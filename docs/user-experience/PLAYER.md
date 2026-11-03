# Reproductor de la web

**Estado:** describe `frontend/web/js/player.js` en `main` (`b058a0c`, 2026-11-03), con la interfaz sin usuarios de [ADR-0015](../decisions/ADR-0015-interfaz-sin-usuarios-aspecto-spotify.md). La interfaz visible del reproductor (barra de 72 px, minirreproductor y pantalla completa) está en [DESIGN.md](DESIGN.md), §9.

**Retirado:** el reproductor de ADR-0009 y su registro del estudio (modos paciente y cuidador, límite de volumen por perfil, arranque al 60 % con fundido, temporizador de apagado, bloqueo de pantalla, sesiones, presentaciones C0 a C2 y eventos `start`, `pause`, `track-end` y demás). Se borraron con ADR-0015 (decisión 9) y su descripción queda en el historial de git. La parte 2 de [AUDIO_ENGINE.md](../audio-processing/AUDIO_ENGINE.md) describe ese reproductor retirado.

## 1. Alcance

- `player.js` es un módulo sin dependencias y sin DOM. Recibe el elemento `<audio>` y, de forma opcional, los servicios del navegador (`env`: `navigator`, `MediaMetadata`, temporizadores y azar), así que se prueba en Node con dobles. Al crearse no suena nada.
- Lo crea `js/app.js` (`createPlayer`), con el volumen, el aleatorio y la repetición guardados en localStorage (`reminiscencia.reproductor`). La interfaz (`js/views/player-ui.js`) pinta el estado y llama a la API.
- No registra nada: no hay eventos de escucha ni datos del estudio.

## 2. Cola

- La cola es una secuencia de entradas `{ key, track, baseIndex, fromQueue }`: las canciones del contexto (carpeta, lista, «Me gusta», búsqueda…) en su orden o barajadas, y entre ellas las añadidas con «Añadir a la cola».
- **Añadir a la cola** (`addToQueue`): la canción suena justo después de la actual y de las ya añadidas, en orden de llegada. Sale de la cola al dejarla atrás. Si no hay nada cargado, la carga en pausa.
- **Cambiar de contexto** (`load`): lo añadido a la cola y aún no escuchado se conserva detrás de la primera canción del nuevo contexto.
- **Saltar a una entrada** (`playEntry(key)`): reproduce esa entrada de la cola.

## 3. Reglas de reproducción

| Caso | Comportamiento |
|---|---|
| Cargar | `load(tracks, startAt, { autoplay, contextId, contextName })` sustituye el contexto y, por defecto, empieza a sonar. `startAt` es el índice en `tracks`; `null` con aleatorio empieza por una al azar. Descarta los elementos sin `id`. |
| Siguiente | `next()` pasa a la siguiente disponible. Si sonaba (o esperaba tras un error), la nueva suena. |
| Fin de la canción | Con repetir «una», vuelve a empezar. Si no, pasa a la siguiente; al final de la cola sin repetir, se para y vuelve al principio de la canción actual. |
| Anterior | Si la canción lleva más de 3 s (`PREVIOUS_RESTART_SECONDS`), vuelve al principio. Si no, va a la anterior disponible; con repetir distinto de «no», la primera lleva a la última. |
| Repetir | `REPEAT_MODES`: `off`, `all` y `one`. `nextRepeatMode` alterna no → toda la cola → esta canción → no. |
| Aleatorio | `setShuffle(true)` deja la canción actual delante, después lo añadido a la cola y baraja el resto (Fisher-Yates, `shuffledIndexes`). `setShuffle(false)` vuelve al orden original desde la canción actual. |
| Volumen | `setVolume(0..1)` y `toggleMute()`. Silenciar pone el elemento a 0 sin perder el volumen. En iOS la propiedad `volume` es de solo lectura: `volumeAdjustable` vale false y la interfaz oculta el control. |
| Saltar | `seekTo(segundos)`, acotado a la duración cuando se conoce. |
| Sin conexión | Una canción no está disponible si no tiene `audioUrl` o si `isAvailable(track)` devuelve false o lanza un error. `js/app.js` la da por disponible con conexión, si es local o si su audio está en la caché. Las no disponibles se saltan con el aviso «Algunas canciones no están disponibles sin conexión y se han saltado.»; si no queda ninguna, «No hay canciones disponibles sin conexión.». |
| Error de audio | Avisa «No se puede reproducir esta canción. Pasamos a la siguiente.» y, si sonaba, pasa a la siguiente a los 3 s (`ERROR_SKIP_MS`). Pausar en ese intervalo cancela el salto. |
| Pausa externa | Una pausa o reproducción que no pidió el reproductor (teclas multimedia, interrupciones del sistema) se refleja en el estado. |
| Media Session | Título, artista y nombre del contexto como álbum; acciones `play`, `pause`, `previoustrack`, `nexttrack` y `seekto`. |
| Canciones locales | Suenan como las demás. Su `audioUrl` es `audio/L<16 hex>.opus`, que sirve `sw.js` desde IndexedDB; sin service worker, una URL de objeto (ADR-0015, decisión 7). |

