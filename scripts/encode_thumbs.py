"""Transcode step03 masters into 360 x360 playback thumbnails ( step04 ).

 Step 4 of the asset processing chain (transcoding): convert the normalized 1200 x1200 transparent master (step03 /)
Convert to 360 x360 playback variant (step04/) for use by dsh-pet plug-in runtime.

Complete processing chain (same level as crop_step01.py / chroma_step02.py / normalize_step03.py):
   step01 (original video) → crop_step01.py → chroma_step02.py (green screen background removal)
  → step02 (transparent 810 x720) → normalize_step03.py (normalized 1200 x1200 unified standing)
  → step03 (master) → this script → step04 (360 x360 playback variant)

 step04 is the final product of the asset processing chain. Put the content of step04 when publishing/installing the plug-in
Sync to dsh-pet/assets/thumb/(npm package requires self-contained playback resources).

Why transcoding is needed:
- Pet only displays about 260 px during playback, 360 resolution is clear enough, 1200 is 4.6 times redundant
- 1200 Full volume 172 MB exceeds the upper limit of npm package size; after transcoding, only ~10 MB can be released
- Playback saves memory and switches faster

Dual track design:
- thumb (product of this script, 360 x360, step04) → synchronize into npm package assets/thumb /, play during runtime
- full (step03 original 1200 x1200) → Not included in npm package, published to GitHub Releases archive"""

from __future__ import annotations

import subprocess
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "step03"
OUT = ROOT / "step04"
# Uniformly use ffmpeg that comes with the workspace (the asset processing chain has zero third-party dependencies)
FFMPEG = str(ROOT / ".tools" / "ffmpeg-9.0.1-essentials_build" / "bin" / "ffmpeg.exe")
FFPROBE = str(ROOT / ".tools" / "ffmpeg-9.0.1-essentials_build" / "bin" / "ffprobe.exe")

PARALLEL = 4
# Transcoding parameters (adjust here to change image quality/resolution)
TARGET_W = 640    # thumb width (same 16:9 ratio as 2160 x1215 master)
TARGET_H = 360    # thumb height
CRF = 40       # VP9 quality parameters (0-63, the smaller, the clearer and the larger; 40 is lighter, saving code in transparent areas)
FPS = 24       # Frame rate (consistent with master, maintain action rhythm)


def convert_video(src: Path, dst: Path) -> None:
    """Transcode one video.

    Decode with -c:v libvpx-vp9 to retain VP9 alpha, matching normalize_step03.py.
    ffmpeg's automatically selected decoder may discard alpha and produce a black background.
    The scale filter also requires format=yuva420p to preserve alpha.
    """
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
        "-vf",
        f"scale={TARGET_W}:{TARGET_H},format=yuva420p",
        "-c:v",
        "libvpx-vp9",  # VP9 encoding (WebM standard)
        "-crf",
        str(CRF),
        "-b:v",
        "0",  # Constant mass mode (CRF)
        "-row-mt",
        "1",  # Multi-line parallelization (accelerated encoding)
        "-r",
        str(FPS),
        "-an",  # Discard the audio track (the animation has no sound, saving size)
        str(dst),
    ]
    result = subprocess.run(cmd, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())


def _is_valid(dst: Path, src: Path, min_size: int = 20_000) -> bool:
    """Breakpoint resume integrity check: exists, is large enough, is not older than the source, and can be read by ffprobe into the video stream."""
    if not dst.exists() or dst.stat().st_size <= min_size:
        return False
    if dst.stat().st_mtime < src.stat().st_mtime:
        return False
    r = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "stream=codec_name",
                        "-of", "csv=p=0", str(dst)], capture_output=True)
    return bool(r.stdout.strip())


def _process_one(video: Path) -> tuple[str, int, int, bool]:
    """Process a single video (worker function), return (name, source size, output size, whether to skip)."""
    src_size = video.stat().st_size
    dst = OUT / video.name
    if _is_valid(dst, video):
        return video.name, src_size, 0, True
    convert_video(video, dst)
    return video.name, src_size, dst.stat().st_size, False


def main() -> int:
    OUT.mkdir(exist_ok=True)
    videos = sorted(SRC.glob("*.webm"))
    if not videos:
        print(f"No WebM masters found in {SRC}")
        return 1

    src_total = 0
    out_total = 0
    total = len(videos)
    with ProcessPoolExecutor(max_workers=PARALLEL) as ex:
        for index, (name, src_size, out_size, skipped) in enumerate(ex.map(_process_one, videos), start=1):
            src_total += src_size
            out_total += out_size
            if skipped:
                print(f"[{index}/{total}] SKIP {name} (already encoded)", flush=True)
            else:
                print(f"[{index}/{total}] {name}  {src_size / 1e6:.1f}MB -> {out_size / 1e6:.1f}MB", flush=True)

    print(f"\n=== summary ===")
    print(f"masters: {total}")
    print(f"source total: {src_total / 1e6:.1f}MB")
    print(f"thumb total: {out_total / 1e6:.1f}MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
