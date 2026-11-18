/*
 * landing_sites_ref.c
 *
 * A reference for the Moon's landing sites (docs/frontend/landing-sites.md):
 * where ten of them are in J2000 at several instants, worked out by NAIF's
 * CSPICE alone, for src/physics/landingSites.test.mjs.
 *
 * Each site's published planetocentric latitude and east longitude (the
 * LROC team's, in the mean-Earth/polar-axis frame) is put on a sphere of
 * the Moon's mean radius with latrec_c, then turned from MOON_ME into
 * J2000 with pxform_c (NAIF's moon_pa_de440 PCK and its frame kernel).
 * The app does the same with its own orientation model (orientation.js's
 * bodyAxesEqj('moon')), so the test measures how far from SPICE the app
 * draws each site.
 *
 * The coordinates are typed here from their sources, independently of
 * src/physics/landingSites.js: the test also checks that the two copies
 * agree.
 *
 * Usage: landing_sites_ref <output.json>
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include "SpiceUsr.h"

#ifndef ORRERY_PYTHON_DIR
#error "ORRERY_PYTHON_DIR must be defined (CMake sets it)"
#endif

static void die_if_failed(const char *where) {
  if (failed_c()) {
    SpiceChar msg[1841];
    getmsg_c("LONG", sizeof msg, msg);
    fprintf(stderr, "SPICE error in %s:\n%s\n", where, msg);
    exit(2);
  }
}

/* key, latitude (deg N), east longitude (deg), as the source prints it. */
static const struct { const char *key; double lat, lon; const char *source; } SITES[] = {
  /* LROC, "Coordinates of lunar anthropogenic targets", 28 July 2016
     (Wagner et al., Icarus 283, 2017) */
  {"apollo11", 0.67416, 23.47314, "LROC 2016 table"},
  {"apollo12", -3.0128, 336.5781, "LROC 2016 table"},
  {"apollo15", 26.13239, 3.63330, "LROC 2016 table"},
  {"apollo17", 20.1911, 30.7723, "LROC 2016 table"},
  {"surveyor7", -40.9812, 348.4873, "LROC 2016 table"},
  {"luna17", 38.23764, 324.99837, "LROC 2016 table"},
  /* LROC's posts */
  {"change4", -45.457, 177.589, "LROC, Chang'e 4 Lander Coordinates, 2019"},
  {"change6", -41.6385, 206.0148, "LROC, First Look: Chang'e 6, 2024"},
  {"chandrayaan3", -69.3741, 32.32, "LROC, Chandrayaan-3 Landing Site, 2023"},
  {"im2", -84.7906, 29.1957, "LROC, IM-2 Athena Seen Obliquely, 2025"},
};

/* Apollo 11's landing, the Chang'e 4 landing day, J2000, and today. */
static const char *EPOCHS[] = {"1969 JUL 20 20:17:40 UTC", "2000 JAN 01 12:00:00 UTC",
                               "2019 JAN 03 02:26:00 UTC", "2026 NOV 18 00:00:00 UTC"};

int main(int argc, char **argv) {
  if (argc != 2) { fprintf(stderr, "usage: %s <output.json>\n", argv[0]); return 1; }
  char outpath[4096];
  if (argv[1][0] == '/') snprintf(outpath, sizeof outpath, "%s", argv[1]);
  else {
    char cwd[2048];
    if (!getcwd(cwd, sizeof cwd)) { perror("getcwd"); return 1; }
    snprintf(outpath, sizeof outpath, "%s/%s", cwd, argv[1]);
  }
  erract_c("SET", 0, "RETURN");
  errprt_c("SET", 0, "NONE");
  /* The meta-kernel's PATH_VALUES are relative to python/. */
  if (chdir(ORRERY_PYTHON_DIR) != 0) { perror(ORRERY_PYTHON_DIR); return 1; }
  furnsh_c("data/metakernel.tm");
  die_if_failed("furnsh_c(data/metakernel.tm)");

  SpiceChar version[80];
  strncpy(version, tkvrsn_c("TOOLKIT"), sizeof version - 1);
  version[sizeof version - 1] = 0;
  const double R = 1737.4;          /* the Moon's mean radius, km (IAU; pck00011) */
  FILE *f = fopen(outpath, "w");
  if (!f) { perror(outpath); return 1; }
  fprintf(f, "{\n  \"meta\": {\"generator\": \"c/landing_sites_ref.c\", \"toolkit\": \"%s\", "
             "\"frame\": \"MOON_ME -> J2000\", \"kernels\": [\"moon_pa_de440_200625.bpc\", \"moon_de440_250416.tf\", \"naif0012.tls\"], "
             "\"radiusKm\": %.1f, \"units\": \"deg, km\"},\n  \"sites\": [\n", version, R);
  const int nS = (int)(sizeof SITES / sizeof SITES[0]), nE = (int)(sizeof EPOCHS / sizeof EPOCHS[0]);
  for (int s = 0; s < nS; s++) {
    SpiceDouble fixed[3];
    latrec_c(R, SITES[s].lon * rpd_c(), SITES[s].lat * rpd_c(), fixed);
    fprintf(f, "    {\"key\": \"%s\", \"lat\": %.7g, \"lon\": %.8g, \"source\": \"%s\",\n     \"meFixedKm\": [%.17g, %.17g, %.17g],\n     \"j2000\": [\n",
            SITES[s].key, SITES[s].lat, SITES[s].lon, SITES[s].source, fixed[0], fixed[1], fixed[2]);
    for (int e = 0; e < nE; e++) {
      SpiceDouble et, m[3][3], v[3];
      str2et_c(EPOCHS[e], &et);
      die_if_failed(EPOCHS[e]);
      pxform_c("MOON_ME", "J2000", et, m);
      die_if_failed("pxform_c(MOON_ME, J2000)");
      mxv_c(m, fixed, v);
      fprintf(f, "       {\"utc\": \"%s\", \"km\": [%.17g, %.17g, %.17g]}%s\n", EPOCHS[e], v[0], v[1], v[2], e == nE - 1 ? "" : ",");
    }
    fprintf(f, "     ]}%s\n", s == nS - 1 ? "" : ",");
  }
  fprintf(f, "  ]\n}\n");
  fclose(f);
  return 0;
}
