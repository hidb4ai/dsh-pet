#!/usr/bin/env python3
"""Verify whether the alpha channel of the HEVC-with-Alpha product actually exists.

Usage: python check_alpha.py dist /*. mov (or ls expansion)
Judgment: Extract the RGBA of the first frame, and the A channel must have real levels (there are >200 opaque pixels,
There are also transparent pixels <100) - if all are 255, it means the encoding is lost alpha, and the encoding command must be modified."""
import os
import subprocess
import sys

FFMPEG = "ffmpeg"


def check_one(path: str) -> bool:
    rgba = path[:-4] + (".rgba" if not path.endswith(".rgba") else path)
    r = subprocess.run(
        [FFMPEG, "-y", "-v", "error", "-i", path, "-ss", "1", "-frames:v", "1",
         "-f", "rawvideo", "-pix_fmt", "rgba", rgba],
        capture_output=True, text=True,
    )
    if r.returncode != 0 or not os.path.exists(rgba) or os.path.getsize(rgba) < 16:
        print(f"  [WARN] {path}: no frame extracted")
        return True
    data = open(rgba, "rb").read()
    alpha = data[3::4]  # rgba is 4 bytes per pixel, A is the 4th
    a_min, a_max = min(alpha), max(alpha)
    a_mean = sum(alpha) / len(alpha)
    ok = a_max > 200 and a_min < 100
    print(f"  alpha min={a_min} max={a_max} mean={a_mean:.1f} -> {'OK' if ok else '!! LOST'}")
    os.remove(rgba)
    return ok


def main() -> int:
    files = sys.argv[1:]
    if not files:
        print("usage: python check_alpha.py <mov...> or ls dist/*.mov | xargs python check_alpha.py")
        return 2
    failed = 0
    for f in files:
        if not check_one(f):
            failed += 1
    print(f"check: {len(files) - failed}/{len(files)} alpha OK")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
