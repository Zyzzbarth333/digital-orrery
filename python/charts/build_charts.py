"""Build the chart view's data: elevation tiles and IAU feature names.

Reads the source elevation models and the IAU/USGS Gazetteer of Planetary
Nomenclature's centre-point shapefiles from ~/.cache/digital-orrery
(textures-src and charts-src, never committed) and writes public/charts/:

  index.json                     what each body has, with sources and credits
  <body>/elev-4.bin.gz           elevation, 4 px/deg (1440 x 720), int16 metres
  <body>/elev-16/<r>-<c>.bin.gz  16 px/deg (5760 x 2880) in 8 x 4 tiles of 720 x 720
  <body>/names.json              the body's IAU feature names

Every grid has the textures' layout (docs/frontend/textures.md): plate carree,
west edge at -180 deg east longitude, top row at +90 deg. Heights are in
whole metres above the source's own datum (index.json says which), and
-32768 is no data (Magellan's gaps on Venus). Each height h is stored as its
difference from the prediction left + up - upper-left (zero off the grid),
as int16 wrapping, zigzag-coded (0, -1, 1, -2 ... -> 0, 1, 2, 3), the low
bytes of the whole grid and then the high bytes, gzipped with no time
stamp, so the same input always gives the same bytes. That is about a
quarter smaller than row differences alone. The browser undoes it
(src/chart/elevation.ts).

Grids are area-averaged down from the sources, ignoring no data:
- Mars: MOLA MEGDR 16 px/deg (MEG016), metres above the areoid.
- Moon: LOLA LDEM 16 px/deg (CGI Moon Kit), metres above 1737.4 km.
- Mercury: USGS MESSENGER global DEM 665 m v2 (64 px/deg), metres above 2439.4 km.
- Venus: USGS Magellan global topography 4641 m v02, metres above 6051 km.
- Earth: ETOPO 2022 15 arc-second surface elevation, as the textures' 8192 px
  grid, metres above the geoid (EGM2008), sea floor included.

The Gazetteer's shapefiles give planetocentric (or, on a sphere, the same)
latitude and longitude 0-360 east, whatever their metadata's londir says
(it says "Positive West" for Mercury and the synchronous moons, but Pele
on Io is at 104.72 there, the gazetteer page's 255.28 W): CHECKS below
holds one known feature per body, and the build stops if one is off.

The sheet grids (src/chart/sheets.json) are checked here too: every named
feature the Gazetteer assigns to a quadrangle must fall in it.

Usage:  python3 python/charts/build_charts.py [--only mars,moon] [--names-only]
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
import struct
import sys
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

REPO = Path(__file__).resolve().parents[2]
CACHE = Path.home() / ".cache/digital-orrery"
TEX_SRC = CACHE / "textures-src"
SRC = CACHE / "charts-src"
OUT = REPO / "public/charts"

W16, W4 = 5760, 1440          # 16 and 4 px/deg
TILES_X, TILES_Y = 8, 4       # 720 x 720 tiles of the 16 px/deg grid
NODATA = -32768


# ------------------------------------------------------------ small readers

def tiff_tags(path: Path) -> dict[int, tuple]:
    """The first IFD's tags of a little-endian classic TIFF (enough for these files)."""
    with open(path, "rb") as f:
        head = f.read(8)
        if head[:2] != b"II":
            raise ValueError(f"{path.name}: not a little-endian TIFF")
        (off,) = struct.unpack("<I", head[4:8])
        f.seek(off)
        (n,) = struct.unpack("<H", f.read(2))
        ents = f.read(12 * n)
        sizes = {1: 1, 2: 1, 3: 2, 4: 4, 8: 2, 11: 4, 12: 8}
        fmts = {1: "B", 2: "s", 3: "H", 4: "I", 8: "h", 11: "f", 12: "d"}
        tags = {}
        for i in range(n):
            tag, typ, cnt, val = struct.unpack("<HHI4s", ents[12 * i:12 * (i + 1)])
            size = sizes.get(typ, 1) * cnt
            raw = val
            if size > 4:
                (p,) = struct.unpack("<I", val)
                f.seek(p)
                raw = f.read(size)
            if typ == 2:
                tags[tag] = (raw[:size].rstrip(b"\0").decode("latin1"),)
            else:
                tags[tag] = struct.unpack("<" + fmts.get(typ, "B") * cnt, raw[:size])
        return tags


