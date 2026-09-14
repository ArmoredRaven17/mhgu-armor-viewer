"""Iris masks for the hunter's eye atlases: docs/tex/iris/<albedo hash>.png.

Raven, 2026-09-14: "Eye color drop down colors the whole eye not just the iris", then
"Eye color is set by some defaults, but we can simply make a mask for this."

The character colour is a luminance tint over the whole eye material, so the white of the
eye took the colour hardest. Every hunter face shares one of two eye textures, and each is
an ATLAS of ten identically shaped eyes whose irises are already painted in different
colours (the eye mesh samples only the top-left cell). That makes the iris measurable
rather than guessed: across those cells only the iris colour changes, while the sclera,
the pupil, the glint, the lids and the skin are the same pixels in every one. So the mask
is the per-pixel colour spread across the eight ordinary irises -- the two row-2 cells, an
all-white and an all-dark eye, are left out because they differ across the whole eye, not
just the iris. The spread is normalised and eased between two thresholds for a soft edge,
then written into every real eye cell of a mask the same size as the atlas, so it lines up
with the albedo UV for whichever cell is sampled.

    python dev/build-iris-masks.py
"""
import math
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.join(os.path.dirname(HERE), "docs")
ATLASES = ["44b07b0ea36bdc5f", "9f45a8304abd0bcf"]     # female, male
CELL = 32
NORMAL = [(0, 0), (1, 0), (2, 0), (3, 0), (0, 1), (1, 1), (2, 1), (3, 1)]
EYES = NORMAL + [(0, 2), (1, 2)]                          # the ten real eyes; the rest are placeholders
LO, HI = 0.20, 0.45                                       # fractions of the peak spread


def smooth(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


for h in ATLASES:
    src = Image.open(os.path.join(DOCS, "tex", h + ".png")).convert("RGB")
    W, H = src.size
    spread = [[0.0] * CELL for _ in range(CELL)]
    for y in range(CELL):
        for x in range(CELL):
            vals = [src.getpixel((cx * CELL + x, cy * CELL + y)) for cx, cy in NORMAL]
            sd = 0.0
            for ch in range(3):
                m = sum(v[ch] for v in vals) / len(vals)
                sd += math.sqrt(sum((v[ch] - m) ** 2 for v in vals) / len(vals))
            spread[y][x] = sd / 3
    peak = max(max(r) for r in spread)
    shape = [[smooth(LO, HI, spread[y][x] / peak) for x in range(CELL)] for y in range(CELL)]
    mask = Image.new("L", (W, H), 0)
    for cx, cy in EYES:
        for y in range(CELL):
            for x in range(CELL):
                mask.putpixel((cx * CELL + x, cy * CELL + y), int(round(255 * shape[y][x])))
    out = os.path.join(DOCS, "tex", "iris", h + ".png")
    mask.save(out)
    covered = sum(1 for r in shape for v in r if v > 0.5)
    print("%s  peak spread %.1f  iris texels (>0.5) %d of %d per cell  -> %s"
          % (h, peak, covered, CELL * CELL, os.path.relpath(out, os.path.dirname(HERE))))
