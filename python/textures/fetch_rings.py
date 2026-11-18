"""Fetch the Voyager 2 PPS ring occultation profiles of Uranus from the NASA
PDS Ring-Moon Systems Node (volume VG_2801, EASYDATA/KM001: calibrated
normal opacity at 1 km resolution) into the source folder (default
~/.cache/digital-orrery/textures-src/rings). Files already there are kept.
About 0.8 MB in all. See docs/frontend/textures.md#the-other-planets-rings.

  PU2P01<k><s>.TAB  beta Persei, ring k = 6, 5, 4, A(lpha), B(eta),
                    N (eta), G(amma), D(elta), E(psilon); s = I(ngress), E(gress)
  PU1P01L<s>.TAB    sigma Sagittarii, the lambda ring (too faint in beta Per)

Usage:  python3 python/textures/fetch_rings.py [--src DIR]
"""

from __future__ import annotations

import argparse
import sys
import urllib.request
from pathlib import Path

DEFAULT_SRC = Path.home() / ".cache" / "digital-orrery" / "textures-src"
BASE = "https://pds-rings.seti.org/holdings/volumes/VG_28xx/VG_2801/EASYDATA/KM001"
FILES = [f"PU2P01{k}{s}" for k in "654ABNGDE" for s in "IE"] + ["PU1P01LI", "PU1P01LE"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, default=DEFAULT_SRC)
    args = ap.parse_args()
    folder = args.src / "rings"
    folder.mkdir(parents=True, exist_ok=True)
    for stem in FILES:
        for ext in (".TAB", ".LBL"):
            out = folder / (stem + ext)
            if out.exists():
                continue
            req = urllib.request.Request(f"{BASE}/{stem}{ext}", headers={"User-Agent": "digital-orrery texture build"})
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            if ext == ".TAB" and not data[:20].strip()[:1].isdigit():
                print(f"{stem}{ext}: not a profile table: {data[:120]!r}", file=sys.stderr)
                return 1
            tmp = out.with_suffix(out.suffix + ".part")
            tmp.write_bytes(data)
            tmp.rename(out)
            print(f"{stem}{ext}: {len(data)} bytes")
    print(f"rings: {len(FILES)} profiles in {folder}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
