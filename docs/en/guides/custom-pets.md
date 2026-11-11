# Create a pet pack

English · [简体中文](../../zh/guides/custom-pets.md) · [Documentation](../README.md)

A new character needs its own artwork and transparent animations. Changing the persona, display name or speech voice keeps the current artwork. Check the [asset terms](../../../dsh-pet/ASSET-LICENSE.md) before distributing derivatives.

## Prepare animation clips

Use a consistent 16:9 frame, character scale and ground line. Keep the character inside the frame. For ordinary actions, start and end in the same neutral pose so clips can join cleanly. The upstream [action recipes](../../../prompts/) contain Chinese production prompts and asset identifiers; they are source material, not application instructions.

For sleep, prepare three segments: entering sleep, a seamless loop and waking. Entry/loop must not return to standing; waking does. Match the entry end to the loop start and wake start, then the wake end to the entry start.

## Process assets

The root `scripts/` directory contains the production pipeline. It needs Python 3, ffmpeg, NumPy and SciPy; some scripts use tools under the workspace's `.tools/` directory. Read each script's input paths before running it.

```sh
cd scripts
python3 watermark_step01.py
python3 chroma_step02.py
# Optional: replace automatic keying with manually keyed alpha MOVs from pr/.
python3 pr_import_step02.py
python3 normalize_step03.py
python3 encode_thumbs.py
```

Automatic green-screen keying and imported manually keyed alpha clips both feed step02; normalization and playback encoding follow. Keep source videos and generated intermediate directories out of this documentation change. The upstream release may provide `assets-videos.zip`; do not assume this fork publishes that archive.

The packaged format is VP9-alpha WebM. The existing WebKit path uses separately prepared HEVC-with-alpha MOVs: place main-character MOVs in `$DSH_HOME/dsh-pet/main-animation/mov/`, or pack-specific files in `pet/<name>-animation/mov/`. Preserve matching asset names across formats. The upstream [assets-mov release](https://github.com/PC2005-cloud/dsh-pet/releases/tag/assets-mov) is a separate resource.

## Install a character locally

```text
$DSH_HOME/dsh-pet/pet/
├── otter-config.json
└── otter-animation/
    ├── idle.webm
    └── wave.webm
```

Create a configuration matching the bundled schema, with an instance ID, size, display target and animation pools. Pool names must match files in that pack. The filename stem identifies the pack; `pets[]` defines its instances and may use different IDs. Use a complete valid pool rather than assuming a partial pool will deep-merge.

After loading the pack, select its kind in Pet Config. Add or adjust instances there; each kind must retain at least one instance. Configuration and memory remain independent of the default entry. [Configuration reference](../reference/configuration.md#additional-characters).

## Distribute

For this plugin, use the [release workflow](releases.md), including the correct prerelease channel. Do not publish a beta directly to `latest`. For a separate artwork pack, include the configuration, matching assets, licensing and attribution, and test it in both browser and desktop runtimes you claim to support.
