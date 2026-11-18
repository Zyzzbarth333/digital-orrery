"""New Horizons LORRI images of Jupiter's rings: reading, geometry and
photometry (numpy only), for the jupiter_rings recipe in sources.py.

Each calibrated image (PDS volume NHJULO_2001, level 2, DN) is turned into
normal I/F against ring-plane radius:

  - I/F = (S / t_exp / RSOLAR) pi r_h^2 / F_sun, with RSOLAR 2.349e5 (1x1)
    and the solar flux at LORRI's pivot wavelength at 1 au, 176
    erg cm-2 s-1 A-1 (Weaver et al. 2020, Eqs. 8-10 and Table 2; the 2017
    headers carry an older RSOLAR);
  - each pixel's ray, from the spacecraft position relative to Jupiter
    (header SPC1SCX/Y/Z, J2000) along the camera's pointing (the SPICE
    quaternion SPCQA/X/Y/Z, instrument to J2000; 4.9636 urad pixels), meets
    the plane of Jupiter's equator (IAU pole) at ring radius r;
  - the reconstructed pointing is off by tens of pixels, so it is refitted
    on the main ring's sharp outer edge, 129,100 km (de Pater et al. 2018);
  - the sky (Jupiter's scattered light) is a plane fitted to 132,000-
    145,000 km and taken off; normal I/F is I/F times |sin B|, B the
    spacecraft's elevation above the ring plane.
"""

from __future__ import annotations

import numpy as np

IFOV = 4.9636e-6                 # rad per 1x1 pixel (Weaver et al. 2020)
RSOLAR = {1: 2.349e5, 4: 4.092e6}
F_SUN_1AU = 176.0                # erg cm-2 s-1 A-1 at the pivot, 6076 A
AU = 149597870.7
EDGE_KM = 129100.0


def read_fits(path):
    raw = open(path, 'rb').read()
    txt = raw.decode('latin1')
    i, cards = 0, []
    while True:
        blk = txt[i:i + 2880]
        i += 2880
        cs = [blk[j:j + 80] for j in range(0, 2880, 80)]
        cards += cs
        if any(c.startswith('END') and c[3:].strip() == '' for c in cs):
            break
    H = {}
    for c in cards:
        if len(c) > 9 and c[8] == '=':
            v = c[10:].split(' /')[0].strip()
            if v.startswith("'"):
                v = v.strip("'").strip()
            else:
                try:
                    v = float(v)
                except ValueError:
                    pass
            H[c[:8].strip()] = v
    n1, n2 = int(H['NAXIS1']), int(H['NAXIS2'])
    a = np.frombuffer(raw[i:i + n1 * n2 * 4], dtype='>f4').reshape(n2, n1).astype(np.float64)
    return a, H


def quat_matrix(q0, q1, q2, q3):
    """SPICE quaternion to rotation matrix (instrument to J2000)."""
    return np.array([
        [1 - 2 * (q2 * q2 + q3 * q3), 2 * (q1 * q2 - q0 * q3), 2 * (q1 * q3 + q0 * q2)],
        [2 * (q1 * q2 + q0 * q3), 1 - 2 * (q1 * q1 + q3 * q3), 2 * (q2 * q3 - q0 * q1)],
        [2 * (q1 * q3 - q0 * q2), 2 * (q2 * q3 + q0 * q1), 1 - 2 * (q1 * q1 + q2 * q2)]])


def jupiter_pole(jd_tdb):
    """IAU (Archinal et al. 2018) Jupiter pole, its leading terms."""
    T = (jd_tdb - 2451545.0) / 36525
    ra, dec = np.radians(268.056595 - 0.006499 * T), np.radians(64.495303 + 0.002413 * T)
    return np.array([np.cos(dec) * np.cos(ra), np.cos(dec) * np.sin(ra), np.sin(dec)])


def ring_radius(H, shape, dx, dy, binning=1):
    """Ring-plane radius (km) for every pixel, the pointing nudged by
    (dx, dy) full-resolution pixels; NaN where the ray misses the plane in
    front or Jupiter hides it. Pixel (x, y), FITS order, looks along
    (u, v, -1) in the instrument frame, u = x - 511.5 and v = y - 511.5
    (the orientation that puts the ring where the images show it)."""
    summ = int(round(1024 / (shape[1] * binning)))
    s = IFOV * summ
    n2, n1 = shape
    y, x = np.mgrid[0:n2, 0:n1].astype(np.float64)
    c = (1024 / summ - 1) / 2
    u = ((x + 0.5) * binning - 0.5 - c + dx) * s
    v = ((y + 0.5) * binning - 0.5 - c + dy) * s
    d = np.stack([u, v, -np.ones_like(u)], -1)
    d /= np.linalg.norm(d, axis=-1, keepdims=True)
    dj = d @ quat_matrix(H['SPCQA'], H['SPCQX'], H['SPCQY'], H['SPCQZ']).T
    P = np.array([H['SPC1SCX'], H['SPC1SCY'], H['SPC1SCZ']])
    n = jupiter_pole(2451545.0 + H['SPCSCET'] / 86400)
    t = -(P @ n) / (dj @ n)
    r = np.linalg.norm(P + t[..., None] * dj, axis=-1)
    r[t <= 0] = np.nan
    b = dj @ P
    c2 = P @ P - 71492.0 ** 2
    r[(b * b - c2 > 0) & (-b - np.sqrt(np.maximum(b * b - c2, 0)) < t)] = np.nan
    return r


