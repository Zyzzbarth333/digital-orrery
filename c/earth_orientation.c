/*
 * earth_orientation.c
 *
 * Samples NAIF's ITRF93 Earth orientation (the J2000 -> ITRF93 rotation of
 * the binary Earth PCKs) for src/physics/eop.build.mjs, which fits each
 * day's Earth orientation parameters to it with the app's own IAU 1976/1980
 * model (earthRotation.js) and writes public/ephemeris/earth-orientation-*.bin.
 *
 * Two segments, one per kernel, each read alone so that neither borrows
 * from the other:
 *   0  earth_latest_high_prec.bpc     measured EOP to its last datum, then
 *                                     JPL's short-term prediction
 *   1  earth_*_predict.bpc            from where the first file ends: NAIF's
 *                                     long-term extension (polar motion and
 *                                     nutation corrections held, UT1 at the
 *                                     rate of TAI apart from the zonal tides)
 *
 * For each day at 0h UTC it samples seven instants an hour apart, centred
 * on 0h, shifted to stay inside the segment at its ends, so the fit can tell
 * the terrestrial (polar motion) from the celestial (nutation correction)
 * part by the Earth's turn between them.
 *
 * Output: little-endian doubles. A header [1, nseg, nsamp], then per
 * segment [first MJD (UTC), number of days], then per day per sample
 * [TT seconds past J2000, the J2000 -> ITRF93 matrix row-major (9)].
 *
 * Usage: earth_orientation <high_prec.bpc> <predict.bpc> <out.bin>
 * (run from the repo root; it loads python/data/kernels/lsk/naif0012.tls).
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "SpiceUsr.h"

#ifndef ORRERY_PYTHON_DIR
#error "ORRERY_PYTHON_DIR must be defined (CMake sets it)"
#endif

#define NSAMP 7
#define HOUR 3600.0

static void die_if_failed(const char *where) {
  if (failed_c()) {
    SpiceChar msg[1841];
    getmsg_c("LONG", sizeof msg, msg);
    fprintf(stderr, "SPICE error in %s:\n%s\n", where, msg);
    exit(2);
  }
}

/* Days since 1970-01-01 -> civil date (Hinnant's algorithm). */
static void civil(long z, int *y, int *m, int *d) {
  z += 719468;
  long era = (z >= 0 ? z : z - 146096) / 146097;
  long doe = z - era * 146097;
  long yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  long doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  long mp = (5 * doy + 2) / 153;
  *d = (int)(doy - (153 * mp + 2) / 5 + 1);
  *m = (int)(mp < 10 ? mp + 3 : mp - 9);
  *y = (int)(yoe + era * 400 + (*m <= 2));
}

static double et_of_day(long unixDay) {
  int y, m, d;
  civil(unixDay, &y, &m, &d);
  char s[64];
  snprintf(s, sizeof s, "%04d-%02d-%02d 00:00:00 UTC", y, m, d);
  SpiceDouble et;
  str2et_c(s, &et);
  die_if_failed(s);
  return et;
}

/* Coverage of the ITRF93 (body 3000) data in a binary PCK. */
static void coverage(const char *file, double *a, double *b) {
  SPICEDOUBLE_CELL(cover, 2000);
  scard_c(0, &cover);
  pckcov_c(file, 3000, &cover);
  die_if_failed(file);
  SpiceInt n = wncard_c(&cover);
  if (n < 1) { fprintf(stderr, "%s: no ITRF93 data\n", file); exit(2); }
  SpiceDouble lo, hi;
  wnfetd_c(&cover, 0, &lo, &hi);
  *a = lo;
  wnfetd_c(&cover, n - 1, &lo, &hi);
  *b = hi;
  if (n > 1) fprintf(stderr, "%s: %d coverage windows; using their span\n", file, (int)n);
}

/* Days (UTC 0h) from the first at or after a to the last at or before b. */
static void day_range(double a, double b, long *first, long *last) {
  long d = (long)((a / 86400.0) + 10957.5) - 2;   /* 10957.5: Unix days at J2000 */
  while (et_of_day(d) < a - 1e-3) d++;
  *first = d;
  d = (long)((b / 86400.0) + 10957.5) + 2;
  while (et_of_day(d) > b + 1e-3) d--;
  *last = d;
}

static void put(FILE *f, const double *v, int n) {
  if (fwrite(v, sizeof(double), n, f) != (size_t)n) { perror("write"); exit(1); }
}

static void segment(FILE *f, const char *file, double a, double b, long first, long last) {
  furnsh_c(file);
  die_if_failed(file);
  for (long d = first; d <= last; d++) {
    double et0 = et_of_day(d);
    /* Centred window, shifted inside [a, b]. */
    double lo = et0 - 3 * HOUR;
    if (lo < a) lo = a;
    if (lo + 6 * HOUR > b) lo = b - 6 * HOUR;
    for (int k = 0; k < NSAMP; k++) {
      double et = lo + k * HOUR;
      SpiceDouble m[3][3];
      pxform_c("J2000", "ITRF93", et, m);
      die_if_failed("pxform_c");
      double row[10];
      row[0] = unitim_c(et, "TDB", "TT");
      memcpy(row + 1, &m[0][0], 9 * sizeof(double));
      put(f, row, 10);
    }
  }
  unload_c(file);
}

int main(int argc, char **argv) {
  if (argc != 4) {
    fprintf(stderr, "usage: %s <high_prec.bpc> <predict.bpc> <out.bin>\n", argv[0]);
    return 1;
  }
  erract_c("SET", 0, "RETURN");
  errprt_c("SET", 0, "NONE");
  char lsk[4096];
  snprintf(lsk, sizeof lsk, "%s/data/kernels/lsk/naif0012.tls", ORRERY_PYTHON_DIR);
  furnsh_c(lsk);
  die_if_failed(lsk);

  double hp0, hp1, pr0, pr1;
  coverage(argv[1], &hp0, &hp1);
  coverage(argv[2], &pr0, &pr1);
  if (pr0 > hp1 || pr1 <= hp1) { fprintf(stderr, "the predict file must continue the high-precision one\n"); return 2; }

  long f0, l0, f1, l1;
  day_range(hp0, hp1, &f0, &l0);
  day_range(hp1, pr1, &f1, &l1);
  /* The second segment starts on the day the first ends. */

  FILE *f = fopen(argv[3], "wb");
  if (!f) { perror(argv[3]); return 1; }
  double head[3] = {1, 2, NSAMP};
  put(f, head, 3);
  double s0[2] = {f0 + 40587.0, (double)(l0 - f0 + 1)}, s1[2] = {f1 + 40587.0, (double)(l1 - f1 + 1)};
  put(f, s0, 2);
  put(f, s1, 2);
  segment(f, argv[1], hp0, hp1, f0, l0);
  segment(f, argv[2], hp1, pr1, f1, l1);
  if (ferror(f) | fclose(f)) { perror(argv[3]); return 1; }
  fprintf(stderr, "wrote %s: %ld + %ld days (MJD %ld-%ld, %ld-%ld)\n", argv[3], l0 - f0 + 1, l1 - f1 + 1,
          f0 + 40587, l0 + 40587, f1 + 40587, l1 + 40587);
  return 0;
}
