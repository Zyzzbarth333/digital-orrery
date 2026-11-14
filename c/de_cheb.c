/* c/de_cheb.c
 *
 * Fits Chebyshev series to DE442 for the app's ephemeris
 * (docs/physics/ephemerides-and-gm.md#de442-in-the-app), J2000 equatorial,
 * km, against TDB seconds past J2000:
 *   - the Moon relative to the Earth, and the Earth-Moon barycentre (EMB)
 *     relative to the Sun. The Earth is then
 *       Earth = EMB - k (Moon - Earth),  k = GM_moon / (GM_earth + GM_moon),
 *     as JPL's own ephemerides store it. The barycentre moves smoothly; the
 *     Earth itself swings 4,700 km round it every month, which a series of
 *     the Earth relative to the Sun fits only to 0.5 m and, worse, with an
 *     acceleration that ripples by 1e-8 m/s^2 and jumps at the joins (an
 *     orbit about the Earth follows the table's Earth).
 *   - Mercury, Venus and the Mars system barycentre relative to the Sun.
 *   - the Jupiter to Pluto system barycentres, and the Sun, relative to the
 *     solar system barycentre (SSB). Heliocentric, an outer planet carries
 *     the Sun's own wobble (450 km a year from the Earth, 260 km every 225
 *     days from Venus), which would need short intervals; about the SSB it
 *     moves on a smooth arc a few coefficients per year cover. The app
 *     subtracts the Sun's series: planet - Sun.
 *
 *   usage: de_cheb <out.bin> <first year> <last year (exclusive)>
 *
 * Each body's span is cut into equal intervals; on each the series is fitted
 * at the Chebyshev-Gauss nodes (a discrete cosine transform, exact for a
 * polynomial of that degree), then checked against spkezr_c between the
 * nodes: position, and acceleration (the series' second derivative against
 * a second difference of SPICE positions), and the jumps in position,
 * velocity and acceleration where intervals meet. The derived Earth, and each
 * body as the app composes it relative to the Sun, are checked the same way.
 *
 * Tuning: DAYS_<id> and N_<id> override a series' interval length and
 * coefficient count (id: the target's NAIF code, 301 for the Moon).
 *
 * File layout (all Float64):
 *   [0] format version (3), [1] number of series, [2] k
 *   per series, 6 values: target, centre (NAIF codes: 301 Moon, 399 Earth,
 *     1-9 system barycentres, 10 Sun, 0 SSB), t0 (TDB s past J2000),
 *     interval length (s), intervals, coefficients
 *   then per series, per interval: x coefficients, y, z.
 */

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include "SpiceUsr.h"

typedef struct { int id, centre; const char *target, *center; double days; int ncoef; } Body;
static Body BODIES[] = {
  { 301, 399, "MOON", "EARTH", 8.0, 18 },
  { 3, 10, "EARTH BARYCENTER", "SUN", 16.0, 14 },
  { 1, 10, "MERCURY BARYCENTER", "SUN", 16.0, 16 },
  { 2, 10, "VENUS BARYCENTER", "SUN", 32.0, 13 },
  { 4, 10, "MARS BARYCENTER", "SUN", 32.0, 12 },
  { 10, 0, "SUN", "SOLAR SYSTEM BARYCENTER", 32.0, 12 },
  { 5, 0, "JUPITER BARYCENTER", "SOLAR SYSTEM BARYCENTER", 128.0, 10 },
  { 6, 0, "SATURN BARYCENTER", "SOLAR SYSTEM BARYCENTER", 256.0, 11 },
  { 7, 0, "URANUS BARYCENTER", "SOLAR SYSTEM BARYCENTER", 512.0, 12 },
  { 8, 0, "NEPTUNE BARYCENTER", "SOLAR SYSTEM BARYCENTER", 1024.0, 12 },
  { 9, 0, "PLUTO BARYCENTER", "SOLAR SYSTEM BARYCENTER", 1024.0, 12 },
};
#define NB ((int)(sizeof BODIES / sizeof BODIES[0]))
#define SUN_SERIES 5

static void die_if_failed(const char *what) {
  if (failed_c()) {
    char msg[1841];
    getmsg_c("LONG", sizeof msg, msg);
    fprintf(stderr, "%s: %s\n", what, msg);
    exit(1);
  }
}

static void pos(const Body *b, double et, double out[3]) {
  double s[6], lt;
  spkezr_c(b->target, et, "J2000", "NONE", b->center, s, &lt);
  out[0] = s[0]; out[1] = s[1]; out[2] = s[2];
}

/* Clenshaw evaluation of sum c_j T_j(x). */
static double cheb(const double *c, int n, double x) {
  double b0 = 0, b1 = 0, b2 = 0;
  for (int j = n - 1; j >= 1; j--) { b0 = 2 * x * b1 - b2 + c[j]; b2 = b1; b1 = b0; }
  return x * b1 - b2 + c[0];
}

/* Coefficients of d/dx of sum c_j T_j (the standard recurrence). */
static void cheb_deriv(const double *c, int n, double *d) {
  d[n - 1] = 0;
  if (n > 1) d[n - 2] = 2 * (n - 1) * c[n - 1];
  for (int j = n - 3; j >= 0; j--) d[j] = d[j + 2] + 2 * (j + 1) * c[j + 1];
  d[0] /= 2;
}

