/* c/sb_cheb.c
 *
 * Fits Chebyshev series to JPL's SB441 asteroid ephemerides for the app
 * (docs/frontend/small-bodies.md#exact-positions-for-the-largest), as
 * c/de_cheb.c does for the Earth and the Moon: J2000 equatorial, km, against
 * TDB seconds past J2000.
 *
 *   usage: sb_cheb <out.bin> <first year> <last year (exclusive)> <tol km>
 *                  <lsk> <planetary spk> <asteroid spk> id ...
 *
 * Each asteroid is fitted relative to the solar-system barycentre, and the
 * Sun relative to it once; the app takes the difference. Heliocentric
 * positions carry the Sun's own wobble about the barycentre (Venus's and the
 * Earth's pull swing it by hundreds of km over months), which a series of
 * each asteroid would have to follow: barycentric, the asteroids are smooth
 * and their series less than half as long (16 asteroids: 0.55 MB
 * heliocentric, 0.24 MB barycentric plus 0.06 MB for the Sun). The SB441
 * files give each asteroid relative to the Sun; the barycentric position
 * adds the planetary SPK's Sun, and the app subtracts the series of that
 * same Sun, so which DE the Sun comes from cancels out.
 *
 * Each body gets its own interval length and number of coefficients, the
 * series interpolating the SPK at the Chebyshev-Lobatto points (both ends
 * among them, so position is continuous where intervals meet): of the pairs
 * (n, days) with n from 6 to 20 and days from CANDIDATE_DAYS, the one that
 * stores the fewest coefficients per day while the series stays within tol
 * of the SPK everywhere (checked between the nodes, 16 points an interval,
 * and at both ends). The Sun is held to tol / 10. Then the heliocentric
 * difference is checked against the SPK's heliocentric position and
 * velocity, every 0.37 days.
 *
 * File layout (all Float64), version 1:
 *   [0] format version (1), [1] number of series
 *   per series, 5 values: NAIF id (10 the Sun, 2000000 + number an
 *     asteroid), t0 (TDB s past J2000), interval length (s), intervals,
 *     coefficients
 *   then per series, per interval: x coefficients, y, z.
 * The first series is the Sun's; every series is relative to the
 * solar-system barycentre.
 *
 * With SB_REFERENCE=<file.json> set it also writes the SPK's heliocentric
 * states of each asteroid on the dates asteroids.horizons.mjs asks Horizons
 * for (src/physics/fixtures/asteroids_sb441.json), so the JavaScript tests
 * check the table against SB441 itself without SPICE.
 */

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "SpiceUsr.h"

static const double CANDIDATE_DAYS[] = { 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512, 768, 1024, 1536, 2048 };
#define ND ((int)(sizeof CANDIDATE_DAYS / sizeof CANDIDATE_DAYS[0]))
#define NMIN 6
#define NMAX 20

static void die_if_failed(const char *what) {
  if (failed_c()) {
    char msg[1841];
    getmsg_c("LONG", sizeof msg, msg);
    fprintf(stderr, "%s: %s\n", what, msg);
    exit(1);
  }
}

/* Position of id relative to the barycentre (0). */
static void pos(int id, double et, double out[3]) {
  double lt;
  spkezp_c(id, et, "J2000", "NONE", 0, out, &lt);
}

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

/* Fits body id over [et0, et0 + nint len) with n coefficients, writing
 * into c (nint x 3 x n) when it is not NULL. Returns the worst position
 * error (km), or stops early and returns it as soon as it passes tol. */
