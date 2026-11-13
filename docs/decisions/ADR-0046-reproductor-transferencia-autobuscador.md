# ADR-0046: Reproductor fluido, transferencias sin truncar, autobuscador autónomo y comparación con la biblioteca

- Estado: **implementada y probada** (2026-11-13). Suites verdes: web `node --test tests/web-unit/*.test.mjs` 1016/1016; APK `flutter test` 620/620. Falta la verificación en vivo del usuario (dispositivo real + Spotify real), que no se puede hacer desde el entorno de desarrollo.
- Fecha: 2026-11-13.
- Relacionadas: [ADR-0036](ADR-0036-estabilidad-del-reproductor.md) (estabilidad del reproductor), [ADR-0044](ADR-0044-transferir-musica-desde-spotify.md) (Transferir música), [ADR-0045](ADR-0045-apk-conversor-directo.md) (APK conversor directo), [ADR-0026](ADR-0026-albumes-orden-seleccion-duplicados.md) (regla de duplicados), [ADR-0028](ADR-0028-contrato-comun-y-busqueda.md) (normalización común), [ADR-0031](ADR-0031-audio-por-el-worker.md) (direcciones de audio).

## Contexto

Cuatro problemas reportados por el usuario, atacados como partes de un mismo sistema sin que el arreglo de uno perjudique a otro.

1. **El cambio de canción en la APK se quedaba mostrando la canción anterior varios segundos.**
2. **Muchas canciones transferidas salían de unos segundos o un minuto** cuando deberían durar varios minutos (descargas truncadas aceptadas como válidas).
3. **El autobuscador (Transferir música) obligaba a buscar a mano** demasiadas canciones.
4. **La comparación con la biblioteca daba falsos «faltan»**: una canción que ya tienes aparecía como pendiente por diferencias menores de metadatos; y no mostraba un número claro de total/tengo/faltan.

Causas reales encontradas (auditoría del código, no suposiciones):

- **(1) Reproductor APK.** Los metadatos (`mediaItem` → `_now`) solo se actualizaban desde `currentIndexStream` de just_audio (`sonidos_audio_handler.dart`), que no emite hasta que la siguiente fuente ha transitado/bufferizado. No había publicación optimista en `playNext`/`playPrevious`. (La web ya actualiza el texto al instante; solo la portada va con algo de retraso por no prefetch, que no se cambia aquí.)
- **(2) Transferencias.** La duración REAL del audio descargado nunca se comparaba con la esperada; es más, la duración esperada se descartaba antes de descargar (`YoutubeTrack` no la llevaba; `selectedTransferTracks` la tiraba). Un WAV truncado se convertía en un Opus corto perfectamente «válido» y se aceptaba. Sin salto a otro candidato cuando salía corto.
- **(3) Autobuscador.** El resolver usaba **una sola consulta** (`youtubeQueryFor`, «artista título») y, si el primer candidato no cuadraba, caía a revisión manual: ni probaba otras formulaciones ni otro candidato automáticamente.
- **(4) Comparación.** Se reutilizaba la regla estricta de duplicados (±2 s, sin quitar «remaster»/versión del título ni `feat.` del artista), que da falsos «faltan»; el panel no mostraba el total ni se deduplicaba el conteo entre listas.

## Decisión

### 1. Reproductor APK: publicación optimista al cambiar de canción

`sonidos_audio_handler.dart`: `playNext`/`playPrevious` publican YA la metadata de la canción de destino (`_publishIndexOptimistically`, usando `nextIndex`/`previousIndex` de just_audio, que respetan el aleatorio y la repetición) **antes** de pedir el salto. `currentIndexStream` confirma o corrige el índice real cuando la transición termina (no se toca `_lastIndex`, que lo gobierna ese stream). Así el título, el artista y la portada cambian al instante en lugar de quedarse con la canción anterior mientras se bufferiza la siguiente. No cambia la reproducción ni la estabilidad de ADR-0036.

### 2. Transferencias: validación anti-truncado + salto a otro candidato

- `YoutubeTrack` lleva ahora `expectedDurationS` (duración esperada, exacta de Spotify) y `alternatives` (otras URLs candidatas). `selectedTransferTracks` (APK) las rellena a partir de la coincidencia de Spotify.
- Tras descargar el WAV, `_convertAndDownload` mide su **duración real a partir de los bytes reales** del fichero (`_wavDurationS`: `byteRate` del trozo `fmt ` y tamaño real del trozo `data`, sin fiarse de la cabecera RIFF, que yttowav puede falsear al transmitir). Si la duración sale por debajo de `expectedDurationS * kYoutubeMinDurationRatio` (0,70, con suelo de 60 s para no tocar interludios cortos) se considera truncada.
- Si queda otro candidato, salta al siguiente automáticamente; si no, la pista **falla** (no se entrega un audio inservible: en un lote se omite, en una sola se muestra el error). El margen es amplio a propósito para no rechazar ediciones legítimas (un «radio edit» difiere un 10-20 %, no un 70 %).
- Límite conocido: la importación de **playlists de YouTube** y la descarga manual por búsqueda no tienen duración de referencia (el proxy de playlist no la da), así que ahí sigue valiendo solo el chequeo de bytes (Content-Length/RIFF), no el de duración.

### 3. Autobuscador: varias consultas y degradado automático

