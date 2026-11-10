# ADR-0036: Estabilidad del reproductor (APK y web)

- Estado: aceptada (rama `feature/estabilidad-apk`, 2026-11-10; pendiente de fusionar en main). Comprobada en el emulador (Android 15) con una sesión de 50 minutos, llamadas simuladas, `am kill`, arranques en frío y modo avión, y en la web con Chrome sin cabeza. **Sin probar en un teléfono real** (los gestores de batería de cada fabricante y Doze durante horas no se pueden reproducir en el emulador).
- Fecha: 2026-11-10.
- Relacionadas: [ADR-0021](ADR-0021-buscar-en-youtube.md) (Escuchar de YouTube), [ADR-0031](ADR-0031-audio-por-el-worker.md) (direcciones del audio y respaldos), [ADR-0033](ADR-0033-descargas-y-subidas-en-movil.md) (descargas sin conexión).

## Contexto

Problemas reportados en la APK:

1. Se cerraba sola tras 30–40 minutos de música.
2. Al abrir, el reproductor mostraba una canción que nadie había elegido, y los controles no respondían bien hasta tocar otra.

Causas encontradas (reproducidas en el emulador antes de cambiar nada):

- **Cierres: la app perdía el servicio en primer plano tras una interrupción.**
  - Una llamada o un aviso con la app en segundo plano hacía que just_audio pausara.
  - Con `androidStopForegroundOnPause: true`, audio_service sacaba el servicio de primer plano en esa pausa.
  - Al acabar la interrupción, just_audio volvía a sonar y audio_service intentaba volver a primer plano desde segundo plano, algo que Android 12+ prohíbe. Lanza `ForegroundServiceStartNotAllowedException`, que el plugin se traga (`AudioServicePlugin.java`).
  - La música seguía sin servicio en primer plano ni bloqueo de CPU (`oom_score_adj` 700). Android podía matar el proceso como cualquier app en segundo plano, y lo hacía al cabo de un rato.
  - Sin interrupciones, 54 minutos fueron estables y sin fugas: memoria total 124–148 MB, hilos alrededor de 45, descriptores 180–200.
- **La recuperación de errores no se ejecutaba nunca.**
  - just_audio 0.10 pasó los errores de `playbackEventStream.onError` a `errorStream`.
  - Además, tras un error su `seek` no vuelve a preparar el reproductor, y un `seek` a una fuente que falla no termina nunca. Eso bloqueaba la cola de órdenes: sin conexión, la app se quedaba «cargando».
  - Tras un error, just_audio queda en `idle`, y audio_service interpreta `idle` como «parar el servicio» mientras la música seguía.
- **Canción fantasma: la app cargaba toda la biblioteca como cola al abrir.**
  - `home_shell` → `_applyQueue`/`_prepareAudio` → `_loadQueue` publicaba la primera canción como «sonando» y empezaba a transmitirla aunque nadie la hubiera tocado.
  - Sin conexión, `setAudioSources` sin `initialIndex` preparaba primero la canción 1: si no estaba guardada, fallaba la cola entera antes de llegar a la tocada.

En la web no hay fugas: una sesión larga con Chrome se mantiene estable. Sí tenía tres problemas propios:

- Una canción transmitida cuya red se quedaba colgada esperaba para siempre.
- Al llegar una versión nueva del service worker, la página se recargaba y se perdía la canción, la cola y la posición.
- Las preferencias del reproductor se escribían en `localStorage` con cada `timeupdate`.

La canción fantasma y los cierres son **solo de la APK**.

## Decisión

### APK (`mobile/lib/sonidos_audio_handler.dart`, salvo donde se indica)

- **Interrupciones en el handler, no en just_audio** (`AudioPlayer(handleInterruptions: false)`, `handleInterruption`):
  - Una pérdida pasajera del foco (una llamada) para el sonido, pero se publica como «suspendida» (`buffering`, sigue sonando para el sistema). El servicio no sale nunca de primer plano y al acabar no tiene que volver a entrar.
  - Una pérdida definitiva del foco, desenchufar los auriculares o pausar a mano son pausas de verdad: el servicio sale de primer plano y suelta el bloqueo de CPU, como antes.
  - Una suspensión de más de 15 minutos pasa a ser una pausa de verdad.
- **Se mantiene `androidStopForegroundOnPause: true`.** Se probó mantener el primer plano en toda pausa (`false`) y es peor. audio_service solo suelta el primer plano al pausar o al destruirse el servicio, y con la app abierta el servicio sigue enlazado. Tras parar, quedaba en primer plano y con el bloqueo de CPU sin fin (comprobado en el emulador).
- **Nunca `idle` con una cola activa** (`serviceProcessingState`): se publica `buffering` si la reproducción está pedida y `ready` si está en pausa.
- **Cierre por inactividad** (`kIdleStopAfter`, 15 minutos): en pausa, al acabar la cola o tras un error sin salida, se para el reproductor, el servicio y la notificación.
- **Recuperación de errores** (`_recover`, desde `errorStream`): recarga la cola con `setAudioSources(initialIndex, initialPosition)` en el mismo punto. Por orden:
  1. desde el fichero, si la canción ya está guardada;
  2. si no, la siguiente dirección del audio (Worker, r2.dev y la web; ADR-0031);
  3. si no, salta a la siguiente canción que pueda sonar sin red;
  4. si no queda ninguna, pausa con un aviso.
