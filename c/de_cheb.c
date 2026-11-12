/* c/de_cheb.c
 *
 * Fits Chebyshev series to DE442 for the app's Earth-Moon ephemeris
 * (docs/physics/ephemerides-and-gm.md#de442-in-the-app): the Moon relative
 * to Earth and Earth relative to the Sun, J2000 equatorial, km, against TDB
 * seconds past J2000. Writes a little-endian Float64 file that
 * src/physics/deTable.js reads.
 *
 *   usage: de_cheb <out.bin> <first year> <last year (exclusive)>
 *
 * Each body's span is cut into equal intervals; on each the series is fitted
 * at the Chebyshev-Gauss nodes (a discrete cosine transform, exact for a
 * polynomial of that degree), then checked against spkezr_c at points
 * between the nodes. The worst position error is printed per body.
 *
 * File layout (all Float64):
 *   [0] format version (1), [1] number of bodies
 *   per body, 5 values: id (1 Moon wrt Earth, 2 Earth wrt Sun),
 *     t0 (TDB s past J2000), interval length (s), intervals, coefficients
 *   then per body, per interval: x coefficients, y, z.
 */

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include "SpiceUsr.h"

typedef struct { int id; const char *target, *center; double days; int ncoef; } Body;
static const Body BODIES[] = {
  { 1, "MOON", "EARTH", 8.0, 14 },
  { 2, "EARTH", "SUN", 16.0, 16 },
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

int main(int argc, char **argv) {
  if (argc != 4) { fprintf(stderr, "usage: %s <out.bin> <first year> <last year>\n", argv[0]); return 1; }
  char outpath[4096], cwd[2048];
  if (argv[1][0] == '/') snprintf(outpath, sizeof outpath, "%s", argv[1]);
  else {
    if (!getcwd(cwd, sizeof cwd)) { perror("getcwd"); return 1; }
    snprintf(outpath, sizeof outpath, "%s/%s", cwd, argv[1]);
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

  FILE *f = fopen(outpath, "wb");
  if (!f) { perror(outpath); return 1; }
  double head[2] = { 1, NB };
  fwrite(head, sizeof(double), 2, f);
  int nint[NB];
  for (int k = 0; k < NB; k++) {
    const double len = BODIES[k].days * 86400.0;
    nint[k] = (int)ceil((et1 - et0) / len);
    double h[5] = { BODIES[k].id, et0, len, nint[k], BODIES[k].ncoef };
    fwrite(h, sizeof(double), 5, f);
  }
  for (int k = 0; k < NB; k++) {
    const Body *b = &BODIES[k];
    const int n = b->ncoef;
    const double len = b->days * 86400.0;
    double *fx = malloc(sizeof(double) * 3 * n), *c = malloc(sizeof(double) * 3 * n);
    double worst = 0, worstEt = 0;
    for (int i = 0; i < nint[k]; i++) {
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
        double p[3], e = 0;
        pos(b, et, p);
        for (int d = 0; d < 3; d++) { const double r = cheb(c + d * n, n, x) - p[d]; e += r * r; }
        e = sqrt(e);
        if (e > worst) { worst = e; worstEt = et; }
      }
    }
    char u[40];
    et2utc_c(worstEt, "ISOC", 0, sizeof u, u);
    fprintf(stderr, "%s wrt %s: %d intervals of %.0f d, %d coefficients; worst %.3f m (at %s)\n",
            b->target, b->center, nint[k], b->days, n, worst * 1000, u);
    free(fx); free(c);
  }
  fclose(f);
  return 0;
}
