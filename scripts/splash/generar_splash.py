"""Genera los dibujos de la pantalla de apertura de la APK (ADR-0035).

Una sola geometría produce los dos VectorDrawable de Android, para que se vean nítidos en cualquier densidad y tamaño
de pantalla sin deformarse ni recortarse:

  mobile/android/app/src/main/res/drawable/splash_mark.xml      el emblema (viewport 108; todo cabe en el círculo de
                                                                 radio 36 que Android 12+ deja ver del icono)
  mobile/android/app/src/main/res/drawable/splash_wordmark.xml  «Reminiscencia» en Figtree ExtraBold (OFL) a trazos,
                                                                 en la caja de marca de 200x80 dp de Android 12+

Concepto del emblema: un disco que suena y cuyo eco se desvanece (reminiscencia: el recuerdo de una música). Centro
verde macizo con el agujero del disco y tres ondas abiertas, cada una más tenue, más fina y más girada que la
anterior: el disco gira y el sonido se aleja. Colores de la app (lib/theme.dart): verde #1FDF64 sobre #121212.

Uso (desde la raíz del repositorio; necesita fontTools, «pip install fonttools»):
    python3 scripts/splash/generar_splash.py
    python3 scripts/splash/generar_splash.py --vista-previa /ruta/carpeta   # además, SVG y un HTML para revisarlo

backend/tests/test_splash.py comprueba que los ficheros del repositorio coinciden con lo que genera este script.
"""

import argparse
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FONT = ROOT / "mobile" / "assets" / "fonts" / "Figtree-ExtraBold.ttf"
DRAWABLE = ROOT / "mobile" / "android" / "app" / "src" / "main" / "res" / "drawable"

GREEN = "#1FDF64"
BACKGROUND = "#121212"
NAME = "Reminiscencia"
CENTER = 54.0  # centro del viewport 108
SAFE_RADIUS = 36.0  # Android 12+ recorta el icono a un círculo de 2/3 del lado (160 dp de 240 dp)
WORDMARK_BOX = (200.0, 80.0)  # caja de la imagen de marca de Android 12+, en dp
WORDMARK_WIDTH = 176.0  # ancho del nombre dentro de la caja


def _polar(radius, degrees):
    angle = math.radians(degrees)
    return CENTER + radius * math.cos(angle), CENTER + radius * math.sin(angle)


def _arc(radius, start, sweep):
    x1, y1 = _polar(radius, start)
    x2, y2 = _polar(radius, start + sweep)
    large = 1 if sweep > 180 else 0
    return f"M{x1:.3f},{y1:.3f} A{radius},{radius} 0 {large} 1 {x2:.3f},{y2:.3f}"


def _disc(outer, inner):
    """Disco con agujero central: dos circunferencias en un único trazado (regla evenOdd)."""
    def circle(radius):
        return (f"M{CENTER - radius:.3f},{CENTER} A{radius},{radius} 0 1 1 {CENTER + radius:.3f},{CENTER} "
                f"A{radius},{radius} 0 1 1 {CENTER - radius:.3f},{CENTER} Z")
    return circle(outer) + " " + circle(inner)


def _wave(radius, gap_center, gap, width, opacity):
    """Onda abierta: el hueco (en grados) centrado en gap_center; el arco es el resto de la circunferencia."""
    return radius, gap_center + gap / 2, 360 - gap, width, opacity


CORE = _disc(13.0, 3.2)
# Los huecos giran en el sentido de las agujas del reloj de dentro afuera.
WAVES = (
    _wave(19.0, -70, 64, 3.6, 1.00),
    _wave(25.5, -25, 78, 3.2, 0.60),
    _wave(32.0, 20, 96, 2.8, 0.30),
)


def outermost_extent():
    """Radio máximo que ocupa el emblema (onda más externa más medio trazo)."""
    return max(radius + width / 2 for radius, _, _, width, _ in WAVES)


def mark_vector():
    lines = [
        '<?xml version="1.0" encoding="utf-8"?>',
        "<!-- Emblema de la pantalla de apertura (ADR-0035). Generado por scripts/splash/generar_splash.py: no editar",
        "     a mano. Viewport 108; todo cabe en el círculo de radio 36 que Android 12+ deja ver del icono. -->",
        '<vector xmlns:android="http://schemas.android.com/apk/res/android"',
        '    android:width="108dp"',
        '    android:height="108dp"',
        '    android:viewportWidth="108"',
        '    android:viewportHeight="108">',
        "    <path",
        f'        android:fillColor="{GREEN}"',
        '        android:fillType="evenOdd"',
        f'        android:pathData="{CORE}" />',
    ]
    for radius, start, sweep, width, opacity in WAVES:
        lines += [
            "    <path",
            '        android:fillColor="#00000000"',
            f'        android:strokeColor="{GREEN}"',
            f'        android:strokeWidth="{width}"',
            f'        android:strokeAlpha="{opacity}"',
            '        android:strokeLineCap="round"',
            f'        android:pathData="{_arc(radius, start, sweep)}" />',
        ]
    lines.append("</vector>")
    return "\n".join(lines) + "\n"


def mark_svg(size, background=True):
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="{size}" height="{size}">']
    if background:
        parts.append(f'<rect width="108" height="108" fill="{BACKGROUND}"/>')
    parts.append(f'<path d="{CORE}" fill="{GREEN}" fill-rule="evenodd"/>')
    for radius, start, sweep, width, opacity in WAVES:
        parts.append(f'<path d="{_arc(radius, start, sweep)}" fill="none" stroke="{GREEN}" stroke-width="{width}" '
                     f'stroke-linecap="round" stroke-opacity="{opacity}"/>')
    parts.append("</svg>")
    return "".join(parts)


