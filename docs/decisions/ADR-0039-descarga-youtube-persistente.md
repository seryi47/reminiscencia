# ADR-0039: La descarga de YouTube en la APK es persistente y se reanuda sola

- Estado: aceptada (2026-11-10). Lógica con pruebas headless; el «sobrevive a que Android cierre la app» se verifica en un dispositivo real.
- Fecha: 2026-11-10.
- Relacionadas: [ADR-0021](ADR-0021-buscar-en-youtube.md) (buscar y descargar de YouTube), [ADR-0017](ADR-0017-subida-directa-github-web-publica.md) (la cola de subidas, ya persistente), [ADR-0033](ADR-0033-descargas-y-subidas-en-movil.md) (descargas y subidas en el móvil).

## Contexto

En la APK, «Descargar» una canción de «En YouTube» lanza el mismo flujo que Homeostasia: convertir en el proxy (yttowav) → descargar el WAV → entregarlo a la cola de subidas, que lo publica en la biblioteca.

El usuario reportó que, si sale de Buscar antes de que termine (cambiando de pestaña o mandando la app a segundo plano), la descarga «se interrumpe» y al volver queda «como si nunca hubiera descargado nada».

Diagnóstico: la mitad de «importar» (convertir + descargar el WAV) vivía **solo en memoria** (en el singleton `youtubeDownloads`). El cambio de pestaña no la corta (las pestañas son `IndexedStack`, que mantiene el estado, y la importación no lleva token de cancelación), pero cuando Android **mata el proceso** —habitual al mandar la app a segundo plano, y en móviles agresivos incluso con cambios de pantalla bajo presión de memoria— ese estado se pierde entero y **nada lo reanuda**. La mitad de «subir» ya era persistente (`UploadsStore`, `uploads.restore()` al arrancar) y seguía la canción hasta publicarla; el hueco estaba solo en la mitad de «importar».

## Decisión

Hacer la mitad de «importar» igual de persistente y auto-reanudable que la de «subir», reutilizando el mismo patrón.

- **`lib/youtube_imports_store.dart` (nuevo):** guarda las importaciones **en curso** (id, URL, título, artista, duración) en `biblioteca-local/importaciones-youtube/importaciones.json`. Mismo patrón que `UploadsStore`: índice JSON entero reescrito de forma atómica (temporal + rename) y en serie, lectura tolerante a entradas dañadas.
- **`YoutubeDownloads` (`lib/ui/youtube_results.dart`):**
  - `start()` anota la importación en el índice **al empezar** (antes del trabajo largo) y la **borra al entregar** el WAV a la cola de subidas (o al terminar en error). La escritura es «best-effort» y no bloquea el inicio (`unawaited`): si falla (p. ej. sin `path_provider` en pruebas), la descarga sigue igual, solo no se podría reanudar.
  - `restore(services)` lee el índice al abrir y reanuda las que quedaron a medias; es idempotente (una sola vez, y `start()` no duplica si ya está en curso). El importer ya guardaba el `jobId` de conversión, así que al reanudar re-sondea en vez de convertir de cero.
- **`home_shell` (arranque):** tras `library.ensureLoaded()`, llama a `youtubeDownloads.restore(services)`, junto a la reanudación de subidas y ediciones.

Así: si Android cierra la app a media descarga, al volver a abrir la importación **se reanuda sola** hasta entregarse a la cola de subidas, que la publica en la biblioteca. Una importación interrumpida por un cierre nunca llega a «éxito» ni a «error», así que queda en el índice y se retoma; una que falla de verdad se limpia del índice (no se reintenta en bucle).

## Consecuencias

- La descarga de YouTube ya no se pierde «como si nunca hubiera pasado» al cerrarse la app; termina en cuanto la app vuelve a abrirse (o antes, si no llega a cerrarse).
- **No añade servicio en primer plano** (no se añade dependencia nativa a ciegas). Con la app en primer plano la descarga termina en el momento; si el sistema la cierra estando en segundo plano, se completa al reabrir, no mientras está cerrada. Un servicio en primer plano para terminar también en segundo plano queda como posible mejora futura (`- [ ]`).
- Versión de la APK: 1.2.7+11.
- **Pruebas:** `test/youtube_imports_store_test.dart` (ida y vuelta, reemplazo, tolerancia a datos dañados) y `test/youtube_background_download_test.dart` (mientras descarga queda guardada en disco; `restore` reanuda lo guardado; `restore` solo una vez; al fallar se limpia del índice). Suite de móvil entera verde (595).
- **Pendiente de verificar en dispositivo:** que, efectivamente, al matar la app a media descarga y reabrir, la canción acaba apareciendo en Tu biblioteca. No es verificable sin un teléfono.

## Pitfalls (trampas)

- La persistencia es «best-effort» y `unawaited`: si se hiciera bloqueante (`await`) en el camino caliente, desplaza el *timing* de las pruebas de widget (el `pumpAndSettle` no drena el fallo de `path_provider` sin mock) y rompe tests que ya existían.
- `restore()` carga **todas** las entradas en memoria antes de reanudarlas: si no, la primera en terminar reescribiría el índice (que vuelca el mapa en memoria) y borraría las demás.
- El cambio de pestaña NO era la causa (IndexedStack mantiene el estado); no «arreglar» cancelaciones que no existen. La causa es el cierre del proceso y la falta de persistencia.
