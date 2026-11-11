"""Remove green backgrounds from step01 videos into transparent WebM files in step02/."""

from __future__ import annotations

import subprocess
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "step01"
OUT = ROOT / "step02"
# Uniformly use ffmpeg that comes with the workspace (the asset processing chain has zero third-party dependencies)
FFMPEG = str(ROOT / ".tools" / "ffmpeg-9.0.1-essentials_build" / "bin" / "ffmpeg.exe")
FFPROBE = str(ROOT / ".tools" / "ffmpeg-9.0.1-essentials_build" / "bin" / "ffprobe.exe")

PARALLEL = 4
W, H, FPS = 1280, 720, 24
# HSV Hue judgment background removal: Only pixels with "green hue + sufficient saturation/brightness" are judged as background (transparent).
# Compared with chromakey (YUV chromaticity distance) and RGB chromaticity threshold: they are "circled with the green screen as the center",
# Blue/white and other colors may fall into the circle and be picked out by mistake; HSV Hue judgment only recognizes the green direction, blue/white/red will never be picked out by mistake.
GREEN_HUE_MIN = 70.0   # Green hue lower bound
GREEN_HUE_MAX = 170.0  # Upper bound of green hue
SAT_MIN = 0.15         # Lower bound of saturation (white/light colors below this are not considered background)
VAL_MIN = 0.15         # Lower bound of lightness
HUE_FEATHER = 6.0      # Hue boundary gradient (degrees)

WIDTH = 320
HEIGHT = 180
MARGIN_X = WIDTH // 10
MARGIN_Y = HEIGHT // 10
FRAMES_PER_VIDEO = 10
QUANTIZE = 8

GREEN_HUE_MIN = 70.0
GREEN_HUE_MAX = 170.0
SATURATION_MIN = 0.15
VALUE_MIN = 0.15


def rgb_to_hsv(r: int, g: int, b: int) -> tuple[float, float, float]:
    rn, gn, bn = r / 255.0, g / 255.0, b / 255.0
    mx = max(rn, gn, bn)
    mn = min(rn, gn, bn)
    delta = mx - mn
    if delta == 0:
        return 0.0, 0.0, mx
    if mx == rn:
        hue = 60.0 * (((gn - bn) / delta) % 6.0)
    elif mx == gn:
        hue = 60.0 * (((bn - rn) / delta) + 2.0)
    else:
        hue = 60.0 * (((rn - gn) / delta) + 4.0)
    saturation = delta / mx if mx else 0.0
    return hue, saturation, mx


