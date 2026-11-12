/* c/artemis2_ref.c
 *
 * Samples the reconstructed Artemis II trajectory for the validation in
 * docs/validation/artemis2.md: Orion's geocentric J2000 state from NAIF's
 * SPK of the JSC/FOD/NAV best estimated trajectory (BET revF), and the
 * Moon's geocentric state from DE442 at the same instants.
 *
 *   usage: artemis2_ref <output.json> <step seconds>
 *
 * The SPK is in continuous segments that break at manoeuvres; each sample
 * records its segment, and the segments' bounds are written too. Times are
 * written as UTC (ISO, ms) so the JavaScript side, which runs on UTC, needs
 * no time-scale conversion. Kernels: python/data/metakernel.tm plus
 *   spk/missions/artemis2/art002_rec_260402_260410_jsc_bet_revf.bsp
 *   spk/missions/artemis2/art002_rec_260402_260410_jsc_bet_revf_gapfill.bsp
 * from https://naif.jpl.nasa.gov/pub/naif/ARTEMIS/kernels/spk/.
 */

#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include "SpiceUsr.h"

#define ORION "-24"
#define MAIN_SPK "data/kernels/spk/missions/artemis2/art002_rec_260402_260410_jsc_bet_revf.bsp"
#define GAP_SPK "data/kernels/spk/missions/artemis2/art002_rec_260402_260410_jsc_bet_revf_gapfill.bsp"
#define MAXWIN 64

static void die_if_failed(const char *what) {
  if (failed_c()) {
    char msg[1841];
    getmsg_c("LONG", sizeof msg, msg);
    fprintf(stderr, "%s: %s\n", what, msg);
    exit(1);
  }
}

int main(int argc, char **argv) {
  if (argc != 3) { fprintf(stderr, "usage: %s <output.json> <step seconds>\n", argv[0]); return 1; }
  const double step = atof(argv[2]);
  if (!(step > 0)) { fprintf(stderr, "step must be positive\n"); return 1; }
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
  furnsh_c(GAP_SPK);
  furnsh_c(MAIN_SPK);
  die_if_failed("furnsh_c(Artemis II SPK)");

  /* The main SPK's coverage: one interval per continuous segment. */
  SPICEDOUBLE_CELL(cover, 2 * MAXWIN);
  spkcov_c(MAIN_SPK, -24, &cover);
  die_if_failed("spkcov_c");
  const int nwin = (int)wncard_c(&cover);

  FILE *f = fopen(outpath, "w");
  if (!f) { perror(outpath); return 1; }
  char tk[128];
  snprintf(tk, sizeof tk, "%s", tkvrsn_c("TOOLKIT"));
  fprintf(f, "{\n  \"source\": \"NAIF art002_rec_260402_260410_jsc_bet_revf.bsp (JSC/FOD/NAV BET revF, Orion -24 wrt Earth, J2000); Moon from DE442\",\n");
  fprintf(f, "  \"toolkit\": \"%s\",\n  \"stepSeconds\": %.3f,\n  \"frame\": \"J2000 (EQJ), km and km/s, geocentric\",\n", tk, step);
  fprintf(f, "  \"fields\": [\"utc\", \"segment\", \"x\", \"y\", \"z\", \"vx\", \"vy\", \"vz\", \"moonX\", \"moonY\", \"moonZ\", \"moonVx\", \"moonVy\", \"moonVz\"],\n");
  fprintf(f, "  \"segments\": [\n");
  for (int i = 0; i < nwin; i++) {
    double a, b;
    char ua[40], ub[40];
    wnfetd_c(&cover, i, &a, &b);
    et2utc_c(a, "ISOC", 3, sizeof ua, ua);
    et2utc_c(b, "ISOC", 3, sizeof ub, ub);
    fprintf(f, "    [\"%sZ\", \"%sZ\"]%s\n", ua, ub, i + 1 < nwin ? "," : "");
  }
  fprintf(f, "  ],\n  \"states\": [\n");
  int first = 1;
  for (int i = 0; i < nwin; i++) {
    double a, b;
    wnfetd_c(&cover, i, &a, &b);
    /* Samples on the step grid inside the segment, plus its two ends. */
    for (double et = a;; ) {
      double s[6], lt, m[6];
      char u[40];
      spkezr_c(ORION, et, "J2000", "NONE", "EARTH", s, &lt);
      spkezr_c("MOON", et, "J2000", "NONE", "EARTH", m, &lt);
      die_if_failed("spkezr_c");
      et2utc_c(et, "ISOC", 3, sizeof u, u);
      fprintf(f, "%s    [\"%sZ\", %d, %.6f, %.6f, %.6f, %.9f, %.9f, %.9f, %.3f, %.3f, %.3f, %.9f, %.9f, %.9f]",
              first ? "" : ",\n", u, i, s[0], s[1], s[2], s[3], s[4], s[5], m[0], m[1], m[2], m[3], m[4], m[5]);
      first = 0;
      if (et >= b) break;
      et = et + step > b ? b : et + step;
    }
  }
  fprintf(f, "\n  ]\n}\n");
  fclose(f);
  return 0;
}
