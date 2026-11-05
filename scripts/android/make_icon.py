#!/usr/bin/env python3
"""Genera los iconos de la app Android a partir del maestro scripts/android/icon_1024.png (requiere Pillow).

Salidas en mobile/android/app/src/main/res/mipmap-<densidad>/ic_launcher.png:
mdpi 48 px, hdpi 72 px, xhdpi 96 px, xxhdpi 144 px, xxxhdpi 192 px.

Uso, desde cualquier directorio:
    python3 scripts/android/make_icon.py
"""

from pathlib import Path

from PIL import Image

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
MASTER_PATH = SCRIPT_DIR / "icon_1024.png"
RES_DIR = REPO_ROOT / "mobile" / "android" / "app" / "src" / "main" / "res"
DENSITIES = [("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)]


def main():
    master = Image.open(MASTER_PATH).convert("RGB")
    for density, size in DENSITIES:
        target = RES_DIR / f"mipmap-{density}" / "ic_launcher.png"
        master.resize((size, size), Image.LANCZOS).save(target, optimize=True)
        print(f"{target.relative_to(REPO_ROOT)} ({size} px)")


if __name__ == "__main__":
    main()
