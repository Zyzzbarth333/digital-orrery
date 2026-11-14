/*
 * orrery_spice_ref.c
 *
 * Generates reference data for digital-orrery's JavaScript physics core from
 * NAIF's CSPICE toolkit and the DE442 ephemeris. Writes one JSON file that
 * src/physics/orbital.test.mjs reads, so the JS tests run without SPICE
 * installed but are still checked against it.
 *
 * Contents:
 *   meta         toolkit version, the kernels loaded, frame, GM values
 *   twobody      deterministic set of initial states (elliptic, near-parabolic,
 *                hyperbolic; built with conics_c), each propagated with
 *                prop2b_c and converted to elements with oscltx_c
 *   msl          heliocentric J2000 states of Earth at MSL launch and Mars at
 *                MSL arrival (spkezr_c, geometric, observer Sun)
 *   planets      heliocentric J2000 states of Mercury..Neptune barycentres
 *                at a few epochs, for checking astronomy-engine later
 *   orientation  J2000 -> body-fixed rotations of the Sun and planets
 *   earth        J2000 -> ITRF93 at 408 instants 2000-2126, for the Earth
 *                orientation table (src/physics/eop.js)
 *
 * Frame: J2000 (equatorial, the same axes as astronomy-engine's EQJ).
 * Units: km, km/s, s, km^3/s^2, radians.
 *
 * Usage: orrery_spice_ref <output.json>
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
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

static void put_vec(FILE *f, const char *key, const double *v, int n, int comma) {
  fprintf(f, "\"%s\": [", key);
  for (int i = 0; i < n; i++) fprintf(f, "%s%.17g", i ? ", " : "", v[i]);
  fprintf(f, "]%s", comma ? ", " : "");
}

/* Small deterministic generator so the fixture is reproducible. */
static unsigned long long rng_state = 0x9E3779B97F4A7C15ULL;
static double urand(void) {
  rng_state = rng_state * 6364136223846793005ULL + 1442695040888963407ULL;
  return (double)(rng_state >> 11) / 9007199254740992.0;  /* [0,1) */
}
static double uniform(double lo, double hi) { return lo + (hi - lo) * urand(); }

static double get_gm(const char *body) {
  SpiceInt n;
  SpiceDouble gm;
  bodvrd_c(body, "GM", 1, &n, &gm);
  die_if_failed(body);
  return gm;
}

/* One two-body case: elements -> state (conics_c), prop2b_c, oscltx_c. */
static void twobody_case(FILE *f, const char *kind, double mu, double rp, double ecc,
                         double m0, double dt, int comma) {
  SpiceDouble elts[8], s0[6], s1[6], osc[SPICE_OSCLTX_NELTS];
  elts[0] = rp;
  elts[1] = ecc;
  elts[2] = uniform(0.05, 3.0);            /* inclination, avoids the equatorial case */
  elts[3] = uniform(0.0, twopi_c());       /* node */
  elts[4] = uniform(0.0, twopi_c());       /* argument of periapsis */
  elts[5] = m0;                            /* mean anomaly at epoch */
  elts[6] = 0.0;                           /* epoch */
  elts[7] = mu;
  conics_c(elts, 0.0, s0);
  die_if_failed("conics_c");
  prop2b_c(mu, s0, dt, s1);
  die_if_failed("prop2b_c");
  oscltx_c(s0, 0.0, mu, osc);
  die_if_failed("oscltx_c");
  /* oscltx_c: rp ecc inc lnode argp m0 t0 mu nu a tau */
  fprintf(f, "    {\"kind\": \"%s\", \"mu\": %.17g, \"dt\": %.17g, ", kind, mu, dt);
  put_vec(f, "state0", s0, 6, 1);
  put_vec(f, "state1", s1, 6, 1);
  fprintf(f, "\"elements0\": {\"rp\": %.17g, \"e\": %.17g, \"i\": %.17g, \"raan\": %.17g, "
             "\"argp\": %.17g, \"M\": %.17g, \"nu\": %.17g, \"a\": %.17g}}%s\n",
          osc[0], osc[1], osc[2], osc[3], osc[4], osc[5], osc[8], osc[9], comma ? "," : "");
}

static void body_state(FILE *f, const char *body, double et, const char *key, int comma) {
  SpiceDouble st[6], lt;
  spkezr_c(body, et, "J2000", "NONE", "SUN", st, &lt);
  die_if_failed(body);
  fprintf(f, "\"%s\": {\"body\": \"%s\", \"et\": %.17g, ", key, body, et);
  put_vec(f, "state", st, 6, 0);
  fprintf(f, "}%s", comma ? ", " : "");
}