def sample_background_color(video: Path) -> str:
    cmd = [
        FFMPEG,
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(video),
        "-an",
        "-vf",
        f"fps=1,scale={WIDTH}:{HEIGHT}",
        "-frames:v",
        str(FRAMES_PER_VIDEO),
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-",
    ]
    result = subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    frame_size = WIDTH * HEIGHT * 3
    counter: Counter = Counter()

    for offset in range(0, len(result.stdout) - frame_size + 1, frame_size):
        frame = result.stdout[offset : offset + frame_size]
        for y in range(HEIGHT):
            for x in range(WIDTH):
                if MARGIN_X <= x < WIDTH - MARGIN_X and MARGIN_Y <= y < HEIGHT - MARGIN_Y:
                    continue
                index = (y * WIDTH + x) * 3
                r, g, b = frame[index], frame[index + 1], frame[index + 2]
                hue, sat, val = rgb_to_hsv(r, g, b)
                if GREEN_HUE_MIN <= hue <= GREEN_HUE_MAX and sat >= SATURATION_MIN and val >= VALUE_MIN:
                    q = (r // QUANTIZE * QUANTIZE, g // QUANTIZE * QUANTIZE, b // QUANTIZE * QUANTIZE)
                    counter[q] += 1

    if not counter:
        raise RuntimeError(f"No green pixels found in border of {video.name}")
    (r, g, b), _ = counter.most_common(1)[0]
    return "#%02X%02X%02X" % (r, g, b)


def read_exact(stream, n):
    """Blocked reading of n bytes (pipeline read may partially return and must be looped). Return insufficient when EOF."""
    buf = b""
    while len(buf) < n:
        chunk = stream.read(n - len(buf))
        if not chunk:
            break
        buf += chunk
    return buf


def _rgb_to_yuv(frame: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """rgb24 ( H , W ,3) → Y/U/V plane ( BT.601 limited ). U/V does 4:2:0 subsampling on average with 2 x2."""
    r = frame[..., 0].astype(np.float32)
    g = frame[..., 1].astype(np.float32)
    b = frame[..., 2].astype(np.float32)
    y = np.clip(16 + 0.257 * r + 0.504 * g + 0.098 * b, 16, 235).astype(np.uint8)
    u = np.clip(128 - 0.148 * r - 0.291 * g + 0.439 * b, 16, 240)
    v = np.clip(128 + 0.439 * r - 0.368 * g - 0.071 * b, 16, 240)
    u = u.reshape(H // 2, 2, W // 2, 2).mean(axis=(1, 3)).astype(np.uint8)
    v = v.reshape(H // 2, 2, W // 2, 2).mean(axis=(1, 3)).astype(np.uint8)
    return y, u, v


def _rgb_to_hsv(frame: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """rgb24 ( H , W ,3) → hue (0-360), saturation (0-1), value (0-1), numpy vectorized."""
    r = frame[..., 0].astype(np.float32) / 255.0
    g = frame[..., 1].astype(np.float32) / 255.0
    b = frame[..., 2].astype(np.float32) / 255.0
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    delta = mx - mn
    hue = np.zeros_like(mx)
    nz = delta > 0
    with np.errstate(divide="ignore", invalid="ignore"):
        hr = 60.0 * (((g - b) / np.where(nz, delta, 1)) % 6.0)
        hg = 60.0 * (((b - r) / np.where(nz, delta, 1)) + 2.0)
        hb = 60.0 * (((r - g) / np.where(nz, delta, 1)) + 4.0)
    hue = np.where((mx == r) & nz, hr, np.where((mx == g) & nz, hg, np.where((mx == b) & nz, hb, 0.0)))
    sat = np.where(mx > 0, delta / np.maximum(mx, 1e-6), 0.0)
    return hue, sat, mx


def convert_video(src: Path, dst: Path, color: str) -> None:
    """HSV Hue judgment background removal: green hue + sufficient saturation/brightness → transparent.

    Input pipe: step01 video rgb24 stream; output pipe: yuva420p → VP9 transparent webm."""
    bg = np.array([int(color[i:i + 2], 16) for i in (1, 3, 5)], np.uint8)  # # RRGGBB (for reference only)
    p1 = subprocess.Popen(
        [FFMPEG, "-loglevel", "error", "-i", str(src), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        stdout=subprocess.PIPE)
    p2 = subprocess.Popen(
        [FFMPEG, "-y", "-loglevel", "error",
         "-f", "rawvideo", "-pix_fmt", "yuva420p", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-crf", "30", "-b:v", "0",
         "-auto-alt-ref", "0", "-deadline", "good", "-cpu-used", "4", str(dst)],
        stdin=subprocess.PIPE)

    frame_size = W * H * 3
    # Hue span 0 degree processing: green range [70,170], leaving HUE_FEATHER gradient on both sides
    lo = GREEN_HUE_MIN - HUE_FEATHER
    hi = GREEN_HUE_MAX + HUE_FEATHER
    while True:
        buf = read_exact(p1.stdout, frame_size)
        if len(buf) < frame_size:
            break
        frame = np.frombuffer(buf, np.uint8).reshape(H, W, 3)
        hue, sat, val = _rgb_to_hsv(frame)
        # Background = within the green hue and the saturation/brightness meets the standard; the hue boundary is linearly gradient
        in_hue = np.clip((hue - lo) / HUE_FEATHER, 0, 1) * np.clip((hi - hue) / HUE_FEATHER, 0, 1)
        bg_mask = (sat >= SAT_MIN) & (val >= VAL_MIN) & (hue >= lo) & (hue <= hi)
        # Background → alpha 0 (transparent); green hue center fully transparent, edge gradient; non-background → 255
        alpha = np.where(bg_mask, (1.0 - in_hue) * 255, 255).astype(np.uint8)
        y, u, v = _rgb_to_yuv(frame)
        p2.stdin.write(y.tobytes() + u.tobytes() + v.tobytes() + alpha.tobytes())
    p1.stdout.close()
    p2.stdin.close()
    rc = p1.wait() + p2.wait()
    if rc != 0:
        raise RuntimeError(f"convert failed rc={rc}: {src.name}")


def _is_valid(dst: Path, src: Path, min_size: int = 50_000) -> bool:
    """Breakpoint resume integrity check: exists, is large enough, is not older than the source, and can be read by ffprobe into the video stream."""
    if not dst.exists() or dst.stat().st_size <= min_size:
        return False
    if dst.stat().st_mtime < src.stat().st_mtime:
        return False
    r = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "stream=codec_name",
                        "-of", "csv=p=0", str(dst)], capture_output=True)
    return bool(r.stdout.strip())


def _process_one(video: Path) -> tuple[str, str]:
    """Processing a single video (worker function, must be module level to support Windows spawn)."""
    dst = OUT / (video.stem + ".webm")
    if _is_valid(dst, video):
        return video.name, "SKIP"
    color = sample_background_color(video)
    convert_video(video, dst, color)
    return video.name, f"{color}"


def main() -> int:
    OUT.mkdir(exist_ok=True)
    videos = sorted(SRC.glob("*.mp4"))
    if not videos:
        print(f"No MP4 files found in {SRC}")
        return 1

    total = len(videos)
    with ProcessPoolExecutor(max_workers=PARALLEL) as ex:
        for index, (name, status) in enumerate(ex.map(_process_one, videos), start=1):
            print(f"[{index}/{total}] {name} -> {status}", flush=True)

    print(f"Done. {total} videos written to {OUT} (parallel={PARALLEL})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