- `spotify-core.js`: `youtubeQueriesFor` devuelve varias variantes de la más precisa a la más amplia: «artista principal + título», «todos los artistas + título» (solo si hay colaboración) y «título solo». `youtubeQueryFor` es la primera (compatibilidad).
- `spotify-resolve.js`: el resolver prueba las variantes (hasta `maxQueries`, 2 por defecto) **acumulando candidatos** y clasificando sobre la unión; para en cuanto hay una coincidencia ALTA (no gasta llamadas de más: YouTube Music limita en listas largas). Solo si TODAS las variantes fallan por red y no se juntó ni un candidato queda en baja con error.
- El **salto a otro candidato** cuando el elegido sale truncado lo hace la APK (punto 2) consumiendo las `alternatives` que el resolver ya devuelve; con varias variantes esas alternativas son más y mejores.

### 4. Comparación con la biblioteca: regla tolerante + contador explícito

- **Regla de presencia tolerante** (nueva, `frontend/web/js/library-match.js` y `mobile/lib/library_match.dart`, con contrato común `tests/contrato/biblioteca-match.json`), separada de la regla de duplicados (ADR-0026) para no tocar ese contrato. Parte del título ya normalizado de duplicados (sin ruido ni `feat`) y, encima, quita las etiquetas NEUTRAS (misma grabación: remaster, radio edit…) pero CONSERVA las de versión (live, remix, acústico…). Coincide si la clave de título es igual y no vacía y, además: si ambos artistas se conocen, deben solaparse (tolera `feat` y acentos); si a alguno le falta, decide la duración (±8 s) o, sin ella, basta el título. Así deja de contar como «falta» una canción que ya tienes por un «Remastered», un `feat.` o unos segundos de diferencia, sin confundir una versión en directo con la de estudio ni dos canciones distintas de artistas distintos con el mismo título.
- **Contador explícito** (`transferStats` en `spotify-transfer.js`, con prueba): por álbum, **total, cuántas ya tienes y cuántas faltan**; y el total global de «faltan» **sin contar dos veces** una misma canción que aparezca en varias listas. La web (`views/transferir.js`) y la APK (`ui/spotify_transfer_page.dart`) lo muestran («Faltan N de M · ya tienes K»).
- **Comparación automática al abrir** (sin transferir): modo `compareOnly` en `/api/spotify/resolve` (lista las pistas SIN resolver YouTube) + `compareCollection` (web y APK). Al abrir el panel, cada lista/álbum propio muestra «Faltan K de N» solo, en segundo plano y con caché (web: concurrencia 2; APK: cola acotada a 2). Ya no hace falta pulsar «Analizar» para ver qué falta.
- **Actualización en vivo**: al terminar una transferencia completa, esas canciones se marcan como «ya la tienes» (conjunto `transferredKeys`, aunque tarden en publicarse) y se vacía la caché de recuentos, así el navegador recalcula «faltan» al momento. `analyzeSelected`/`_analyze` también lo respetan.

## Consecuencias

- **Pruebas nuevas/ampliadas:**
  - APK: `youtube_importer_test.dart` (salto a otro candidato por truncado, truncado sin alternativa que falla, íntegra que no se rechaza); `audio_handler_test.dart` (metadata inmediata en siguiente/anterior, con un fake que retiene `currentIndexStream`); `library_match_test.dart` (contrato de presencia). `fake_audio_player.dart` gana `nextIndex`/`previousIndex`/`seekToPrevious` y un modo de retención del stream de índice.
  - Web: `spotify-core.test.mjs` (variantes de consulta), `spotify-resolve.test.mjs` (recuperación con 2.ª variante, parada en ALTA, acumulación de candidatos), `library-match.test.mjs` (contrato), `spotify-transfer.test.mjs` (`transferStats`).
- **Ampliación (2026-11-13, misma tanda):** se completaron los puntos que antes quedaban fuera:
  - Comparación **automática al abrir** cada lista/álbum (compareOnly), ya no hace falta «Analizar» para ver el recuento.
  - **Actualización en vivo** del recuento tras una transferencia completa.
  - **Prefetch de portada** de la canción vecina en la web (`prefetchNeighbors` en `player.js`): al saltar, la portada ya está en caché.
  - **Validación de duración en la descarga manual** de YouTube: el buscador pasa la duración del resultado como referencia (`importPlaylist(..., expectedDurationS)`). Las **playlists reales** siguen sin validar porque el proxy no da duración por pista (límite real documentado).
- **Qué NO se ha hecho (honestidad):**
  - El recuento «en vivo» se actualiza al **terminar** la transferencia, no pista a pista mientras descarga (durante la descarga el usuario está en la pantalla de progreso, no en el navegador de listas).
  - Las **playlists de YouTube** (no las de Spotify) siguen sin validación de duración (sin duración de referencia por pista).
- `SHELL_VERSION` 45 → 46 (nuevo módulo `js/library-match.js` en el shell offline).
- **Auditoría (2026-11-13):** revisión completa del diff. 5 hallazgos, todos corregidos y con pruebas: (1) la clave de título quitaba el grupo entero y se llevaba por delante un «Live» pegado a «Remastered» → ahora quita solo la etiqueta neutra (con su año) y conserva la versión; (2) el solape de artista era demasiado laxo (un artista suelto encajaba como «feat» de otra canción del mismo título) → el mismo artista exacto vale siempre, el solape parcial exige que la duración cuadre; (3) el recuento al abrir no deduplicaba peticiones en curso y abría un pool por llamada → cola compartida con guardia de in-flight y tope global de 2; (4) «ya tienes» global contaba doble mientras «faltan» deduplicaba → ambos deduplican (web y APK); (5) el catálogo se leía dos veces al abrir → promesa memorizada.
- Verificación en vivo (dispositivo real + Spotify real + tanda grande) pendiente del usuario, como en ADR-0044/0045.