/* Position, velocity and acceleration of interval coefficients c (3 x n)
 * at x, with time scale len. */
static void state3(const double *c, int n, double x, double len, double r[3], double v[3], double a[3]) {
  double d1[32], d2[32];
  for (int d = 0; d < 3; d++) {
    cheb_deriv(c + d * n, n, d1);
    cheb_deriv(d1, n, d2);
    r[d] = cheb(c + d * n, n, x);
    v[d] = cheb(d1, n, x) * 2 / len;
    a[d] = cheb(d2, n, x) * 4 / (len * len);
  }
}

static double dist3(const double a[3], const double b[3]) {
  return sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]) + (a[2] - b[2]) * (a[2] - b[2]));
}

/* SPICE acceleration by a second difference of positions, h apart: 300 s
 * for the short series; longer for the outer planets, whose positions are so
 * large that rounding over 300 s would swamp their small accelerations. */
static void accel_ref(const Body *b, double et, double h, double a[3]) {
  double p0[3], p1[3], p2[3];
  pos(b, et - h, p0); pos(b, et, p1); pos(b, et + h, p2);
  for (int d = 0; d < 3; d++) a[d] = (p2[d] - 2 * p1[d] + p0[d]) / (h * h);
}

int main(int argc, char **argv) {
  if (argc != 4) { fprintf(stderr, "usage: %s <out.bin> <first year> <last year>\n", argv[0]); return 1; }
  char outpath[4096], cwd[2048];
  if (argv[1][0] == '/') snprintf(outpath, sizeof outpath, "%s", argv[1]);
  else {
    if (!getcwd(cwd, sizeof cwd)) { perror("getcwd"); return 1; }
    snprintf(outpath, sizeof outpath, "%s/%s", cwd, argv[1]);
  }
  for (int k = 0; k < NB; k++) {
    char name[32];
    snprintf(name, sizeof name, "DAYS_%d", BODIES[k].id);
    if (getenv(name)) BODIES[k].days = atof(getenv(name));
    snprintf(name, sizeof name, "N_%d", BODIES[k].id);
    if (getenv(name)) BODIES[k].ncoef = atoi(getenv(name));
  }
  erract_c("SET", 0, "RETURN");
  errprt_c("SET", 0, "NONE");
  if (chdir(ORRERY_PYTHON_DIR) != 0) { perror(ORRERY_PYTHON_DIR); return 1; }
  furnsh_c("data/metakernel.tm");
  die_if_failed("furnsh_c(metakernel)");

  char s0[32], s1[32];
  snprintf(s0, sizeof s0, "%s-01-01 00:00:00 TDB", argv[2]);
  snprintf(s1, sizeof s1, "%s-01-01 00:00:00 TDB", argv[3]);
  double et0, et1;
  str2et_c(s0, &et0);
  str2et_c(s1, &et1);
  die_if_failed("str2et_c");

  double gmE, gmM;
  int dim;
  bodvrd_c("EARTH", "GM", 1, &dim, &gmE);
  bodvrd_c("MOON", "GM", 1, &dim, &gmM);
  die_if_failed("bodvrd_c(GM)");
  const double kMoon = gmM / (gmE + gmM);

  FILE *f = fopen(outpath, "wb");
  if (!f) { perror(outpath); return 1; }
  double head[3] = { 3, NB, kMoon };
  fwrite(head, sizeof(double), 3, f);
  int nint[NB];
  for (int k = 0; k < NB; k++) {
    const double len = BODIES[k].days * 86400.0;
    nint[k] = (int)ceil((et1 - et0) / len);
    double h[6] = { BODIES[k].id, BODIES[k].centre, et0, len, nint[k], BODIES[k].ncoef };
    fwrite(h, sizeof(double), 6, f);
  }
  double *all[NB];
  for (int k = 0; k < NB; k++) {
    const Body *b = &BODIES[k];
    const int n = b->ncoef;
    const double len = b->days * 86400.0;
    double *fx = malloc(sizeof(double) * 3 * n);
    all[k] = malloc(sizeof(double) * 3 * n * nint[k]);
    double worst = 0, worstA = 0, jumpR = 0, jumpV = 0, jumpA = 0;
    for (int i = 0; i < nint[k]; i++) {
      double *c = all[k] + (size_t)i * 3 * n;
      const double a = et0 + i * len, mid = a + len / 2;
      for (int q = 0; q < n; q++) {
        const double x = cos(M_PI * (q + 0.5) / n);
        double p[3];
        pos(b, mid + x * len / 2, p);
        for (int d = 0; d < 3; d++) fx[d * n + q] = p[d];
      }
      for (int d = 0; d < 3; d++)
        for (int j = 0; j < n; j++) {
          double s = 0;
          for (int q = 0; q < n; q++) s += fx[d * n + q] * cos(M_PI * j * (q + 0.5) / n);
          c[d * n + j] = (j == 0 ? 1.0 : 2.0) * s / n;
        }
      die_if_failed("spkezr_c");
      fwrite(c, sizeof(double), 3 * n, f);
      /* Check between the nodes, and at both ends. */
      for (int t = 0; t <= 16; t++) {
        const double x = -1 + t / 8.0, et = mid + x * len / 2;
        double p[3], r[3], v[3], ac[3], ar[3];
        pos(b, et, p);
        state3(c, n, x, len, r, v, ac);
        if (dist3(r, p) > worst) worst = dist3(r, p);
        accel_ref(b, et, b->days > 64 ? 86400 : 300, ar);
        if (dist3(ac, ar) > worstA) worstA = dist3(ac, ar);
      }
      if (i > 0) {
        double r0[3], v0[3], a0[3], r1[3], v1[3], a1[3];
        state3(c - 3 * n, n, 1, len, r0, v0, a0);
        state3(c, n, -1, len, r1, v1, a1);
        if (dist3(r0, r1) > jumpR) jumpR = dist3(r0, r1);
        if (dist3(v0, v1) > jumpV) jumpV = dist3(v0, v1);
        if (dist3(a0, a1) > jumpA) jumpA = dist3(a0, a1);
      }
    }
    fprintf(stderr, "%s wrt %s: %d intervals of %.1f d, %d coefficients; worst %.4f m, acceleration %.1e m/s^2; jumps %.1e m, %.1e m/s, %.1e m/s^2\n",
            b->target, b->center, nint[k], b->days, n, worst * 1000, worstA * 1000, jumpR * 1000, jumpV * 1000, jumpA * 1000);
    free(fx);
  }
  /* The derived Earth, against SPICE's Earth relative to the Sun. */
  {
    const Body earth = { 0, 0, "EARTH", "SUN", 0, 0 };
    const Body *M = &BODIES[0], *E = &BODIES[1];
    const double lm = M->days * 86400.0, le = E->days * 86400.0;
    double worst = 0, worstA = 0;
    for (double et = et0 + 1000; et < et1 - 1000; et += 86400.0 * 0.37) {
      const int im = (int)((et - et0) / lm), ie = (int)((et - et0) / le);
      const double xm = 2 * (et - (et0 + im * lm)) / lm - 1, xe = 2 * (et - (et0 + ie * le)) / le - 1;
      double rm[3], vm[3], am[3], re[3], ve[3], ae[3], p[3], ar[3], r[3], ac[3];
      state3(all[0] + (size_t)im * 3 * M->ncoef, M->ncoef, xm, lm, rm, vm, am);
      state3(all[1] + (size_t)ie * 3 * E->ncoef, E->ncoef, xe, le, re, ve, ae);
      for (int d = 0; d < 3; d++) { r[d] = re[d] - kMoon * rm[d]; ac[d] = ae[d] - kMoon * am[d]; }
      pos(&earth, et, p);
      accel_ref(&earth, et, 300, ar);
      if (dist3(r, p) > worst) worst = dist3(r, p);
      if (dist3(ac, ar) > worstA) worstA = dist3(ac, ar);
    }
    fprintf(stderr, "EARTH wrt SUN (derived, k = %.12f): worst %.4f m, acceleration %.1e m/s^2\n", kMoon, worst * 1000, worstA * 1000);
  }
  /* Each planet relative to the Sun, as the app composes it (an outer one
   * less the Sun's series), against SPICE's. */
  for (int k = 2; k < NB; k++) {
    if (k == SUN_SERIES) continue;
    const Body *B = &BODIES[k], *S = &BODIES[SUN_SERIES];
    const Body helio = { 0, 0, B->target, "SUN", 0, 0 };
    const double lb = B->days * 86400.0, ls = S->days * 86400.0;
    const double h = B->centre == 0 ? 3600 : 300;
    double worst = 0, worstA = 0;
    for (double et = et0 + 1000; et < et1 - 1000; et += 86400.0 * 0.37) {
      const int ib = (int)((et - et0) / lb), is = (int)((et - et0) / ls);
      const double xb = 2 * (et - (et0 + ib * lb)) / lb - 1, xs = 2 * (et - (et0 + is * ls)) / ls - 1;
      double r[3], v[3], ac[3], rs[3], vs[3], as[3], p[3], ar[3];
      state3(all[k] + (size_t)ib * 3 * B->ncoef, B->ncoef, xb, lb, r, v, ac);
      if (B->centre == 0) {
        state3(all[SUN_SERIES] + (size_t)is * 3 * S->ncoef, S->ncoef, xs, ls, rs, vs, as);
        for (int d = 0; d < 3; d++) { r[d] -= rs[d]; ac[d] -= as[d]; }
      }
      pos(&helio, et, p);
      accel_ref(&helio, et, h, ar);
      if (dist3(r, p) > worst) worst = dist3(r, p);
      if (dist3(ac, ar) > worstA) worstA = dist3(ac, ar);
    }
    fprintf(stderr, "%s wrt SUN (as the app composes it): worst %.4f m, acceleration %.1e m/s^2\n", B->target, worst * 1000, worstA * 1000);
  }
  fclose(f);
  return 0;
}
