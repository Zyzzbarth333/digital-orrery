"""Fetch the moons' source mosaics from USGS Astrogeology into the source
folder (default ~/.cache/digital-orrery/textures-src). Files already there
are kept. See docs/frontend/textures.md#sources-and-credits.

Most come from the USGS planetary map server (WMS GetMap, EPSG:4326, west
edge at -180 deg east, one request each: the server returns at most 4096
pixels a side). The map server's only Phobos layer is a shaded relief, so
Phobos's image mosaic is the full GeoTIFF.

Usage:  python3 python/textures/fetch_moons.py [--src DIR] [--only io,europa]
"""

from __future__ import annotations

import argparse
import sys
import urllib.request
from pathlib import Path

DEFAULT_SRC = Path.home() / ".cache" / "digital-orrery" / "textures-src"
WMS = "https://planetarymaps.usgs.gov/cgi-bin/mapserv"

# key: (planet, layer, width) for the map server, or a direct URL.
MOONS: dict[str, tuple[str, str, int] | str] = {
    "phobos": "https://planetarymaps.usgs.gov/mosaic/Phobos_Viking_Mosaic_40ppd_DLRcontrol.tif",
    "deimos": ("mars", "VIKING", 2048),
    "io": ("jupiter", "SSI_VGR_color", 4096),
    "europa": ("jupiter", "GALILEO_VOYAGER", 4096),
    "ganymede": ("jupiter", "GALILEO_VOYAGER", 4096),
    "callisto": ("jupiter", "GALILEO_VOYAGER", 4096),
    "mimas": ("saturn", "CASSINI_VOYAGER", 2048),
    "enceladus": ("saturn", "CASSINI", 2048),
    "tethys": ("saturn", "CASSINI", 2048),
    "dione": ("saturn", "CASSINI_VOYAGER", 2048),
    "rhea": ("saturn", "CASSINI_VOYAGER", 2048),
    "iapetus": ("saturn", "CASSINI_VOYAGER", 2048),
    "triton": ("neptune", "TRITON_VOYAGER2", 4096),
    "charon": ("pluto", "NEWHORIZONS_CHARON_MOSAIC", 2048),
}


def source_name(key: str) -> str:
    v = MOONS[key]
    return f"{key}_usgs.tif" if isinstance(v, str) else f"{key}_usgs_wms.png"


def url_for(key: str) -> str:
    v = MOONS[key]
    if isinstance(v, str):
        return v
    planet, layer, w = v
    return (f"{WMS}?map=/maps/{planet}/{key}_simp_cyl.map&SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap"
            f"&LAYERS={layer}&STYLES=&SRS=EPSG:4326&BBOX=-180,-90,180,90&WIDTH={w}&HEIGHT={w // 2}"
            f"&FORMAT=image/png")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, default=DEFAULT_SRC)
    ap.add_argument("--only", default="")
    args = ap.parse_args()
    only = set(filter(None, args.only.split(",")))
    args.src.mkdir(parents=True, exist_ok=True)
    for key in MOONS:
        if only and key not in only:
            continue
        out = args.src / source_name(key)
        if out.exists():
            print(f"{key}: have {out.name}")
            continue
        req = urllib.request.Request(url_for(key), headers={"User-Agent": "digital-orrery texture build"})
        with urllib.request.urlopen(req, timeout=600) as r:
            kind = r.headers.get("Content-Type", "")
            data = r.read()
        if not kind.startswith("image/"):
            print(f"{key}: not an image ({kind}): {data[:200]!r}", file=sys.stderr)
            return 1
        tmp = out.with_suffix(out.suffix + ".part")
        tmp.write_bytes(data)
        tmp.rename(out)
        print(f"{key}: wrote {out.name}  {len(data) / 1e6:.1f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