## 4. API de `createPlayer`

### 4.1 Opciones

| Opción | Por defecto | Qué hace |
|---|---|---|
| `audio` | Obligatoria | Elemento de audio con `play`. Si falta, lanza `TypeError`. |
| `isAvailable(track)` | Siempre true | Dice si una canción se puede reproducir sin conexión. |
| `onChange(state)` | No hace nada | Se llama en cada cambio de estado, también en cada `timeupdate`. |
| `onNotice(texto)` | No hace nada | Se llama con cada aviso de `NOTICES`. |
| `volume`, `shuffle`, `repeat` | 1, false, `off` | Estado inicial. |
| `env` | Globales del navegador | Dobles para las pruebas. |

Un error lanzado dentro de un callback se captura y se registra con `console.error` («Reproductor: error en un aviso.»); la reproducción sigue.

### 4.2 Métodos

`load`, `play`, `pause`, `toggle`, `next`, `previous`, `playEntry(key)`, `addToQueue(track)`, `seekTo(segundos)`, `setShuffle(on)`, `setRepeat(modo)`, `setVolume(valor)`, `toggleMute()`, `getState()` y `destroy()`. Tras `destroy()` (para el audio y quita los manejadores), los métodos no hacen nada.

### 4.3 Estado: `getState()`

`track` (copia de la canción actual o null), `key`, `contextId`, `contextName`, `playing`, `position` y `duration` (segundos con un decimal), `volume`, `muted`, `volumeAdjustable`, `shuffle`, `repeat`, `notice` y `upcoming` (lo que queda en la cola, con `key`, `track` y `fromQueue`).

### 4.4 Exportaciones

Constantes `REPEAT_MODES`, `PREVIOUS_RESTART_SECONDS` (3), `ERROR_SKIP_MS` (3000) y `NOTICES`; funciones puras `clampVolume`, `nextRepeatMode` y `shuffledIndexes`.

## 5. Pruebas

- `tests/web-unit/player.test.mjs`: 31 pruebas con `node:test` (funciones puras, carga y reproducción, repetir, aleatorio, cola, volumen, sin conexión y errores, Media Session y destrucción). En verde el 2026-11-03 con `node --test "tests/web-unit/*.test.mjs"` (274 en total).
- La interfaz del reproductor la cubren las pruebas de extremo a extremo de `tests/web-e2e/` (`funcional`, `a11y` y `medidas`).
- No cubren el audio real (decodificación y volumen en iOS) ni dispositivos físicos.

## Pendiente

1. **Atajos de teclado.** El reproductor no escucha teclas y la interfaz no define atajos de reproducción (DESIGN §12 solo pide teclado en diálogos y menús). Los atajos de una tecla de la versión 1.0 se retiraron con ella. Decidir si hacen falta.
2. **iOS e iPadOS.** Comprobar en un dispositivo real Media Session, el control de volumen oculto y la reproducción de canciones locales por el service worker.
