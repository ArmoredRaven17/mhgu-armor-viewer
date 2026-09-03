"""Compare two shot runs pixel by pixel.

    python dev/diff-shots.py baseline split          # prints a table, writes dev/shots/diff-baseline-split/*.png
    python dev/diff-shots.py baseline split --json   # machine-readable

A scene counts as identical when every pixel matches. Otherwise the number of differing pixels,
the mean absolute channel difference over those pixels, and the bounding box of the change are
reported, and an amplified difference image is written so the change can be looked at.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, "shots")


def load(run, name):
    p = os.path.join(SHOTS, run, name + ".png")
    return np.asarray(Image.open(p).convert("RGBA")).astype(np.int16) if os.path.isfile(p) else None


def compare(a, b, out_path=None):
    if a is None or b is None:
        return {"status": "missing"}
    if a.shape != b.shape:
        return {"status": "shape", "a": list(a.shape), "b": list(b.shape)}
    d = np.abs(a - b)
    mask = d.max(axis=2) > 0
    n = int(mask.sum())
    if n == 0:
        return {"status": "identical"}
    ys, xs = np.nonzero(mask)
    res = {"status": "differs", "pixels": n, "fraction": round(n / mask.size, 5),
           "meanAbs": round(float(d[mask].mean()), 2), "maxAbs": int(d.max()),
           "bbox": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]}
    if out_path:
        amp = np.clip(d.max(axis=2) * 4, 0, 255).astype(np.uint8)
        rgb = np.stack([amp, amp // 3, amp // 3], axis=2)
        Image.fromarray(rgb).save(out_path)
    return res


def main():
    args = [x for x in sys.argv[1:] if not x.startswith("--")]
    if len(args) != 2:
        print(__doc__)
        sys.exit(2)
    ra, rb = args
    as_json = "--json" in sys.argv
    names = set()
    for r in (ra, rb):
        folder = os.path.join(SHOTS, r)
        if os.path.isdir(folder):
            names.update(f[:-4] for f in os.listdir(folder) if f.endswith(".png"))
    names = sorted(names)
    out_dir = os.path.join(SHOTS, "diff-%s-%s" % (ra, rb))
    os.makedirs(out_dir, exist_ok=True)
    report = {}
    for n in names:
        report[n] = compare(load(ra, n), load(rb, n), os.path.join(out_dir, n + ".png"))
    if as_json:
        print(json.dumps(report, indent=1))
    else:
        for n, r in report.items():
            if r["status"] == "identical":
                print("%-18s identical" % n)
            elif r["status"] == "differs":
                print("%-18s differs  %7d px (%.2f%%)  mean %5.1f  max %3d  bbox %s" %
                      (n, r["pixels"], r["fraction"] * 100, r["meanAbs"], r["maxAbs"], r["bbox"]))
            else:
                print("%-18s %s %s" % (n, r["status"], r))
    bad = [n for n, r in report.items() if r["status"] != "identical"]
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
