"""Build script to prepare the Python sidecar for distribution."""

import os
import shutil
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SIDECAR_SRC = PROJECT_ROOT / "sidecar"
SIDECAR_DIST = PROJECT_ROOT / "sidecar" / "dist"


def clean():
    if SIDECAR_DIST.exists():
        shutil.rmtree(SIDECAR_DIST)


def copy_source():
    SIDECAR_DIST.mkdir(parents=True, exist_ok=True)

    for item in SIDECAR_SRC.iterdir():
        if item.name in ("__pycache__", "dist", ".pytest_cache"):
            continue
        dest = SIDECAR_DIST / item.name
        if item.is_dir():
            shutil.copytree(item, dest, ignore=shutil.ignore_patterns("__pycache__", ".pytest_cache"))
        else:
            shutil.copy2(item, dest)

    print(f"Sidecar source copied to {SIDECAR_DIST}")


def install_dependencies():
    """Install Python dependencies if needed."""
    req_file = SIDECAR_SRC / "requirements.txt"
    if not req_file.exists():
        print("No requirements.txt found, skipping dependency installation")
        return

    print("Installing Python dependencies...")
    try:
        subprocess.check_call([
            sys.executable, "-m", "pip", "install", "-r", str(req_file),
            "--quiet", "--no-deps"
        ])
        print("Dependencies installed")
    except subprocess.CalledProcessError as e:
        print(f"Warning: Failed to install all dependencies: {e}")


def verify():
    """Verify the sidecar can be imported."""
    server_path = SIDECAR_DIST / "server.py"
    if not server_path.exists():
        print(f"ERROR: {server_path} not found")
        sys.exit(1)

    print(f"Sidecar build complete at {SIDECAR_DIST}")


if __name__ == "__main__":
    clean()
    copy_source()
    if "--install-deps" in sys.argv:
        install_dependencies()
    else:
        print("Skipping dependency installation (use --install-deps to install ML packages)")
    verify()
