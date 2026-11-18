"""Fetch the New Horizons LORRI images of Jupiter's main ring that the
jupiter_rings recipe reduces, from the NASA PDS Ring-Moon Systems Node
(volume NHJULO_2001, calibrated, level 2), into the source folder (default
~/.cache/digital-orrery/textures-src/jupiter_rings). Files already there
are kept. 18 images, about 190 MB. See docs/frontend/rings.md#jupiter.

They are both ansae of the main ring at 11.7 and 15.3 deg phase (sequences
RPHASE01 and RPHASE02, four repeats each) and the two 151 deg frames that
hold the whole ring (RPHASE05/06), chosen from Showalter's table of the
LORRI ring images (newhorizons/lorri_jring_images.tab on the node).

Usage:  python3 python/textures/fetch_jupiter_rings.py [--src DIR]
"""

from __future__ import annotations

import argparse
import sys
import urllib.request
from pathlib import Path

DEFAULT_SRC = Path.home() / ".cache" / "digital-orrery" / "textures-src"
BASE = "https://pds-rings.seti.org/holdings/volumes/NHxxLO_xxxx/NHJULO_2001/"
FILES = [
    "data/20070225_003467/lor_0034676524_0x630_sci.fit",
    "data/20070225_003467/lor_0034676528_0x630_sci.fit",
    "data/20070225_003467/lor_0034676532_0x630_sci.fit",
    "data/20070225_003467/lor_0034676536_0x630_sci.fit",
    "data/20070225_003467/lor_0034676944_0x630_sci.fit",
    "data/20070225_003467/lor_0034676948_0x630_sci.fit",
    "data/20070225_003467/lor_0034676952_0x630_sci.fit",
    "data/20070225_003467/lor_0034676956_0x630_sci.fit",
    "data/20070225_003471/lor_0034714624_0x630_sci.fit",
    "data/20070225_003471/lor_0034714628_0x630_sci.fit",
    "data/20070225_003471/lor_0034714632_0x630_sci.fit",
    "data/20070225_003471/lor_0034714636_0x630_sci.fit",
    "data/20070225_003471/lor_0034715044_0x630_sci.fit",
    "data/20070225_003471/lor_0034715048_0x630_sci.fit",
    "data/20070225_003471/lor_0034715052_0x630_sci.fit",
    "data/20070225_003471/lor_0034715056_0x630_sci.fit",
    "data/20070303_003518/lor_0035187263_0x630_sci.fit",
    "data/20070303_003518/lor_0035187983_0x630_sci.fit",
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, default=DEFAULT_SRC)
    args = ap.parse_args()
    folder = args.src / "jupiter_rings"
    folder.mkdir(parents=True, exist_ok=True)
    for rel in FILES:
        out = folder / Path(rel).name
        if out.exists() and out.stat().st_size > 0:
            continue
        req = urllib.request.Request(BASE + rel, headers={"User-Agent": "digital-orrery texture build"})
        with urllib.request.urlopen(req, timeout=300) as r:
            data = r.read()
        if not data.startswith(b"SIMPLE"):
            print(f"{rel}: not a FITS file: {data[:80]!r}", file=sys.stderr)
            return 1
        tmp = out.with_suffix(".part")
        tmp.write_bytes(data)
        tmp.rename(out)
        print(f"{out.name}: {len(data) / 1e6:.1f} MB")
    print(f"jupiter_rings: {len(FILES)} images in {folder}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
