/* c/moon_cheb.c
 *
 * Fits Chebyshev series to JPL's satellite ephemerides for the app's moons
 * (docs/frontend/moons.md#positions): each moon and the planet's centre
 * relative to the system barycentre (Titan and 699 about 6), J2000
 * equatorial (ICRF axes), km, against TDB seconds past J2000. One file per
 * planet system per year.
 *
 *   usage: moon_cheb survey <tolerance km> <first year> <last year (exclusive)>
 *          moon_cheb <out dir> <tolerance km> <first year> <last year (exclusive)>
 *
 * $MOON_SYSTEMS (say "neptune,pluto") limits a run to those systems.
 *
 * The kernels are NAIF's satellite SPKs (python/README.md), read from
 * python/data/kernels/spk/satellites, or from $SAT_KERNELS if set.
 *
 * For each body the tool picks the number of equal intervals a year and of
 * coefficients that store it in the fewest bytes with every position within
 * the tolerance: 1 to 8192 intervals a year (powers of the square root of
 * two), 6 to 120 coefficients, Float32 coefficients
 * for bodies within 300,000 km of the barycentre and Float64 beyond. Each
 * candidate is fitted on 96 intervals spread over the span and checked at
 * 6 n points between the nodes; the chosen one is then fitted over the
 * whole span and checked the same way on every interval (velocity too),
 * and at the joins, and refitted with more coefficients where it misses.
 *
 * Each interval is fitted at the Chebyshev-Gauss nodes (a discrete cosine
 * transform, exact for a polynomial of that degree), as in de_cheb.c, over
 * a window 10 % wider than itself, then pinned to the SPK's positions at
 * its ends (fit()).
 *
 * File layout (little-endian), <system>-<year>.bin:
 *   Float64 [0] format version (1), [1] number of bodies k,
 *   then per body 6 values: NAIF id, t0 (TDB s past J2000),
 *     interval length (s), intervals, coefficients, bytes per coefficient
 *     (4 or 8),
 *   then per body, per interval: x coefficients, y, z, as Float32 or
 *   Float64, each body's block padded to a multiple of 8 bytes.
 */

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "SpiceUsr.h"

