#!/bin/zsh
# ============================================================================
# HEVC-with-Alpha batch encoding (sunkeycn scheme, macOS native AVFoundation)
#
# Principle: ffmpeg is only responsible for decoding VP9-alpha webm into the original BGRA frame (stdin pipeline),
# The real HEVC-with-Alpha encoding is handed over to the swift program (AVAssetWriter +
# AVVideoCodecType.hevcWithAlpha) - Apple's native API, the product is native to Safari
# Verification support (issue contributor has tested on Safari).
#
# Usage:
# ./encode_hevc_alpha.sh [asset directory] [output directory]
# Default asset = . (compatible with assets/webm or assets/thumb after the main warehouse of the pipeline clone)
# Default output = ./ dist
#
# Dependency (macOS runner):
# - ffmpeg (Decoding webm: This script uses $FFMPEG_BIN first, followed by ffmpeg in PATH)
# - xcrun + swiftc (built-in system, compiled encoder)
# - hevc_alpha_encoder.swift (same directory as this script)
#
# Resume running from breakpoint: If the output mov is newer than the source webm, it will be skipped (the same mode as the main warehouse asset chain script).
# ============================================================================

set -euo pipefail

# ---- Parameters: asset directory / output directory ----
# Compatible with two asset layouts: directly to the directory, or relative to main-repo / (after the assembly line clone main warehouse)
if [[ -n "$1" ]]; then
  asset_dir=$1
else
  if [[ -d "main-repo/dsh-pet/assets/webm" ]]; then
    asset_dir="main-repo/dsh-pet/assets/webm"
  elif [[ -d "main-repo/dsh-pet/assets/thumb" ]]; then
    asset_dir="main-repo/dsh-pet/assets/thumb"
  elif [[ -d "dsh-pet/assets/webm" ]]; then
    asset_dir="dsh-pet/assets/webm"
  elif [[ -d "dsh-pet/assets/thumb" ]]; then
    asset_dir="dsh-pet/assets/thumb"
  else
    print -u2 "no asset dir found; pass it as \$1 (e.g. main-repo/dsh-pet/assets/webm)"
    exit 1
  fi
fi
out_dir=${2:-dist}

script_dir=${0:A:h}
encoder_src="$script_dir/hevc_alpha_encoder.swift"
encoder_bin=$(mktemp /tmp/dsh-pet-hevc-alpha.XXXXXX)
temp_output=''

cleanup() {
  rm -f "$encoder_bin"
  if [[ -n "$temp_output" ]]; then
    rm -f "$temp_output"
  fi
}
trap cleanup EXIT INT TERM

# ---- ffmpeg positioning ----
if [[ -n ${FFMPEG_BIN:-} ]]; then
  ffmpeg_bin=$FFMPEG_BIN
elif command -v ffmpeg >/dev/null 2>&1; then
  ffmpeg_bin=$(command -v ffmpeg)
else
  print -u2 'ffmpeg not found; install it or set FFMPEG_BIN=/absolute/path/to/ffmpeg'
  exit 1
fi
if [[ ! -x "$ffmpeg_bin" ]]; then
  print -u2 "ffmpeg is not executable: $ffmpeg_bin"
  exit 1
fi

# ---- Compile Swift encoder (macOS native AVFoundation + VideoToolbox)----
xcrun swiftc -O -suppress-warnings \
  -framework AVFoundation \
  -framework CoreVideo \
  -framework VideoToolbox \
  "$encoder_src" \
  -o "$encoder_bin"

# ---- Batch encoding ----
mkdir -p "$out_dir"
webm_files=("$asset_dir"/*.webm(N))
if (( ${#webm_files} == 0 )); then
  print -u2 "no WebM assets found: $asset_dir"
  exit 1
fi

converted=0
skipped=0
for source_file in "${webm_files[@]}"; do
  output_file="$out_dir/${source_file:t:r}.mov"
  if [[ -f "$output_file" && "$output_file" -nt "$source_file" ]]; then
    (( skipped += 1 ))
    continue
  fi

  temp_output="$out_dir/${source_file:t:r}.tmp.mov"
  rm -f "$temp_output"
  print "[$(( converted + skipped + 1))/${#webm_files}] ${source_file:t}"
  # ffmpeg: libvpx-vp9 decoding (retaining alpha) → original BGRA frame → swift encoder
  "$ffmpeg_bin" \
    -hide_banner \
    -loglevel error \
    -c:v libvpx-vp9 \
    -i "$source_file" \
    -an \
    -f rawvideo \
    -pix_fmt bgra \
    pipe:1 \
    | "$encoder_bin" "$temp_output" 640 360 24
  mv -f "$temp_output" "$output_file"
  temp_output=''
  (( converted += 1 ))
done

print "done: converted=$converted skipped=$skipped total=${#webm_files} out=$out_dir"