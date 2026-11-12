"""Convert source surface maps into the web textures the scene loads.

Reads originals from a source folder (default ~/.cache/digital-orrery/
textures-src, never committed) and writes public/textures/<body>/*.webp plus
public/textures/manifest.json. See docs/frontend/textures.md.

Every output map has the same layout: equirectangular, west edge at -180 deg
east longitude, top row at +90 deg latitude (the browser flips it so v = 0 is
the south pole, as the shader expects).

Normal maps come from elevation at true scale: for height h(lon, lat) on a
sphere of radius R,

    dh/dE = (dh/dlon) / (R cos lat),   dh/dN = (dh/dlat) / R,
    n_ENU = normalize(-dh/dE, -dh/dN, 1),  stored as (n + 1) / 2.

The heights are first averaged down to the output grid so the slopes are the
ones that grid can show.

Usage:  python3 python/textures/build_textures.py [--src DIR] [--only earth,moon]
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "public" / "textures"
DEFAULT_SRC = Path.home() / ".cache" / "digital-orrery" / "textures-src"


# ---------------------------------------------------------------- helpers

def srgb_to_linear(c: np.ndarray) -> np.ndarray:
    c = c.astype(np.float64) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def area_mean_luminance(img: Image.Image) -> float:
    """Mean linear luminance over the sphere (rows weighted by cos lat)."""
    small = img.convert("RGB").resize((1024, 512), Image.Resampling.BOX)
    lin = srgb_to_linear(np.asarray(small))
    lum = 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]
    lat = (0.5 - (np.arange(512) + 0.5) / 512) * math.pi
    w = np.cos(lat)[:, None]
    return float((lum * w).sum() / (w.sum() * 1024))


def bright_luminance(img: Image.Image, q: float = 99.5) -> float:
    """Linear luminance at the q-th percentile over the sphere (rows
    weighted by cos lat): the brightest targets, for calibrating Earth."""
    small = img.convert("RGB").resize((1024, 512), Image.Resampling.BOX)
    lin = srgb_to_linear(np.asarray(small))
    lum = (0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]).ravel()
    lat = (0.5 - (np.arange(512) + 0.5) / 512) * math.pi
    w = np.repeat(np.cos(lat), 1024)
    order = np.argsort(lum)
    cw = np.cumsum(w[order]) / w.sum()
    return float(lum[order][np.searchsorted(cw, q / 100.0)])


def roll_to_minus180(img: Image.Image, west_edge_deg: float) -> Image.Image:
    """Shift columns so the west edge is at -180 deg east longitude."""
    if abs(((west_edge_deg + 180.0) % 360.0)) < 1e-9:
        return img
    a = np.asarray(img)
    shift = int(round((west_edge_deg + 180.0) / 360.0 * a.shape[1]))
    return Image.fromarray(np.roll(a, shift, axis=1))


def save_webp(img: Image.Image, path: Path, quality: int = 88) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "WEBP", quality=quality, method=6)
    print(f"  wrote {path.relative_to(REPO)}  {img.size[0]}x{img.size[1]}  {path.stat().st_size / 1e6:.1f} MB")


def colour_map(src: Path, out: Path, width: int, west_edge_deg: float = -180.0) -> float:
    img = Image.open(src).convert("RGB")
    img = roll_to_minus180(img, west_edge_deg)
    img = img.resize((width, width // 2), Image.Resampling.LANCZOS)
    save_webp(img, out)
    return area_mean_luminance(img)


def heights_km(src: Path, scale_km: float, offset_km: float = 0.0) -> np.ndarray:
    """Read a single-band elevation image as km: h = value * scale + offset."""
    img = Image.open(src)
    if img.mode not in ("I", "I;16", "I;16B", "F", "L"):
        img = img.convert("L")
    a = np.asarray(img, dtype=np.float64)
    return a * scale_km + offset_km


def box_down(h: np.ndarray, width: int) -> np.ndarray:
    """Area-average a height grid down to width x width/2."""
    rows, cols = h.shape
    hh, ww = width // 2, width
    fr, fc = rows / hh, cols / ww
    if fr == int(fr) and fc == int(fc):
        return h.reshape(hh, int(fr), ww, int(fc)).mean(axis=(1, 3))
    return np.asarray(Image.fromarray(h.astype(np.float32), mode="F").resize((ww, hh), Image.Resampling.BOX),
                      dtype=np.float64)


def normal_map(h_km: np.ndarray, radius_km: float, out: Path, width: int, west_edge_deg: float = -180.0) -> None:
    h = box_down(h_km, width)
    if abs((west_edge_deg + 180.0) % 360.0) > 1e-9:
        h = np.roll(h, int(round((west_edge_deg + 180.0) / 360.0 * h.shape[1])), axis=1)
    rows, cols = h.shape
    dlon = 2 * math.pi / cols
    dlat = math.pi / rows
    lat = (0.5 - (np.arange(rows) + 0.5) / rows) * math.pi
    coslat = np.maximum(np.cos(lat), 1e-3)[:, None]
    dh_dlon = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) / (2 * dlon)
    north = np.vstack([h[:1], h[:-1]])            # row above (towards +90)
    south = np.vstack([h[1:], h[-1:]])
    dh_dlat = (north - south) / (2 * dlat)
    gE = dh_dlon / (radius_km * coslat)
    gN = dh_dlat / radius_km
    n = np.stack([-gE, -gN, np.ones_like(h)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    rgb = np.clip(np.rint((n * 0.5 + 0.5) * 255), 0, 255).astype(np.uint8)
    save_webp(Image.fromarray(rgb, "RGB"), out, quality=92)
    slope = np.degrees(np.arctan(np.hypot(gE, gN)))
    print(f"    slopes at this grid: median {np.median(slope):.2f} deg, 99th pct {np.percentile(slope, 99):.1f} deg")


# ---------------------------------------------------------------- bodies

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, default=DEFAULT_SRC)
    ap.add_argument("--only", default="")
    args = ap.parse_args()
    from sources import BODIES  # noqa: E402  (python/textures/sources.py)

    only = set(filter(None, args.only.split(",")))
    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {"bodies": {}}
    for key, build in BODIES.items():
        if only and key not in only:
            continue
        print(key)
        entry = build(args.src, OUT, colour_map, heights_km, normal_map)
        if key in ("rings", "stars"):
            manifest.setdefault(key, {}).update(entry)
        else:
            manifest["bodies"][key] = entry
    OUT.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"wrote {manifest_path.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    sys.exit(main())
