"""Remove near-black background from AI-generated character art, output RGBA PNG.

Strategy: RGB euclidean distance to black (0,0,0), three-tier alpha:
  dist < t1  -> alpha 0 (fully transparent)
  dist > t2  -> alpha 255 (fully opaque)
  in between -> linear transition (soft edge / anti-white-fringe)

Optional connected-component protection: only erase dark regions that touch
the image border, so dark parts inside the character (shadow, dark hair)
are never deleted.

Usage:
  python remove-black-bg.py --input IN --output OUT [--t1 40] [--t2 90]
                            [--protect-cc] [--stats-only]
"""

import argparse
import os
import sys

import numpy as np
from PIL import Image

try:
    from scipy import ndimage
    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False


def load_rgb(path):
    img = Image.open(path).convert("RGB")
    return img, np.asarray(img, dtype=np.uint8)


def compute_alpha(arr, t1, t2, protect_cc, erode=3):
    dist = np.linalg.norm(arr.astype(np.float32), axis=2)
    alpha = np.zeros(arr.shape[:2], dtype=np.float32)
    opaque = dist >= t2
    clear = dist <= t1
    mid = ~opaque & ~clear
    alpha[clear] = 0.0
    alpha[opaque] = 255.0
    if mid.any():
        alpha[mid] = 255.0 * (dist[mid] - t1) / max(t2 - t1, 1)

    if protect_cc:
        if not HAS_SCIPY:
            print("[warn] scipy not available, skipping connected-component protection", file=sys.stderr)
        else:
            struct = np.ones((3, 3), dtype=int)
            candidates = dist < t2
            eroded = ndimage.binary_erosion(candidates, structure=struct, iterations=erode)
            if eroded.any():
                labels, n = ndimage.label(eroded, structure=struct)
                h, w = labels.shape
                yy, xx = np.indices((h, w))
                d_border = np.minimum(np.minimum(yy, h - 1 - yy), np.minimum(xx, w - 1 - xx))
                min_d = ndimage.minimum(d_border, labels, index=np.arange(1, n + 1))
                border_labels = set((np.flatnonzero(min_d <= erode) + 1).tolist())
                erase = np.isin(labels, list(border_labels))
                erase = ndimage.binary_dilation(erase, structure=struct, iterations=erode)
                protect = candidates & ~erase
                alpha[protect] = 255.0
    return np.clip(alpha, 0, 255).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser(description="Cut near-black background to transparent")
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--t1", type=int, default=40, help="dist < t1 fully transparent (default 40)")
    ap.add_argument("--t2", type=int, default=90, help="dist > t2 fully opaque (default 90)")
    ap.add_argument("--protect-cc", action="store_true",
                    help="protect dark regions inside the character (erosion-based)")
    ap.add_argument("--erode", type=int, default=3,
                    help="erosion iterations for protect-cc (default 3)")
    args = ap.parse_args()

    if not (0 <= args.t1 < args.t2 <= 255):
        sys.exit("error: need 0 <= t1 < t2 <= 255")

    img, arr = load_rgb(args.input)
    alpha = compute_alpha(arr, args.t1, args.t2, args.protect_cc, args.erode)

    out = img.convert("RGBA")
    out.putalpha(Image.fromarray(alpha, "L"))

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    out.save(args.output, "PNG")

    total = alpha.size
    transparent = int((alpha == 0).sum())
    partial = int(((alpha > 0) & (alpha < 255)).sum())
    pct = 100.0 * transparent / total
    print(f"size: {img.size[0]}x{img.size[1]}")
    print(f"t1={args.t1} t2={args.t2} protect_cc={args.protect_cc}")
    print(f"transparent: {transparent} ({pct:.1f}%)")
    print(f"soft-edge(0<alpha<255): {partial} ({100.0*partial/total:.1f}%)")
    print(f"saved -> {args.output}")


if __name__ == "__main__":
    main()
