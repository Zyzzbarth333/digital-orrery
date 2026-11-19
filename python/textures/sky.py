"""The interactive sky's catalogue files (docs/frontend/interactive-sky.md).

    python3 python/textures/sky.py [--src DIR] [--out public]

Writes public/sky/:

- stars-info.bin: for each star of stars/hipparcos.bin, in its order, the
  values its plate shows that the point layer does not carry. Little-endian:
  a 16-byte header (b"SKY1", uint32 n, uint32 spectral-type count, uint32
  spectral-table bytes), then columns of n values each: uint32 HIP, uint32
  HD (0: none), float32 parallax and its standard error (mas; NaN: none),
  float32 proper motion in RA (mu_alpha* = mu_alpha cos dec) and Dec
  (mas/yr; NaN: none), float32 RA and Dec (deg, ICRS, epoch J1991.25, the
  catalogue's own: the point layer's int16 directions are good to 6"), uint16 index into the spectral-type table (0: none),
  uint8 Hipparcos coarse variability flag (0: none, 1-3: H6), padded to 4
  bytes; then the spectral types, UTF-8, joined by "\\n" (the first empty).
- names.json: {"stars": [[index, IAU name, Bayer, superscript, Flamsteed, HR,
  constellation], ...]} for each star with an IAU name or a BSC5
  designation (null where it has none). Bayer is the Greek letter's
  three-letter code as BSC5 gives it ("alp"), the constellation its IAU abbreviation.
- constellations.json: {"constellations": [{abbr, name, gen, en, label:
  [ra, dec] deg, lines: [[i, j], ...]}]}, 88, lines as pairs of star indices.

Sources (each licence read at the source on 19 Nov 2026; see the doc):

- The Hipparcos main catalogue (ESA 1997), via NASA HEASARC,
  heasarc_hipparcos.tdat.gz, the file sources.py's stars() reads. HEASARC:
  "materials are all available freely for your use".
- IAU Catalog of Star Names, IAU WGSN, the live table at
  https://exopla.net/star-names/modern-iau-star-names/ (saved as
  iau-csn-exopla.html). WGSN: the names belong to the public domain.
- The Bright Star Catalogue, 5th revised ed. (Hoffleit and Warren 1991),
  HEASARC heasarc_bsc5p.tdat.gz: Bayer and Flamsteed designations
  (alt_name) and HR numbers, joined to Hipparcos by HD number.
- d3-celestial (Olaf Frohn, BSD-3-Clause), data/constellations.lines.json
  and data/constellations.json at the commit in d3-celestial.commit: the
  lines (after the IAU and Sky & Telescope charts, CC BY 4.0, Alan
  MacRobert's figures) and each constellation's Latin and English names,
  genitive and label point. Its other-language names (from Wikipedia,
  CC BY-SA) are not kept.

Each line vertex is matched to its Hipparcos star: the nearest within 0.02
deg, else the brightest within 0.1 deg; the build stops if one has none.
"""

import argparse
import gzip
import html
import json
import re
import struct
import sys
import urllib.request
from pathlib import Path

import numpy as np

DEFAULT_SRC = Path.home() / ".cache" / "digital-orrery" / "textures-src"
VMAX = 9.0            # as sources.py's stars(): the point layer's limit
D3_COMMIT = "7e720a3de062059d4c5400a379146a601d9010e0"
URLS = {
    "sky/iau-csn-exopla.html": "https://exopla.net/star-names/modern-iau-star-names/",
    "sky/heasarc_bsc5p.tdat.gz": "https://heasarc.gsfc.nasa.gov/FTP/heasarc/dbase/tdat_files/heasarc_bsc5p.tdat.gz",
    "sky/d3-constellations.lines.json": f"https://raw.githubusercontent.com/ofrohn/d3-celestial/{D3_COMMIT}/data/constellations.lines.json",
    "sky/d3-constellations.json": f"https://raw.githubusercontent.com/ofrohn/d3-celestial/{D3_COMMIT}/data/constellations.json",
}
GREEK = ["alp", "bet", "gam", "del", "eps", "zet", "eta", "the", "iot", "kap", "lam", "mu", "nu", "xi",
         "omi", "pi", "rho", "sig", "tau", "ups", "phi", "chi", "psi", "ome"]


