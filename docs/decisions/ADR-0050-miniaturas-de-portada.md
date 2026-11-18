# ADR-0050 — Miniaturas 160×160 de portadas para listas

Fecha: 2026-11-18
Estado: Aceptado.

## Contexto

La portada pública de la biblioteca (ADR-0016) es un JPEG 640×640 (~15-70 KiB según la imagen). Se usa tal cual
en el reproductor a toda pantalla pero también en todas las listas: filas de 40-56 px de alto («Tu biblioteca»,
tabla de canciones, acceso rápido, resultados de búsqueda, mini-reproductor). En pantallas grandes se ven decenas
de filas a la vez: con lazy-loading se bajan ~10-20 portadas simultáneamente, entre 150 KiB y 1 MiB de ancho
de banda inicial que **no aportan nitidez**: a 40 px de alto el navegador tira el 99 % del detalle.

## Decisión

- El backend genera una **miniatura 160×160 JPEG** al lado de cada portada, en `audio-library/thumbs/<ID>.jpg`,
  derivada de la portada ya convertida (determinista, mismos bytes para la misma portada). Ahorro medido en una
  portada real: 17 KiB → 2.1 KiB (**-88 %**).
- `sonidos.publish.sync_public` las copia a `frontend/web/thumbs/<ID>.jpg` y añade un nuevo campo
  `"thumb": "thumbs/<ID>.jpg"` en `data/songs.json`, `data/folders.json` y `data/catalog.json`. El campo solo
  aparece cuando la miniatura se ha publicado: si la generación falla (ffmpeg ausente, portada corrupta), la canción
  queda publicada sin `thumb` y los clientes caen al `cover` (compatibilidad total).
- Autogeneración: si falta la miniatura al publicar (por ejemplo, portadas antiguas sin miniatura), se intenta
  generarla desde la portada existente. Así no hace falta un paso de migración.
- La web elige una u otra en cada componente según el tamaño real de render:
  - **Miniatura** (small=true): `library-cover` (48 px), `tile-cover` (48 px), `track-cover` (40 px),
    `top-cover` (92 px), `browse-cover` (56 px), `player-cover` (56 px), `mini-cover`, mosaicos 2×2.
  - **Portada** (640): `card-cover` (nitidez retina en tarjetas de 150-180 px), `collection-cover` (232 px),
    `now-cover` y `full-cover` (reproductor a toda pantalla).
- El service worker cachea las miniaturas en la **misma caché** que las portadas (`reminiscencia-portadas-v1`),
  con `staleWhileRevalidate`. Tope compartido de 300 entradas. Son derivadas del mismo contenido inmutable; no vale
  la pena una caché aparte.

## Alternativas descartadas

- **Reducir la portada 640 a 320**: mitad de contrato, rompe ADR-0016 y empeora la calidad del reproductor grande.
- **`srcset` + `sizes`**: deja al navegador la elección, pero requiere un `sizes` por componente y complica el
  código. La elección por componente es más fácil de razonar.
- **Cloudflare Images / transformación on-the-fly**: paga por imagen procesada; el Worker Free no la ofrece.
- **Thumbs vía Worker, servidor de imagen**: Workers no tiene ffmpeg; usar lavfi o WebAssembly dentro del Worker
  dispara el coste por CPU.

## Consecuencias

- Los clientes viejos (APK anterior a 1.4.10, cualquier versión que no entienda el campo) ignoran `thumb` y siguen
  usando `cover` → sin regresión.
- Las portadas de R2 (ADR-0029, índice de portadas del Worker) **no tienen miniatura**: el campo `thumb` del catálogo
  solo aparece para portadas de Git. Los clientes caen al cover para esas.
- La suite backend de pruebas (`tests/test_publish.py`) añade tres casos: thumb publicada y enlazada, portada
  corrupta → sin thumb sin romper publicación, limpieza al despublicar. Requieren `ffmpeg` en PATH para generar un
  JPEG 640×640 válido como fuente.
- APK: el `cover` sigue funcionando. Una futura versión podrá consumir `thumb` para listas y bajar su consumo de
  datos; cambio opcional, no bloqueante.
