# Slim robot control packages

[Robot guide](robot.md) · [简体中文](../../zh/guides/robot-bundles.md)

The **Robot slim bundles** GitHub Actions workflow creates preview artifacts for Windows x64, Linux x64, Linux ARM64, macOS Intel and macOS Apple Silicon. It also produces ordinary and slim Windows desktop ZIPs. These builds do not publish to npm or create a GitHub Release. The published `0.1.0-beta.1` remains unchanged.

## Download and install

Open [the workflow](https://github.com/ob-labs/dsh-pet-powercontext/actions/workflows/robot-bundles.yml), select a successful run and download `robot-slim-<platform>` from **Artifacts**. Artifact downloads require a GitHub login and are retained for seven days. Extract the artifact ZIP first.

- **Windows desktop:** extract `dsh-pet-win32-x64-desktop-slim.zip`, keep the complete `win-unpacked` directory, and run `dsh-pet.exe`. Python, the SDK, Electron/Node and application dependencies are included. The unsigned preview may trigger Windows reputation prompts.
- **DSH/plugin or Node standalone:** use the `dsh-pet-powercontext-<version>-<platform>-slim.tgz` matching the **host computer**, not the robot. In the DSH profile's plugin package directory, run `npm install --offline --legacy-peer-deps /absolute/path/to/the-slim.tgz`, then enable the plugin through the existing DSH profile configuration. For standalone use, run that command in an empty directory, then `npx --no-install dsh-pet-powercontext`. Node 22.12+ is required; DSH itself is not included in the archive.
- **Runtime only:** `astra-runtime-<platform>-slim.tar.gz` is provided for deployment inspection. The slim plugin and desktop archives already contain it.

In the robot panel, select **Bundled environment (recommended)**. There is no Python installation step. Copying only the executable or `bridge.py` is insufficient: preserve the complete runtime directory. Configuration saved with a custom Python path remains custom; switch to bundled explicitly when upgrading that installation.

## What is included

The private runtime pins CPython 3.11.18 (python-build-standalone release `20261110`), Astra SDK 2.0.0, gRPC and compiler 1.78.0, protobuf 6.31.1, pip, setuptools and typing extensions. OpenCV and NumPy are intentionally excluded. Build inputs and hashes live in `dsh-pet/runtime/astra/`; compiled environments are created outside the repository. The slim npm archive additionally bundles the plugin's Node runtime dependency closure and is marked private to prevent accidentally publishing a platform-specific archive under the universal package name.

The adapter imports the SDK's generated protocol modules directly. Taught actions, action sequences, controller status, speech requests and three subsystem stops remain supported. Camera preview and image/depth processing are excluded. The vendor's top-level `astra_grpc_clients` wrapper eagerly imports the omitted vision libraries, so it cannot be used in this profile; the original SDK wheel and metadata remain unchanged.

The runtime uses an absolute executable path and Python isolated mode. It does not activate a virtual environment, edit PATH, install into system Python, or fall back to system Python when files are missing. In Electron, native files live in `resources/astra-runtime`, outside `app.asar`; in the plugin, they live in `runtime/astra-native`. Choosing **Custom Python environment** is an explicit advanced override and uses the interpreter you provide.

Linux packages target glibc (not Alpine/musl); they no longer require OpenCV's `libGL.so.1` or GLib. CI tests Ubuntu 24.04, Windows Server 2022, macOS 15 Intel and macOS 26 Apple Silicon. Other OS versions require separate validation. Container deployments must install the archive inside the container. macOS packages are not notarized application installers.

The supplied SDK metadata declares MIT but contains no separate vendor license/copyright notice. The unmodified metadata and provenance notice are preserved in every runtime. Python and dependency license files remain included; request the vendor's complete notice for future public redistribution if available.

## Build, sizes and verification

After this workflow is on the default branch, select **Run workflow** and choose a branch. The development branch also builds on push. There are no npm credentials or publishing permissions in this workflow.

Each native runner verifies the Python archive and wheel hashes and checks the dependency closure before installing the SDK. Afterwards it permits exactly the two missing OpenCV requirements declared by the unmodified SDK metadata and rejects all other dependency errors. A plain `pip check` therefore reports those intentional omissions; reinstalling the SDK with automatic dependency resolution would restore the vision stack. Validation confirms `cv2` and NumPy are unavailable and imports the actual SDK protocol modules. It tests the relocated interpreter with hostile Python environment variables; exercises status, single/group actions, speech and all three stops against a loopback gRPC server; and repeats smoke tests after extracting the compressed archives. The slim npm archive must install with an empty npm cache in offline mode; the installed HTTP host must then select its bundled interpreter and read the loopback controller state.

`robot-size-report` contains `SIZE-REPORT.md` and per-platform JSON reports, including SHA256 checksums, archive sizes, unpacked payload sizes, Python size before SDK installation, Node dependency size, and Python component breakdowns. Values use MiB (1,048,576 bytes). Filesystem allocation and installation scratch space are not included. Missing platform reports fail the aggregate job.

The Windows desktop ZIP is extracted and launched with real Electron. CI verifies a window loads and the ASAR host reaches the bundled SDK, then saves a screenshot. Exhibition hardware still requires on-site acceptance and physical robot validation. Loopback RPCs do not validate robot firmware, movement, playback or stopping distance.

For a local native build, first produce the ordinary package with `npm pack --pack-destination /data/codex-tmp/astra-base`, then run from `dsh-pet`:

```bash
TMPDIR=/data/codex-tmp PYTHONDONTWRITEBYTECODE=1 python3 scripts/astra/build.py \
  --output /data/codex-tmp/astra-slim-build \
  --base-package /data/codex-tmp/astra-base/dsh-pet-powercontext-0.1.0-beta.1.tgz
```

Use a new output directory on each run. Generated archives, caches, temporary environments and reports are never committed.
