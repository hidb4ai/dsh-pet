"""Aggregate native build reports without treating missing platforms as success."""

import argparse
from pathlib import Path

from common import INPUTS, read_json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    reports = {item["platform"]: item for path in args.directory.rglob("sizes-*.json")
               if (item := read_json(path))}
    expected = set(read_json(INPUTS / "distributions.json")["platforms"])
    lines = ["# Full robot bundle sizes", "", "All sizes are MiB (1,048,576 bytes). Unpacked values count file payloads, not filesystem allocation.", "",
             "| Platform | Python before SDK | Robot runtime archive / unpacked | Full npm archive / unpacked | Node dependencies |",
             "| --- | ---: | ---: | ---: | ---: |"]
    mib = lambda count: f"{count / 1048576:.1f}"
    pair = lambda item: f"{mib(item['compressedBytes'])} / {mib(item['unpackedBytes'])}"
    for target in sorted(expected):
        if target not in reports:
            lines.append(f"| {target} | MISSING | MISSING | MISSING | MISSING |")
            continue
        report = reports[target]
        lines.append(f"| {target} | {mib(report['pythonBytes'])} | {pair(report['runtime'])} | {pair(report['fullPackage'])} | {mib(report['nodeDependencyBytes'])} |")
    if (windows := reports.get("win32-x64")) and "desktop" in windows:
        lines.extend(["", f"Windows desktop baseline: **{pair(windows['desktop'])} MiB** (archive / unpacked).",
                      f"Windows desktop with robot dependencies: **{pair(windows['desktopFull'])} MiB**.", ""])
    lines.extend(["", "Full npm archives include the pet, private Python, vendor SDK, all pinned Python dependencies and bundled Node runtime dependencies. Node/DSH itself is a prerequisite; the Windows desktop archive also includes Electron/Node.", "",
                  "Checks: pip dependency closure; full SDK/OpenCV/contrib imports; relocated and isolated interpreter; real SDK loopback status/action/group/speech/three-stop RPCs; compressed archive extraction; npm install offline with an empty cache.", "",
                  "These artifacts are previews, not npm publications. No physical robot was connected. Native OS libraries are not an operating system image."])
    text = "\n".join(lines) + "\n"
    print(text)
    (args.directory / "SIZE-REPORT.md").write_text(text, encoding="utf-8")
    if set(reports) != expected:
        raise SystemExit("Not all requested native platform reports are present")


if __name__ == "__main__":
    main()