typedef struct { const char *system; int id, center; const char *kernel; } Moon;
static const Moon MOONS[] = {
  { "mars", 499, 4, "mar099s.bsp" }, { "mars", 401, 4, "mar099s.bsp" }, { "mars", 402, 4, "mar099s.bsp" },
  { "jupiter", 599, 5, "jup365.bsp" }, { "jupiter", 501, 5, "jup365.bsp" }, { "jupiter", 502, 5, "jup365.bsp" },
  { "jupiter", 503, 5, "jup365.bsp" }, { "jupiter", 504, 5, "jup365.bsp" },
  { "jupiter", 505, 5, "jup365.bsp" }, { "jupiter", 514, 5, "jup365.bsp" },
  { "jupiter", 515, 5, "jup365.bsp" }, { "jupiter", 516, 5, "jup365.bsp" },
  { "saturn", 699, 6, "sat441.bsp" }, { "saturn", 601, 6, "sat441.bsp" }, { "saturn", 602, 6, "sat441.bsp" },
  { "saturn", 603, 6, "sat441.bsp" }, { "saturn", 604, 6, "sat441.bsp" },
  { "saturn", 605, 6, "sat441.bsp" }, { "saturn", 606, 6, "sat441.bsp" },
  { "saturn", 607, 6, "sat441.bsp" }, { "saturn", 608, 6, "sat441.bsp" },
  { "saturn", 609, 6, "sat441.bsp" }, { "saturn", 612, 6, "sat441.bsp" },
  { "saturn", 613, 6, "sat441.bsp" }, { "saturn", 614, 6, "sat441.bsp" },
  { "saturn", 632, 6, "sat441.bsp" }, { "saturn", 634, 6, "sat441.bsp" },
  { "saturn", 610, 6, "sat415.bsp" },
  { "saturn", 611, 6, "sat415.bsp" },
  { "saturn", 615, 6, "sat415.bsp" },
  { "saturn", 616, 6, "sat415.bsp" },
  { "saturn", 617, 6, "sat415.bsp" },
  { "saturn", 618, 6, "sat415.bsp" },
  { "saturn", 633, 6, "sat415.bsp" },
  { "saturn", 649, 6, "sat415.bsp" },
  { "saturn", 653, 6, "sat415.bsp" },
  { "uranus", 799, 7, "ura184_part-3.bsp" }, { "uranus", 701, 7, "ura184_part-3.bsp" }, { "uranus", 702, 7, "ura184_part-3.bsp" },
  { "uranus", 703, 7, "ura184_part-3.bsp" }, { "uranus", 704, 7, "ura184_part-3.bsp" },
  { "uranus", 705, 7, "ura184_part-3.bsp" }, { "uranus", 716, 7, "ura184_part-3.bsp" },
  { "uranus", 717, 7, "ura184_part-3.bsp" }, { "uranus", 718, 7, "ura184_part-3.bsp" },
  { "uranus", 719, 7, "ura184_part-3.bsp" }, { "uranus", 720, 7, "ura184_part-3.bsp" },
  { "uranus", 721, 7, "ura184_part-3.bsp" }, { "uranus", 722, 7, "ura184_part-3.bsp" },
  { "uranus", 723, 7, "ura184_part-3.bsp" }, { "uranus", 724, 7, "ura184_part-3.bsp" },
  { "uranus", 75051, 7, "ura184_part-3.bsp" },
  { "uranus", 706, 7, "ura184_part-1.bsp" },
  { "uranus", 707, 7, "ura184_part-1.bsp" },
  { "uranus", 708, 7, "ura184_part-1.bsp" },
  { "uranus", 709, 7, "ura184_part-1.bsp" },
  { "uranus", 710, 7, "ura184_part-1.bsp" },
  { "uranus", 711, 7, "ura184_part-1.bsp" },
  { "uranus", 712, 7, "ura184_part-1.bsp" },
  { "uranus", 713, 7, "ura184_part-2.bsp" },
  { "uranus", 714, 7, "ura184_part-2.bsp" },
  { "uranus", 715, 7, "ura184_part-2.bsp" },
  { "uranus", 725, 7, "ura184_part-2.bsp" },
  { "uranus", 726, 7, "ura184_part-2.bsp" },
  { "uranus", 727, 7, "ura184_part-2.bsp" },
  { "uranus", 75052, 7, "ura184_part-2.bsp" },
  { "neptune", 899, 8, "nep098_part-1.bsp" }, { "neptune", 803, 8, "nep098_part-1.bsp" },
  { "neptune", 801, 8, "nep098_part-1.bsp" }, { "neptune", 802, 8, "nep098_part-1.bsp" },
  { "neptune", 804, 8, "nep098_part-2.bsp" },
  { "neptune", 805, 8, "nep098_part-2.bsp" },
  { "neptune", 806, 8, "nep098_part-2.bsp" },
  { "neptune", 807, 8, "nep098_part-3.bsp" },
  { "neptune", 808, 8, "nep098_part-3.bsp" },
  { "neptune", 814, 8, "nep098_part-3.bsp" },
  { "pluto", 999, 9, "plu060.bsp" }, { "pluto", 901, 9, "plu060.bsp" }, { "pluto", 902, 9, "plu060.bsp" },
  { "pluto", 903, 9, "plu060.bsp" }, { "pluto", 904, 9, "plu060.bsp" },
  { "pluto", 905, 9, "plu060.bsp" },
};
#define NMAX 120
#define NSAMPLE 96
#define F32_MAX_KM 3e5
#define NM ((int)(sizeof MOONS / sizeof MOONS[0]))
static const char *SYSTEMS[] = { "mars", "jupiter", "saturn", "uranus", "neptune", "pluto" };

static void die_if_failed(const char *what) {
  if (failed_c()) {
    char msg[1841];
    getmsg_c("LONG", sizeof msg, msg);
    fprintf(stderr, "%s: %s\n", what, msg);
    exit(1);
  }
}

