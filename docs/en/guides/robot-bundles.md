# Full robot dependency packages

[Robot guide](robot.md) · [简体中文](../../zh/guides/robot-bundles.md)

The **Robot full dependency bundles** GitHub Actions workflow creates preview artifacts for Windows x64, Linux x64, Linux ARM64, macOS Intel and macOS Apple Silicon. It also produces ordinary and full Windows desktop ZIPs. These builds do not publish to npm or create a GitHub Release. The published `0.1.0-beta.1` remains unchanged.

## Download and install

Open [the workflow](https://github.com/ob-labs/dsh-pet-powercontext/actions/workflows/robot-bundles.yml), select a successful run and download `robot-full-<platform>` from **Artifacts**. Artifact downloads require a GitHub login and are retained for seven days. Extract the artifact ZIP first.

- **Windows desktop:** extract `dsh-pet-win32-x64-desktop-full.zip`, keep the complete `win-unpacked` directory, and run `dsh-pet.exe`. Python, the SDK, Electron/Node and application dependencies are included. The unsigned preview may trigger Windows reputation prompts.
- **DSH/plugin or Node standalone:** use the `dsh-pet-powercontext-<version>-<platform>-full.tgz` matching the **host computer**, not the robot. In the DSH profile's plugin package directory, run `npm install --offline --legacy-peer-deps /absolute/path/to/the-full.tgz`, then enable the plugin through the existing DSH profile configuration. For standalone use, run that command in an empty directory, then `npx --no-install dsh-pet-powercontext`. Node 22.12+ is required; DSH itself is not included in the archive.
- **Runtime only:** `astra-runtime-<platform>.tar.gz` is provided for deployment inspection. The full plugin and desktop archives already contain it.

In the robot panel, select **Bundled environment (recommended)**. There is no Python installation step. Copying only the executable or `bridge.py` is insufficient: preserve the complete runtime directory. Configuration saved with a custom Python path remains custom; switch to bundled explicitly when upgrading that installation.

## What is included

The private runtime pins CPython 3.11.18 (python-build-standalone release `20261110`), Astra SDK 2.0.0, gRPC and compiler 1.78.0, protobuf 6.31.1, NumPy 2.4.6, both vendor-required OpenCV 4.10.0.84 distributions, pip, setuptools and typing extensions. Build inputs and hashes live in `dsh-pet/runtime/astra/`; compiled environments are created outside the repository. The full npm archive additionally bundles the plugin's Node runtime dependency closure and is marked private to prevent accidentally publishing a platform-specific archive under the universal package name.

The runtime uses an absolute executable path and Python isolated mode. It does not activate a virtual environment, edit PATH, install into system Python, or fall back to system Python when files are missing. In Electron, native files live in `resources/astra-runtime`, outside `app.asar`; in the plugin, they live in `runtime/astra-native`. Choosing **Custom Python environment** is an explicit advanced override and uses the interpreter you provide.

These are native desktop builds, not OS images. Linux packages target glibc (not Alpine/musl), need glibc 2.28+ for the pinned NumPy wheels, and require the OpenCV OS libraries `libGL.so.1` and GLib. CI tests Ubuntu 24.04, Windows Server 2022 and macOS 15 on the corresponding architectures. A headless Linux host may need `sudo apt-get install libgl1 libglib2.0-0`. Container deployments must install the archive and OS libraries inside the container. macOS packages are not notarized application installers.

The supplied SDK metadata declares MIT but contains no separate vendor license/copyright notice. The unmodified metadata and provenance notice are preserved in every runtime. Python and dependency license files remain included; request the vendor's complete notice for future public redistribution if available.

## Build, sizes and verification

After this workflow is on the default branch, select **Run workflow** and choose a branch. The development branch also builds on push. There are no npm credentials or publishing permissions in this workflow.

Each native runner verifies the Python archive and wheel hashes, installs the full dependency closure and runs `pip check`. It imports the actual SDK, OpenCV contrib and NumPy; tests the relocated interpreter with hostile Python environment variables; exercises status, single/group actions, speech and all three stops against a loopback gRPC server; and repeats smoke tests after extracting the compressed archives. The full npm archive must install with an empty npm cache in offline mode.

`robot-size-report` contains `SIZE-REPORT.md` and per-platform JSON reports, including SHA256 checksums, archive sizes, unpacked payload sizes, Python size before SDK installation, Node dependency size, and Python component breakdowns. Values use MiB (1,048,576 bytes). Shared OpenCV files are counted once; filesystem allocation and installation scratch space are not included. Missing platform reports fail the aggregate job.

The Windows desktop ZIP is extracted and its private runtime tested. The executable's GUI and robot integration still require a Windows desktop acceptance test and physical exhibition robot validation. Loopback RPCs do not validate robot firmware, movement, playback or stopping distance.

For a local native build, first produce the ordinary package with `npm pack --pack-destination /data/codex-tmp/astra-base`, then run from `dsh-pet`:

```bash
TMPDIR=/data/codex-tmp PYTHONDONTWRITEBYTECODE=1 python3 scripts/astra/build.py \
  --output /data/codex-tmp/astra-full-build \
  --base-package /data/codex-tmp/astra-base/dsh-pet-powercontext-0.1.0-beta.1.tgz
```

Use a new output directory on each run. Generated archives, caches, temporary environments and reports are never committed.
