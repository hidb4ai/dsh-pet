"""Build utilities; all mutable output must stay outside the source checkout."""

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import urllib.request

PACKAGE = Path(__file__).resolve().parents[2]
INPUTS = PACKAGE / "runtime" / "astra"


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def sha256(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def size(path):
    """Count regular-file payload bytes once; symlinks add no duplicate payload."""
    return sum(p.stat().st_size for p in Path(path).rglob("*") if p.is_file() and not p.is_symlink())


def outside_checkout(path):
    path = Path(path).resolve()
    if path.is_relative_to(PACKAGE.parent):
        raise ValueError("Build outputs must be outside the repository.")
    path.mkdir(parents=True, exist_ok=True)
    return path


def run(args, **kwargs):
    try:
        return subprocess.run([str(arg) for arg in args], check=True, **kwargs)
    except subprocess.CalledProcessError as error:
        if error.stdout:
            print(error.stdout, file=sys.stderr)
        if error.stderr:
            print(error.stderr, file=sys.stderr)
        raise


def npm(*args, **kwargs):
    """Invoke npm's JS entry, avoiding a Windows shell and argument interpolation."""
    executable = Path(shutil.which("npm") or shutil.which("npm.cmd"))
    cli = executable.parent / "node_modules/npm/bin/npm-cli.js" if os.name == "nt" else executable.resolve()
    return run([shutil.which("node"), cli, *args], **kwargs)


def download(url, destination, digest):
    destination = Path(destination)
    if not destination.exists():
        with urllib.request.urlopen(url, timeout=120) as source, destination.open("wb") as target:
            shutil.copyfileobj(source, target)
    if sha256(destination) != digest:
        raise ValueError(f"SHA256 mismatch: {destination.name}")


def extract(archive, destination):
    """Reject archive traversal and unsafe links, while preserving Python symlinks."""
    with tarfile.open(archive) as source:
        source.extractall(destination, filter="data")


def archive_tree(source, destination, prefix):
    with tarfile.open(destination, "w:gz", compresslevel=6) as archive:
        archive.add(source, arcname=prefix)


def clean_bytecode(root):
    for path in Path(root).rglob("__pycache__"):
        shutil.rmtree(path)
    for path in Path(root).rglob("*.pyc"):
        path.unlink()


def artifact(path, unpacked_bytes):
    return {"file": Path(path).name, "compressedBytes": Path(path).stat().st_size,
            "unpackedBytes": unpacked_bytes, "sha256": sha256(path)}


def component_sizes(root):
    """Attribute installed files once, including shared cv2 files and native libraries."""
    totals = {}
    for path in Path(root).rglob("*"):
        if not path.is_file() or path.is_symlink():
            continue
        parts = path.relative_to(root).parts
        component = "Python and notices"
        if "site-packages" in parts:
            package = parts[parts.index("site-packages") + 1].lower()
            if package.startswith(("cv2", "opencv")):
                component = "OpenCV including contrib"
            elif package.startswith("numpy"):
                component = "NumPy"
            elif package.startswith("grpc"):
                component = "gRPC and compiler"
            elif package.startswith(("google", "protobuf")):
                component = "Protobuf"
            elif package.startswith(("astra", "proto_python")):
                component = "Astra SDK"
            else:
                component = "Python packaging dependencies"
        totals[component] = totals.get(component, 0) + path.stat().st_size
    return totals
