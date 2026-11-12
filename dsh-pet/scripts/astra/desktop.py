"""Package Windows desktop variants and compare actual archive/payload sizes."""

import argparse
import os
from pathlib import Path
import shutil
import zipfile

from common import PACKAGE, artifact, outside_checkout, read_json, run, size, write_json


def zip_tree(root, destination):
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in root.rglob("*"):
            if path.is_file():
                archive.write(path, Path(root.name) / path.relative_to(root))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    output = outside_checkout(args.output)
    assert os.name == "nt", "Windows desktop packaging requires a Windows runner"
    runtime = output / "astra-runtime"
    configuration = output / "electron-builder.json"
    write_json(configuration, {"extends": str(PACKAGE / "electron-builder.yml"),
                               "directories": {"output": str(output / "desktop")}})
    run([shutil.which("node"), PACKAGE / "node_modules/electron-builder/out/cli/cli.js",
         "--win", "dir", "--config", configuration], cwd=PACKAGE,
        env={**os.environ, "CSC_IDENTITY_AUTO_DISCOVERY": "false"})
    unpacked = output / "desktop/win-unpacked"
    baseline = output / "dsh-pet-win32-x64-desktop.zip"
    zip_tree(unpacked, baseline)
    baseline_record = artifact(baseline, size(unpacked))
    # Native Python and DLLs must be real files outside app.asar.
    shutil.copytree(runtime, unpacked / "resources/astra-runtime")
    full = output / "dsh-pet-win32-x64-desktop-full.zip"
    zip_tree(unpacked, full)
    # Validate the distributed archive after extracting it into a different directory.
    restored = output / "desktop-unzip"
    with zipfile.ZipFile(full) as archive:
        archive.extractall(restored)
    restored_runtime = restored / "win-unpacked/resources/astra-runtime"
    run([restored_runtime / "python/python.exe", "-I", "-B", "-c",
         (Path(__file__).parent / "smoke.py").read_text(), str(restored_runtime)])
    report_path = output / "sizes-win32-x64.json"
    report = read_json(report_path)
    report["desktop"] = baseline_record
    report["desktopFull"] = artifact(full, size(unpacked))
    write_json(report_path, report)


if __name__ == "__main__":
    main()
