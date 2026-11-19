/* c/flyby_ref.c
 *
 * Samples a body's geometric J2000 state about another from SPK kernels,
 * for the flyby checks where Horizons holds no reconstruction
 * (pipelines/flyby.fetch.mjs). Its output is in the form of a Horizons
 * vector table (VEC_TABLE 2, CSV), between $$SOE and $$EOE, so the fetch
 * script reads both the same way:
 *
 *   JD TDB, calendar, x, y, z, vx, vy, vz,     (km, km/s)
 *
 *   usage: flyby_ref <target> <centre> <start TDB> <stop TDB> <step s> <lsk> <spk>...
 *
 * e.g. flyby_ref -32 8 "1989-08-24 19:00" "1989-08-25 22:00" 600 \
 *        naif0012.tls vgr2_nep097.bsp
 *
 * Times are TDB calendar strings. Steps run from start to stop inclusive.
 */

#include <stdio.h>
#include <stdlib.h>
#include "SpiceUsr.h"

static void die_if_failed(const char *what) {
  if (failed_c()) {
    char msg[1841];
    getmsg_c("LONG", sizeof msg, msg);
    fprintf(stderr, "%s: %s\n", what, msg);
    exit(1);
  }
}

int main(int argc, char **argv) {
  if (argc < 8) {
    fprintf(stderr, "usage: %s <target> <centre> <start TDB> <stop TDB> <step s> <lsk> <spk>...\n", argv[0]);
    return 2;
  }
  erract_c("SET", 0, "RETURN");
  for (int i = 6; i < argc; i++) { furnsh_c(argv[i]); die_if_failed(argv[i]); }
  char t0s[64], t1s[64];
  snprintf(t0s, sizeof t0s, "%s TDB", argv[3]);
  snprintf(t1s, sizeof t1s, "%s TDB", argv[4]);
  SpiceDouble t0, t1, step = atof(argv[5]);
  str2et_c(t0s, &t0); die_if_failed("start");
  str2et_c(t1s, &t1); die_if_failed("stop");
  if (!(step > 0)) { fprintf(stderr, "step must be positive\n"); return 2; }
  printf("Target: %s, centre: %s, J2000 geometric, TDB (flyby_ref, CSPICE)\n$$SOE\n", argv[1], argv[2]);
  long n = (long)((t1 - t0) / step + 1e-9);
  for (long k = 0; k <= n; k++) {
    SpiceDouble et = t0 + k * step, s[6], lt;
    spkezr_c(argv[1], et, "J2000", "NONE", argv[2], s, &lt);
    die_if_failed("spkezr");
    char cal[64];
    timout_c(et, "YYYY-MON-DD HR:MN:SC.### ::TDB", sizeof cal, cal);
    printf("%.9f, A.D. %s, %.6f, %.6f, %.6f, %.9f, %.9f, %.9f,\n",
           2451545.0 + et / 86400.0, cal, s[0], s[1], s[2], s[3], s[4], s[5]);
  }
  printf("$$EOE\n");
  return 0;
}
