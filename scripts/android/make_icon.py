#!/usr/bin/env python3
"""Genera el icono de la app Android sin dependencias (solo zlib, struct y math).

Dibuja una nota musical en color cálido (#e0b26a) sobre fondo oscuro (#14161c).
Cada tamaño se dibuja directamente a su resolución, en lugar de reducir una imagen grande,
así las líneas quedan nítidas en todas las densidades. Los bordes se suavizan con la
distancia a la figura (antialiasing por cobertura).

Salidas:
  - scripts/android/icon_1024.png: maestro de 1024 px (también sirve para la ficha de la tienda).
  - mobile/android/app/src/main/res/mipmap-<densidad>/ic_launcher.png con estos tamaños:
    mdpi 48 px, hdpi 72 px, xhdpi 96 px, xxhdpi 144 px, xxxhdpi 192 px.

Uso, desde cualquier directorio:
    python3 scripts/android/make_icon.py
"""

import math
import struct
import zlib
from pathlib import Path

BACKGROUND = (0x14, 0x16, 0x1C)  # #14161c
NOTE = (0xE0, 0xB2, 0x6A)  # #e0b26a

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
MASTER_PATH = SCRIPT_DIR / "icon_1024.png"
RES_DIR = REPO_ROOT / "mobile" / "android" / "app" / "src" / "main" / "res"
MASTER_SIZE = 1024
DENSITIES = [("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)]


def dist_to_segment(px, py, ax, ay, bx, by):
    """Distancia de un punto a un segmento."""
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    length_sq = vx * vx + vy * vy
    t = 0.0 if length_sq == 0.0 else max(0.0, min(1.0, (wx * vx + wy * vy) / length_sq))
    return math.hypot(wx - t * vx, wy - t * vy)


def ellipse_sdf(cx, cy, rx, ry, angle):
    """Distancia con signo (negativa dentro) a una elipse girada. Aproximada, suficiente para AA."""
    cos_a, sin_a = math.cos(angle), math.sin(angle)
    r_min = min(rx, ry)

    def sdf(px, py):
        dx, dy = px - cx, py - cy
        x = dx * cos_a + dy * sin_a
        y = -dx * sin_a + dy * cos_a
        k = math.sqrt((x / rx) ** 2 + (y / ry) ** 2)
        return (k - 1.0) * r_min

    return sdf


def box_sdf(cx, cy, half_w, half_h):
    """Distancia con signo a un rectángulo alineado con los ejes."""

    def sdf(px, py):
        return max(abs(px - cx) - half_w, abs(py - cy) - half_h)

    return sdf


def stroke_sdf(points, radius):
    """Distancia con signo a una línea gruesa que pasa por los puntos."""
    segments = list(zip(points, points[1:]))

    def sdf(px, py):
        nearest = min(dist_to_segment(px, py, ax, ay, bx, by) for (ax, ay), (bx, by) in segments)
        return nearest - radius

    return sdf


def quad_bezier(p0, p1, p2, steps):
    """Puntos de una curva cuadrática de Bézier."""
    points = []
    for i in range(steps + 1):
        t = i / steps
        u = 1.0 - t
        x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0]
        y = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]
        points.append((x, y))
    return points


def note_shapes(size):
    """Figuras de la nota en píxeles: cada una con su función de distancia y su caja de búsqueda."""
    s = float(size)

    # Cabeza de la nota: elipse girada hacia la izquierda.
    cx, cy, rx, ry = 0.43 * s, 0.65 * s, 0.135 * s, 0.095 * s
    reach = max(rx, ry) + 2
    head = (ellipse_sdf(cx, cy, rx, ry, math.radians(-24)), (cx - reach, cy - reach, cx + reach, cy + reach))

    # Plica: rectángulo vertical que sube desde la cabeza.
    stem_x, stem_top, stem_bottom, half_w = 0.532 * s, 0.235 * s, 0.65 * s, 0.027 * s
    stem_cy = (stem_top + stem_bottom) / 2.0
    stem_hy = (stem_bottom - stem_top) / 2.0
    stem = (
        box_sdf(stem_x, stem_cy, half_w, stem_hy),
        (stem_x - half_w - 2, stem_top - 2, stem_x + half_w + 2, stem_bottom + 2),
    )

    # Corchea: línea curva que sale de lo alto de la plica.
    radius = 0.026 * s
    points = quad_bezier(
        (stem_x, stem_top + radius),
        (stem_x + 0.19 * s, stem_top),
        (stem_x + 0.12 * s, stem_top + 0.27 * s),
        36,
    )
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    flag = (
        stroke_sdf(points, radius),
        (min(xs) - radius - 2, min(ys) - radius - 2, max(xs) + radius + 2, max(ys) + radius + 2),
    )
    return [head, stem, flag]


def render(size):
    """Devuelve los píxeles RGB (bytes, por filas) del icono de `size` x `size`."""
    total = size * size
    coverage = [0.0] * total
    for sdf, (x0, y0, x1, y1) in note_shapes(size):
        left = max(0, int(math.floor(x0)))
        top = max(0, int(math.floor(y0)))
        right = min(size - 1, int(math.ceil(x1)))
        bottom = min(size - 1, int(math.ceil(y1)))
        for y in range(top, bottom + 1):
            py = y + 0.5
            row = y * size
            for x in range(left, right + 1):
                value = 0.5 - sdf(x + 0.5, py)
                if value > 0.0:
                    value = min(value, 1.0)
                    if value > coverage[row + x]:
                        coverage[row + x] = value

    pixels = bytearray(bytes(BACKGROUND) * total)
    for index, value in enumerate(coverage):
        if value > 0.0:
            offset = index * 3
            for channel in range(3):
                background = BACKGROUND[channel]
                note = NOTE[channel]
                pixels[offset + channel] = int(round(background + (note - background) * value))
    return bytes(pixels)


def png_bytes(size, pixels):
    """Codifica un PNG RGB de 8 bits, sin filtros, con zlib y struct."""
    stride = size * 3
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filtro 0: sin filtrar
        raw.extend(pixels[y * stride:(y + 1) * stride])

    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    # Cabecera: ancho, alto, 8 bits por canal, tipo 2 (RGB), compresión 0, filtro 0, sin entrelazado.
    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def main():
    MASTER_PATH.write_bytes(png_bytes(MASTER_SIZE, render(MASTER_SIZE)))
    print(f"maestro: {MASTER_PATH.relative_to(REPO_ROOT)} ({MASTER_SIZE} px)")
    for name, size in DENSITIES:
        target = RES_DIR / f"mipmap-{name}" / "ic_launcher.png"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(png_bytes(size, render(size)))
        print(f"{target.relative_to(REPO_ROOT)} ({size} px)")


if __name__ == "__main__":
    main()
