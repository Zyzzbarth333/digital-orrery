"""WebP output for build_textures.py, with a lossless master of each map.

The WebP files are what the app falls back to; the masters (PNG, in the
source folder's _work/masters, never committed) are what build_ktx2.py
encodes to KTX2, so the GPU formats are made from the image itself and not
from a lossy copy of it, and what its quality figures compare against.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

OUT = Path(__file__).resolve().parents[2] / "public" / "textures"
MASTERS = Path.home() / ".cache" / "digital-orrery" / "textures-src" / "_work" / "masters"


def set_source(src: Path) -> None:
    global MASTERS
    MASTERS = src / "_work" / "masters"


def master_path(rel: str) -> Path:
    """The lossless master of public/textures/<rel>."""
    return (MASTERS / rel).with_suffix(".png")


def save_webp(img: Image.Image, path: Path, quality: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "WEBP", quality=quality, method=6)
    m = master_path(path.relative_to(OUT).as_posix())
    m.parent.mkdir(parents=True, exist_ok=True)
    img.save(m, "PNG", compress_level=1)