def raw_tiff(path: Path) -> np.ndarray:
    """An uncompressed, single-band int16 strip TIFF as a read-only array."""
    t = tiff_tags(path)
    w, h = t[256][0], t[257][0]
    if t[259][0] != 1 or t[258][0] != 16 or t[339][0] != 2:
        raise ValueError(f"{path.name}: expected uncompressed signed 16-bit")
    offs, counts = t[273], t[279]
    if any(offs[i + 1] - offs[i] != counts[i] for i in range(len(offs) - 1)):
        raise ValueError(f"{path.name}: strips are not contiguous")
    return np.memmap(path, dtype="<i2", mode="r", offset=offs[0], shape=(h, w))


def read_dbf(path: Path) -> list[dict[str, str]]:
    """A dBase III table (the shapefile's attributes) as a list of rows."""
    b = path.read_bytes()
    n, hlen, rlen = struct.unpack("<IHH", b[4:12])
    fields, p = [], 32
    while b[p] != 0x0D:
        fields.append((b[p:p + 11].split(b"\0")[0].decode(), b[p + 16]))
        p += 32
    rows = []
    for i in range(n):
        r = b[hlen + i * rlen: hlen + (i + 1) * rlen]
        if r[:1] == b"*":
            continue
        o, d = 1, {}
        for name, ln in fields:
            d[name] = r[o:o + ln].decode("utf-8", "replace").strip()
            o += ln
        rows.append(d)
    return rows


# ------------------------------------------------------------ grids

def box_mean(h: np.ndarray, valid: np.ndarray | None, width: int) -> np.ndarray:
    """Area-average a grid to width x width/2, ignoring invalid cells (NaN where none is valid)."""
    rows, cols = h.shape
    hh, ww = width // 2, width
    v = np.ones_like(h, dtype=np.float32) if valid is None else valid.astype(np.float32)
    x = np.where(v > 0, h, 0).astype(np.float32)
    if rows % hh == 0 and cols % ww == 0:
        fr, fc = rows // hh, cols // ww
        s = x.reshape(hh, fr, ww, fc).sum(axis=(1, 3), dtype=np.float64)
        c = v.reshape(hh, fr, ww, fc).sum(axis=(1, 3), dtype=np.float64)
    else:
        rs = lambda a: np.asarray(Image.fromarray(a, mode="F").resize((ww, hh), Image.Resampling.BOX), dtype=np.float64)
        s, c = rs(x), rs(v)
    out = np.full((hh, ww), np.nan)
    ok = c > 1e-6
    out[ok] = s[ok] / c[ok]
    return out


def roll_to_minus180(h: np.ndarray, west_edge_deg: float) -> np.ndarray:
    shift = (west_edge_deg + 180.0) / 360.0 * h.shape[1]
    if abs(shift - round(shift)) > 1e-9:
        raise ValueError("roll must be whole columns")
    return np.roll(h, int(round(shift)) % h.shape[1], axis=1)


def to_int16(h: np.ndarray) -> np.ndarray:
    out = np.where(np.isnan(h), NODATA, np.clip(np.rint(h), -32767, 32767)).astype(np.int16)
    return out


def _predict(t: np.ndarray) -> np.ndarray:
    """left + up - upper-left, with zeros off the grid (int32)."""
    t = t.astype(np.int32)
    p = np.zeros_like(t)
    p[:, 1:] += t[:, :-1]
    p[1:, :] += t[:-1, :]
    p[1:, 1:] -= t[:-1, :-1]
    return p


