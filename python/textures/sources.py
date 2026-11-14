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


def stars(src, out, colour_map, heights_km, normal_map, vmax=9.0):
    """The sky in two layers (docs/frontend/textures.md#stars).

    The light between the stars: NASA SVS Deep Star Maps 2020, the Milky Way
    layer (milkyway_2020_4k.exr), which is the full star map with the
    Hipparcos and Tycho stars taken out; linear half-float, ICRF plate
    carree, RA 0h at the centre and increasing to the left. Written as 8-bit
    sRGB with its brightest 0.01 % at white.

    The stars: the Hipparcos main catalogue (ESA 1997), 118,218 stars, via
    NASA HEASARC (heasarc_hipparcos.tdat.gz). Stars to V `vmax` are kept,
    each as int16 x, y, z (J2000 unit vector times 32767), int16 V x 1000
    and int16 B-V x 1000 (-32768 where the catalogue has none): 10 bytes a
    star. The app turns B-V into a colour (stars.ts)."""
    import gzip
    import json
    import subprocess
    exr = src / "milkyway_2020_4k.exr"
    raw = src / "_work" / "milkyway.f32"
    raw.parent.mkdir(exist_ok=True)
    if not raw.exists():
        subprocess.run(["node", str(Path(__file__).with_name("exr_to_f32.mjs")), str(exr), str(raw)], check=True)
    size = json.loads(raw.with_suffix(".f32.json").read_text())
    a = np.maximum(np.fromfile(raw, dtype=np.float32).reshape(size["height"], size["width"], 3), 0.0)
    scale = 1.0 / np.percentile(a.max(axis=2), 99.99)
    lin = np.clip(a * scale, 0, 1)
    srgb = np.where(lin <= 0.0031308, 12.92 * lin, 1.055 * lin ** (1 / 2.4) - 0.055)
    img = Image.fromarray(np.rint(srgb * 255).astype(np.uint8), "RGB")
    m = out / "stars" / "milky-way.webp"
    m.parent.mkdir(parents=True, exist_ok=True)
    img.save(m, "WEBP", quality=92, method=6)
    print(f"  wrote stars/milky-way.webp {img.size[0]}x{img.size[1]} {m.stat().st_size / 1e6:.1f} MB")

    names = None
    rows = []
    with gzip.open(src / "heasarc_hipparcos.tdat.gz", "rt") as f:
        data = False
        for line in f:
            if line.startswith("line[1] = "):
                names = line.split("=", 1)[1].split()
            elif line.startswith("<DATA>"):
                data = True
            elif line.startswith("<END>"):
                break
            elif data and names:
                v = line.rstrip("\n").split("|")
                rows.append(v)
    col = {n: i for i, n in enumerate(names)}
    ra, dec, vm, bv = [], [], [], []
    for v in rows:
        try:
            mag = float(v[col["vmag"]])
            r, d = float(v[col["ra"]]), float(v[col["dec"]])
        except (ValueError, IndexError):
            continue
        if mag > vmax:
            continue
        b = v[col["bv_color"]].strip()
        ra.append(r); dec.append(d); vm.append(mag); bv.append(float(b) if b else np.nan)
    ra, dec, vm, bv = (np.radians(np.array(ra)), np.radians(np.array(dec)), np.array(vm), np.array(bv))
    xyz = np.stack([np.cos(dec) * np.cos(ra), np.cos(dec) * np.sin(ra), np.sin(dec)], axis=1)
    out_arr = np.empty((len(vm), 5), dtype=np.int16)
    out_arr[:, :3] = np.rint(xyz * 32767)
    out_arr[:, 3] = np.rint(vm * 1000)
    out_arr[:, 4] = np.where(np.isnan(bv), -32768, np.rint(np.nan_to_num(bv) * 1000))
    p = out / "stars" / "hipparcos.bin"
    out_arr.tofile(p)
    old = out / "stars" / "points.bin"
    if old.exists():
        old.unlink()
    print(f"  wrote stars/hipparcos.bin: {len(vm)} of {len(rows)} stars to V {vmax}, "
          f"{np.isnan(bv).sum()} without B-V, {p.stat().st_size / 1e6:.2f} MB")
    return {"map": "stars/milky-way.webp", "raAtLeftDeg": 180.0, "raIncreasesRight": False, "gain": 1.0,
            "points": "stars/hipparcos.bin", "pointFormat": "int16 x y z (x 32767), V x 1000, B-V x 1000",
            "pointCount": int(len(vm)),
            "credit": "Milky Way: NASA/Goddard Space Flight Center Scientific Visualization Studio, Deep Star Maps 2020; "
                      "Gaia DR2: ESA/Gaia/DPAC. Stars: the Hipparcos Catalogue, ESA 1997 (ESA SP-1200), via NASA HEASARC."}


BODIES["stars"] = stars