static double fit(int id, double et0, int nint, double len, int n, double tol, double *c) {
  double fx[3 * NMAX], cc[3 * NMAX], worst = 0;
  const int N = n - 1;
  for (int i = 0; i < nint; i++) {
    const double mid = et0 + i * len + len / 2;
    /* Interpolated at the Chebyshev-Lobatto points x_q = cos(pi q / N),
     * which include both ends: neighbouring intervals meet at the same SPK
     * position, so the table has no jumps in position. */
    for (int q = 0; q <= N; q++) {
      double p[3];
      pos(id, mid + cos(M_PI * q / N) * len / 2, p);
      for (int d = 0; d < 3; d++) fx[d * n + q] = p[d];
    }
    for (int d = 0; d < 3; d++)
      for (int j = 0; j <= N; j++) {
        double s = 0;
        for (int q = 0; q <= N; q++) s += (q == 0 || q == N ? 0.5 : 1.0) * fx[d * n + q] * cos(M_PI * j * q / N);
        cc[d * n + j] = (j == 0 || j == N ? 1.0 : 2.0) * s / N;
      }
    for (int t = 0; t <= 16; t++) {
      const double x = -1 + t / 8.0;
      double p[3], e = 0;
      pos(id, mid + x * len / 2, p);
      for (int d = 0; d < 3; d++) { const double r = cheb(cc + d * n, n, x) - p[d]; e += r * r; }
      e = sqrt(e);
      if (e > worst) worst = e;
    }
    if (worst > tol) return worst;
    if (c) for (int k = 0; k < 3 * n; k++) c[(size_t)i * 3 * n + k] = cc[k];
  }
  die_if_failed("spkezp_c");
  return worst;
}

typedef struct { int id, n, nint; double len, *c; } Series;

/* The cheapest series for id within tol. */
static Series best_series(int id, double et0, double et1, double tol) {
  double best = INFINITY;
  int bestN = 0, bestD = -1;
  for (int n = NMIN; n <= NMAX; n++) {
    for (int di = ND - 1; di >= 0; di--) {
      if (n / CANDIDATE_DAYS[di] >= best) break;
      const double len = CANDIDATE_DAYS[di] * 86400.0;
      if (fit(id, et0, (int)ceil((et1 - et0) / len), len, n, tol, NULL) <= tol) {
        best = n / CANDIDATE_DAYS[di]; bestN = n; bestD = di;
        break;
      }
    }
  }
  if (bestD < 0) { fprintf(stderr, "%d: no series within %.3f km\n", id, tol); exit(1); }
  Series s = { id, bestN, 0, CANDIDATE_DAYS[bestD] * 86400.0, NULL };
  s.nint = (int)ceil((et1 - et0) / s.len);
  s.c = malloc(sizeof(double) * 3 * s.n * s.nint);
  fit(id, et0, s.nint, s.len, s.n, INFINITY, s.c);
  return s;
}

/* Position and velocity of a series at et. */
static void state(const Series *s, double et0, double et, double r[3], double v[3]) {
  int i = (int)floor((et - et0) / s->len);
  if (i >= s->nint) i = s->nint - 1;
  const double x = 2 * (et - (et0 + i * s->len)) / s->len - 1;
  double d1[NMAX];
  for (int d = 0; d < 3; d++) {
    const double *c = s->c + (size_t)i * 3 * s->n + d * s->n;
    cheb_deriv(c, s->n, d1);
    r[d] = cheb(c, s->n, x);
    v[d] = cheb(d1, s->n, x) * 2 / s->len;
  }
}

