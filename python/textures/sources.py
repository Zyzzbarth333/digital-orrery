"""Per-body recipes for build_textures.py: which source files, how they are
encoded, and the credit each output carries. Source files are fetched by
the list in docs/frontend/textures.md into the source folder."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None


def join_halves(src: Path, stem: str) -> Image.Image:
    """USGS WMS caps each side at 4096 px, so maps come as west and east halves."""
    w = Image.open(src / f"{stem}_west.png").convert("RGB")
    e = Image.open(src / f"{stem}_east.png").convert("RGB")
    out = Image.new("RGB", (w.width + e.width, w.height))
    out.paste(w, (0, 0))
    out.paste(e, (w.width, 0))
    return out


def save_tmp(img: Image.Image, src: Path, name: str) -> Path:
    p = src / "_work" / name
    p.parent.mkdir(exist_ok=True)
    img.save(p)
    return p


# ------------------------------------------------------------------ Earth

def earth(src, out, colour_map, heights_km, normal_map):
    # Earth is calibrated, not albedo-normalised: a cloud-free map scaled to
    # the whole planet's albedo would make the ground far too bright. The
    # brightest 0.5 % (Antarctic and Greenland snow) is set to reflectance
    # 0.9, the visible reflectance of fresh snow, and the rest scales with it.
    from build_textures import bright_luminance
    months, whites = [], []
    for m in range(1, 13):
        rel = f"earth/day-{m:02d}.webp"
        colour_map(src / f"earth_day_{m:02d}.jpg", out / rel, 5400)
        whites.append(bright_luminance(Image.open(src / f"earth_day_{m:02d}.jpg")))
        months.append(rel)
    # Night lights: the Black Marble 2016 greyscale (lights only), tinted to
    # the colour of mostly sodium and LED street lighting. A display layer.
    g = Image.open(src / "earth_night_gray.jpg").convert("L").resize((8192, 4096), Image.Resampling.LANCZOS)
    a = np.asarray(g, dtype=np.float64) / 255.0
    tint = np.array([1.0, 0.78, 0.52])
    rgb = np.clip(a[..., None] * tint * 255.0, 0, 255).astype(np.uint8)
    night = save_tmp(Image.fromarray(rgb, "RGB"), src, "earth_night_tinted.png")
    colour_map(night, out / "earth/night.webp", 8192)
    # Relief: ETOPO 2022 surface elevation (ice surface, with bathymetry),
    # signed 16-bit metres. The ocean floor is flattened to sea level for
    # the shading, since water covers it.
    h = heights_km(src / "earth_etopo2022_8192_s16.tif", 0.001)
    h = np.maximum(h, 0.0)
    normal_map(h, 6371.0084, out / "earth/normal.webp", 8192)
    return {
        "dayMonthly": months,
        "dayWhiteLuminance": float(np.mean(whites)),
        "night": "earth/night.webp",
        "normal": "earth/normal.webp",
        "credit": "Blue Marble Next Generation (Reto Stöckli), Black Marble 2016: NASA Earth Observatory. "
                  "Relief: NOAA NCEI ETOPO 2022 (doi:10.25921/fd45-gt74).",
    }


# ------------------------------------------------------------------ Moon

def moon(src, out, colour_map, heights_km, normal_map):
    lum = colour_map(src / "moon_lroc_color_8k.tif", out / "moon/day.webp", 8192)
    # LDEM uint16: half-metres above 1,727.4 km, so h = (v - 20000) / 2 m
    # above the 1,737.4 km reference sphere.
    h = heights_km(src / "moon_ldem_16_uint.tif", 0.0005, -10.0)
    normal_map(h, 1737.4, out / "moon/normal.webp", 5760)
    return {
        "day": "moon/day.webp", "dayMeanLuminance": lum, "normal": "moon/normal.webp",
        "credit": "NASA's Scientific Visualization Studio, CGI Moon Kit (LRO LROC colour, LOLA elevation).",
    }


# ------------------------------------------------------------------ Mars

def mars(src, out, colour_map, heights_km, normal_map):
    colour = save_tmp(join_halves(src, "mars_mdim21"), src, "mars_mdim21.png")
    lum = colour_map(colour, out / "mars/day.webp", 8192)
    # MOLA MEGDR 16 px/deg: raw big-endian int16 metres above the areoid,
    # 5760 x 2880, west edge at 0 deg east.
    raw = np.fromfile(src / "mars_mola_meg016.img", dtype=">i2").reshape(2880, 5760).astype(np.float64)
    normal_map(raw / 1000.0, 3389.5, out / "mars/normal.webp", 5760, west_edge_deg=0.0)
    return {
        "day": "mars/day.webp", "dayMeanLuminance": lum, "normal": "mars/normal.webp",
        "credit": "Viking MDIM 2.1 colour mosaic: NASA/JPL, USGS Astrogeology. "
                  "MOLA MEGDR elevation: NASA/GSFC MOLA Science Team.",
    }


# ------------------------------------------------------------------ others

def mercury(src, out, colour_map, heights_km, normal_map):
    colour = save_tmp(join_halves(src, "mercury_mdis"), src, "mercury_mdis.png")
    lum = colour_map(colour, out / "mercury/day.webp", 8192)
    return {"day": "mercury/day.webp", "dayMeanLuminance": lum,
            "credit": "MESSENGER MDIS colour: NASA/JHUAPL/Carnegie Institution of Washington, USGS Astrogeology."}


def pluto(src, out, colour_map, heights_km, normal_map):
    colour = save_tmp(join_halves(src, "pluto_nh"), src, "pluto_nh.png")
    lum = colour_map(colour, out / "pluto/day.webp", 8192)
    return {"day": "pluto/day.webp", "dayMeanLuminance": lum,
            "credit": "New Horizons LORRI/MVIC mosaic: NASA/JHUAPL/SwRI, USGS Astrogeology."}


def venus(src, out, colour_map, heights_km, normal_map):
    # In visible light Venus is its cloud deck; the surface is radar only.
    lum = colour_map(src / "sss_4k_venus_atmosphere.jpg", out / "venus/day.webp", 4096)
    return {"day": "venus/day.webp", "dayMeanLuminance": lum,
            "credit": "Cloud map: Solar System Scope (CC BY 4.0), based on NASA imagery."}


def jupiter(src, out, colour_map, heights_km, normal_map):
    img = Image.open(src / "jupiter_pia07782.jpg").convert("RGB").resize((4096, 2048), Image.Resampling.LANCZOS)
    lum = colour_map(save_tmp(img, src, "jupiter.png"), out / "jupiter/day.webp", 4096)
    return {"day": "jupiter/day.webp", "dayMeanLuminance": lum,
            "credit": "Cassini global map PIA07782: NASA/JPL/Space Science Institute."}


def giant(name, file, width):
    def build(src, out, colour_map, heights_km, normal_map):
        lum = colour_map(src / file, out / f"{name}/day.webp", width)
        return {"day": f"{name}/day.webp", "dayMeanLuminance": lum,
                "credit": "Solar System Scope (CC BY 4.0), based on NASA imagery."}
    return build


def rings(src, out, colour_map, heights_km, normal_map):
    """Saturn's normal optical depth from the Cassini UVIS 126 Tau egress
    occultation, 10 km bins (PDS Rings Node, COUVIS_8001). Columns (from
    the .LBL): 0 radius km, 3 mean signal, 4 normal optical depth, 5 maximum
    detectable depth, 8 unocculted star model. A depth of -1 means
    unconstrained, which this profile uses for three different things:
      - signal flagged missing (-1): a data gap, filled by interpolation;
      - signal at or above the unocculted star: a clear gap, tau = 0;
      - inside the C ring's inner edge (74,490 km): the D ring, tau = 0.
    Where tau reaches 95 % of the maximum detectable depth the measurement
    has saturated (the B ring core); those bins are set to 5, effectively
    opaque, since the true depth is only known to exceed the limit."""
    import json
    a = np.array([[float(x) for x in line.split(",")]
                  for line in (src / "saturn_uvis_tau10km.tab").read_text().splitlines() if line.strip()])
    r, signal, tau, tmax, star = a[:, 0], a[:, 3], a[:, 4].copy(), a[:, 5], a[:, 8]
    unconstrained = tau < 0
    clear = unconstrained & ((signal >= 0.95 * star) | (r < 74490.0))
    missing = unconstrained & ~clear
    tau[clear] = 0.0
    saturated = (~unconstrained) & (tmax > 0) & (tau >= 0.95 * tmax)
    tau[saturated] = 5.0
    good = ~missing
    tau[missing] = np.interp(r[missing], r[good], tau[good])
    print(f"  {len(r)} bins: {clear.sum()} clear, {missing.sum()} missing (interpolated), "
          f"{saturated.sum()} saturated (set to 5)")
    # Resample onto an even 10 km grid for the texture.
    step = 10.0
    grid = np.arange(r[0], r[-1] + step / 2, step)
    tg = np.interp(grid, r, tau)
    p = out / "saturn" / "rings_tau.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"innerKm": float(grid[0]), "stepKm": step,
                             "tau": [round(float(t), 4) for t in tg]}))
    print(f"  wrote {p.relative_to(out.parent.parent)}  {len(tg)} bins {grid[0]:.0f}-{grid[-1]:.0f} km")
    return {"saturn": {"tau": "saturn/rings_tau.json", "innerKm": float(grid[0]), "outerKm": float(grid[-1]),
                       "credit": "Cassini UVIS 126 Tau occultation optical depth (Colwell et al.): "
                                 "NASA PDS Ring-Moon Systems Node."}}


BODIES = {
    "earth": earth, "moon": moon, "mars": mars, "mercury": mercury, "pluto": pluto,
    "venus": venus, "jupiter": jupiter,
    "saturn": giant("saturn", "sss_8k_saturn.jpg", 4096),
    "uranus": giant("uranus", "sss_2k_uranus.jpg", 2048),
    "neptune": giant("neptune", "sss_2k_neptune.jpg", 2048),
    "rings": rings,
}


def _shift_reduce(a, r, fn, axis):
    """Sliding min or max of width 2r+1 along an axis (wrapping in RA, axis 1;
    clamped at the poles, axis 0)."""
    out = a.copy()
    for k in range(1, r + 1):
        for d in (k, -k):
            if axis == 1:
                sh = np.roll(a, d, axis=1)
            else:
                idx = np.clip(np.arange(a.shape[0]) - d, 0, a.shape[0] - 1)
                sh = a[idx]
            out = fn(out, sh)
    return out


def _box(a, r):
    """Box blur of width 2r+1, wrapping in RA."""
    out = np.zeros_like(a)
    for dx in range(-r, r + 1):
        out += np.roll(a, dx, axis=1)
    a = out / (2 * r + 1)
    out = np.zeros_like(a)
    for dy in range(-r, r + 1):
        idx = np.clip(np.arange(a.shape[0]) - dy, 0, a.shape[0] - 1)
        out += a[idx]
    return out / (2 * r + 1)


# The twenty brightest stars (RA, Dec in degrees, J2000; V magnitude): Sirius,
# Canopus, Alpha Centauri (A and B together), Arcturus, Vega, Capella, Rigel,
# Procyon, Achernar, Betelgeuse, Hadar, Altair, Acrux, Aldebaran, Antares,
# Spica, Pollux, Fomalhaut, Deneb, Mimosa; and Polaris.
BRIGHT_STARS = [
    (101.287, -16.716, -1.46), (95.988, -52.696, -0.74), (219.900, -60.834, -0.27), (213.915, 19.182, -0.05),
    (279.234, 38.784, 0.03), (79.172, 45.998, 0.08), (78.634, -8.202, 0.13), (114.825, 5.225, 0.34),
    (24.429, -57.237, 0.46), (88.793, 7.407, 0.50), (210.956, -60.373, 0.61), (297.696, 8.868, 0.76),
    (186.650, -63.099, 0.76), (68.980, 16.509, 0.86), (247.352, -26.432, 0.96), (201.298, -11.161, 0.97),
    (116.329, 28.026, 1.14), (344.413, -29.622, 1.16), (310.358, 45.280, 1.25), (191.930, -59.689, 1.25),
    (37.955, 89.264, 1.98),   # Polaris: smeared along the map's top rows, so it is pinned too
]


def stars(src, out, colour_map, heights_km, normal_map, count=20000):
    """NASA SVS Deep Star Maps 2020 (Hipparcos-2, Tycho-2, Gaia DR2), linear
    half-float EXR in ICRF, RA 0h at the centre, RA increasing to the left,
    split into the stars and the light between them.

    At 4096 x 2048 a texel is 0.088 deg, magnified 1.6 to 3.4 times on
    screen, so stars drawn from the map are soft blobs. Instead:
    - the diffuse light is estimated with a grey-scale opening (7 x 7 min,
      then max) and a 5 x 5 box blur;
    - stars are the `count` brightest local maxima of the map minus that
      estimate, at least 4 texels apart (wider toward the poles); each is
      measured in a 7 x 7 aperture weighted by cos Dec (flux in R, G, B,
      flux-weighted centroid) and replaced in the map by the estimate over
      9 x 9, feathered at the edge;
    - the map that is left (the Milky Way and every star too faint to pick
      out) is written as 8-bit sRGB, its brightest 0.01 % at white;
    - the stars are written as points (stars/points.bin, float32 x, y, z in
      J2000 equatorial, magnitude, linear R, G, B at luminance 1), their
      magnitudes by rank against all-sky star counts (see below), since the
      map's own photometry is compressed.
    The scene draws them as sharp points over the map (src/scene/stars.ts)."""
    import json
    import subprocess
    exr = src / "starmap_2020_4k.exr"
    raw = src / "_work" / "starmap.f32"
    raw.parent.mkdir(exist_ok=True)
    if not raw.exists():
        subprocess.run(["node", str(Path(__file__).with_name("exr_to_f32.mjs")), str(exr), str(raw)], check=True)
    size = json.loads(raw.with_suffix(".f32.json").read_text())
    H, W = size["height"], size["width"]
    a = np.maximum(np.fromfile(raw, dtype=np.float32).reshape(H, W, 3), 0.0)
    lumw = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)

    bg = _shift_reduce(a, 3, np.minimum, 1)
    bg = _shift_reduce(bg, 3, np.minimum, 0)
    bg = _shift_reduce(bg, 3, np.maximum, 1)
    bg = _shift_reduce(bg, 3, np.maximum, 0)
    bg = _box(bg, 2).astype(np.float32)
    res = a - bg
    rl = res @ lumw
    peak = rl == _shift_reduce(_shift_reduce(rl, 2, np.maximum, 1), 2, np.maximum, 0)
    ys, xs = np.nonzero(peak & (rl > 0))
    order = np.argsort(-rl[ys, xs])[: int(count * 1.6)]
    ys, xs = ys[order], xs[order]
    # Bright stars are drawn as flat discs a few texels wide, with several
    # local maxima: keep the brightest within 4 texels of each.
    # Rows near the poles cover less sky (cos Dec), so a star spreads over
    # more texels there: the window widens and texels are weighted by it.
    cosrow = np.cos(np.radians(90.0 - 180.0 * (np.arange(H) + 0.5) / H))
    taken = np.zeros((H, W), dtype=bool)
    keep = []
    for i, (y0, x0) in enumerate(zip(ys, xs)):
        y1, y2 = max(0, y0 - 4), min(H, y0 + 5)
        rx = min(W // 2, int(np.ceil(4 / max(cosrow[y0], 0.02))))
        cols = np.arange(x0 - rx, x0 + rx + 1) % W
        if taken[y1:y2][:, cols].any():
            continue
        keep.append(i)
        taken[y0, x0] = True
        if len(keep) == count:
            break
    ys, xs = ys[keep], xs[keep]

    flux = np.zeros((len(ys), 3))
    cx = np.zeros(len(ys)); cy = np.zeros(len(ys)); wsum = np.zeros(len(ys))
    clean = a.copy()
    for dy in range(-4, 5):
        yy = np.clip(ys + dy, 0, H - 1)
        for dx in range(-4, 5):
            xx = (xs + dx) % W
            # Feathered: the outer ring keeps half the original, so the patch
            # does not show as a smooth square in the map's grain.
            ring = max(abs(dy), abs(dx))
            t = 1.0 if ring <= 2 else (0.75 if ring == 3 else 0.4)
            clean[yy, xx] = clean[yy, xx] * (1 - t) + bg[yy, xx] * t
            if ring > 3:
                continue
            f = np.maximum(res[yy, xx], 0.0) * cosrow[yy][:, None]
            flux += f
            w = f @ lumw
            cx += w * dx; cy += w * dy; wsum += w
    fl = flux @ lumw
    keep = fl > 0
    flux, fl, cx, cy, wsum, ys, xs = flux[keep], fl[keep], cx[keep], cy[keep], wsum[keep], ys[keep], xs[keep]
    x = xs + cx / wsum + 0.5
    y = ys + cy / wsum + 0.5
    ra = np.radians(180.0 - 360.0 * x / W)      # RA 180 deg at the left edge, increasing to the left
    dec = np.radians(90.0 - 180.0 * y / H)
    # Magnitudes by rank: a 5 x 5 aperture on this map compresses the range
    # (bright stars are drawn wider than the aperture), giving -1.5 to 4.4
    # for 40,000 stars that really reach V 8. So each star takes the
    # magnitude whose all-sky count matches its rank (cumulative counts
    # N(< V) of the standard star-count tables, interpolated in log N).
    rank = np.empty(len(fl)); rank[np.argsort(-fl)] = np.arange(1, len(fl) + 1)
    n_tab = np.log10([1, 15, 48, 171, 513, 1602, 4800, 14000, 41000, 117000])
    v_tab = np.array([-1.46, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    mag = np.interp(np.log10(rank), n_tab, v_tab)
    # The brightest stars keep their own V magnitudes (matched within 0.3 deg).
    for ra0, de0, v in BRIGHT_STARS:
        r0, d0 = np.radians(ra0), np.radians(de0)
        cosd = np.sin(dec) * np.sin(d0) + np.cos(dec) * np.cos(d0) * np.cos(ra - r0)
        j = int(np.argmax(cosd))
        if cosd[j] > np.cos(np.radians(0.3)):
            mag[j] = v
    rgb = flux / fl[:, None]
    pts = np.stack([np.cos(dec) * np.cos(ra), np.cos(dec) * np.sin(ra), np.sin(dec), mag,
                    rgb[:, 0], rgb[:, 1], rgb[:, 2]], axis=1).astype(np.float32)
    p = out / "stars" / "points.bin"
    p.parent.mkdir(parents=True, exist_ok=True)
    pts.tofile(p)
    print(f"  wrote stars/points.bin: {len(pts)} stars, magnitude {mag.min():.2f} to {mag.max():.2f}, {p.stat().st_size / 1e6:.2f} MB")

    scale = 1.0 / np.percentile(clean.max(axis=2), 99.99)
    lin = np.clip(clean * scale, 0, 1)
    srgb = np.where(lin <= 0.0031308, 12.92 * lin, 1.055 * lin ** (1 / 2.4) - 0.055)
    img = Image.fromarray(np.rint(srgb * 255).astype(np.uint8), "RGB")
    m = out / "stars" / "milky-way.webp"
    img.save(m, "WEBP", quality=92, method=6)
    print(f"  wrote stars/milky-way.webp {img.size[0]}x{img.size[1]} {m.stat().st_size / 1e6:.1f} MB (stars removed)")
    return {"map": "stars/milky-way.webp", "raAtLeftDeg": 180.0, "raIncreasesRight": False, "gain": 1.0,
            "points": "stars/points.bin", "pointCount": int(len(pts)),
            "credit": "NASA/Goddard Space Flight Center Scientific Visualization Studio, Deep Star Maps 2020. "
                      "Gaia DR2: ESA/Gaia/DPAC."}


BODIES["stars"] = stars
