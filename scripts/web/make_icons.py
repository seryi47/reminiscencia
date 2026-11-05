#!/usr/bin/env python3
"""Genera los iconos PWA de la web a partir del maestro scripts/android/icon_1024.png (requiere Pillow).

Salidas en frontend/web/icons/:
  - icon-192.png           192 px, purpose "any".
  - icon-512.png           512 px, purpose "any".
  - icon-maskable-512.png  512 px, purpose "maskable": el maestro ocupa todo el lado y el rostro queda dentro
                           del círculo de seguridad (80 % central).

Uso, desde cualquier directorio:
    python3 scripts/web/make_icons.py
"""

from pathlib import Path

from PIL import Image

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
MASTER_PATH = REPO_ROOT / "scripts" / "android" / "icon_1024.png"
ICONS_DIR = REPO_ROOT / "frontend" / "web" / "icons"

# (nombre de fichero, lado en píxeles, escala del dibujo)
ICONS = [
    ("icon-192.png", 192, 1.0),
    ("icon-512.png", 512, 1.0),
    ("icon-maskable-512.png", 512, 1.0),
]


def main():
    master = Image.open(MASTER_PATH).convert("RGB")
    background = master.getpixel((4, 4))
    for name, size, scale in ICONS:
        inner = round(size * scale)
        art = master.resize((inner, inner), Image.LANCZOS)
        canvas = Image.new("RGB", (size, size), background)
        offset = (size - inner) // 2
        canvas.paste(art, (offset, offset))
        canvas.save(ICONS_DIR / name, optimize=True)
        print(f"{name} ({size} px, escala {scale})")


if __name__ == "__main__":
    main()