static void pos(const Moon *m, double et, double out[3]) {
  double s[3], lt;
  spkezp_c(m->id, et, "J2000", "NONE", m->center, s, &lt);
  out[0] = s[0]; out[1] = s[1]; out[2] = s[2];
}

/* Clenshaw evaluation of sum c_j T_j(x). */
static double cheb(const double *c, int n, double x) {
  double b0 = 0, b1 = 0, b2 = 0;
  for (int j = n - 1; j >= 1; j--) { b0 = 2 * x * b1 - b2 + c[j]; b2 = b1; b1 = b0; }
  return x * b1 - b2 + c[0];
}

static double chebd(const double *c, int n, double x) {
  /* d/dx sum c_j T_j = sum j c_j U_{j-1}. */
  double u0 = 1, u1 = 2 * x, s = n > 1 ? c[1] : 0;
  for (int j = 2; j < n; j++) { s += j * c[j] * u1; const double u2 = 2 * x * u1 - u0; u0 = u1; u1 = u2; }
  return s;
}

/* Fit interval [mid - len/2, mid + len/2] with n coefficients per axis into
 * c (3 x n); round to Float32 if f32. */
/* The DCT of values at the n Chebyshev-Gauss nodes: the coefficients of
 * the polynomial of degree n - 1 through them. */
static void dct(const double *fx, int n, double *c) {
  for (int j = 0; j < n; j++) {
    double s = 0;
    for (int q = 0; q < n; q++) s += fx[q] * cos(M_PI * j * (q + 0.5) / n);
    c[j] = (j == 0 ? 1.0 : 2.0) * s / n;
  }
}

/* Fit interval [mid - len/2, mid + len/2] with n coefficients per axis into
 * c (3 x n); round to Float32 if f32. The series is fitted over a window
 * WIDEN times longer and then re-expanded, exactly, on the interval: a
 * Chebyshev fit's derivative is worst at its window's ends (by about n
 * squared against n inside), so this way the velocities at the joins,
 * which the kernel's Hermite nodes use, are as good as anywhere inside. */
#define WIDEN 1.1
/* The run's span: the window is kept inside it (the Mars kernel ends on
 * 2050 Jan 1). */
static double SPAN0 = -INFINITY, SPAN1 = INFINITY;
static void fit(const Moon *m, double mid, double len, int n, int f32, double *c) {
  double fx[NMAX], ext[3 * NMAX];
  const double half = WIDEN * len / 2;
  double wc = mid;
  if (wc - half < SPAN0) wc = SPAN0 + half;
  if (wc + half > SPAN1) wc = SPAN1 - half;
  for (int q = 0; q < n; q++) {
    double p[3];
    pos(m, wc + cos(M_PI * (q + 0.5) / n) * half, p);
    die_if_failed("spkezp_c");
    for (int d = 0; d < 3; d++) ext[d * n + q] = p[d];
  }
  /* The SPK's own positions at both ends: each interval is pinned to them
   * by a straight line (at most the ends' own misses), so neighbouring
   * intervals and years meet without a step. Pinning the velocities too
   * would take a cubic as large as the velocity miss times the interval,
   * kilometres for the fast moons; the wider window keeps those small. */
  double s0[3], s1[3];
  pos(m, mid - len / 2, s0);
  pos(m, mid + len / 2, s1);
  die_if_failed("spkezp_c");
  for (int d = 0; d < 3; d++) {
    double ce[NMAX];
    dct(ext + d * n, n, ce);
    for (int q = 0; q < n; q++) fx[q] = cheb(ce, n, (mid + cos(M_PI * (q + 0.5) / n) * len / 2 - wc) / half);
    double *cd = c + d * n;
    dct(fx, n, cd);
    const double e0 = s0[d] - cheb(cd, n, -1), e1 = s1[d] - cheb(cd, n, 1);
    cd[0] += (e0 + e1) / 2; cd[1] += (e1 - e0) / 2;
    if (f32) for (int j = 0; j < n; j++) cd[j] = (float)cd[j];
  }
}