int main(int argc, char **argv) {
  if (argc != 2) {
    fprintf(stderr, "usage: %s <output.json>\n", argv[0]);
    return 1;
  }
  /* Resolve the output path before changing directory. */
  char outpath[4096];
  int n;
  if (argv[1][0] == '/') n = snprintf(outpath, sizeof outpath, "%s", argv[1]);
  else {
    char cwd[2048];
    if (!getcwd(cwd, sizeof cwd)) { perror("getcwd"); return 1; }
    n = snprintf(outpath, sizeof outpath, "%s/%s", cwd, argv[1]);
  }
  if (n < 0 || n >= (int)sizeof outpath) { fprintf(stderr, "output path too long\n"); return 1; }

  erract_c("SET", 0, "RETURN");
  errprt_c("SET", 0, "NONE");
  /* The meta-kernel's PATH_VALUES are relative to python/. */
  if (chdir(ORRERY_PYTHON_DIR) != 0) { perror(ORRERY_PYTHON_DIR); return 1; }
  furnsh_c("data/metakernel.tm");
  die_if_failed("furnsh_c(data/metakernel.tm)");

  /* Write to <out>.tmp and rename at the end, so a failed run never leaves a
     truncated fixture in place of the good one. */
  char tmppath[4200];
  if (snprintf(tmppath, sizeof tmppath, "%s.tmp", outpath) >= (int)sizeof tmppath) {
    fprintf(stderr, "output path too long\n");
    return 1;
  }
  FILE *f = fopen(tmppath, "w");
  if (!f) { perror(tmppath); return 1; }

  const double muSun = get_gm("SUN");
  const double muEarth = get_gm("EARTH");

  /* ---- meta ---- */
  /* Provenance: every kernel actually loaded, as file names. */
  fprintf(f, "{\n  \"meta\": {\"generator\": \"c/orrery_spice_ref.c\", \"toolkit\": \"%s\", \"kernels\": [",
          tkvrsn_c("TOOLKIT"));
  {
    SpiceInt count;
    ktotal_c("ALL", &count);
    int written = 0;
    for (SpiceInt i = 0; i < count; i++) {
      SpiceChar file[1024], type[32], source[1024];
      SpiceInt handle;
      SpiceBoolean found;
      kdata_c(i, "ALL", sizeof file, sizeof type, sizeof source, file, type, source, &handle, &found);
      if (!found || strcmp(type, "META") == 0) continue;
      const char *base = strrchr(file, '/');
      fprintf(f, "%s\"%s\"", written++ ? ", " : "", base ? base + 1 : file);
    }
  }
  fprintf(f, "], \"frame\": \"J2000\", \"units\": \"km, km/s, s, km^3/s^2, rad\", "
             "\"gm\": {\"sun\": %.17g, \"earth\": %.17g", muSun, muEarth);
  /* Every GM the JS kernel uses, as SPICE reads it from the loaded kernels:
     system barycentres for Mercury..Neptune, the Earth and Moon themselves. */
  {
    const char *keys[] = {"mercury", "venus", "moon", "mars", "jupiter", "saturn", "uranus", "neptune"};
    const char *names[] = {"MERCURY BARYCENTER", "VENUS BARYCENTER", "MOON", "MARS BARYCENTER",
                           "JUPITER BARYCENTER", "SATURN BARYCENTER", "URANUS BARYCENTER", "NEPTUNE BARYCENTER"};
    for (int i = 0; i < 8; i++) fprintf(f, ", \"%s\": %.17g", keys[i], get_gm(names[i]));
  }
  fprintf(f, "}},\n");

  /* ---- two-body cases ---- */
  fprintf(f, "  \"twobody\": [\n");
  const int nEll = 40, nNear = 8, nHyp = 16;
  const int total = nEll + nNear + nHyp;
  int done = 0;
  for (int i = 0; i < nEll; i++) {
    double rp = uniform(6600.0, 30000.0), e = uniform(0.0, 0.9);
    double a = rp / (1.0 - e), T = twopi_c() * sqrt(a * a * a / muEarth);
    twobody_case(f, "elliptic", muEarth, rp, e, uniform(-pi_c(), pi_c()), uniform(-1.5, 1.5) * T,
                 ++done < total);
  }
  const double nearE[8] = {0.99, 0.995, 0.999, 0.9999, 1.0001, 1.001, 1.005, 1.01};
  for (int i = 0; i < nNear; i++) {
    /* Sweep through periapsis: start near true anomaly -150 deg and end near
       +150 deg (parabolic Barker timing), the regime where element-based
       propagation is ill-conditioned. */
    double rp = uniform(6600.0, 12000.0), e = nearE[i];
    double D = tan(0.5 * 150.0 * rpd_c());
    double tHalf = sqrt(2.0 * rp * rp * rp / muEarth) * (D + D * D * D / 3.0);
    double dt = 2.0 * tHalf * uniform(0.8, 1.0);
    double a = rp / fabs(1.0 - e), n = sqrt(muEarth / (a * a * a));
    twobody_case(f, "near-parabolic", muEarth, rp, e, -n * tHalf, dt, ++done < total);
  }
  for (int i = 0; i < nHyp; i++) {
    double rp = uniform(6600.0, 30000.0), e = uniform(1.1, 4.0);
    twobody_case(f, "hyperbolic", muEarth, rp, e, uniform(-1.0, 1.0), uniform(-20000.0, 20000.0),
                 ++done < total);
  }
  fprintf(f, "  ],\n");

  /* ---- MSL: launch 2011-11-26 15:02 UTC, arrival 2012-08-06 05:17 UTC ---- */
  SpiceDouble etL, etA;
  str2et_c("2011 NOV 26 15:02:00 UTC", &etL);
  str2et_c("2012 AUG 06 05:17:00 UTC", &etA);
  die_if_failed("str2et_c");
  fprintf(f, "  \"msl\": {\"launch_utc\": \"2011-11-26T15:02:00\", \"arrival_utc\": \"2012-08-06T05:17:00\", "
             "\"tof_s\": %.17g, ", etA - etL);
  body_state(f, "EARTH", etL, "earth_at_launch", 1);
  body_state(f, "MARS BARYCENTER", etA, "mars_at_arrival", 0);
  fprintf(f, "},\n");

  /* ---- planets at a few epochs ---- */
  const char *bodies[] = {"MERCURY", "VENUS", "EARTH", "MARS BARYCENTER", "JUPITER BARYCENTER",
                          "SATURN BARYCENTER", "URANUS BARYCENTER", "NEPTUNE BARYCENTER"};
  const char *epochs[] = {"2000 JAN 01 12:00:00 TDB", "2011 NOV 26 15:02:00 UTC",
                          "2026 JAN 01 00:00:00 UTC"};
  fprintf(f, "  \"planets\": [\n");
  for (int e = 0; e < 3; e++) {
    SpiceDouble et;
    str2et_c(epochs[e], &et);
    die_if_failed(epochs[e]);
    for (int b = 0; b < 8; b++) {
      fprintf(f, "    {\"epoch\": \"%s\", ", epochs[e]);
      body_state(f, bodies[b], et, "s", 0);
      fprintf(f, "}%s\n", (e == 2 && b == 7) ? "" : ",");
    }
  }
  fprintf(f, "  ],\n");

  /* ---- body orientation: the J2000 -> body-fixed rotation (row-major) ----
     Earth is ITRF93 from the high-precision Earth PCK (precession, nutation,
     UT1 and polar motion); the Moon is MOON_ME, the mean-Earth/polar-axis
     frame the LRO maps are made in; the rest are the IAU frames from
     pck00011 (Mars from Konopliv 2026), the planets' 20 major moons
     among them. */
  const char *okeys[] = {"sun", "mercury", "venus", "earth", "moon", "mars", "jupiter",
                         "saturn", "uranus", "neptune", "pluto",
                         "phobos", "deimos", "io", "europa", "ganymede", "callisto",
                         "mimas", "enceladus", "tethys", "dione", "rhea", "titan", "iapetus",
                         "miranda", "ariel", "umbriel", "titania", "oberon", "triton", "charon"};
  const char *oframes[] = {"IAU_SUN", "IAU_MERCURY", "IAU_VENUS", "ITRF93", "MOON_ME", "IAU_MARS",
                           "IAU_JUPITER", "IAU_SATURN", "IAU_URANUS", "IAU_NEPTUNE", "IAU_PLUTO",
                           "IAU_PHOBOS", "IAU_DEIMOS", "IAU_IO", "IAU_EUROPA", "IAU_GANYMEDE",
                           "IAU_CALLISTO", "IAU_MIMAS", "IAU_ENCELADUS", "IAU_TETHYS", "IAU_DIONE",
                           "IAU_RHEA", "IAU_TITAN", "IAU_IAPETUS", "IAU_MIRANDA", "IAU_ARIEL",
                           "IAU_UMBRIEL", "IAU_TITANIA", "IAU_OBERON", "IAU_TRITON", "IAU_CHARON"};
  const int nO = (int)(sizeof okeys / sizeof okeys[0]);
  {
    const char *oepochs[] = {"2000 JAN 01 12:00:00 UTC", "2011 NOV 26 15:02:00 UTC",
                             "2026 AUG 12 17:45:47 UTC", "2026 NOV 01 00:00:00 UTC"};
    fprintf(f, "  \"orientation\": [\n");
    for (int e = 0; e < 4; e++) {
      SpiceDouble et, m[3][3];
      str2et_c(oepochs[e], &et);
      die_if_failed(oepochs[e]);
      for (int b = 0; b < nO; b++) {
        pxform_c("J2000", oframes[b], et, m);
        die_if_failed(oframes[b]);
        fprintf(f, "    {\"utc\": \"%s\", \"body\": \"%s\", \"frame\": \"%s\", ",
                oepochs[e], okeys[b], oframes[b]);
        put_vec(f, "m", &m[0][0], 9, 0);
        fprintf(f, "}%s\n", (e == 3 && b == nO - 1) ? "" : ",");
      }
    }
    fprintf(f, "  ],\n");
  }

  /* ---- the Earth's orientation, densely: J2000 -> ITRF93 at 400 random
     instants (to the millisecond) across the Earth PCKs, and either side of
     the leap seconds and of the hand-over from the high-precision file to
     the long-term one (metakernel.tm loads the latter first, so the former
     wins where both cover). For src/physics/eop.js. ---- */
  {
    const char *hpName = "earth_latest_high_prec.bpc";
    char hpPath[256];
    snprintf(hpPath, sizeof hpPath, "data/kernels/pck/%s", hpName);
    SPICEDOUBLE_CELL(cover, 2000);
    scard_c(0, &cover);
    pckcov_c(hpPath, 3000, &cover);
    die_if_failed(hpPath);
    SpiceDouble hp0, hp1, lo, hi, end;
    wnfetd_c(&cover, 0, &hp0, &hi);
    wnfetd_c(&cover, wncard_c(&cover) - 1, &lo, &hp1);
    str2et_c("2126 NOV 02 00:00:00 UTC", &end);
    die_if_failed("earth span");
    SpiceChar hpEnd[64];
    et2utc_c(hp1, "ISOC", 3, sizeof hpEnd, hpEnd);
    fprintf(f, "  \"earth\": {\"frame\": \"ITRF93\", \"high_prec_end_utc\": \"%s\", \"rows\": [\n", hpEnd);
    const char *fixed[] = {"2008-12-31T23:59:59.000", "2009-01-01T00:00:00.000", "2016-12-31T23:59:59.999",
                           "2017-01-01T00:00:00.001", "2016-12-31T12:00:00.000", "2017-01-01T12:00:00.000"};
    const int nFixed = 6, nRand = 400;
    SpiceDouble hpEt[2] = {hp1 - 1.0, hp1 + 1.0};
    for (int i = 0; i < nFixed + 2 + nRand; i++) {
      SpiceDouble et;
      SpiceChar utc[64];
      if (i < nFixed) str2et_c(fixed[i], &et);
      else if (i < nFixed + 2) et = hpEt[i - nFixed];
      /* Three in four in the high-precision file, the rest after. */
      else if (i % 4) et = uniform(hp0 + 60.0, hp1 - 60.0);
      else et = uniform(hp1 + 60.0, end);
      et2utc_c(et, "ISOC", 3, sizeof utc, utc);
      str2et_c(utc, &et);              /* the instant the string names */
      die_if_failed(utc);
      SpiceDouble m[3][3];
      pxform_c("J2000", "ITRF93", et, m);
      die_if_failed("pxform_c ITRF93");
      fprintf(f, "    {\"utc\": \"%s\", ", utc);
      put_vec(f, "m", &m[0][0], 9, 0);
      fprintf(f, "}%s\n", i == nFixed + 2 + nRand - 1 ? "" : ",");
    }
    fprintf(f, "  ]},\n");
  }

  /* ---- body shapes: the triaxial ellipsoid's radii along body-fixed X, Y,
     Z, as SPICE reads them from the loaded PCKs (bodvrd_c RADII) ---- */
  fprintf(f, "  \"radii\": {");
  for (int b = 0; b < nO; b++) {
    SpiceInt nr;
    SpiceDouble r[3];
    const char *name = strcmp(okeys[b], "sun") == 0 ? "SUN" : okeys[b];
    bodvrd_c(name, "RADII", 3, &nr, r);
    die_if_failed(okeys[b]);
    fprintf(f, "%s\"%s\": [%.17g, %.17g, %.17g]", b ? ", " : "", okeys[b], r[0], r[1], r[2]);
  }
  fprintf(f, "}\n}\n");

  if (ferror(f) | fclose(f)) { perror(tmppath); remove(tmppath); return 1; }
  if (rename(tmppath, outpath) != 0) { perror(outpath); remove(tmppath); return 1; }
  fprintf(stderr, "wrote %s (%d two-body cases)\n", outpath, total);
  return 0;
}
