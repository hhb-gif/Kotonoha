#!/usr/bin/env python3
"""Generate Kotonoha app icon: deep-purple starry night + a stylized "K" mark.

Writes build/icon.png (256x256) and build/icon.ico (multi-size)."""
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

SIZE = 256
OUT_DIR = Path(__file__).resolve().parent.parent / "build"
OUT_DIR.mkdir(exist_ok=True)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def build_icon() -> Image.Image:
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Radial gradient backdrop: deep indigo -> dark purple -> near-black
    top = (28, 12, 52)
    mid = (58, 18, 88)
    bot = (10, 6, 18)
    for y in range(SIZE):
        t = y / (SIZE - 1)
        if t < 0.5:
            c = lerp(top, mid, t * 2)
        else:
            c = lerp(mid, bot, (t - 0.5) * 2)
        draw.line([(0, y), (SIZE, y)], fill=c)

    # Nebula glow patches
    glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for cx, cy, r, col in [
        (70, 70, 90, (140, 80, 220, 60)),
        (190, 60, 70, (90, 60, 200, 50)),
        (150, 190, 100, (120, 50, 180, 40)),
    ]:
        for _ in range(120):
            ang = random.random() * math.tau
            rad = random.random() * r
            x = cx + math.cos(ang) * rad
            y = cy + math.sin(ang) * rad
            gd.ellipse((x - 2, y - 2, x + 2, y + 2), fill=col)
    glow = glow.filter(ImageFilter.GaussianBlur(24))
    img = Image.alpha_composite(img, glow)

    # Star field
    rng = random.Random(42)
    draw = ImageDraw.Draw(img)
    for _ in range(180):
        x = rng.uniform(0, SIZE)
        y = rng.uniform(0, SIZE)
        r = rng.choice([0.6, 0.9, 1.2])
        bright = rng.randint(120, 255)
        draw.ellipse((x - r, y - r, x + r, y + r), fill=(bright, bright, bright, 200))
    # A few sparkle stars (4-point)
    for _ in range(12):
        x = rng.uniform(20, SIZE - 20)
        y = rng.uniform(20, SIZE - 20)
        s = rng.uniform(3, 5)
        draw.line((x - s, y, x + s, y), fill=(255, 255, 255, 220), width=1)
        draw.line((x, y - s, x, y + s), fill=(255, 255, 255, 220), width=1)
        draw.ellipse((x - 1, y - 1, x + 1, y + 1), fill=(255, 255, 255, 240))

    # Rounded-corner mask (app-like square)
    mask = Image.new("L", (SIZE, SIZE), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle((0, 0, SIZE - 1, SIZE - 1), radius=48, fill=255)
    img.putalpha(mask)

    # Stylized "K" glyph in soft gold/white
    draw = ImageDraw.Draw(img)
    x0, y0, x1, y1 = 68, 56, 190, 200
    col = (255, 238, 200, 255)
    w = 14
    draw.line((x0, y0, x0, y1), fill=col, width=w)
    draw.line((x0 + w // 2, 128, x1, y0), fill=col, width=w)
    draw.line((x0 + w // 2, 128, x1, y1), fill=col, width=w)
    # round the stroke joints with dots
    for cx, cy in [(x0, y0), (x0, y1), (x1, y0), (x1, y1), (x0 + w // 2, 128)]:
        draw.ellipse((cx - w // 2, cy - w // 2, cx + w // 2, cy + w // 2), fill=col)
    img = img.filter(ImageFilter.GaussianBlur(0.6))

    return img


def main():
    icon = build_icon()
    icon.save(OUT_DIR / "icon.png", "PNG")
    # ICO: include 256 + 128 + 64 + 48 + 32 + 16 for crisp scaling everywhere
    sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
    icon.save(OUT_DIR / "icon.ico", sizes=sizes)
    print(f"icon.png / icon.ico written to {OUT_DIR}")


if __name__ == "__main__":
    main()