def encode(a: np.ndarray) -> bytes:
    """Gradient-predicted, zigzag-coded int16 in two byte planes, gzipped without a time stamp."""
    a = np.ascontiguousarray(a, dtype=np.int16)
    r = (a.astype(np.int32) - _predict(a)).astype(np.int16).astype(np.int32)   # wraps
    z = ((r << 1) ^ (r >> 31)) & 0xFFFF
    planes = np.concatenate([(z & 0xFF).astype(np.uint8).ravel(), (z >> 8).astype(np.uint8).ravel()])
    return gzip.compress(planes.tobytes(), compresslevel=9, mtime=0)


def decode(b: bytes, w: int, h: int) -> np.ndarray:
    raw = np.frombuffer(gzip.decompress(b), dtype=np.uint8)
    z = raw[: w * h].astype(np.int32) | (raw[w * h:].astype(np.int32) << 8)
    r = ((z >> 1) ^ -(z & 1)).reshape(h, w)
    t = np.zeros((h, w), dtype=np.int32)
    for y in range(h):                       # row by row: each row needs the one above
        up = t[y - 1] if y else np.zeros(w, dtype=np.int32)
        d = r[y] + up - np.concatenate([[0], up[:-1]])   # h[x] - h[x-1] along the row
        row = np.cumsum(d)
        t[y] = ((row + 32768) & 0xFFFF) - 32768
    return t.astype(np.int16)


# ------------------------------------------------------------ sources

def mars() -> tuple[np.ndarray, dict]:
    raw = np.fromfile(TEX_SRC / "mars_mola_meg016.img", dtype=">i2").reshape(2880, 5760).astype(np.float64)
    return roll_to_minus180(raw, 0.0), {
        "source": "MOLA MEGDR 16 px/deg (MEG016)", "datum": "the MOLA areoid",
        "radiusKm": 3396.19, "tag": "MOLA",
        "credit": "MOLA MEGDR: NASA/GSFC MOLA Science Team, via the PDS Geosciences Node.",
    }


def moon() -> tuple[np.ndarray, dict]:
    a = np.asarray(Image.open(TEX_SRC / "moon_ldem_16_uint.tif"), dtype=np.float64)
    return (a - 20000.0) / 2.0, {
        "source": "LOLA LDEM 16 px/deg (NASA SVS CGI Moon Kit)", "datum": "a 1,737.4 km sphere",
        "radiusKm": 1737.4, "tag": "LOLA",
        "credit": "LOLA elevation: NASA/GSFC LOLA Science Team, via NASA's Scientific Visualization Studio CGI Moon Kit.",
    }


def mercury() -> tuple[np.ndarray, dict]:
    m = raw_tiff(SRC / "mercury-dem/Mercury_Messenger_USGS_DEM_Global_665m_v2.tif")
    # Box-average 4 x 4 in bands of rows to keep memory low (23040 x 11520 source).
    out = np.empty((2880, 5760))
    for r0 in range(0, 2880, 180):
        blk = np.asarray(m[r0 * 4:(r0 + 180) * 4], dtype=np.float32)
        valid = blk != NODATA
        out[r0:r0 + 180] = _box4(blk * 0.5, valid)
    return out, {
        "source": "USGS MESSENGER global DEM 665 m v2", "datum": "a 2,439.4 km sphere",
        "radiusKm": 2439.4, "tag": "MESSENGER",
        "credit": "MESSENGER DEM: NASA/JHUAPL/Carnegie Institution of Washington, USGS Astrogeology (Becker et al. 2016).",
    }