int main(int argc, char **argv) {
  if (argc < 9) {
    fprintf(stderr, "usage: %s <out.bin> <first year> <last year> <tol km> <lsk> <planetary spk> <asteroid spk> id ...\n", argv[0]);
    return 1;
  }
  erract_c("SET", 0, "RETURN");
  errprt_c("SET", 0, "NONE");
  furnsh_c(argv[5]);
  furnsh_c(argv[6]);
  furnsh_c(argv[7]);
  die_if_failed("furnsh_c");
  const double tol = atof(argv[4]);

  char s0[32], s1[32];
  snprintf(s0, sizeof s0, "%s-01-01 00:00:00 TDB", argv[2]);
  snprintf(s1, sizeof s1, "%s-01-01 00:00:00 TDB", argv[3]);
  double et0, et1;
  str2et_c(s0, &et0);
  str2et_c(s1, &et1);
  die_if_failed("str2et_c");

  const int nb = 1 + argc - 8;
  Series *S = malloc(sizeof(Series) * nb);
  size_t total = 0;
  for (int k = 0; k < nb; k++) {
    const int id = k == 0 ? 10 : atoi(argv[7 + k]);
    S[k] = best_series(id, et0, et1, k == 0 ? tol / 10 : tol);
    total += (size_t)3 * S[k].n * S[k].nint;
    /* The app's heliocentric position (this series less the Sun's) against
     * the SPK's own. */
    double worstR = 0, worstV = 0;
    if (k > 0) {
      for (double et = et0; et <= et1; et += 86400.0 * 0.37) {
        double ra[3], va[3], rs[3], vs[3], st[6], lt;
        state(&S[k], et0, et, ra, va);
        state(&S[0], et0, et, rs, vs);
        spkezr_c(argv[7 + k], et, "J2000", "NONE", "SUN", st, &lt);
        double er = 0, ev = 0;
        for (int d = 0; d < 3; d++) { er += pow(ra[d] - rs[d] - st[d], 2); ev += pow(va[d] - vs[d] - st[3 + d], 2); }
        if (sqrt(er) > worstR) worstR = sqrt(er);
        if (sqrt(ev) > worstV) worstV = sqrt(ev);
      }
      die_if_failed("spkezr_c");
    }
    char name[64];
    SpiceBoolean found;
    bodc2n_c(id, sizeof name, name, &found);
    fprintf(stderr, "%8d %-12s %5.0f d x %2d coefficients, %3d intervals", id, found ? name : "", S[k].len / 86400, S[k].n, S[k].nint);
    if (k > 0) fprintf(stderr, ": heliocentric worst %.3f km, %.1e km/s\n", worstR, worstV);
    else fprintf(stderr, "\n");
  }

  FILE *f = fopen(argv[1], "wb");
  if (!f) { perror(argv[1]); return 1; }
  double head[2] = { 1, nb };
  fwrite(head, sizeof(double), 2, f);
  for (int k = 0; k < nb; k++) {
    double h[5] = { S[k].id, et0, S[k].len, S[k].nint, S[k].n };
    fwrite(h, sizeof(double), 5, f);
  }
  for (int k = 0; k < nb; k++) fwrite(S[k].c, sizeof(double), (size_t)3 * S[k].n * S[k].nint, f);
  fclose(f);

  const char *ref = getenv("SB_REFERENCE");
  if (ref) {
    FILE *g = fopen(ref, "w");
    if (!g) { perror(ref); return 1; }
    const char *base = strrchr(argv[7], '/') ? strrchr(argv[7], '/') + 1 : argv[7];
    fprintf(g, "{\n \"source\": \"JPL %s, heliocentric J2000 equatorial states (km, km/s) from spkezr_c, TDB\",\n \"dates\": [", base);
    const int ny = 11;
    double ets[11];
    for (int y = 0; y < ny; y++) {
      char d[40];
      if (y < ny - 1) snprintf(d, sizeof d, "%d-01-01 12:00:00 TDB", 2000 + 5 * y);
      else snprintf(d, sizeof d, "2049-12-31 12:00:00 TDB");
      str2et_c(d, &ets[y]);
      fprintf(g, "%s\"%.10s\"", y ? ", " : "", d);
    }
    fprintf(g, "],\n \"et\": [");
    for (int y = 0; y < ny; y++) fprintf(g, "%s%.1f", y ? ", " : "", ets[y]);
    fprintf(g, "],\n \"bodies\": {");
    for (int k = 1; k < nb; k++) {
      fprintf(g, "%s\n  \"%d\": [", k > 1 ? "," : "", S[k].id);
      for (int y = 0; y < ny; y++) {
        double st[6], lt;
        spkezr_c(argv[7 + k], ets[y], "J2000", "NONE", "SUN", st, &lt);
        fprintf(g, "%s[%.6f, %.6f, %.6f, %.9f, %.9f, %.9f]", y ? ", " : "", st[0], st[1], st[2], st[3], st[4], st[5]);
      }
      fprintf(g, "]");
    }
    fprintf(g, "\n }\n}\n");
    fclose(g);
    die_if_failed("reference");
  }
  fprintf(stderr, "%d series, %.2f MB\n", nb, (16 + 40.0 * nb + 8.0 * total) / 1e6);
  return 0;
}
