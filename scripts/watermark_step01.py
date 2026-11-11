"""Watermark filling (step01): video /*. mp4 → step01 /*. mp4 (watermark pixels are filled with the 5th nearest background color)

 Step 1 of the asset processing chain (replaces the responsibility of the original crop_step01 - watermark removal, and is more accurate):
   video / (1280 x720 original video) → this script → step01 / (1280 x720 after watermark removal)
  → chroma_step02.py (green screen background removal) → normalize_step03.py → encode_thumbs.py

Solution (verified):
- mask: video/watermark_mask_v5.mkv (black video brightness >10 generated, covering fade watermark)
- Color picking: Each watermark pixel takes the 5th closest "non-watermark pixel" color (skipping the adjacent unmarked watermark holes)
- Output: libx264 crf18 yuv420p, the same size/frame rate as the original video, for chromakey background removal

 concurrency: PARALLEL videos are processed simultaneously (each video has an independent Python process + 3 ffmpeg sub-processes)."""
from __future__ import annotations

import re
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "video"
OUT = ROOT / "step01"
MASK = SRC / "watermark_mask_v5.mkv"
K = 5
PARALLEL = 4
# Uniformly use ffmpeg that comes with the workspace (the asset processing chain has zero third-party dependencies)
FFMPEG = str(ROOT / ".tools" / "ffmpeg-9.0.1-essentials_build" / "bin" / "ffmpeg.exe")
FFPROBE = str(ROOT / ".tools" / "ffmpeg-9.0.1-essentials_build" / "bin" / "ffprobe.exe")
sys.path.insert(0, str(ROOT / "scripts"))
from fill_nn import fill_nn  # noqa: E402


def duration(video: Path) -> int:
    r = subprocess.run([FFMPEG, "-i", str(video), "-f", "null", "-"],
                       capture_output=True, text=True, errors="replace")
    m = re.findall(r"Duration:\s*(\d+):(\d+):(\d+)\.(\d+)", r.stderr)
    if not m:
        return 10
    h, mi, s, cs = map(int, m[0])
    return max(1, h * 3600 + mi * 60 + s + (1 if cs else 0))


def _is_valid(dst: Path, src: Path, min_size: int = 50_000) -> bool:
    """Breakpoint resume integrity check: exists, is large enough, is not older than the source, and can be read by ffprobe into the video stream.

     ffprobe Validation prevents files that are "writing when interrupted, appear to be of sufficient size but are damaged" from being misjudged as completed."""
    if not dst.exists() or dst.stat().st_size <= min_size:
        return False
    if dst.stat().st_mtime < src.stat().st_mtime:
        return False
    r = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "stream=codec_name",
                        "-of", "csv=p=0", str(dst)], capture_output=True)
    return bool(r.stdout.strip())


def _process_one(video: Path) -> tuple[str, str]:
    """Processing a single video (worker function, must be module level to support Windows spawn)."""
    dst = OUT / video.name
    if _is_valid(dst, video):
        return video.name, "SKIP"
    rc = fill_nn(video, MASK, dst, duration(video), K)
    return video.name, "OK" if rc == 0 else f"FAIL rc={rc}"


def main() -> int:
    OUT.mkdir(exist_ok=True)
    videos = sorted(SRC.glob("*.mp4"))
    if not videos:
        print(f"No MP4 files found in {SRC}")
        return 1
    if not MASK.exists():
        print(f"Missing mask: {MASK}")
        return 1

    total = len(videos)
    with ProcessPoolExecutor(max_workers=PARALLEL) as ex:
        for index, (name, status) in enumerate(ex.map(_process_one, videos), start=1):
            print(f"[{index}/{total}] {name} {status}", flush=True)

    print(f"Done. {total} videos written to {OUT} (parallel={PARALLEL})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
