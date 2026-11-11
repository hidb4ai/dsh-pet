"""Import hand-keyed MOV files from pr / and write transparent WebM into step02 /.

For the situation where automatic green screen background removal (chroma_step02.py) does not work well for actions that “contain third-party items”:
The user performs manual background removal in PR and exports . mov carrying the alpha channel. This script directly uses ffmpeg to convert this batch
 Convert mov to transparent webm and write step02 /, overwriting the previous automatic background removal result of this action. Then keep walking
 normalize_step03.py → encode_thumbs.py, the rest of the entire asset chain remains unchanged.

Use:
  1. Put the transparent mov exported by PR into pr /, and the file name is consistent with the action name (such as eating glutinous rice balls. mov).
  2. Run `python pr_import_step02.py` → generate step02 / eat glutinous rice balls. webm.
  3. Then run normalize_step03.py and encode_thumbs.py (increment: this action is redone, and the remaining SKIP).
  4. Synchronize step04 results to dsh-pet/assets/thumb/.

Note:
  - mov must carry alpha channel (such as ProRes 4444 with alpha, or PNG serial package),
     Only the ffmpeg decoder can read back transparency; otherwise, the output is opaque.
  - Conversion parameters are specified by user: - c:v libvpx-vp9 - pix_fmt yuva420p - b:v 0 - crf 32 - an."""

from __future__ import annotations

import subprocess
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "pr"                    # PR Buttoned and transparent mov
OUT = ROOT / "step02"                # Directly cover step02 (equivalent to chroma_step02 product)
# Uniformly use ffmpeg that comes with the workspace (the asset processing chain has zero third-party dependencies)
FFMPEG = str(ROOT / ".tools" / "ffmpeg-9.0.1-essentials_build" / "bin" / "ffmpeg.exe")
FFPROBE = str(ROOT / ".tools" / "ffmpeg-9.0.1-essentials_build" / "bin" / "ffprobe.exe")

PARALLEL = 4
# Transcoding parameters (user specified: VP9 + transparent + constant quality CRF32)
CRF = 32       # VP9 constant quality parameter (0-63, the smaller, the clearer and the larger)


def _mov_files() -> list[Path]:
    """Collect pr / mov (case insensitive), sort by name, and maintain a stable order."""
    return sorted(p for p in SRC.iterdir() if p.suffix.lower() == ".mov")


def convert_video(src: Path, dst: Path) -> None:
    """Convert mov with alpha to transparent VP9 webm (maintain original resolution, no scaling).

    Note:
    - There is no mandatory specification on the decoding end: mov exported by PR comes with alpha (ProRes/PNG package), ffmpeg
      The automatic decoder can read back rgba; if the source does not contain alpha the result is opaque (see module docstring).
    - The encoding end must - c:v libvpx-vp9 + - pix_fmt yuva420p to write alpha into WebM."""
    cmd = [
        FFMPEG,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(src),
        "-c:v",
        "libvpx-vp9",   # VP9 encoding (WebM standard, supports alpha)
        "-pix_fmt",
        "yuva420p",     # Force 4:2:0 + alpha plane
        "-b:v",
        "0",            # Constant mass mode (CRF)
        "-crf",
        str(CRF),
        "-row-mt",
        "1",            # Multi-line parallelization (accelerated encoding)
        "-an",          # Discard the audio track (the animation has no sound, saving size)
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
    """Handling single mov (worker function, must be module level to support Windows spawn)."""
    src_size = video.stat().st_size
    dst = OUT / (video.stem + ".webm")
    if _is_valid(dst, video):
        return video.name, src_size, 0, True
    convert_video(video, dst)
    return video.name, src_size, dst.stat().st_size, False


def main() -> int:
    OUT.mkdir(exist_ok=True)
    videos = _mov_files()
    if not videos:
        print(f"No MOV files found in {SRC}")
        return 1

    src_total = 0
    out_total = 0
    total = len(videos)
    with ProcessPoolExecutor(max_workers=PARALLEL) as ex:
        for index, (name, src_size, out_size, skipped) in enumerate(ex.map(_process_one, videos), start=1):
            src_total += src_size
            out_total += out_size
            if skipped:
                print(f"[{index}/{total}] SKIP {name} (already in step02)", flush=True)
            else:
                print(f"[{index}/{total}] {name}  {src_size / 1e6:.1f}MB -> {out_size / 1e6:.1f}MB", flush=True)

    print(f"\n=== summary ===")
    print(f"mov imported: {total}")
    print(f"source total: {src_total / 1e6:.1f}MB")
    print(f"step02 total: {out_total / 1e6:.1f}MB")
    print("Next, run normalize_step03.py and encode_thumbs.py, then sync step04 to assets/thumb/.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