def geometry(H):
    """Phase angle, and B, the spacecraft's elevation above the ring plane (deg)."""
    sc = np.array([H['SPC1SCX'], H['SPC1SCY'], H['SPC1SCZ']])
    sun = np.array([H['SPC1SOX'], H['SPC1SOY'], H['SPC1SOZ']])
    n = jupiter_pole(2451545 + H['SPCSCET'] / 86400)
    B = np.degrees(np.arcsin(sc @ n / np.linalg.norm(sc)))
    phase = np.degrees(np.arccos(sun @ sc / np.linalg.norm(sun) / np.linalg.norm(sc)))
    return float(phase), float(B)


def iof(a, H):
    summ = int(round(1024 / a.shape[1]))
    rh = np.linalg.norm([H['SPC1SOX'], H['SPC1SOY'], H['SPC1SOZ']]) / AU
    return a / H['EXPTIME'] / RSOLAR[summ] * np.pi * rh * rh / F_SUN_1AU


def edge_score(a, r):
    """How sharply the image drops across the main ring's outer edge."""
    inside = (r > EDGE_KM - 700) & (r < EDGE_KM - 100)
    outside = (r > EDGE_KM + 300) & (r < EDGE_KM + 1200)
    if inside.sum() < 100 or outside.sum() < 100:
        return -1e9
    return float(np.median(a[inside]) - np.median(a[outside]))


SEARCH_SPAN = 54        # px: the coarse search's reach plus its last step


def fit_pointing(a, H, span=48, step=6):
    best = (-1e9, 0.0, 0.0)
    for dx in range(-span, span + 1, step):
        for dy in range(-span, span + 1, step):
            s = edge_score(a, ring_radius(H, a.shape, dx, dy))
            if s > best[0]:
                best = (s, float(dx), float(dy))
    _, x0, y0 = best
    for dx in np.arange(x0 - step, x0 + step + 0.5, 1.0):
        for dy in np.arange(y0 - step, y0 + step + 0.5, 1.0):
            s = edge_score(a, ring_radius(H, a.shape, dx, dy))
            if s > best[0]:
                best = (s, float(dx), float(dy))
    return best


def plane_background(I, r, keep):
    """A plane in pixel (x, y) through the sky pixels, sigma-clipped."""
    n2, n1 = I.shape
    y, x = np.mgrid[0:n2, 0:n1].astype(np.float64)
    terms = [np.ones_like(x), (x - n1 / 2) / n1, (y - n2 / 2) / n2]
    M = np.stack([t[keep] for t in terms], -1)
    z = I[keep]
    w = np.ones_like(z, dtype=bool)
    for _ in range(3):
        coef, *_ = np.linalg.lstsq(M[w], z[w], rcond=None)
        res = z - M @ coef
        s = 1.4826 * np.median(np.abs(res[w]))
        w = np.abs(res) < 3 * s
    return sum(c * t for c, t in zip(coef, terms))


def profile(vals, r, edges):
    """Clipped mean of vals in each radius bin (NaN with under 20 pixels)."""
    out = np.full(len(edges) - 1, np.nan)
    ok = np.isfinite(r)
    idx = np.digitize(r[ok], edges) - 1
    v = vals[ok]
    for k in range(len(edges) - 1):
        s = v[idx == k]
        if s.size >= 20:
            med = np.median(s)
            mad = 1.4826 * np.median(np.abs(s - med)) + 1e-30
            out[k] = s[np.abs(s - med) < 3 * mad].mean()
    return out


def reduce_image(path, edges):
    """One image's normal I/F profile and geometry."""
    a, H = read_fits(path)
    phase, B = geometry(H)
    score, dx, dy = fit_pointing(a, H)
    r = ring_radius(H, a.shape, dx, dy)
    I = iof(a, H)
    sky = np.isfinite(r) & (r > 132000) & (r < 145000)
    I = (I - plane_background(I, r, sky)) * abs(np.sin(np.radians(B)))
    return {'phase': phase, 'B': B, 'dx': dx, 'dy': dy, 'edgeScore': score,
            'rMin': float(np.nanmin(r)), 'profile': profile(I, r, edges)}