def fetch(src: Path) -> None:
    for rel, url in URLS.items():
        p = src / rel
        if p.exists():
            continue
        p.parent.mkdir(parents=True, exist_ok=True)
        print(f"  fetching {url}")
        req = urllib.request.Request(url, headers={"User-Agent": "digital-orrery-build"})
        with urllib.request.urlopen(req, timeout=120) as r:
            p.write_bytes(r.read())


def tdat(path: Path):
    """A HEASARC .tdat.gz as (column index by name, rows of strings)."""
    names, rows, data = None, [], False
    with gzip.open(path, "rt", encoding="latin-1") as f:
        for line in f:
            if line.startswith("line[1] = "):
                names = line.split("=", 1)[1].split()
            elif line.startswith("<DATA>"):
                data = True
            elif line.startswith("<END>"):
                break
            elif data and names:
                rows.append(line.rstrip("\n").split("|"))
    if names is None:
        sys.exit(f"{path} has no column list")
    return {n: i for i, n in enumerate(names)}, rows


def num(s: str, kind=float):
    try:
        return kind(s)
    except (ValueError, TypeError):
        return None


def hipparcos(src: Path):
    """The point layer's stars, in hipparcos.bin's order: the same filter
    as sources.py's stars(), so index i here is star i there."""
    col, rows = tdat(src / "heasarc_hipparcos.tdat.gz")
    kept = []
    for v in rows:
        try:
            mag = float(v[col["vmag"]])
            r, d = float(v[col["ra"]]), float(v[col["dec"]])
        except (ValueError, IndexError):
            continue
        if mag > VMAX:
            continue
        b = num(v[col["bv_color"]])
        kept.append({
            "hip": int(v[col["hip_number"]]), "ra": r, "dec": d, "v": mag, "bv": b,
            "hd": num(v[col["hd_id"]], int) or 0,
            "plx": num(v[col["parallax"]]), "plxErr": num(v[col["parallax_error"]]),
            "pmRa": num(v[col["pm_ra"]]), "pmDec": num(v[col["pm_dec"]]),
            "var": num(v[col["var_flag"]], int) or 0,
            "sp": v[col["spect_type"]].strip(),
        })
    return kept


def check_order(stars, out: Path) -> None:
    """Stop unless these stars are hipparcos.bin's, star for star."""
    p = out / "textures" / "stars" / "hipparcos.bin"
    a = np.fromfile(p, dtype=np.int16).reshape(-1, 5)
    if len(a) != len(stars):
        sys.exit(f"hipparcos.bin has {len(a)} stars, the catalogue gives {len(stars)}")
    ra = np.radians([s["ra"] for s in stars]); dec = np.radians([s["dec"] for s in stars])
    xyz = np.rint(np.stack([np.cos(dec) * np.cos(ra), np.cos(dec) * np.sin(ra), np.sin(dec)], axis=1) * 32767)
    vm = np.rint(np.array([s["v"] for s in stars]) * 1000)
    if not (np.array_equal(a[:, :3], xyz.astype(np.int16)) and np.array_equal(a[:, 3], vm.astype(np.int16))):
        sys.exit("hipparcos.bin is not in the catalogue's order: build the textures' stars first")


