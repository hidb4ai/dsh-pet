"""Unify character size across step02 videos into step03.

Whole frame proportional scaling + overlay pan to 2160 x1215 (16:9) transparent canvas:
- Standing height 900 (scaling calculated based on the average height of the first and last standing frames)
- Horizontally centered and aligned with the soles of the feet (aligned according to the lowest point of the full frame content to ensure that the animation is not cropped)
- The character/action content is not cropped, and the transparent blank beyond the bottom is directly cropped.
- Canvas 2160 x1215 Same 16:9 as original video, width to accommodate widest motion (2015 px)"""

from __future__ import annotations

import json
import re
import subprocess
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "step02"
OUT = ROOT / "step03"
# Uniformly use ffmpeg that comes with the workspace (the asset processing chain has zero third-party dependencies)
FFMPEG = str(ROOT / ".tools" / "ffmpeg-9.0.1-essentials_build" / "bin" / "ffmpeg.exe")
FFPROBE = str(ROOT / ".tools" / "ffmpeg-9.0.1-essentials_build" / "bin" / "ffprobe.exe")

PARALLEL = 4
CANVAS_W = 2160  # 16:9: 2160 = 1215 * 16/9, the same ratio as the original video
CANVAS_H = 1215
TARGET_HEIGHT = 900
FEET_Y = CANVAS_H - 100  # 100 from bottom

SRC_W = 1280
SRC_H = 720
FPS = 24
HEAD_FRAMES = 5
TAIL_SEEK = -0.2  # Get the frame from the end to avoid getting the cleanup action

_BBOX_RE = re.compile(r"x1:(\d+) x2:(\d+) y1:(\d+) y2:(\d+)")


def scan_bbox(video: Path, seek: float | None = None, frames: int | None = None) -> list[tuple[int, int, int, int]]:
    """Use alphaextract, bbox filters to scan frame content boundaries and return [( x1, x2, y1, y2)] list."""
    cmd = [FFMPEG, "-hide_banner", "-loglevel", "info", "-c:v", "libvpx-vp9"]
    if seek is not None:
        cmd += ["-sseof", str(seek)]
    cmd += ["-i", str(video)]
    if frames is not None:
        cmd += ["-frames:v", str(frames)]
    cmd += ["-vf", "alphaextract,bbox", "-f", "null", "-"]
    # Explicitly specify UTF-8 decoding when text = True (Windows defaults to GBK, which will not be able to decode the UTF-8 output of ffmpeg)
    result = subprocess.run(cmd, check=False, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())
    return [tuple(int(g) for g in m.groups()) for m in _BBOX_RE.finditer(result.stderr)]


