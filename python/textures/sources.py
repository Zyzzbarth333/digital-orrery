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


# ------------------------------------------------------------------ moons

def gaps(a: np.ndarray, value: int, size: int) -> np.ndarray:
    """No-data in a USGS mosaic, where no spacecraft imaged: solid blocks of
    `value` (black or white) at least `size` pixels across. Imaged pixels of
    that value come singly or in specks, which the opening removes."""
    from PIL import ImageFilter
    flat = np.all(a == value, axis=2) if a.ndim == 3 else a == value
    m = Image.fromarray((flat * 255).astype(np.uint8))
    m = m.filter(ImageFilter.MinFilter(size)).filter(ImageFilter.MaxFilter(size))
    return np.asarray(m) > 0


def fill_gaps(img: Image.Image, gap: np.ndarray, feather_px: int) -> Image.Image:
    """Fill no-data with the imaged part's mean colour (linear light, rows
    weighted by cos lat) and soften the edge over `feather_px`, so an
    unimaged pole shows the moon's mean colour, not black or white."""
    from PIL import ImageFilter
    from build_textures import srgb_to_linear
    a = np.asarray(img.convert("RGB"))
    rows = a.shape[0]
    w = np.cos((0.5 - (np.arange(rows) + 0.5) / rows) * np.pi)[:, None] * ~gap
    lin = srgb_to_linear(a)
    mean_lin = (lin * w[..., None]).sum(axis=(0, 1)) / w.sum()
    mean = np.where(mean_lin <= 0.0031308, 12.92 * mean_lin, 1.055 * mean_lin ** (1 / 2.4) - 0.055) * 255
    filled = np.where(gap[..., None], np.rint(mean).astype(np.uint8), a)
    near = np.asarray(Image.fromarray((gap * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(2 * feather_px + 1))) > 0
    soft = np.asarray(Image.fromarray(filled).filter(ImageFilter.GaussianBlur(feather_px)))
    print(f"    filled {gap.mean() * 100:.1f} % unimaged with the mean colour")
    return Image.fromarray(np.where(near[..., None], soft, filled))


def moon_map(key: str, width: int, credit: str, *, colour: bool = False, gap: int | None = None,
             source: str | None = None):
    """A moon's USGS mosaic (fetched by fetch_moons.py), east-positive with
    its west edge at -180 deg east like every map here. Grey maps (and
    Triton's, whose colour is synthesised from orange, violet and UV
    filters) are kept grey and tinted in the shader by the moon's catalogue
    colour (`tint`)."""
    def build(src, out, colour_map, heights_km, normal_map):
        img = Image.open(src / (source or f"{key}_usgs_wms.png"))
        img = img.convert("RGB")
        if gap is not None:
            size = img.width // 256 + 1                  # 17 px at 4096
            img = fill_gaps(img, gaps(np.asarray(img), gap, size), max(2, img.width // 512))
        if not colour:
            img = img.convert("L").convert("RGB")
        lum = colour_map(save_tmp(img, src, f"{key}.png"), out / f"{key}/day.webp", width)
        entry = {"day": f"{key}/day.webp", "dayMeanLuminance": lum, "credit": credit}
        if not colour:
            entry["tint"] = True
        return entry
    return build


GALILEO = "Galileo SSI and Voyager global mosaic: NASA/JPL, USGS Astrogeology."
CASSINI = "Cassini ISS global mosaic: NASA/JPL/Space Science Institute, USGS Astrogeology."
CASSINI_VOYAGER = "Cassini ISS and Voyager global mosaic: NASA/JPL/Space Science Institute, USGS Astrogeology."

MOONS = {
    "phobos": moon_map("phobos", 2048, "Viking Orbiter mosaic (Stooke, DLR control): NASA/JPL, USGS Astrogeology.",
                       source="phobos_usgs.tif"),
    "deimos": moon_map("deimos", 2048, "Viking Orbiter map (Philip Stooke; Thomas et al. shape model): "
                                       "NASA/JPL, USGS Astrogeology."),
    "io": moon_map("io", 4096, "Galileo SSI and Voyager colour mosaic: NASA/JPL, USGS Astrogeology.", colour=True),
    "europa": moon_map("europa", 4096, GALILEO, gap=0),
    "ganymede": moon_map("ganymede", 4096, GALILEO, gap=0),
    "callisto": moon_map("callisto", 4096, GALILEO, gap=0),
    "mimas": moon_map("mimas", 2048, CASSINI_VOYAGER),
    "enceladus": moon_map("enceladus", 2048, CASSINI),
    "tethys": moon_map("tethys", 2048, CASSINI),
    "dione": moon_map("dione", 2048, CASSINI_VOYAGER),
    "rhea": moon_map("rhea", 2048, CASSINI_VOYAGER),
    "iapetus": moon_map("iapetus", 2048, CASSINI_VOYAGER),
    "triton": moon_map("triton", 4096, "Voyager 2 global mosaic (Paul Schenk, LPI): NASA/JPL, USGS Astrogeology.",
                       gap=255),
    "charon": moon_map("charon", 2048, "New Horizons LORRI/MVIC mosaic: NASA/JHUAPL/SwRI, USGS Astrogeology.",
                       gap=255),
}


BODIES = {
    "earth": earth, "moon": moon, "mars": mars, "mercury": mercury, "pluto": pluto,
    "venus": venus, "jupiter": jupiter,
    "saturn": giant("saturn", "sss_8k_saturn.jpg", 4096),
    "uranus": giant("uranus", "sss_2k_uranus.jpg", 2048),
    "neptune": giant("neptune", "sss_2k_neptune.jpg", 2048),
    "rings": rings,
    **MOONS,
}


def _srgb8(lin: np.ndarray) -> np.ndarray:
    lin = np.clip(lin, 0, 1)
    return np.rint(255 * np.where(lin <= 0.0031308, 12.92 * lin, 1.055 * lin ** (1 / 2.4) - 0.055)).astype(np.uint8)


def _milky_way(src: Path, n: int) -> np.ndarray:
    """The Milky Way layer at n x n/2 as linear float16 RGB, read from the
    SVS EXR (decoded once into the work folder)."""
    import json
    import subprocess
    raw = src / "_work" / f"milkyway{n // 1024}k.f16"
    raw.parent.mkdir(exist_ok=True)
    if not raw.exists():
        subprocess.run(["node", str(Path(__file__).with_name("exr_to_f32.mjs")),
                        str(src / f"milkyway_2020_{n // 1024}k.exr"), str(raw), "--half"], check=True)
    size = json.loads(Path(f"{raw}.json").read_text())
    assert (size["width"], size["height"]) == (n, n // 2), size
    return np.memmap(raw, dtype=np.float16, mode="r", shape=(n // 2, n, 3))


def stars(src, out, colour_map, heights_km, normal_map, vmax=9.0, base=8192, detail=16384, tile=1024, gutter=2):
    """The sky in two layers (docs/frontend/textures.md#stars).

    The light between the stars: NASA SVS Deep Star Maps 2020, the Milky Way
    layer (milkyway_2020_<n>k.exr), which is the full star map with the
    Hipparcos and Tycho stars taken out; linear half-float, ICRF plate
    carree, RA 0h at the centre and increasing to the left. Its pixels hold
    light per pixel, not per steradian: each doubling of the resolution
    quarters them. So each map is multiplied by (n / 4096)^2 and written as
    8-bit sRGB with the white of the 4096-wide map, its brightest 0.01 %
    (0.013 % of the 8192-wide pixels then clip).
    Two products: a `base`-wide map, and the `detail`-wide map cut into
    `tile`-square tiles, each with `gutter` pixels of its neighbours on
    every side (wrapped in RA, repeated at the poles) so the app can filter
    across tile edges. Tile files are <row>-<col>.webp, row 0 at the north.

    The stars: the Hipparcos main catalogue (ESA 1997), 118,218 stars, via
    NASA HEASARC (heasarc_hipparcos.tdat.gz). Stars to V `vmax` are kept,
    each as int16 x, y, z (J2000 unit vector times 32767), int16 V x 1000
    and int16 B-V x 1000 (-32768 where the catalogue has none): 10 bytes a
    star. The app turns B-V into a colour (stars.ts)."""
    import gzip
    import shutil
    # The white of the 4096-wide map (its brightest 0.01 %), carried to the
    # finer maps by their pixel areas, so the sky looks as it did.
    a4 = np.asarray(_milky_way(src, 4096), dtype=np.float32)
    scale = (base / 4096) ** 2 / float(np.percentile(a4.max(axis=2), 99.99))
    del a4
    a = _milky_way(src, base)
    img = Image.fromarray(_srgb8(np.asarray(a, dtype=np.float32) * scale), "RGB")
    m = out / "stars" / f"milky-way-{base // 1024}k.webp"
    m.parent.mkdir(parents=True, exist_ok=True)
    img.save(m, "WEBP", quality=92, method=6)
    old = out / "stars" / "milky-way.webp"          # the earlier 4096-wide map
    if old.exists():
        old.unlink()
    print(f"  wrote {m.relative_to(out)} {img.size[0]}x{img.size[1]} {m.stat().st_size / 1e6:.1f} MB")
    del a, img

    # The detail tiles, at the same white (scale per base pixel / 4 per doubling).
    d = _milky_way(src, detail)
    dscale = scale * (detail / base) ** 2
    rows, cols = detail // 2 // tile, detail // tile
    tdir = out / "stars" / f"milky-way-{detail // 1024}k"
    shutil.rmtree(tdir, ignore_errors=True)
    tdir.mkdir(parents=True)
    total = 0
    for r in range(rows):
        y = np.clip(np.arange(r * tile - gutter, (r + 1) * tile + gutter), 0, detail // 2 - 1)
        band = np.asarray(d[y], dtype=np.float32) * dscale
        band = _srgb8(band)
        for c in range(cols):
            x = np.arange(c * tile - gutter, (c + 1) * tile + gutter) % detail
            t = tdir / f"{r}-{c}.webp"
            Image.fromarray(np.ascontiguousarray(band[:, x]), "RGB").save(t, "WEBP", quality=90, method=6)
            total += t.stat().st_size
    print(f"  wrote {tdir.relative_to(out)}/ {rows}x{cols} tiles of {tile}+2x{gutter} px, {total / 1e6:.1f} MB")

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
        try:
            b = float(v[col["bv_color"]])
        except (ValueError, IndexError):
            b = np.nan                      # no B-V: the app draws it at the Sun's colour
        ra.append(r); dec.append(d); vm.append(mag); bv.append(b)
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
    return {"map": f"stars/milky-way-{base // 1024}k.webp", "raAtLeftDeg": 180.0, "raIncreasesRight": False, "gain": 1.0,
            "detail": {"tiles": f"stars/milky-way-{detail // 1024}k/{{row}}-{{col}}.webp", "width": detail,
                       "tile": tile, "gutter": gutter},
            "points": "stars/hipparcos.bin", "pointFormat": "int16 x y z (x 32767), V x 1000, B-V x 1000",
            "pointCount": int(len(vm)),
            "credit": "Milky Way: NASA/Goddard Space Flight Center Scientific Visualization Studio, Deep Star Maps 2020 "
                      "(SVS 4851, Milky Way layer at 8k and 16k); "
                      "Gaia DR2: ESA/Gaia/DPAC. Stars: the Hipparcos Catalogue, ESA 1997 (ESA SP-1200), via NASA HEASARC."}


BODIES["stars"] = stars
