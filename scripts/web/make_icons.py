#!/usr/bin/env python3
"""Genera los iconos PWA de la web de Reminiscencia sin dependencias (solo zlib, struct y math).

Reutiliza el dibujo de la nota musical de scripts/android/make_icon.py: nota en #e0b26a sobre
fondo #0c0d10 (el color de fondo del manifiesto). Cada tamaño se dibuja a su resolución y los
bordes se suavizan por cobertura.

Salidas en frontend/web/icons/:
  - icon-192.png           192 px, purpose "any".
  - icon-512.png           512 px, purpose "any".
  - icon-maskable-512.png  512 px, purpose "maskable": la nota se reduce al 80 % para quedar
                           dentro del círculo de seguridad (80 % del lado).

Uso, desde cualquier directorio:
    python3 scripts/web/make_icons.py
"""

import math
import struct
import zlib
from pathlib import Path

BACKGROUND = (0x0C, 0x0D, 0x10)  # #0c0d10
NOTE = (0xE0, 0xB2, 0x6A)  # #e0b26a

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
ICONS_DIR = REPO_ROOT / "frontend" / "web" / "icons"

# (nombre de fichero, lado en píxeles, escala de la nota)
ICONS = [
    ("icon-192.png", 192, 1.0),
    ("icon-512.png", 512, 1.0),
    ("icon-maskable-512.png", 512, 0.8),
]


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


def note_shapes(size, scale):
    """Figuras de la nota en píxeles, cada una con su función de distancia y su caja de búsqueda.

    El diseño usa coordenadas normalizadas (0 a 1). `scale` reduce la nota hacia el centro.
    """
    s = float(size)

    def x_px(u):
        return (0.5 + (u - 0.5) * scale) * s

    def y_px(v):
        return (0.5 + (v - 0.5) * scale) * s

    def length(v):
        return v * scale * s

    # Cabeza de la nota: elipse girada hacia la izquierda.
    cx, cy = x_px(0.43), y_px(0.65)
    rx, ry = length(0.135), length(0.095)
    reach = max(rx, ry) + 2
    head = (ellipse_sdf(cx, cy, rx, ry, math.radians(-24)), (cx - reach, cy - reach, cx + reach, cy + reach))

    # Plica: rectángulo vertical que sube desde la cabeza.
    stem_x = x_px(0.532)
    stem_top, stem_bottom = y_px(0.235), y_px(0.65)
    half_w = length(0.027)
    stem_cy = (stem_top + stem_bottom) / 2.0
    stem_hy = (stem_bottom - stem_top) / 2.0
    stem = (
        box_sdf(stem_x, stem_cy, half_w, stem_hy),
        (stem_x - half_w - 2, stem_top - 2, stem_x + half_w + 2, stem_bottom + 2),
    )

    # Corchea: curva que sale de lo alto de la plica.
    radius = length(0.026)
    points = quad_bezier(
        (stem_x, stem_top + radius),
        (stem_x + length(0.19), stem_top),
        (stem_x + length(0.12), stem_top + length(0.27)),
        36,
    )
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    flag = (
        stroke_sdf(points, radius),
        (min(xs) - radius - 2, min(ys) - radius - 2, max(xs) + radius + 2, max(ys) + radius + 2),
    )
    return [head, stem, flag]


def render(size, scale):
    """Devuelve los píxeles RGB (bytes, por filas) del icono de `size` x `size`."""
    total = size * size
    coverage = [0.0] * total
    for sdf, (x0, y0, x1, y1) in note_shapes(size, scale):
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

    pixels = bytearray(total * 3)
    for index, value in enumerate(coverage):
        offset = index * 3
        for channel in range(3):
            background = BACKGROUND[channel]
            pixels[offset + channel] = int(round(background + (NOTE[channel] - background) * value))
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
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    for name, size, scale in ICONS:
        target = ICONS_DIR / name
        target.write_bytes(png_bytes(size, render(size, scale)))
        print(f"{target.relative_to(REPO_ROOT)} ({size} px, escala {scale})")


if __name__ == "__main__":
    main()