/* Worst velocity error (km/s) of interval coefficients c, at 2 n points. */
static double check_v(const Moon *m, double mid, double len, int n, const double *c) {
  double worst = 0;
  for (int t = 0; t <= 2 * n; t++) {
    const double x = -1 + (double)t / n;
    double st[6], lt, e = 0;
    spkez_c(m->id, mid + x * len / 2, "J2000", "NONE", m->center, st, &lt);
    for (int d = 0; d < 3; d++) { const double r = chebd(c + d * n, n, x) * 2 / len - st[3 + d]; e += r * r; }
    if (e > worst) worst = e;
  }
  return sqrt(worst);
}

/* Worst position error (km) of interval coefficients c, at 6 n points. */
static double check(const Moon *m, double mid, double len, int n, const double *c) {
  double worst = 0;
  const int np = 6 * n;
  for (int t = 0; t <= np; t++) {
    const double x = -1 + 2.0 * t / np;
    double p[3], e = 0;
    pos(m, mid + x * len / 2, p);
    for (int d = 0; d < 3; d++) { const double r = cheb(c + d * n, n, x) - p[d]; e += r * r; }
    if (e > worst) worst = e;
  }
  return sqrt(worst);
}

typedef struct { int k, n, f32; double err, bytesPerYear; } Choice;

/* The cheapest (k intervals a year, n coefficients, precision) for m
 * within tol, sampled over [et0, et1]. */
static Choice choose(const Moon *m, double tol, double et0, double et1) {
  Choice best = { 0, 0, 0, 0, INFINITY };
  double c[3 * NMAX];
  int lastk = 0;
  /* Float32 rounds a coefficient to 6e-8 of itself: under 20 m for a body
   * within F32_MAX_KM, whose joins then meet to that. Farther bodies,
   * which move slowly and need few coefficients, keep Float64. */
  double p0[3];
  pos(m, et0, p0);
  const int f32ok = sqrt(p0[0] * p0[0] + p0[1] * p0[1] + p0[2] * p0[2]) < F32_MAX_KM;
  for (int f32 = f32ok; f32 >= 0; f32--) {
    for (int step = 0; step <= 26; step++) {
      const int k = (int)lround(pow(2.0, step / 2.0));
      if (k == lastk) continue;
      lastk = k;
      const double len = 366.0 / k * 86400;   /* a leap year's, the longer */
      /* Bisect for the fewest coefficients that pass, among those that
       * would beat the best so far. */
      int lo = 6, hi = NMAX;
      while (lo <= hi && 3.0 * lo * (f32 ? 4 : 8) * k < best.bytesPerYear) {
        const int n = (lo + hi) / 2;
        double worst = 0;
        for (int s = 0; s < NSAMPLE && worst <= tol; s++) {
          const double mid = et0 + len / 2 + (et1 - et0 - len) * (s + 0.5) / NSAMPLE;
          fit(m, mid, len, n, f32, c);
          const double e = check(m, mid, len, n, c);
          if (e > worst) worst = e;
        }
        const double bpy = 3.0 * n * (f32 ? 4 : 8) * k;
        if (worst <= tol) {
          if (bpy < best.bytesPerYear) best = (Choice){ k, n, f32, worst, bpy };
          hi = n - 1;
        } else lo = n + 1;
      }
    }
    lastk = 0;
  }
  return best;
}

/* $MOON_SYSTEMS (say "neptune,pluto") limits a run to those systems. */
static int wanted(const char *system) {
  const char *w = getenv("MOON_SYSTEMS");
  return !w || strstr(w, system) != NULL;
}

/* Each system's planet kernel (the one its planet's row names) is loaded
 * after its others, so SPICE, which takes the last-loaded segment, reads
 * the planet and any moon that two kernels share from it: Methone is in
 * both sat415 and sat441, 410 km apart, and sat441's is the one Horizons
 * serves. The planet centres agree between kernels to 7 m. */
