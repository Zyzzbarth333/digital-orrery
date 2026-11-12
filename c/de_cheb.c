/* c/de_cheb.c
 *
 * Fits Chebyshev series to DE442 for the app's Earth-Moon ephemeris
 * (docs/physics/ephemerides-and-gm.md#de442-in-the-app): the Moon relative
 * to the Earth, and the Earth-Moon barycentre relative to the Sun, J2000
 * equatorial, km, against TDB seconds past J2000. The Earth is then
 *   Earth = EMB - k (Moon - Earth),  k = GM_moon / (GM_earth + GM_moon),
 * as JPL's own ephemerides store it. The barycentre moves smoothly; the
 * Earth itself swings 4,700 km round it every month, which a series of the
 * Earth relative to the Sun fits only to 0.5 m and, worse, with an
 * acceleration that ripples by 1e-8 m/s^2 and jumps at the joins (an
 * orbit about the Earth follows the table's Earth).
 *
 *   usage: de_cheb <out.bin> <first year> <last year (exclusive)>
 *
 * Each body's span is cut into equal intervals; on each the series is fitted
 * at the Chebyshev-Gauss nodes (a discrete cosine transform, exact for a
 * polynomial of that degree), then checked against spkezr_c between the
 * nodes: position, and acceleration (the series' second derivative against
 * a second difference of SPICE positions), and the jumps in position,
 * velocity and acceleration where intervals meet. The derived Earth is
 * checked the same way.
 *
 * File layout (all Float64):
 *   [0] format version (2), [1] number of bodies, [2] k
 *   per body, 5 values: id (1 Moon wrt Earth, 3 EMB wrt Sun),
 *     t0 (TDB s past J2000), interval length (s), intervals, coefficients
 *   then per body, per interval: x coefficients, y, z.
 */

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include "SpiceUsr.h"

typedef struct { int id; const char *target, *center; double days; int ncoef; } Body;
static Body BODIES[] = {
  { 1, "MOON", "EARTH", 8.0, 18 },
  { 3, "EARTH BARYCENTER", "SUN", 16.0, 14 },
};
#define NB ((int)(sizeof BODIES / sizeof BODIES[0]))

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

/* SPICE acceleration by a second difference of positions (h = 300 s). */
static void accel_ref(const Body *b, double et, double a[3]) {
  double p0[3], p1[3], p2[3];
  const double h = 300;
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
  /* Tuning: MOON_DAYS, MOON_N, EMB_DAYS, EMB_N override the defaults. */
  if (getenv("MOON_DAYS")) BODIES[0].days = atof(getenv("MOON_DAYS"));
  if (getenv("MOON_N")) BODIES[0].ncoef = atoi(getenv("MOON_N"));
  if (getenv("EMB_DAYS")) BODIES[1].days = atof(getenv("EMB_DAYS"));
  if (getenv("EMB_N")) BODIES[1].ncoef = atoi(getenv("EMB_N"));
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
  double head[3] = { 2, NB, kMoon };
  fwrite(head, sizeof(double), 3, f);
  int nint[NB];
  for (int k = 0; k < NB; k++) {
    const double len = BODIES[k].days * 86400.0;
    nint[k] = (int)ceil((et1 - et0) / len);
    double h[5] = { BODIES[k].id, et0, len, nint[k], BODIES[k].ncoef };
    fwrite(h, sizeof(double), 5, f);
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
        accel_ref(b, et, ar);
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
    const Body earth = { 0, "EARTH", "SUN", 0, 0 };
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
      accel_ref(&earth, et, ar);
      if (dist3(r, p) > worst) worst = dist3(r, p);
      if (dist3(ac, ar) > worstA) worstA = dist3(ac, ar);
    }
    fprintf(stderr, "EARTH wrt SUN (derived, k = %.12f): worst %.4f m, acceleration %.1e m/s^2\n", kMoon, worst * 1000, worstA * 1000);
  }
  fclose(f);
  return 0;
}
