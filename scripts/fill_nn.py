"""Pure nearest neighbor watermark filling: each watermark pixel = color of the k nearest "non-watermark pixel"

- Streaming frame-by-frame processing (small memory footprint)
- scipy distance_transform_edt ( return_indices ) calculates the nearest non-watermark pixel coordinates
- k >1: Skip the color source close to the watermark (the unmarked watermark character hole that fades in and out), and take the true background further away
- mask =0 pixel remains unchanged (distance 0 → take itself)

Usage: python fill_nn.py <video> < mask > <output> [duration] [ k ]"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy.ndimage import distance_transform_edt

ROOT = Path(__file__).resolve().parent.parent
FFMPEG = str(ROOT / ".tools" / "ffmpeg-9.0.1-essentials_build" / "bin" / "ffmpeg.exe")
W, H, FPS = 1280, 720, 24


def read_exact(stream, n):
    """Blocked reading of n bytes (pipeline read may partially return and must be looped). Return insufficient when EOF."""
    buf = b""
    while len(buf) < n:
        chunk = stream.read(n - len(buf))
        if not chunk:
            break
        buf += chunk
    return buf


def kth_nearest(wm: np.ndarray, k: int):
    """Return the k nearest non-watermark pixel coordinates (iy, ix) of each watermark pixel.

     distance_transform_edt of indices = the index of each pixel to the nearest "zero element";
    Pass in wm (watermark = non-zero, non-watermark = zero) → indices, which is the "nearest [non-watermark] coordinate of each pixel".
    Nearest k: Merge the color source referenced in the previous k-1 round into wm (become non-zero) so that it is no longer pointed to."""
    cur = wm.copy()
    for _ in range(k):
        _, idx = distance_transform_edt(cur, return_indices=True)
        iy, ix = idx
        used = np.zeros_like(cur, bool)
        used[iy[wm], ix[wm]] = True
        cur = cur | used
    return iy, ix


def fill_nn(video: Path, mask_path: Path, dst: Path, dur: int = 10, k: int = 1) -> int:
    # Input pipeline: original video rgb24 stream
    p1 = subprocess.Popen(
        [FFMPEG, "-loglevel", "error", "-i", str(video),
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        stdout=subprocess.PIPE)
    # Input pipe: mask gray stream
    p2 = subprocess.Popen(
        [FFMPEG, "-loglevel", "error", "-i", str(mask_path),
         "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        stdout=subprocess.PIPE)
    # Output pipe: rgb24 stream → libx264
    p3 = subprocess.Popen(
        [FFMPEG, "-y", "-loglevel", "error",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "fast", str(dst)],
        stdin=subprocess.PIPE)

    frame_size = W * H * 3
    n = 0
    while True:
        buf = read_exact(p1.stdout, frame_size)
        if len(buf) < frame_size:
            break
        mbuf = read_exact(p2.stdout, W * H)
        if len(mbuf) < W * H:
            break
        frame = np.frombuffer(buf, np.uint8).reshape(H, W, 3).copy()  # copy : frombuffer read-only
        mask = np.frombuffer(mbuf, np.uint8).reshape(H, W)
        wm = mask == 255
        if wm.any():
            iy, ix = kth_nearest(wm, k)
            # Only remap watermark pixels; clip defends edge out of bounds. Non-watermark pixels are never altered.
            yi = np.clip(iy[wm], 0, H - 1)
            xi = np.clip(ix[wm], 0, W - 1)
            frame[wm] = frame[yi, xi]
        p3.stdin.write(frame.tobytes())
        n += 1
    p1.stdout.close()
    p2.stdout.close()
    p3.stdin.close()
    rc1, rc2, rc3 = p1.wait(), p2.wait(), p3.wait()
    print(f"Fill complete: {dst} ({n} frames, rc={rc3})")
    return rc3


if __name__ == "__main__":
    video = Path(sys.argv[1])
    mask = Path(sys.argv[2])
    dst = Path(sys.argv[3])
    dur = int(sys.argv[4]) if len(sys.argv) > 4 else 10
    k = int(sys.argv[5]) if len(sys.argv) > 5 else 1
    raise SystemExit(fill_nn(video, mask, dst, dur, k))