def _name_outline(font_path):
    """El nombre en trazos (y hacia abajo) y su caja real. fontTools solo hace falta aquí: el emblema no lo usa."""
    from fontTools.pens.boundsPen import BoundsPen
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen
    from fontTools.ttLib import TTFont

    font = TTFont(font_path)
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    metrics = font["hmtx"]
    path_pen = SVGPathPen(glyphs)
    bounds_pen = BoundsPen(glyphs)
    x = 0
    for char in NAME:
        glyph = cmap[ord(char)]
        for pen in (path_pen, bounds_pen):
            glyphs[glyph].draw(TransformPen(pen, (1, 0, 0, -1, x, 0)))
        x += metrics[glyph][0]
    return path_pen.getCommands(), bounds_pen.bounds


def _wordmark_layout(font_path):
    commands, (x_min, y_min, x_max, y_max) = _name_outline(font_path)
    box_w, box_h = WORDMARK_BOX
    scale = WORDMARK_WIDTH / (x_max - x_min)
    offset_x = (box_w - (x_max - x_min) * scale) / 2 - x_min * scale
    offset_y = (box_h - (y_max - y_min) * scale) / 2 - y_min * scale
    return commands, scale, offset_x, offset_y


def wordmark_vector(font_path=FONT):
    commands, scale, offset_x, offset_y = _wordmark_layout(font_path)
    box_w, box_h = WORDMARK_BOX
    lines = [
        '<?xml version="1.0" encoding="utf-8"?>',
        "<!-- «Reminiscencia» (Figtree ExtraBold, SIL OFL 1.1) a trazos para la pantalla de apertura (ADR-0035).",
        "     Generado por scripts/splash/generar_splash.py: no editar a mano. Caja de marca de Android 12+: 200x80 dp. -->",
        '<vector xmlns:android="http://schemas.android.com/apk/res/android"',
        f'    android:width="{box_w:.0f}dp"',
        f'    android:height="{box_h:.0f}dp"',
        f'    android:viewportWidth="{box_w:.0f}"',
        f'    android:viewportHeight="{box_h:.0f}">',
        "    <group",
        f'        android:translateX="{offset_x:.4f}"',
        f'        android:translateY="{offset_y:.4f}"',
        f'        android:scaleX="{scale:.6f}"',
        f'        android:scaleY="{scale:.6f}">',
        "        <path",
        '            android:fillColor="#FFFFFFFF"',
        f'            android:pathData="{commands}" />',
        "    </group>",
        "</vector>",
    ]
    return "\n".join(lines) + "\n"


def wordmark_svg(font_path=FONT):
    commands, scale, offset_x, offset_y = _wordmark_layout(font_path)
    box_w, box_h = WORDMARK_BOX
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {box_w:.0f} {box_h:.0f}" width="{box_w:.0f}" '
            f'height="{box_h:.0f}"><g transform="translate({offset_x:.4f} {offset_y:.4f}) scale({scale:.6f})">'
            f'<path d="{commands}" fill="#fff"/></g></svg>')


def preview_html(font_path=FONT):
    """Simula la pantalla de apertura de Android 12+ en varios tamaños: icono de 240 dp centrado (se ve el círculo
    de 160 dp) y la marca de 200x80 dp abajo, a 60 dp del borde."""
    icon = mark_svg(240, background=False)
    name = wordmark_svg(font_path)

    def phone(width, height, label):
        return (f'<figure style="margin:0"><div style="position:relative;width:{width}px;height:{height}px;'
                f'background:{BACKGROUND};border-radius:24px;overflow:hidden;box-shadow:0 0 0 2px #333">'
                f'<div style="position:absolute;left:{(width - 240) / 2}px;top:{(height - 240) / 2}px;width:240px;'
                f'height:240px;clip-path:circle(80px at 120px 120px)">{icon}</div>'
                f'<div style="position:absolute;left:{(width - 200) / 2}px;bottom:60px;width:200px;height:80px">'
                f'{name}</div></div><figcaption style="color:#aaa;font:12px sans-serif;margin-top:6px">{label} '
                f'({width}x{height} dp)</figcaption></figure>')

    return ('<!doctype html><meta charset="utf-8"><body style="background:#2b2b2b;margin:20px;display:flex;gap:24px;'
            'flex-wrap:wrap;align-items:flex-start">' + phone(320, 568, "Móvil pequeño") +
            phone(360, 800, "Móvil 1080x2400") + phone(412, 915, "Móvil grande") +
            phone(800, 1280, "Tableta") + "</body>")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--vista-previa", type=Path, help="carpeta donde dejar mark.svg, wordmark.svg e index.html")
    args = parser.parse_args()
    (DRAWABLE / "splash_mark.xml").write_text(mark_vector(), encoding="utf-8")
    (DRAWABLE / "splash_wordmark.xml").write_text(wordmark_vector(), encoding="utf-8")
    print(f"Escritos {DRAWABLE / 'splash_mark.xml'} y {DRAWABLE / 'splash_wordmark.xml'}")
    if args.vista_previa:
        args.vista_previa.mkdir(parents=True, exist_ok=True)
        (args.vista_previa / "mark.svg").write_text(mark_svg(432), encoding="utf-8")
        (args.vista_previa / "wordmark.svg").write_text(wordmark_svg(), encoding="utf-8")
        (args.vista_previa / "index.html").write_text(preview_html(), encoding="utf-8")
        print(f"Vista previa en {args.vista_previa / 'index.html'}")


if __name__ == "__main__":
    main()