- **Órdenes que no se cuelgan:**
  - `playAt` siempre recarga la cola, nunca busca.
  - Siguiente, anterior y saltar a un punto esperan como mucho 5 s (`kSeekWait`).
- **Al abrir no hay nada cargado:** se quitan la precarga y su aviso.
  - `library_controller.dart`: fuera `_applyQueue`, `_prepareAudio`, `retryAudio`, `audioNotice` y `describeAudioError`.
  - `ui/home_page.dart`: fuera el aviso.
  - `playback.dart`: `PlaybackPort` ya no tiene `loadQueue`.
  - La cola se prepara al tocar una canción, empezando por ella (`initialIndex`).
  - `stop()` deja el reproductor vacío: sin canción, cola ni progreso.
- **Las canciones guardadas suenan siempre desde el fichero:**
  - Cada recarga vuelve a mirar qué está en el teléfono, también lo descargado después de cargar la cola.
  - Las transmitidas reutilizan su fuente mientras la dirección no cambie, así el servidor local de just_audio no crece y una descarga en curso no se repite.
  - La descarga y la caché de just_audio usan temporales distintos (`.N.part` y `.part`) y renombran al final.
  - La descarga rechaza un cuerpo más corto que `Content-Length` (`library_store.dart`).
- **Vigilante de parones** (`kStallTimeout`, 15 s, igual que la web), solo para canciones transmitidas: si se queda esperando datos sin avanzar, reintenta una vez desde el mismo punto y, si sigue, va por el camino de error. Nunca actúa sobre una canción que suena desde el fichero.
- **Registro de errores** (`lib/error_log.dart`):
  - recoge `FlutterError.onError` y `PlatformDispatcher.onError`;
  - guarda 256 KB más una copia rotada, en `files/registro/`;
  - va fuera de la copia de seguridad (`backup_rules.xml`, `data_extraction_rules.xml`).
- **YouTube:** un solo `http.Client` compartido (`youtube_audio_source.dart`) en vez de uno por petición. La lógica de extracción no cambia.

### Web

- **Vigilante de parones** (`js/player.js`, `STALL_TIMEOUT_MS = 15 000`): con la reproducción pedida, un `waiting`/`stalled` sin avance reintenta una vez la misma fuente desde el mismo punto y después va por el camino de error de siempre. No toca las canciones servidas desde el dispositivo (descargadas o subidas aquí): el service worker las sirve desde la caché, sin red.
- **Versión nueva sin cortar la música** (`js/pwa.js`, `updateAction`):
  - Sin nada cargado, la página se recarga como antes.
  - Con una canción cargada (sonando o en pausa) o el vídeo de YouTube, no se recarga. Sale el aviso «Hay una versión nueva de Reminiscencia.» con «Recargar» (`update-notice`, `role="status"`).
- **Almacenamiento persistente:** `requestPersistentStorage` (`js/pwa.js`) sustituye a la llamada que ya hacía `app.js`, ahora con prueba. Evita que el navegador vacíe la caché de audio cuando le falta espacio.
- **Menos trabajo por `timeupdate`:**
  - Las preferencias se guardan solo cuando cambian (`createPrefsSaver`).
  - Los iconos del reproductor se sustituyen solo si cambian.
- `SHELL_VERSION` pasa de 33 a 34.

## Consecuencias

- **Pruebas APK:** `flutter test` 585 de 585. Las nuevas:
  - `test/audio_handler_test.dart` (24, con el handler real y `test/support/fake_audio_player.dart`);
  - `test/error_log_test.dart`;
  - casos de `Content-Length` en `offline_downloads_test.dart`;
  - la regla de copia de seguridad.
- **Pruebas web:**
  - unitarias del vigilante, de `updateAction`, de la persistencia y de las preferencias;
  - E2E en `tests/web-e2e/estabilidad.e2e.mjs`: red colgada a media canción, canción descargada con la red colgada (suena entera sin pedirla) y despliegue con y sin canción cargada. El servidor de pruebas admite `stallAfterBytes`.
- **Comprobado en el emulador (Android 15):**
  - 5 arranques en frío, sin canción ni servicio y con los controles bien desde el primer toque.
  - 3 llamadas en segundo plano con la pantalla bloqueada: sigue en primer plano y `am kill` no la mata.
  - Tras 15 minutos en pausa se cierran el servicio y la notificación.
  - Sin red, salta a la siguiente guardada en unos 8 s.
  - 8 descargas mientras suena, sin cortes y con los ficheros íntegros.
  - 50 minutos seguidos con el mismo proceso y siempre en primer plano: memoria total 113–125 MB, hilos 43–49 y descriptores 172–203, sin crecer.
- **Límites conocidos:**
  - Una llamada de más de 15 minutos acaba en pausa y no sigue sola.
  - La notificación sigue fija en pausa hasta el cierre por inactividad, como antes.
  - Problemas de just_audio sin parchear: `LockCachingAudioSource` no cierra el fichero que escribe (un descriptor por canción transmitida y no guardada) y renombra antes de vaciar el búfer (una ventana breve con un fichero corto, rara con «Sin conexión» activo).
  - Botones de Bluetooth o de auriculares reales: sin probar.
- Si la app sigue cerrándose en un teléfono real, el motivo lo da `adb shell dumpsys activity exit-info es.orbitalabs.reminiscencia`, y los errores de Dart quedan en `files/registro/`.
