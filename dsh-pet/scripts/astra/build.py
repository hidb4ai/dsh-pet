"""Build and test a slim private Python runtime and an offline npm archive.

Run with Python 3.11+ on the target platform. Downloaded archives are verified;
only pinned wheels are installed. No host Python packages are modified.
"""

import argparse
import os
from pathlib import Path
import platform
import shutil
import sys

from common import (INPUTS, artifact, archive_tree, clean_bytecode, component_sizes, download,
                    extract, npm, outside_checkout, read_json, run, sha256, size, write_json)


def target_platform():
    machine = platform.machine().lower()
    arch = {"amd64": "x64", "x86_64": "x64", "aarch64": "arm64", "arm64": "arm64"}.get(machine)
    target = f"{sys.platform}-{arch}"
    if target not in read_json(INPUTS / "distributions.json")["platforms"]:
        raise ValueError(f"Unsupported native build target: {target}")
    return target


def build_runtime(output, target):
    settings = read_json(INPUTS / "distributions.json")
    source = settings["platforms"][target]
    root = output / "astra-runtime"
    if root.exists():
        raise ValueError("Use a new output directory for each build.")
    root.mkdir()
    cached = output / "python.tar.gz"
    download(source["url"], cached, source["sha256"])
    extract(cached, root)
    python = root / "python" / ("python.exe" if sys.platform == "win32" else "bin/python3")
    python_bytes = size(root)
    pip = [python, "-I", "-B", "-m", "pip", "--isolated", "--disable-pip-version-check"]
    wheels = output / "wheels"
    wheels.mkdir()
    lock = INPUTS / "requirements.lock"
    run([*pip, "download", "--index-url", "https://pypi.org/simple", "--no-cache-dir",
         "--require-hashes", "--only-binary=:all:", "--no-deps", "-r", lock, "-d", wheels])
    run([*pip, "install", "--no-index", "--find-links", wheels, "--no-compile", "--no-cache-dir",
         "--require-hashes", "--no-deps", "-r", lock])
    run([*pip, "check"])
    sdk = INPUTS / "vendor" / settings["sdkFile"]
    if sha256(sdk) != settings["sdkSha256"]:
        raise ValueError("SDK checksum mismatch")
    run([*pip, "install", "--no-index", "--no-deps", "--no-compile", "--no-cache-dir", sdk])
    # Keep vendor metadata intact; smoke tests allow only its two omitted OpenCV requirements.
    shutil.copytree(INPUTS / "vendor", root / "vendor-notices", ignore=shutil.ignore_patterns("*.whl"))
    shutil.copy2(lock, root / "requirements.lock")
    shutil.copy2(INPUTS / "bridge.py", root / "bridge.py")
    clean_bytecode(root)
    manifest = {"platform": target, "profile": "slim", "pythonVersion": settings["pythonVersion"],
                "sdkVersion": settings["sdkVersion"], "pythonSource": source,
                "sdkSha256": settings["sdkSha256"], "requirementsSha256": sha256(lock)}
    write_json(root / "manifest.json", manifest)
    # Relocation, spaces and hostile Python variables exercise real user installation paths.
    relocated = output / "relocated runtime"
    root.rename(relocated)
    relocated_python = relocated / python.relative_to(root)
    poison = output / "poison-python"
    poison.mkdir()
    (poison / "grpc.py").write_text("raise RuntimeError('Inherited Python path was used')\n")
    environment = {**os.environ, "PYTHONHOME": str(poison), "PYTHONPATH": str(poison),
                   "PYTHONUSERBASE": str(poison), "PYTHONNOUSERSITE": "0"}
    result = run([relocated_python, "-I", "-B", "-c",
                  (Path(__file__).parent / "smoke.py").read_text(), str(relocated)],
                 env=environment, capture_output=True, text=True)
    (output / "smoke.json").write_text(result.stdout, encoding="utf-8")
    print(result.stdout, flush=True)
    relocated.rename(root)
    clean_bytecode(root)
    return root, python_bytes


def slim_package(base, runtime, output, target):
    stage = output / "npm-stage"
    extract(base, stage)
    package = stage / "package"
    metadata = read_json(package / "package.json")
    metadata.pop("devDependencies", None)
    metadata.pop("scripts", None)
    metadata["private"] = True
    metadata["os"], metadata["cpu"] = [target.rsplit("-", 1)[0]], [target.rsplit("-", 1)[1]]
    metadata["bundleDependencies"] = list(metadata["dependencies"])
    metadata["files"].append("runtime/astra-native")
    write_json(package / "package.json", metadata)
    npm("install", "--ignore-scripts", "--omit=dev", "--legacy-peer-deps", "--package-lock=false", cwd=package)
    node_bytes = size(package / "node_modules")
    # npm installation discards symlinks, including Python's interpreter aliases.
    # Materialize native aliases so installed archives remain self-contained.
    shutil.copytree(runtime, package / "runtime/astra-native", symlinks=False)
    archive = output / f"dsh-pet-powercontext-{metadata['version']}-{target}-slim.tgz"
    # The base tar supplies the publication allowlist; dependencies were installed
    # into this external stage and declared as bundled in the package metadata.
    archive_tree(package, archive, "package")
    # Installation must work with an empty cache and no registry/network access.
    installed = output / "offline-install"
    npm("install", "--offline", "--cache", output / "empty-npm-cache", "--ignore-scripts",
        "--omit=dev", "--legacy-peer-deps", "--prefix", installed, archive)
    restored = installed / "node_modules/dsh-pet-powercontext"
    run([shutil.which("node"), restored / "lib/standalone.js", "--help"], capture_output=True)
    executable = restored / "runtime/astra-native/python" / ("python.exe" if os.name == "nt" else "bin/python3")
    run([executable, "-I", "-B", "-c", (Path(__file__).parent / "smoke.py").read_text(),
         str(restored / "runtime/astra-native")], capture_output=True)
    run([executable, "-I", "-B", "-c", (Path(__file__).parent / "host_smoke.py").read_text(),
         str(restored), str(output)], capture_output=True, text=True)
    return artifact(archive, size(package)), node_bytes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--base-package", type=Path)
    args = parser.parse_args()
    output = outside_checkout(args.output)
    target = target_platform()
    runtime, python_bytes = build_runtime(output, target)
    archive = output / f"astra-runtime-{target}-slim.tar.gz"
    archive_tree(runtime, archive, "astra-runtime")
    # Test the actual compressed runtime, not just its pre-archive staging tree.
    extract(archive, output / "archive-check")
    restored = output / "archive-check/astra-runtime"
    python = restored / "python" / ("python.exe" if os.name == "nt" else "bin/python3")
    run([python, "-I", "-B", "-c", (Path(__file__).parent / "smoke.py").read_text(), str(restored)])
    report = {"platform": target, "profile": "slim", "pythonBytes": python_bytes, "components": component_sizes(runtime),
              "runtime": artifact(archive, size(runtime)), "validation": read_json(output / "smoke.json")}
    if args.base_package:
        report["plugin"], report["nodeDependencyBytes"] = slim_package(args.base_package, runtime, output, target)
    write_json(output / f"sizes-{target}.json", report)
    print(f"Size report: {output / ('sizes-' + target + '.json')}")


if __name__ == "__main__":
    main()