def read_alpha_frames(video: Path, seek: float | None = None, frames: int | None = None) -> list[np.ndarray]:
    """Decode the alpha channel of the specified frame (H × W uint8 array per frame)."""
    cmd = [FFMPEG, "-hide_banner", "-loglevel", "error", "-c:v", "libvpx-vp9"]
    if seek is not None:
        cmd += ["-sseof", str(seek)]
    cmd += ["-i", str(video)]
    if frames is not None:
        cmd += ["-frames:v", str(frames)]
    cmd += ["-f", "rawvideo", "-pix_fmt", "rgba", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    frame_size = SRC_W * SRC_H * 4
    out: list[np.ndarray] = []
    while True:
        buf = b""
        while len(buf) < frame_size:
            chunk = p.stdout.read(frame_size - len(buf))
            if not chunk:
                break
            buf += chunk
        if len(buf) < frame_size:
            break
        out.append(np.frombuffer(buf, np.uint8).reshape(SRC_H, SRC_W, 4)[..., 3])
    p.stdout.close()
    p.wait()
    return out


def measure_standing(video: Path) -> dict:
    """The first and last HEAD_FRAMES frames are standing postures.

    The horizontal center uses the median of non-transparent pixels x (to prevent hand/snack extensions from pulling the center of bbox off),
    Use bbox for vertical reference (y direction extension has little interference, bbox itself is reliable)."""
    alphas = read_alpha_frames(video, frames=HEAD_FRAMES) + read_alpha_frames(video, seek=TAIL_SEEK, frames=HEAD_FRAMES)
    med_xs, heights, max_ys = [], [], []
    for a in alphas:
        ys, xs = np.where(a > 10)
        if len(xs) == 0:
            continue
        med_xs.append(float(np.median(xs)))
        heights.append(int(ys.max() - ys.min() + 1))
        max_ys.append(int(ys.max()))
    if not med_xs:
        raise RuntimeError(f"No opaque pixels found in {video.name}")
    return {
        "height": sum(heights) / len(heights),
        "max_y": sum(max_ys) / len(max_ys),
        "center_x": sum(med_xs) / len(med_xs),
    }


def measure_content_union(video: Path) -> tuple[int, int, int, int]:
    """The union of the full frame scan content range (x1, y1, x2, y2) is used to verify whether the animation content has been cropped."""
    boxes = scan_bbox(video)
    if not boxes:
        raise RuntimeError(f"No opaque pixels found in {video.name}")
    return (
        min(b[0] for b in boxes),
        min(b[2] for b in boxes),
        max(b[1] for b in boxes),
        max(b[3] for b in boxes),
    )


def build_filter(scale: float, standing: dict) -> str:
    """Full frame zoom + overlay pan to transparent canvas, standing horizontally centered, feet aligned FEET_Y."""
    scaled_w = int(SRC_W * scale) // 2 * 2
    scaled_h = int(SRC_H * scale) // 2 * 2
    overlay_x = CANVAS_W / 2 - standing["center_x"] * scale
    overlay_y = FEET_Y - standing["max_y"] * scale
    return (
        f"color=c=black@0:s={CANVAS_W}x{CANVAS_H}:r={FPS}[bg];"
        f"[0:v]scale={scaled_w}:{scaled_h}[sc];"
        f"[bg][sc]overlay={overlay_x:.1f}:{overlay_y:.1f}:shortest=1,format=yuva420p[v]"
    )


def convert_video(src: Path, dst: Path, filter_complex: str) -> None:
    cmd = [
        FFMPEG,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-c:v",
        "libvpx-vp9",  # Key: libvpx must be decoded to retain VP9 alpha
        "-i",
        str(src),
        "-filter_complex",
        filter_complex,
        "-map",
        "[v]",
        "-map",
        "0:a?",
        "-c:v",
        "libvpx-vp9",
        "-crf",
        "30",
        "-b:v",
        "0",
        "-auto-alt-ref",
        "0",
        "-deadline",
        "good",
        "-cpu-used",
        "4",
        "-c:a",
        "libopus",
        "-b:a",
        "128k",
        str(dst),
    ]
    result = subprocess.run(cmd, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())


def _is_valid(dst: Path, src: Path, min_size: int = 50_000) -> bool:
    """Breakpoint resume integrity check: exists, is large enough, is not older than the source, and can be read by ffprobe into the video stream."""
    if not dst.exists() or dst.stat().st_size <= min_size:
        return False
    if dst.stat().st_mtime < src.stat().st_mtime:
        return False
    r = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "stream=codec_name",
                        "-of", "csv=p=0", str(dst)], capture_output=True)
    return bool(r.stdout.strip())


def _process_one(video: Path) -> tuple[dict, bool]:
    """Processing a single video (worker function): measure + transcode (or skip transcode), return entry.

    Note: entry must be JSON serializable (params.json is summarized and written by the main process)."""
    dst = OUT / (video.stem + ".webm")
    # Resume running from breakpoint: complete output already exists → skip transcoding (but still measure to ensure params.json is complete)
    skip = _is_valid(dst, video)
    standing = measure_standing(video)
    union = measure_content_union(video)
    scale = TARGET_HEIGHT / standing["height"]
    entry = {
        "file": video.name,
        "standing": {k: round(v, 1) for k, v in standing.items()},
        "content_union": {"x1": union[0], "y1": union[1], "x2": union[2], "y2": union[3]},
        "scale": round(scale, 6),
    }
    if not skip:
        filter_complex = build_filter(scale, standing)
        convert_video(video, dst, filter_complex)
    return entry, skip


def main() -> int:
    OUT.mkdir(exist_ok=True)
    videos = sorted(SRC.glob("*.webm"))
    if not videos:
        print(f"No WebM files found in {SRC}")
        return 1

    payload = {"canvas": f"{CANVAS_W}x{CANVAS_H}", "target_height": TARGET_HEIGHT, "feet_y": FEET_Y, "videos": []}
    total = len(videos)
    with ProcessPoolExecutor(max_workers=PARALLEL) as ex:
        for index, (entry, skip) in enumerate(ex.map(_process_one, videos), start=1):
            payload["videos"].append(entry)
            status = "SKIP" if skip else "OK"
            print(f"[{index}/{total}] {entry['file']} {status} (scale={entry['scale']})", flush=True)

    (OUT / "params.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Done. {total} videos written to {OUT} (parallel={PARALLEL})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