static void furnsh_all(void) {
  const char *dir = getenv("SAT_KERNELS");
  char path[4096];
  const char *seen[NM];
  int ns = 0;
  for (int pass = 0; pass < 2; pass++)
    for (int i = 0; i < NM; i++) {
      int primary = 0;
      for (int j = 0; j < NM; j++)
        if (!strcmp(MOONS[j].kernel, MOONS[i].kernel) && MOONS[j].id % 100 == 99) primary = 1;
      if (primary != pass || !wanted(MOONS[i].system)) continue;
      int dup = 0;
      for (int j = 0; j < ns; j++) if (!strcmp(seen[j], MOONS[i].kernel)) dup = 1;
      if (dup) continue;
      seen[ns++] = MOONS[i].kernel;
      snprintf(path, sizeof path, "%s/%s", dir ? dir : ORRERY_PYTHON_DIR "/data/kernels/spk/satellites", MOONS[i].kernel);
      furnsh_c(path);
      die_if_failed(path);
    }
}

static double year_et(int y) {
  char s[48], err[256];
  double et;
  /* Seconds past J2000 on a uniform calendar, read as TDB (no leapseconds
   * kernel needed). */
  snprintf(s, sizeof s, "%d-01-01T00:00:00", y);
  tparse_c(s, sizeof err, &et, err);
  if (err[0]) { fprintf(stderr, "%d: %s\n", y, err); exit(1); }
  return et;
}