def iau_names(src: Path):
    """HIP -> IAU name, from the WGSN table's rows: proper name, NEC+,
    designation, HIP, Bayer ID, ..."""
    s = (src / "sky" / "iau-csn-exopla.html").read_text(encoding="utf-8", errors="replace")
    out = {}
    for body in re.findall(r'<tr id="table_\d+_row_\d+"(.*?)</tr>', s, re.S):
        cells = [html.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", body, re.S)]
        if len(cells) < 4 or not cells[0]:
            continue
        hip = num(cells[3].replace(",", ""), int)
        if hip:
            out.setdefault(hip, cells[0])
    return out


def bsc(src: Path):
    """HD -> (Bayer, superscript, Flamsteed, HR, constellation) from BSC5's
    alt_name, a fixed-width field read from the right: constellation (3),
    superscript (1), Greek letter (3), Flamsteed number."""
    col, rows = tdat(src / "sky" / "heasarc_bsc5p.tdat.gz")
    out = {}
    for v in rows:
        hd = num(v[col["hd"]], int)
        hr = num(v[col["hr"]], int)
        if not hd:
            continue
        s = v[col["alt_name"]].rstrip()
        bayer = sup = flam = con = None
        if len(s) >= 7:
            con = s[-3:]
            sup = num(s[-4], int)
            g = s[-7:-4].strip().lower()
            bayer = g if g in GREEK else None
            flam = num(s[:-7].strip(), int)
            if bayer is None:
                sup = None
            if bayer is None and flam is None:
                con = None
        out[hd] = (bayer, sup, flam, hr, con)
    return out


def write_info(stars, path: Path) -> None:
    n = len(stars)
    sp = [""] + sorted({s["sp"] for s in stars if s["sp"]})
    spi = {t: i for i, t in enumerate(sp)}
    if len(sp) > 65535:
        sys.exit("too many spectral types for uint16")
    nan = float("nan")
    f32 = lambda k: np.array([nan if s[k] is None else s[k] for s in stars], dtype="<f4")
    table = "\n".join(sp).encode("utf-8")
    with open(path, "wb") as f:
        f.write(b"SKY1" + struct.pack("<III", n, len(sp), len(table)))
        f.write(np.array([s["hip"] for s in stars], dtype="<u4").tobytes())
        f.write(np.array([s["hd"] for s in stars], dtype="<u4").tobytes())
        for k in ("plx", "plxErr", "pmRa", "pmDec", "ra", "dec"):
            f.write(f32(k).tobytes())
        f.write(np.array([spi[s["sp"]] for s in stars], dtype="<u2").tobytes())
        f.write(np.array([s["var"] for s in stars], dtype="u1").tobytes())
        f.write(b"\0" * ((-(n * 3)) % 4))
        f.write(table)
    print(f"  wrote sky/{path.name}: {n} stars, {len(sp) - 1} spectral types, {path.stat().st_size / 1e6:.2f} MB")


def unit(ra, dec):
    ra, dec = np.radians(ra), np.radians(dec)
    return np.stack([np.cos(dec) * np.cos(ra), np.cos(dec) * np.sin(ra), np.sin(dec)], axis=-1)


def constellations(src: Path, stars, path: Path) -> None:
    xyz = unit(np.array([s["ra"] for s in stars]), np.array([s["dec"] for s in stars]))
    vmag = np.array([s["v"] for s in stars])
    meta = {f["id"]: f for f in json.loads((src / "sky" / "d3-constellations.json").read_text())["features"]}
    lines = json.loads((src / "sky" / "d3-constellations.lines.json").read_text())["features"]
    near, wide = np.cos(np.radians(0.02)), np.cos(np.radians(0.1))
    cache, worst = {}, 0.0

    def star_at(lon, lat):
        nonlocal worst
        key = (round(lon, 4), round(lat, 4))
        if key in cache:
            return cache[key]
        c = xyz @ unit(lon % 360, lat)
        i = int(np.argmax(c))
        if c[i] < near:
            within = np.nonzero(c >= wide)[0]
            if len(within) == 0:
                sys.exit(f"no Hipparcos star within 0.1 deg of the line vertex at RA {lon % 360:.4f}, Dec {lat:.4f}")
            i = int(within[np.argmin(vmag[within])])
        worst = max(worst, float(np.degrees(np.arccos(min(1.0, c[i])))))
        cache[key] = i
        return i

    out = {}
    for f in lines:
        abbr = f["id"][:3]                      # Serpens comes in two parts, Ser1 and Ser2
        pairs = out.setdefault(abbr, set())
        for seg in f["geometry"]["coordinates"]:
            idx = [star_at(lon, lat) for lon, lat in seg]
            for a, b in zip(idx, idx[1:]):
                if a != b:
                    pairs.add((min(a, b), max(a, b)))
    rows = []
    for abbr in sorted(out):
        m = meta.get(abbr) or meta.get(abbr + "1")
        if m is None:
            sys.exit(f"no name or label for {abbr}")
        p = m["properties"]
        lon, lat = m["geometry"]["coordinates"]
        rows.append({"abbr": abbr, "name": p["name"], "gen": p["gen"], "en": p["en"],
                     "label": [round(lon % 360, 3), round(lat, 3)], "lines": sorted([list(x) for x in out[abbr]])})
    if len(rows) != 88:
        sys.exit(f"{len(rows)} constellations, not 88")
    path.write_text(json.dumps({"constellations": rows}, separators=(",", ":"), ensure_ascii=False))
    n = sum(len(r["lines"]) for r in rows)
    print(f"  wrote sky/{path.name}: 88 constellations, {n} lines, {len(cache)} stars; vertices within {worst * 3600:.1f}\" of their stars")


def names(stars, iau, des, path: Path) -> None:
    rows, seen_iau = [], set()
    # A name or HD shared by several HIP entries (doubles) goes to the brightest.
    best_by_hip = {}
    for i, s in enumerate(stars):
        best_by_hip[s["hip"]] = i
    best_by_hd = {}
    for i, s in enumerate(stars):
        if s["hd"] and (s["hd"] not in best_by_hd or s["v"] < stars[best_by_hd[s["hd"]]]["v"]):
            best_by_hd[s["hd"]] = i
    for i, s in enumerate(stars):
        name = iau.get(s["hip"])
        d = des.get(s["hd"]) if s["hd"] and best_by_hd.get(s["hd"]) == i else None
        bayer, sup, flam, hr, con = d if d else (None, None, None, None, None)
        if name:
            seen_iau.add(s["hip"])
        if name or bayer or flam or hr:
            rows.append([i, name, bayer, sup, flam, hr, con])
    path.write_text(json.dumps({"stars": rows}, separators=(",", ":"), ensure_ascii=False))
    nb = sum(1 for r in rows if r[2]); nf = sum(1 for r in rows if r[4])
    print(f"  wrote sky/{path.name}: {len(rows)} stars; {len(seen_iau)} of {len(iau)} IAU names "
          f"(the rest are fainter than V {VMAX} or not in Hipparcos), {nb} Bayer, {nf} Flamsteed")


def spot_check(stars, iau, des) -> None:
    i = next(k for k, s in enumerate(stars) if s["hip"] == 27989)
    s = stars[i]
    want = ("Betelgeuse", ("alp", None, 58, 2061, "Ori"), 39801)
    got = (iau.get(27989), des.get(s["hd"]), s["hd"])
    if got != want:
        sys.exit(f"spot check failed for HIP 27989: {got} != {want}")
    print(f"  spot check: HIP 27989 = {got[0]}, alpha Ori, 58 Ori, HR 2061, HD 39801, V {s['v']}, "
          f"plx {s['plx']} +- {s['plxErr']} mas, {s['sp']}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, default=DEFAULT_SRC)
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[2] / "public")
    a = ap.parse_args()
    if (a.src / "sky" / "d3-celestial.commit").exists() and (a.src / "sky" / "d3-celestial.commit").read_text().strip() != D3_COMMIT:
        sys.exit("the cached d3-celestial files are from another commit")
    fetch(a.src)
    stars = hipparcos(a.src)
    check_order(stars, a.out)
    iau, des = iau_names(a.src), bsc(a.src)
    spot_check(stars, iau, des)
    sky = a.out / "sky"
    sky.mkdir(parents=True, exist_ok=True)
    write_info(stars, sky / "stars-info.bin")
    names(stars, iau, des, sky / "names.json")
    constellations(a.src, stars, sky / "constellations.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