def _box4(blk: np.ndarray, valid: np.ndarray) -> np.ndarray:
    h, w = blk.shape
    x = np.where(valid, blk, 0).reshape(h // 4, 4, w // 4, 4).sum(axis=(1, 3), dtype=np.float64)
    c = valid.reshape(h // 4, 4, w // 4, 4).sum(axis=(1, 3))
    out = np.full(x.shape, np.nan)
    out[c > 0] = x[c > 0] / c[c > 0]
    return out


def venus() -> tuple[np.ndarray, dict]:
    m = np.asarray(raw_tiff(SRC / "venus-dem/Venus_Magellan_Topography_Global_4641m_v02.tif"), dtype=np.float32)
    return box_mean(m, m != NODATA, W16), {
        "source": "USGS Magellan global topography 4,641 m v02", "datum": "a 6,051 km sphere",
        "radiusKm": 6051.8, "tag": "Magellan",
        "credit": "Magellan topography: NASA/JPL, USGS Astrogeology.",
    }


def earth() -> tuple[np.ndarray, dict]:
    a = np.asarray(Image.open(TEX_SRC / "earth_etopo2022_8192_s16.tif"), dtype=np.float64)
    return a, {
        "source": "ETOPO 2022 15 arc-second surface elevation (as an 8192 px grid)", "datum": "the geoid (EGM2008); the sea floor below 0",
        "radiusKm": 6371.0084, "tag": "ETOPO",
        "credit": "ETOPO 2022: NOAA National Centers for Environmental Information, doi:10.25921/fd45-gt74.",
    }


ELEVATION = {"mars": mars, "moon": moon, "mercury": mercury, "venus": venus, "earth": earth}

# One known feature per body, from the Gazetteer's web pages (west longitudes
# there are given here as east), within a degree: the shapefile's longitudes
# must be east-positive.
CHECKS = {
    "MARS": ("Jezero", 18.4, 77.5), "MOON": ("Copernicus", 9.6, -20.1), "MERCURY": ("Caloris Planitia", 31.6, 162.0),
    "VENUS": ("Maat Mons", 0.5, 194.6), "IO": ("Pele", -18.7, 104.7), "EUROPA": ("Pwyll", -25.2, 88.6),
    "GANYMEDE": ("Tros", 11.1, 332.7), "CALLISTO": ("Valhalla", 14.7, 304.0), "MIMAS": ("Herschel", -1.4, 248.2),
    "TETHYS": ("Odysseus", 32.8, 231.1), "RHEA": ("Inktomi", -14.1, 247.9), "PHOBOS": ("Stickney", 1.0, 311.0),
    "DEIMOS": ("Voltaire", 22.0, 356.5), "TRITON": ("Leviathan Patera", 17.0, 28.5), "CHARON": ("Kubrick Mons", 3.6, 30.8),
}
NAMED_BODIES = ["MOON", "MARS", "VENUS", "MERCURY", "IO", "EUROPA", "GANYMEDE", "CALLISTO", "PHOBOS", "DEIMOS",
                "PLUTO", "CHARON", "TRITON", "MIMAS", "ENCELADUS", "TETHYS", "DIONE", "RHEA", "IAPETUS"]

# The sheet grids, from src/chart/sheets.json (the app reads the same file):
# per band (south edge, north edge, sheets, edge in deg E, first number,
# direction: 1 numbered eastward from the west edge, -1 westward from the east edge).
SHEETS = {k.upper(): [tuple(b) for b in v["bands"]]
          for k, v in json.loads((REPO / "src/chart/sheets.json").read_text())["sets"].items()}


# The Gazetteer's quad_name field cuts two of Mercury's at 16 characters;
# they are named for its albedo features, which it lists in full.
FULL_NAMES = {"Solitudo Criopho": "Solitudo Criophori", "Solitudo Perseph": "Solitudo Persephones"}


def sheet_of(bands, lat: float, lon: float) -> int | None:
    for lo, hi, n, edge, first, direction in bands:
        if lo <= lat <= hi:
            if n == 1:
                return first
            w = 360.0 / n
            k = ((lon - edge) % 360.0) // w if direction > 0 else ((edge - lon) % 360.0) // w
            return first + int(k)
    return None


def check_sheets(body: str, rows: list[dict[str, str]]) -> dict:
    bands = SHEETS[body]
    n = bad = edge = 0
    named: dict[int, str] = {}
    for r in rows:
        m = re.search(r"(\d+)", r["quad_code"])
        if not m:
            continue
        n += 1
        named.setdefault(int(m.group(1)), r["quad_name"])
        lat, lon = float(r["center_lat"]), float(r["center_lon"])
        if sheet_of(bands, lat, lon) != int(m.group(1)):
            # A feature on a sheet's edge (Mars's albedo names at exactly 0, 90,
            # 180 or 360 E) may be filed on either side.
            on_edge = any(abs(((lon - b[3]) % (360 / b[2])) if b[2] > 1 else 1) < 1e-6 or abs(lat - b[0]) < 1e-6 for b in bands)
            edge += on_edge
            bad += not on_edge
    if bad:
        raise SystemExit(f"{body}: {bad} of {n} features fall outside the sheet the Gazetteer gives them")
    total = sum(b[2] for b in bands)
    if sorted(named) != list(range(1, total + 1)):
        raise SystemExit(f"{body}: the Gazetteer names sheets {sorted(named)}, not 1 to {total}")
    # "South pole (unnamed)" and the like: no name, the code alone.
    names = {k: ("" if "unnamed" in v.lower() else FULL_NAMES.get(v, v)) for k, v in sorted(named.items())}
    return {"features": n, "inSheet": n - edge, "onEdge": edge, "names": names}


def names(body: str) -> tuple[dict, dict | None]:
    z = SRC / f"gazetteer/{body}_nomenclature_center_pts.zip"
    with zipfile.ZipFile(z) as f:
        dbf = next(n for n in f.namelist() if n.endswith(".dbf"))
        tmp = OUT / f".{body}.dbf"
        tmp.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_bytes(f.read(dbf))
    rows = read_dbf(tmp)
    tmp.unlink()
    if body in CHECKS:
        nm, lat, lon = CHECKS[body]
        r = next((r for r in rows if r["clean_name"] == nm), None)
        if r is None:
            raise SystemExit(f"{body}: {nm} not in the Gazetteer")
        dl = abs(((float(r["center_lon"]) - lon + 180) % 360) - 180)
        if abs(float(r["center_lat"]) - lat) > 1 or dl > 1:
            raise SystemExit(f"{body}: {nm} at {r['center_lat']}, {r['center_lon']}, expected {lat}, {lon} E")
    types: dict[str, str] = {}
    feats = []
    seen: set[int | tuple] = set()
    uniq: list[dict[str, str]] = []
    for r in rows:
        if r["approval"] != "Adopted by IAU":
            continue
        # A feature listed twice (Mercury's Discovery Rupes, ID 1548, in the
        # November 2026 shapefile) is kept once.
        m_key = re.search(r"(\d+)$", r["link"])
        k = int(m_key.group(1)) if m_key else (r["name"], r["center_lat"], r["center_lon"])
        if k in seen:
            continue
        seen.add(k)
        uniq.append(r)
        lon = ((float(r["center_lon"]) + 180.0) % 360.0) - 180.0
        types[r["code"]] = r["type"]
        m_id = re.search(r"(\d+)$", r["link"])
        fid = int(m_id.group(1)) if m_id else 0
        feats.append([r["name"], r["code"], round(float(r["center_lat"]), 3), round(lon, 3), round(float(r["diameter"] or 0), 1), fid])
    feats.sort(key=lambda f: (-f[4], f[0]))
    sheets = check_sheets(body, uniq) if body in SHEETS else None
    return {"credit": "IAU Working Group for Planetary System Nomenclature, USGS Astrogeology: Gazetteer of Planetary Nomenclature.",
            "fields": ["name", "type", "lat", "lonE", "diameterKm", "gazetteerId"], "types": types, "features": feats}, sheets


# ------------------------------------------------------------ build

def build_elevation(key: str, entry: dict) -> None:
    h, meta = ELEVATION[key]()
    h16 = box_mean(h, ~np.isnan(h), W16) if h.shape != (2880, 5760) else h
    h4 = box_mean(h16, ~np.isnan(h16), W4)
    g16, g4 = to_int16(h16), to_int16(h4)
    d = OUT / key
    (d / "elev-16").mkdir(parents=True, exist_ok=True)
    (d / "elev-4.bin.gz").write_bytes(encode(g4))
    tw, th = W16 // TILES_X, (W16 // 2) // TILES_Y
    for r in range(TILES_Y):
        for c in range(TILES_X):
            t = g16[r * th:(r + 1) * th, c * tw:(c + 1) * tw]
            b = encode(t)
            assert np.array_equal(decode(b, tw, th), t)
            (d / f"elev-16/{r}-{c}.bin.gz").write_bytes(b)
    ok = g16[g16 != NODATA].astype(np.float64)
    lat = np.deg2rad(90 - (np.arange(g16.shape[0]) + 0.5) / 16)
    wts = np.repeat(np.cos(lat)[:, None], g16.shape[1], axis=1)[g16 != NODATA]
    order = np.argsort(ok)
    cum = np.cumsum(wts[order]) / wts.sum()
    pct = lambda q: float(ok[order][np.searchsorted(cum, q)])
    entry["elevation"] = {
        **meta, "base": f"{key}/elev-4.bin.gz", "tiles": f"{key}/elev-16/{{r}}-{{c}}.bin.gz",
        "baseWidth": W4, "width": W16, "tilesX": TILES_X, "tilesY": TILES_Y, "nodata": NODATA,
        "minM": int(ok.min()), "maxM": int(ok.max()), "p1M": round(pct(0.01)), "p50M": round(pct(0.5)), "p99M": round(pct(0.99)),
        "noDataShare": round(float((g16 == NODATA).mean()), 4),
    }
    print(f"{key:8s} elevation {ok.min():8.0f} .. {ok.max():7.0f} m  p1 {pct(0.01):7.0f}  p99 {pct(0.99):7.0f}  no data {entry['elevation']['noDataShare']:.2%}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--names-only", action="store_true")
    a = ap.parse_args()
    only = {s.strip() for s in a.only.split(",") if s.strip()}
    idx_path = OUT / "index.json"
    index = json.loads(idx_path.read_text()) if idx_path.exists() else {"schema": 1, "bodies": {}}
    index["note"] = "The chart view's data (python/charts/build_charts.py, docs/frontend/chart.md)."
    for key in sorted(set(ELEVATION) | {b.lower() for b in NAMED_BODIES}):
        if only and key not in only:
            continue
        entry = index["bodies"].setdefault(key, {})
        entry.pop("sheetCheck", None)
        if key in ELEVATION and not a.names_only:
            build_elevation(key, entry)
        if key.upper() in NAMED_BODIES:
            n, sheets = names(key.upper())
            (OUT / key).mkdir(parents=True, exist_ok=True)
            (OUT / key / "names.json").write_text(json.dumps(n, ensure_ascii=False, separators=(",", ":")) + "\n")
            entry["names"] = {"path": f"{key}/names.json", "count": len(n["features"]), "credit": n["credit"]}
            if sheets:
                entry["sheets"] = {"names": sheets.pop("names"), "check": sheets,
                                   "source": "quadrangle names and assignments: the Gazetteer's quad_name and quad_code fields"}
            print(f"{key:8s} names {len(n['features']):5d}" + (f"  sheets: {sheets['inSheet']} of {sheets['features']} inside, {sheets['onEdge']} on an edge" if sheets else ""))
    index["bodies"] = dict(sorted(index["bodies"].items()))
    idx_path.write_text(json.dumps(index, indent=1, ensure_ascii=False) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