int main(int argc, char **argv) {
  if (argc != 5) {
    fprintf(stderr, "usage: %s survey <tol km> <first year> <last year (exclusive)>\n"
                    "       %s <out dir> <tol km> <first year> <last year (exclusive)>\n", argv[0], argv[0]);
    return 1;
  }
  erract_c("SET", 0, "RETURN");
  errprt_c("SET", 0, "NONE");
  furnsh_all();
  const double tol = atof(argv[2]);
  const int y0 = atoi(argv[3]), y1 = atoi(argv[4]);
  const double et0 = year_et(y0), et1 = year_et(y1);
  SPAN0 = et0; SPAN1 = et1;
  const int survey = !strcmp(argv[1], "survey");
  Choice ch[NM];
  double total = 0;
  /* Chosen on samples at 0.8 tol, so that most pass tol in the full fit. */
  for (int i = 0; i < NM; i++) {
    ch[i] = (Choice){ 0, 0, 0, 0, 0 };
    if (!wanted(MOONS[i].system)) continue;
    ch[i] = choose(&MOONS[i], 0.8 * tol, et0, et1);
    if (!ch[i].n) { fprintf(stderr, "%d: nothing within %g km\n", MOONS[i].id, tol); return 1; }
    total += ch[i].bytesPerYear * (y1 - y0);
    fprintf(stderr, "%-8s %6d  %4d a year (%8.4f d) x %3d %s  sampled worst %.3f km  %7.0f B/yr\n", MOONS[i].system,
            MOONS[i].id, ch[i].k, 365.25 / ch[i].k, ch[i].n, ch[i].f32 ? "f32" : "f64", ch[i].err, ch[i].bytesPerYear);
  }
  fprintf(stderr, "total %.0f kB over %d years\n", total / 1000, y1 - y0);
  if (survey) return 0;

  /* Fit every year of each moon, and check every interval; a moon that
   * misses tol anywhere (an eccentric moon's periapsis between the samples)
   * takes more coefficients, or, past NMAX, twice the intervals. */
  const int ny = y1 - y0;
  double *coef[NM], worst[NM], worstV[NM], jumpR[NM], jumpV[NM];
  for (int mi = 0; mi < NM; mi++) {
    const Moon *m = &MOONS[mi];
    Choice *c = &ch[mi];
    coef[mi] = NULL;
    worst[mi] = worstV[mi] = jumpR[mi] = jumpV[mi] = 0;
    if (!wanted(m->system)) continue;
    for (int tries = 0;; tries++) {
      const int k = c->k, n = c->n;
      coef[mi] = malloc(sizeof(double) * (size_t)ny * k * 3 * n);
      worst[mi] = worstV[mi] = jumpR[mi] = jumpV[mi] = 0;
      for (int y = y0; y < y1; y++) {
        const double a = year_et(y), len = (year_et(y + 1) - a) / k;
        for (int i = 0; i < k; i++) {
          double *cf = coef[mi] + ((size_t)(y - y0) * k + i) * 3 * n;
          const double mid = a + (i + 0.5) * len;
          fit(m, mid, len, n, c->f32, cf);
          const double e = check(m, mid, len, n, cf), ev = check_v(m, mid, len, n, cf);
          if (e > worst[mi]) worst[mi] = e;
          if (ev > worstV[mi]) worstV[mi] = ev;
          if (i > 0) {
            const double *prev = cf - 3 * n;
            double dr = 0, dv = 0;
            for (int d = 0; d < 3; d++) {
              const double p = cheb(prev + d * n, n, 1) - cheb(cf + d * n, n, -1);
              const double q = (chebd(prev + d * n, n, 1) - chebd(cf + d * n, n, -1)) * 2 / len;
              dr += p * p; dv += q * q;
            }
            if (sqrt(dr) > jumpR[mi]) jumpR[mi] = sqrt(dr);
            if (sqrt(dv) > jumpV[mi]) jumpV[mi] = sqrt(dv);
          }
        }
      }
      if (worst[mi] <= tol) break;
      fprintf(stderr, "%d: %d x %d misses by %.3f km; ", m->id, k, n, worst[mi]);
      free(coef[mi]);
      /* Rounding to Float32 may be what misses, past a few tries. */
      if (tries == 4 && c->f32) c->f32 = 0;
      else if (n + n / 8 + 2 <= NMAX) c->n = n + n / 8 + 2;
      else { c->k = 2 * k; c->n = n / 2 + 2; }
      c->bytesPerYear = 3.0 * c->n * (c->f32 ? 4 : 8) * c->k;
      fprintf(stderr, "trying %d x %d\n", c->k, c->n);
    }
  }
  for (int y = y0; y < y1; y++) {
    for (int s = 0; s < 6; s++) {
      if (!wanted(SYSTEMS[s])) continue;
      int idx[NM], k = 0;
      for (int i = 0; i < NM; i++) if (!strcmp(MOONS[i].system, SYSTEMS[s])) idx[k++] = i;
      char path[4096];
      snprintf(path, sizeof path, "%s/%s-%d.bin", argv[1], SYSTEMS[s], y);
      FILE *f = fopen(path, "wb");
      if (!f) { perror(path); return 1; }
      const double a = year_et(y), b = year_et(y + 1);
      double head[2] = { 1, k };
      fwrite(head, sizeof(double), 2, f);
      for (int j = 0; j < k; j++) {
        const Choice *c = &ch[idx[j]];
        double h[6] = { MOONS[idx[j]].id, a, (b - a) / c->k, c->k, c->n, c->f32 ? 4 : 8 };
        fwrite(h, sizeof(double), 6, f);
      }
      for (int j = 0; j < k; j++) {
        const Choice *c = &ch[idx[j]];
        const size_t count = (size_t)c->k * 3 * c->n;
        const double *cf = coef[idx[j]] + (size_t)(y - y0) * count;
        if (c->f32) {
          for (size_t q = 0; q < count; q++) { const float g = (float)cf[q]; fwrite(&g, sizeof g, 1, f); }
          static const char zero[8];
          if ((count * 4) % 8) fwrite(zero, 1, 4, f);
        } else fwrite(cf, sizeof(double), count, f);
      }
      fclose(f);
    }
  }
  total = 0;
  for (int i = 0; i < NM; i++) total += ch[i].bytesPerYear * ny;
  fprintf(stderr, "wrote %.0f kB\n", total / 1000);
  int bad = 0;
  for (int i = 0; i < NM; i++) {
    if (!wanted(MOONS[i].system)) continue;
    fprintf(stderr, "%-8s %6d wrt %d: %4d intervals a year x %3d (%s); worst %.3f km, %.2e km/s; joins %.3f km, %.2e km/s\n",
            MOONS[i].system, MOONS[i].id, MOONS[i].center, ch[i].k, ch[i].n, ch[i].f32 ? "f32" : "f64", worst[i],
            worstV[i], jumpR[i], jumpV[i]);
    if (worst[i] > tol) bad = 1;
  }
  return bad;
}
