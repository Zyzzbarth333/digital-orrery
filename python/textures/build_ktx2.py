"""Encode the app's maps as KTX2 with Basis Universal, and measure them.

Each map in public/textures/manifest.json gets a .ktx2 beside its .webp,
encoded from its lossless master (written by build_textures.py into the
source folder's _work/masters, never committed). The app loads the KTX2
where the GPU takes a format the Basis transcoder makes, and the WebP
otherwise (docs/frontend/textures.md#gpu-compressed-maps).

- Colour maps: ETC1S (BasisLZ), about 1-2 bits a texel to download; the
  browser transcodes it to BC7, ASTC or ETC2.
- Normal maps, and the colour maps listed in UASTC: UASTC with RDO and
  Zstandard, 8 bits a texel on the GPU at near-BC7 quality.
- Every map but the sky tiles carries its mip chain, box-filtered
  (2 x 2 means of linear light for sRGB maps: what generateMipmap did).
  The tiles are used at one level only.
- Rows are stored south first (texture origin bottom-left), as the WebP
  is flipped when it is decoded, so the shaders see the same layout.

Needs KTX-Software's `ktx` tool (4.4 or later) on the PATH or in $KTX.

Usage:
  python3 python/textures/build_ktx2.py              # encode what is out of date
  python3 python/textures/build_ktx2.py --only moon/day.webp,stars
  python3 python/textures/build_ktx2.py --measure    # PSNR and SSIM per map
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import masters  # noqa: E402

Image.MAX_IMAGE_PIXELS = None

OUT = masters.OUT
DEFAULT_SRC = Path.home() / ".cache" / "digital-orrery" / "textures-src"

# Colour maps encoded as UASTC because ETC1S looked worse than the WebP:
# its luma SSIM against the master fell more than 0.015 below the WebP's,
# or its PSNR below 35 dB, or (the Moon) it put false colour on grey ground
# (the measurements and crops are in docs/frontend/textures.md). Paths
# ending in / take everything under them. The sky's 2k preview stays
# ETC1S: it is on screen for about a second, while the full map loads.
UASTC: tuple[str, ...] = (
    "moon/day.webp", "mars/day.webp", "mercury/day.webp", "pluto/day.webp",
    "phobos/day.webp", "io/day.webp", "europa/day.webp", "ganymede/day.webp", "callisto/day.webp",
    "enceladus/day.webp", "tethys/day.webp", "dione/day.webp", "rhea/day.webp", "iapetus/day.webp",
    "stars/milky-way-8k.webp", "stars/milky-way-16k/",
)

# Encoder settings. ETC1S at quality 255 of 255, effort 4 of 5. UASTC at
# level 2, with rate-distortion optimisation at lambda 2 (smaller files
# for Zstandard; still more accurate than the WebP on every map measured)
# and Zstandard level 18.
ETC1S_ARGS = ["--encode", "basis-lz", "--qlevel", "255", "--clevel", "4"]
UASTC_ARGS = ["--encode", "uastc", "--uastc-quality", "2", "--uastc-rdo", "--uastc-rdo-l", "2", "--zstd", "18"]


def ktx_tool() -> str:
    exe = os.environ.get("KTX") or shutil.which("ktx")
    if not exe:
        sys.exit("ktx (KTX-Software 4.4+) not found: put it on the PATH or set KTX=/path/to/ktx")
    return exe


def jobs(manifest: dict) -> list[tuple[str, str, bool]]:
    """(map path, 'colour' or 'normal', with mipmaps) for every map."""
    out: list[tuple[str, str, bool]] = []
    for entry in manifest["bodies"].values():
        for p in entry.get("dayMonthly", []):
            out.append((p, "colour", True))
        for k in ("day", "night"):
            if k in entry:
                out.append((entry[k], "colour", True))
        if "normal" in entry:
            out.append((entry["normal"], "normal", True))
    stars = manifest.get("stars", {})
    for k in ("map", "preview"):
        if k in stars:
            out.append((stars[k], "colour", True))
    d = stars.get("detail")
    if d:
        rows, cols = d["width"] // 2 // d["tile"], d["width"] // d["tile"]
        for r in range(rows):
            for c in range(cols):
                out.append((d["tiles"].format(row=r, col=c), "tile", False))
    return out


def codec(path: str, kind: str) -> str:
    uastc = any(path == u or (u.endswith("/") and path.startswith(u)) for u in UASTC)
    return "uastc" if kind == "normal" or uastc else "etc1s"


def written_with(path: Path) -> set[str]:
    """The encoder options a KTX2 records (KTXwriterScParams), without
    --threads, read from its key/value data."""
    b = path.read_bytes()[:65536]
    off, n = int.from_bytes(b[56:60], "little"), int.from_bytes(b[60:64], "little")
    kvd, i = b[off:off + n], 0
    while i + 4 <= len(kvd):
        size = int.from_bytes(kvd[i:i + 4], "little")
        key, _, value = kvd[i + 4:i + 4 + size].partition(b"\0")
        if key == b"KTXwriterScParams":
            t = value.rstrip(b"\0").decode().split()
            return {f"{a} {v}" if v and not v.startswith("--") else a
                    for a, v in zip(t, t[1:] + [""]) if a.startswith("--") and a != "--threads"}
        i += 4 + size + (-size % 4)
    return set()


def expected_options(args: list[str]) -> set[str]:
    out = set()
    for a, v in zip(args, args[1:] + [""]):
        if a.startswith("--") and a != "--encode":
            out.add(f"{a} {v}" if v and not v.startswith("--") else a)
    return out


def ktx_path(path: str) -> str:
    return str(Path(path).with_suffix(".ktx2").as_posix())


def encode(exe: str, path: str, kind: str, mips: bool, threads: int) -> str:
    src = masters.master_path(path)
    dst = OUT / ktx_path(path)
    if not src.exists():
        return f"  {path}: no master ({src}); run build_textures.py first"
    c = codec(path, kind)
    enc = ETC1S_ARGS if c == "etc1s" else UASTC_ARGS
    if (dst.exists() and dst.stat().st_mtime > src.stat().st_mtime and dst.stat().st_size > 0
            and written_with(dst) == expected_options(enc)):
        return ""
    args = [exe, "create", "--threads", str(threads), "--convert-texcoord-origin", "bottom-left"]
    if kind == "normal":
        args += ["--format", "R8G8B8_UNORM", "--assign-tf", "linear"]
    else:
        args += ["--format", "R8G8B8_SRGB", "--assign-tf", "srgb"]
    if mips:
        args += ["--generate-mipmap", "--mipmap-filter", "box"]
    args += enc
    tmp = dst.with_suffix(".ktx2.tmp")
    r = subprocess.run(args + [str(src), str(tmp)], capture_output=True, text=True)
    if r.returncode != 0:
        tmp.unlink(missing_ok=True)
        return f"  {path}: ktx create failed: {r.stderr.strip()}"
    tmp.replace(dst)
    return f"  wrote {ktx_path(path)}  {c}  {dst.stat().st_size / 1e6:.2f} MB (WebP {(OUT / path).stat().st_size / 1e6:.2f} MB)"


# ---------------------------------------------------------------- quality

def _luma(a: np.ndarray) -> np.ndarray:
    """Rec. 709 luma of 8-bit sRGB values (the encoded values, as SSIM
    is usually taken)."""
    a = a.astype(np.float32)
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]


def _blur(x: np.ndarray) -> np.ndarray:
    import cv2
    return cv2.GaussianBlur(x, (11, 11), 1.5, borderType=cv2.BORDER_REFLECT)


def ssim(a: np.ndarray, b: np.ndarray) -> float:
    """Mean SSIM of the luma (Wang et al. 2004: 11 x 11 Gaussian window,
    sigma 1.5, K1 0.01, K2 0.03, L 255)."""
    x, y = _luma(a), _luma(b)
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    mx, my = _blur(x), _blur(y)
    sxx = _blur(x * x) - mx * mx
    syy = _blur(y * y) - my * my
    sxy = _blur(x * y) - mx * my
    s = ((2 * mx * my + c1) * (2 * sxy + c2)) / ((mx * mx + my * my + c1) * (sxx + syy + c2))
    return float(s.mean(dtype=np.float64))


def psnr(a: np.ndarray, b: np.ndarray) -> float:
    mse = float(np.mean((a.astype(np.float32) - b.astype(np.float32)) ** 2, dtype=np.float64))
    return math.inf if mse == 0 else 10 * math.log10(255 ** 2 / mse)


def chroma_psnr(a: np.ndarray, b: np.ndarray) -> float:
    """PSNR of the Rec. 709 colour differences Cb and Cr together: the
    false colour ETC1S can put on grey ground, which luma SSIM misses."""
    def cbcr(x: np.ndarray) -> np.ndarray:
        x = x.astype(np.float32)
        y = _luma(x)
        return np.stack([(x[..., 2] - y) / 1.8556, (x[..., 0] - y) / 1.5748], axis=-1)
    mse = float(np.mean((cbcr(a) - cbcr(b)) ** 2, dtype=np.float64))
    return math.inf if mse == 0 else 10 * math.log10(255 ** 2 / mse)


def normal_error_deg(a: np.ndarray, b: np.ndarray) -> tuple[float, float]:
    """Mean and 99th-percentile angle between two normal maps, degrees."""
    def unit(x: np.ndarray) -> np.ndarray:
        n = x.astype(np.float32) / 127.5 - 1.0
        return n / np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-9)
    d = np.clip(np.sum(unit(a) * unit(b), axis=-1), -1, 1)
    ang = np.degrees(np.arccos(d))
    return float(ang.mean()), float(np.percentile(ang, 99))


def decode_ktx2(exe: str, path: Path, tmpdir: Path) -> np.ndarray:
    """Level 0 of a KTX2, transcoded to RGB8 and put back top row first."""
    png = tmpdir / (path.relative_to(OUT).as_posix().replace("/", "_") + ".png")
    subprocess.run([exe, "extract", "--transcode", "rgb8", str(path), str(png)], check=True, capture_output=True)
    a = np.asarray(Image.open(png).convert("RGB"))
    png.unlink()
    return a[::-1]


def measure(exe: str, path: str, kind: str, tmpdir: Path) -> dict:
    ref = np.asarray(Image.open(masters.master_path(path)).convert("RGB"))
    wp = np.asarray(Image.open(OUT / path).convert("RGB"))
    kt = decode_ktx2(exe, OUT / ktx_path(path), tmpdir)
    row = {"map": path, "codec": codec(path, kind), "size": f"{ref.shape[1]}x{ref.shape[0]}",
           "webpMB": (OUT / path).stat().st_size / 1e6, "ktx2MB": (OUT / ktx_path(path)).stat().st_size / 1e6,
           "webp": {"psnr": psnr(ref, wp), "ssim": ssim(ref, wp), "chroma": chroma_psnr(ref, wp)},
           "ktx2": {"psnr": psnr(ref, kt), "ssim": ssim(ref, kt), "chroma": chroma_psnr(ref, kt)}}
    if kind == "normal":
        row["webp"]["angleDeg"] = normal_error_deg(ref, wp)
        row["ktx2"]["angleDeg"] = normal_error_deg(ref, kt)
    return row


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, default=DEFAULT_SRC)
    ap.add_argument("--only", default="", help="map paths or prefixes, comma separated")
    ap.add_argument("--measure", action="store_true", help="compare each KTX2 and WebP with its master")
    ap.add_argument("--report", type=Path, help="write the measurements here as JSON")
    ap.add_argument("--jobs", type=int, default=4, help="parallel encodes (measuring runs two at most: an 8k map takes about 2 GB)")
    args = ap.parse_args()
    masters.set_source(args.src)
    exe = ktx_tool()

    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    todo = jobs(manifest)
    only = [p for p in args.only.split(",") if p]
    sel = [j for j in todo if not only or any(j[0].startswith(p) for p in only)]

    if args.measure:
        rows = []
        with tempfile.TemporaryDirectory() as td, ThreadPoolExecutor(min(2, args.jobs)) as ex:
            for row in ex.map(lambda j: measure(exe, j[0], j[1], Path(td)), sel):
                rows.append(row)
                w, k = row["webp"], row["ktx2"]
                extra = ""
                if "angleDeg" in k:
                    extra = f"  angle mean/p99 WebP {w['angleDeg'][0]:.2f}/{w['angleDeg'][1]:.2f}, KTX2 {k['angleDeg'][0]:.2f}/{k['angleDeg'][1]:.2f} deg"
                print(f"{row['map']:42s} {row['codec']:5s} PSNR WebP {w['psnr']:5.1f} KTX2 {k['psnr']:5.1f} dB"
                      f"  SSIM WebP {w['ssim']:.4f} KTX2 {k['ssim']:.4f}"
                      f"  chroma WebP {w['chroma']:5.1f} KTX2 {k['chroma']:5.1f} dB{extra}", flush=True)
        if args.report:
            args.report.write_text(json.dumps(rows, indent=1) + "\n")
        return 0

    threads = max(1, (os.cpu_count() or 4) // args.jobs)
    with ThreadPoolExecutor(args.jobs) as ex:
        for msg in ex.map(lambda j: encode(exe, j[0], j[1], j[2], threads), sel):
            if msg:
                print(msg, flush=True)

    # The manifest says which maps have a KTX2: the app falls back to the
    # WebP for any that do not.
    maps = {p: ktx_path(p) for p, kind, _ in todo if kind != "tile" and (OUT / ktx_path(p)).exists()}
    manifest["ktx2"] = dict(sorted(maps.items()))
    d = manifest.get("stars", {}).get("detail")
    if d:
        tiles = [p for p, kind, _ in todo if kind == "tile"]
        if tiles and all((OUT / ktx_path(p)).exists() for p in tiles):
            d["tilesKtx2"] = ktx_path(d["tiles"])
        else:
            d.pop("tilesKtx2", None)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    total = sum((OUT / ktx_path(p)).stat().st_size for p, _, _ in todo if (OUT / ktx_path(p)).exists())
    print(f"wrote {manifest_path.relative_to(OUT.parents[1])}: {len(maps)} maps"
          f"{' and the sky tiles' if d and 'tilesKtx2' in d else ''} as KTX2, {total / 1e6:.1f} MB in all")
    return 0


if __name__ == "__main__":
    sys.exit(main())
