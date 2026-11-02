# Reproductor y registro del estudio

**Estado:** describe la rama feat/ui-publica pendiente de fusión (commits 4d15379 y cc8ef01, sobre main 8a19a09). En main todavía no existe `frontend/web/js/player.js`.

**Base de diseño:** `docs/user-experience/DESIGN.md`, secciones 3.2, 6.1, 7.4 y 8.1 a 8.4.

**Revisión:** 2026-11-02. Lo que no se ha podido comprobar en el código, o lo que el código no cumple, está en la sección «Pendiente».

## 1. Alcance

- `frontend/web/js/player.js` es un módulo sin dependencias y sin DOM. Recibe el elemento `<audio>` y, opcionalmente, los servicios del navegador (`env`). No pinta nada: textos, zonas de C0, C1 y C2, botones y avisos visibles son responsabilidad de la interfaz.
- Las reglas de reproducción están en el reproductor. El registro del estudio está en `frontend/web/js/store.js` (almacenamiento y consultas) y en `frontend/web/js/schema.js` (tipos y validación).
- Integración: en feat/ui-publica ningún módulo importa `createPlayer`. `frontend/web/index.html` carga solo `app.js` (línea 135), y `app.js` no usa el reproductor. Por ahora el reproductor solo se ejecuta en las pruebas unitarias.

## 2. Reglas de reproducción

| Caso | Comportamiento en el código | Lo aplica |
|---|---|---|
| Al abrir la app | Al crear el reproductor no suena nada. `restoreLast(item, startAt)` deja la pista en pausa en `startAt`, sin evento de inicio. | Reproductor. «Reanudar al abrir» (`resumeOnOpen`, No por defecto) debe llamar a `play()` desde la interfaz. |
| Empezar sesión | `load(items, startAt, origin, presentation)` carga la cola sin iniciar el audio. Solo `play()` empieza a sonar. | Reproductor (carga) e interfaz (botón «Empezar sesión»). |
| Reproducir y pausar | `play()` no hace nada sin pista o si ya suena. Si la pista actual no está disponible, busca otra (fila «Sin conexión»). `pause()` no hace nada si no suena. `toggle()` alterna ambas. | Reproductor. |
| Siguiente | `next()` pasa a la siguiente pista disponible. Si sonaba, la nueva suena; si estaba en pausa, cambia de pista sin sonar. DESIGN dice «reproducción continua»: el código lo cumple solo si ya sonaba. | Reproductor. |
| Fin de la pista | Si la pista termina sola y sonaba, emite `track-end` con `completed: true` y pasa a la siguiente disponible. | Reproductor. |
| Fin de la lista | Con `repeatList` (true por defecto; sin perfil, también), vuelve a la primera pista disponible y sigue sonando. Sin repetición, se detiene con el aviso «Fin de la lista». No hay orden aleatorio ni pistas «Le gusta» al final. | Reproductor. |
| Anterior | `previous()`. En paciente, siempre la pista anterior. En cuidador, si la posición supera 3 s (`PREVIOUS_RESTART_SECONDS`), vuelve al inicio de la pista. En la primera pista, con repetición va a la última; sin repetición, vuelve al inicio. | Reproductor. |
| Error de audio | Emite `error`, cierra la pista sin `track-end` y muestra «No se puede reproducir esta canción. Pasamos a la siguiente.». Si sonaba, salta a la siguiente disponible a los 6 s (`skipDelayAfterError`). Pausar en ese intervalo cancela el salto. | Reproductor. |
| Sin conexión | Una pista no está disponible si no tiene `audioUrl` o si `isAvailable(item)` devuelve false o lanza un error. `next`, el fin de pista y el salto tras un error buscan solo hacia delante; `previous`, solo hacia atrás; `play`, `load` y `jumpTo`, hacia delante y luego hacia atrás. Al saltar aparece «No disponible sin internet». En `load`, `play` y `jumpTo`, si no hay ninguna disponible, aparece «No hay canciones disponibles sin internet.»; en `next` y en el fin de pista, aparece «Fin de la lista» (ver Pendiente 14). | El reproductor decide. La interfaz pinta la pista deshabilitada y pasa `isAvailable`. |
| Volumen | Pasos enteros de 0 a 10 (10 % cada uno). Al crear el reproductor, el paso es 6 (60 %), o el límite si es menor. `setVolumeStep` redondea y aplica el límite del perfil. | Reproductor. |
| Límite por perfil | `volumeLimit` (de 50 a 100; 100 por defecto en `store.js`) se convierte en pasos de 5 a 10, redondeando hacia abajo (55 % equivale a 50 %). Si el volumen supera el límite, baja hasta él. Un perfil sin `volumeLimit` válido conserva el límite vigente. | Reproductor. |
| Web Audio | El grafo (AudioContext, MediaElementAudioSourceNode y GainNode) se crea en el primer `pointerdown`, `keydown` o `touchend` del documento. Hasta entonces, o si el navegador no lo admite, el volumen va en `audio.volume` y `volumeMode` vale «element». Con grafo, vale «gain». | Reproductor. |
| Arranque de sesión | En paciente, la primera reproducción de cada sesión sube de 0 al 60 % (o al límite, si es menor) en 1,5 s (`FADE_IN_MS`). Con grafo es una rampa del GainNode; sin él, pasos de 50 ms sobre `audio.volume`. En cuidador no hay arranque ni fundido. | Reproductor. |
| Saltar | `seekTo(segundos)` salta a esa posición, acotada a la duración cuando se conoce; `seekBy(segundos)` salta de forma relativa. Ninguno emite evento. «Saltar al tocar la barra» (`seekOnTap`, No por defecto) no lo filtra el reproductor. | La interfaz decide si el toque llama a `seekTo`. |
| Temporizador | `setSleepTimer(minutos)` lo fija; `null` o cero lo quitan. `extendSleepTimer(minutos)` suma minutos o lo inicia. Cuenta solo mientras suena, con tic de 1 s. Con 30 s o menos llama una vez a `onSleepWarning(segundos)`. A cero, si sonaba, pausa (emite `pause`) y llama a `onSleep()`. Pausa aunque nadie haya respondido al aviso; no cierra la aplicación. | Reproductor. Los minutos 15, 30 y 60 (`SLEEP_TIMER_MINUTES`, en `schema.js`) los elige la interfaz; el reproductor acepta cualquier minuto positivo. |
| Pantalla | En paciente, mientras suena, pide el bloqueo de pantalla (`screen`) si `wakeLockEnabled` es true (por defecto). Lo libera al pausar, al pasar a cuidador y al destruir el reproductor. Al volver a la pestaña visible, lo vuelve a pedir si sigue sonando. | Reproductor. La interfaz pasa el ajuste de dispositivo `wakeLock` como `wakeLockEnabled`. |
| Sistema | Media Session: título, artista y portada de la pista (declarada como 512 × 512), estado de reproducción y las acciones play, pause, previoustrack y nexttrack. | Reproductor. |
| Cambio de modo | `setMode` no detiene la reproducción. Cierra la sesión (sección 3) y pide o libera el bloqueo de pantalla. | Reproductor. |
| Atajos de una tecla (DESIGN 7.4) | El reproductor no escucha teclas: el `keydown` solo desbloquea Web Audio. Ofrece `toggle()`, `seekBy()` y `setVolumeStep()` para que la interfaz los use. | Interfaz (pendiente). |

## 3. Sesiones de escucha (DESIGN 8.2)

- **Qué guarda el reproductor.** Una marca de sesión abierta (`sessionStarted`). La sesión se reinicia en tres casos: al cambiar de modo (`setMode`), al cambiar de perfil (`setProfile` con otro `id`) y, en paciente, cuando `play()` encuentra que han pasado 3 horas (`SESSION_IDLE_MS`) desde el último momento en que dejó de sonar. Al reiniciarse, la siguiente reproducción en paciente aplica el arranque de la sección 2.
- **Lo que no la reinicia.** Pausar y reanudar, cambiar de pista, cambiar de lista con `load` y cambiar el volumen.
- **Inactividad.** La comprobación de las 3 horas ocurre solo al pulsar Reproducir. No hay temporizador que cierre la sesión mientras no suena.
- **Lo que el reproductor no hace.** No crea identificador de sesión, no emite `session-start` ni `session-end` y no tiene una acción «Terminar sesión». DESIGN 8.2 sitúa la creación en C4 y el cierre en el cuidador. Ver «Pendiente».
- **Condición.** «Según cada canción» (`segun-cancion`) y «Solo audio» (`solo-audio`) no las conoce el reproductor. Recibe la presentación en `load`, como valor o como función que recibe la pista y devuelve el valor. Que «Solo audio» fuerce C0 en toda la sesión lo decide la interfaz.

## 4. Presentaciones C0, C1 y C2 (DESIGN 8.3)

| Código | Presentación | Portada | Fotografía | Recuerdo |
|---|---|---|---|---|
| C0 | Solo canción | Sí | «Sin fotografía» | «Sin recuerdo guardado» |
| C1 | Canción y recuerdo | Sí | «Sin fotografía» | Tarjeta con texto |
| C2 | Canción, foto y recuerdo | Sí | Fotografía | Tarjeta con texto |

- Las zonas no cambian de posición ni de tamaño (DESIGN 8.3).
- Textos de ausencia: C0 muestra siempre sus dos textos. En C1 y C2, cuando falta la fotografía o el recuerdo, se muestran los mismos textos que en una canción sin contenido: «Sin fotografía» (DESIGN 6.1, P-9) y «Sin recuerdo guardado» (DESIGN 6.1, P-10).
- Vista previa: no crea sesión ni registra eventos (DESIGN 3.2). El reproductor emite eventos en cualquier modo; quien decide si se registran es la interfaz.
- En el código: `STUDY_PRESENTATIONS` (`schema.js`) admite solo `C0`, `C1`, `C2` o null. El reproductor resuelve la presentación en el momento de cada evento; si la función que la calcula lanza un error, el evento lleva null.
- El historial deriva «fotografía mostrada» de C2 y «recuerdo mostrado» de C1 o C2 (`toHistoryRow` en `store.js`). Ver «Pendiente».

## 5. Registro del estudio (DESIGN 8.4)

### 5.1 Almacenamiento

- IndexedDB, base `reminiscencia`, versión 2. Almacén `studyEvents` con clave local `seq` autoincremental e índices `bySession`, `byProfile` y `byDay` (`frontend/web/js/store.js`).
- `recordStudyEvent(event)` valida el evento con `normalizeStudyEvent`, le añade `participantCode` (el código del perfil en ese momento), `id` aleatorio y `day`, y devuelve la clave local. Rechaza eventos inválidos y perfiles inexistentes, sin escribir nada.
- `listStudyEvents(filtros)` acepta `from` y `to` (AAAA-MM-DD, ambos incluidos), `sessionId`, `profileId` y `presentation`, y devuelve los eventos en orden cronológico.
- Las copias de seguridad llevan el registro desde la versión 2 de la copia (`BACKUP_PAYLOAD_VERSION = 2`). Las copias de la versión 1 siguen siendo válidas.
- El almacén `history`, anterior al registro (`addHistory`, `listHistory`), no lo escribe el reproductor. El historial de C-24 se calcula desde `studyEvents` (ver 5.5).

### 5.2 Tipos de evento

`STUDY_EVENT_TYPES` en `frontend/web/js/schema.js`. Todos los eventos exigen `type`, `at`, `sessionId` y `profileId`.

| Tipo | Lo emite | Requisitos añadidos |
|---|---|---|
| `start` | Reproductor | `songId`, `presentation`, `condition` y `origin` |
| `pause` | Reproductor | Los mismos que `start` |
| `resume` | Reproductor | Los mismos que `start` |
| `track-end` | Reproductor | Los mismos que `start`, más `completed` (booleano) y `seconds` |
| `error` | Reproductor | Los mismos que `start` |
| `session-start`, `session-end` | Interfaz (pendiente) | Ninguno de pista |
| `memory-seen`, `memory-other`, `photo-zoom` | Interfaz (pendiente) | Los mismos que `start` |
| `observation` | Interfaz (pendiente) | Ninguno de pista; `songId` opcional |

### 5.3 Campos

| Campo | Contenido | Lo pone |
|---|---|---|
| `type` | Uno de los tipos de 5.2. | Reproductor o interfaz. |
| `at` | Fecha y hora ISO 8601 con zona. El reproductor usa `toISOString()`: UTC, con sufijo `Z` y milisegundos. La validación admite también desplazamientos, como `+02:00`. | Reproductor o interfaz. |
| `day` | `AAAA-MM-DD`: los diez primeros caracteres de `at`. | Almacén. |
| `sessionId` | Identificador de 1 a 64 caracteres: letras sin tildes, dígitos, `_` y `-`. | Interfaz (pendiente). |
| `profileId` | Identificador interno del perfil, con el mismo formato. | Interfaz (pendiente). |
| `participantCode` | Código del participante en el momento del registro, hasta 40 caracteres. | Almacén. |
| `songId` | Identificador de catálogo: `S` seguida de 16 caracteres hexadecimales, o null. | Reproductor (`track.id`). |
| `presentation` | `C0`, `C1`, `C2` o null. | Reproductor (de `load`). |
| `condition` | `segun-cancion`, `solo-audio` o null. | Interfaz (pendiente). |
| `origin` | `lista`, `carpeta`, `busqueda`, `continua` o null. `continua` cuando `restoreLast` crea una cola de una sola pista. | Reproductor (de `load`). |
| `seconds` | Entero de 0 a 86 400, o null. El reproductor emite `position` con un decimal y el almacén lo redondea. | La interfaz debe copiar `position` en `seconds` (pendiente). |
| `completed` | Booleano. Solo en `track-end`. | Reproductor. |
| `trackSeconds` | Entero de 1 a 86 400, o null: duración de la pista. | Interfaz (pendiente). El reproductor la expone en `getState().duration`. |
| `id`, `seq` | `id`: identificador aleatorio que evita duplicados al combinar copias. `seq`: clave local. | Almacén. |

### 5.4 Cuándo emite el reproductor cada evento

- `start`: una pista pasa a estar abierta y empieza a sonar. Su `position` es la de arranque, que puede ser distinta de 0 tras `restoreLast`.
- `resume`: vuelve a sonar la misma pista tras una pausa, incluidas la externa y la del temporizador.
- `pause`: `pause()`, una pausa externa del elemento (por ejemplo, una interrupción del sistema) y el final del temporizador.
- `track-end` con `completed: true`: la pista termina sola.
- `track-end` con `completed: false`: la pista se cierra porque la reproducción pasa a otra pista (`next`, `previous`, `jumpTo`, `load`, `restoreLast`) o porque `next` no encuentra más pistas. Se emite antes de sustituir la cola, así que lleva el origen y la presentación de la lista anterior.
- `error`: fallo del elemento de audio. La pista queda cerrada y no genera `track-end`.
- No emite evento: los saltos dentro de la pista (`seekTo`, `seekBy` y `previous` cuando vuelve al inicio), los cambios de volumen, de modo o de temporizador, ni el inicio o el fin de sesión.

### 5.5 Historial y resumen

- `buildListeningHistory(eventos)` (`store.js`) toma solo los `track-end`, los agrupa por `day` y ordena los días del más reciente al más antiguo.
- Cada fila tiene: `time` (HH:MM tomado de `at`), `songId`, `seconds`, `percent` (segundos entre `trackSeconds`, con máximo 100; null si falta `trackSeconds`), `completed`, `photoShown` (presentación C2), `memoryShown` (C1 o C2), `presentation`, `origin`, `condition` y `sessionId`.
- Resumen de cada día: `listens` (número de filas), `minutes` (suma de `seconds`, redondeada a minutos) y `skipped` (filas con `completed` false).
- `listListeningHistory({ profileId, from, to, sessionId, presentation })` exige `profileId`.

## 6. API de createPlayer

`createPlayer(options)` está en `frontend/web/js/player.js`. Al crearse no suena nada.

### 6.1 Opciones

| Opción | Por defecto | Qué hace |
|---|---|---|
| `audio` | Obligatoria | Elemento de audio con método `play`. Si falta, lanza `TypeError`. |
| `profile` | null | Perfil con `id`, `repeatList` y `volumeLimit`. Sin perfil: repetición activa y volumen hasta 100 %. |
| `mode` | `cuidador` | `paciente` o `cuidador`. Cualquier otro valor equivale a `cuidador`. |
| `wakeLockEnabled` | true | Con false, no pide el bloqueo de pantalla. |
| `isAvailable(item)` | Siempre true | Dice si una pista se puede reproducir. Si lanza un error, cuenta como no disponible. |
| `onChange(state)` | No hace nada | Se llama en cada cambio de estado, también en cada `timeupdate` del audio. |
| `onStudyEvent(event)` | No hace nada | Se llama con cada evento de estudio (6.4). |
| `onNotice(texto o null)` | No hace nada | Se llama solo cuando cambia el aviso. |
| `onSleepWarning(segundos)` | No hace nada | Una vez por temporizador, a 30 s o menos. |
| `onSleep()` | No hace nada | Cuando el temporizador llega a cero. |
| `env` | Globales del navegador | Sustituye `now`, `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`, `AudioContext`, `navigator`, `document` y `MediaMetadata`. Sirve para las pruebas. |

### 6.2 Métodos

| Método | Efecto | Evento de estudio |
|---|---|---|
| `load(items, startAt = 0, origin = null, presentation = null)` | Sustituye la cola. Descarta los elementos sin `id` y copia `id`, `title`, `artist`, `year`, `coverUrl`, `audioUrl` y `folderId`. Elige la primera pista disponible desde `startAt`. No inicia el audio. | `track-end` (completed false) de la pista abierta, si la hay. |
| `restoreLast(item, startAt = 0)` | Deja `item` en pausa en `startAt`. Si ya está en la cola, la selecciona; si no, la cola pasa a ser solo esa pista, con origen `continua`. | `track-end` (completed false) de la pista abierta, si la hay. |
| `play()` | Empieza a sonar. En paciente, aplica el arranque de sesión si procede. | `start` o `resume`. |
| `pause()` | Pausa. | `pause`. |
| `toggle()` | `play()` o `pause()`, según el estado. | Según el caso. |
| `next()` | Pasa a la siguiente pista disponible. Si no queda ninguna, se detiene con «Fin de la lista». | `track-end` (completed false). |
| `previous()` | Ver la fila «Anterior» de la sección 2. | `track-end` (completed false) si cambia de pista. |
| `jumpTo(indice)` | Pasa a la pista de ese índice. Si no está disponible, busca hacia delante y luego hacia atrás. Mantiene el estado de reproducción. | `track-end` (completed false). |
| `seekTo(segundos)`, `seekBy(segundos)` | Salta dentro de la pista. | Ninguno. |
| `setVolumeStep(paso)` | Fija el volumen entre 0 y 10, redondeado y con el límite del perfil. | Ninguno. |
| `setProfileLimit(porcentaje)` | Fija el límite entre 50 y 100 %. Los valores no válidos se ignoran. | Ninguno. |
| `setSleepTimer(minutos o null)` | Fija el temporizador. `null` o cero lo quitan. | `pause` si al llegar a cero sonaba. |
| `extendSleepTimer(minutos)` | Suma minutos, o inicia el temporizador. Vuelve a armar el aviso de 30 s. | Ninguno. |
| `setProfile(perfil o null)` | Cambia de perfil. Si cambia el `id`, reinicia la sesión. Si cambia el `id` o `volumeLimit`, aplica el límite. | Ninguno. |
| `setMode(modo)` | Cambia entre `paciente` y `cuidador`. Cierra la sesión, no detiene la reproducción y gestiona el bloqueo de pantalla. | Ninguno. |
| `getState()` | Devuelve el estado (6.3). | Ninguno. |
| `destroy()` | Detiene el audio, cancela los temporizadores y libera el bloqueo y los listeners. Después, los métodos no hacen nada; `getState()` sigue devolviendo el último estado. | Ninguno. |

### 6.3 Estado: getState()

- `track`: copia de la pista actual, o null.
- `index`: posición en la cola (-1 sin cola).
- `queueLength`: número de pistas de la cola.
- `playing`: booleano.
- `position` y `duration`: segundos, con un decimal.
- `volumeStep` (de 0 a 10) y `volumeLimitStep` (de 5 a 10).
- `notice`: texto del aviso, o null.
- `sleepMinutesLeft`: minutos que faltan, redondeados hacia arriba, o null.
- `volumeMode`: `gain` o `element`.

### 6.4 Eventos y avisos

- `onStudyEvent` recibe un objeto con `type`, `at` (ISO 8601 en UTC), `songId`, `position` (segundos, con un decimal), `origin` y `presentation`. Solo `track-end` añade `completed`. El objeto no trae `sessionId`, `profileId`, `condition` ni `trackSeconds`: la interfaz los añade antes de registrarlo (sección 5.3).
- `onNotice` recibe los textos de `NOTICES`: `unavailable` («No disponible sin internet»), `noneAvailable` («No hay canciones disponibles sin internet.»), `error` («No se puede reproducir esta canción. Pasamos a la siguiente.») y `endOfList` («Fin de la lista»).
- Un error lanzado dentro de un callback se captura, se registra con `console.error` («El reproductor: error en un aviso.») y la reproducción sigue.

### 6.5 Constantes y funciones exportadas

- Constantes: `MODES`; `VOLUME_STEP_MAX` (10); `ARRIVAL_STEP` (6); `FADE_IN_MS` (1500); `SEEK_STEP_SECONDS` (5, sin uso dentro del reproductor; ver «Pendiente»); `skipDelayAfterError` (6); `PREVIOUS_RESTART_SECONDS` (3); `sleepWarningAt` (30); `extendSleepMinutes` (15, minutos que suma el aviso P6; la prueba e2e de P6 espera «Seguir 15 minutos más»); `SESSION_IDLE_MS` (10 800 000); `NOTICES`.
- Funciones puras: `clampVolumeStep`, `volumeFromStep`, `applyVolumeLimit`, `limitStepFromPercent`, `fadeInGain`, `nextIndex`, `previousIndex`, `shouldRestartOnPrevious`, `shouldWarnSleep`, `sleepMinutesLeft` e `isSessionIdle`.

## 7. Pruebas

- **`tests/web-unit/player.test.mjs`**: 65 pruebas con `node:test`. Se ejecutaron en esta revisión sobre una copia de feat/ui-publica (cc8ef01), con Node v26.4.0: 65 pasan y ninguna falla. Comando desde la raíz del repositorio: `node --test tests/web-unit/player.test.mjs`.
- **Qué cubren**: las funciones puras (volumen, límite de perfil, fundido, índices, anterior, temporizador e inactividad de sesión); los textos de DESIGN 8.1; las reglas de la sección 2; el arranque y la sesión (8.2); Web Audio; el temporizador; el bloqueo de pantalla; Media Session; los eventos de estudio; los saltos; el cambio de modo; `destroy`; los errores de los avisos del llamador; la pausa externa y la cola vacía.
- **Qué no cubren**:
  - El DOM: textos visibles, zonas de C0, C1 y C2, tamaños, foco y accesibilidad. Lo cubren las pruebas de extremo a extremo de `tests/web-e2e/` (`paciente.e2e.mjs`, `cuidador.e2e.mjs`, `medidas.e2e.mjs` y `a11y.e2e.mjs`). Esas pruebas no se han ejecutado en esta revisión.
  - El audio real: decodificación, salida de Web Audio y volumen en iOS. Las pruebas usan dobles del elemento de audio, del reloj y del AudioContext.
  - La persistencia del registro en IndexedDB. La prueba `tests/web-unit/store-idb.test.mjs` cubre `recordStudyEvent` y `listListeningHistory`; no se ha revisado en esta tarea.
  - El cableado con la interfaz (sección 1).
- **Índice de pruebas**: `tests/web-unit/index.mjs` no importa `player.test.mjs`. `node --test tests/web-unit/` ejecuta 128 pruebas, ninguna del reproductor. `node --test tests/web-unit/*.test.mjs` ejecuta 243, incluidas las 65 del reproductor. Todas pasan en el snapshot de la rama.

## Pendiente

1. **Cableado con la interfaz.** Ningún módulo llama a `createPlayer`, ni a `recordStudyEvent`, `saveLastTrack`, `getLastTrack` o `listListeningHistory`. `frontend/web/index.html` carga solo `app.js`. Las pruebas e2e de reproducción dependen de este cableado.
2. **Eventos sin emisor.** `session-start`, `session-end`, `memory-seen`, `memory-other`, `photo-zoom` y `observation` están en `STUDY_EVENT_TYPES`, pero ningún código los emite. El reproductor emite siempre, también en vista previa. Que la vista previa no registre (DESIGN 3.2) depende de la interfaz. La prueba e2e «Vista previa» comprueba que no suena nada, no que no se registre.
3. **Campos que faltan en cada evento.** La interfaz debe añadir `sessionId`, `profileId`, `condition` y `trackSeconds`, y copiar `position` en `seconds`.
4. **Sesión (DESIGN 8.2).** No hay identificador de sesión, ni «Terminar sesión», ni código que emita `session-start` o `session-end`. El cierre por 3 horas solo se comprueba al pulsar Reproducir.
5. **Ajuste «Registro del estudio» (DESIGN 8.4).** Ni `SETTING_KEYS` en `schema.js` ni `prefs.js` tienen una clave para activarlo o desactivarlo (DESIGN: activado por defecto). El texto de primer uso («Se guardan eventos de escucha en este navegador para el estudio. No se usan nombres reales.») no aparece en la rama.
6. **Exportación CSV.** DESIGN 8.4 y C-24 piden «Exportar CSV» desde Historial. No hay código.
7. **Historial (DESIGN 8.4).** DESIGN pide la familiaridad y la preferencia vigentes en cada reproducción; `toHistoryRow` en `store.js` no las incluye. El almacén `history` anterior sigue en el código: decidir si se retira.
8. **Fotografía y recuerdo mostrados.** `store.js` los deriva de la presentación (C2; C1 o C2), no de si la canción tiene foto o recuerdo. Con C1 y una canción sin recuerdo, la fila marca «sí» aunque la tarjeta muestre «Sin recuerdo guardado». Decidir qué se mide.
9. **Día del registro.** `at` se graba en UTC y `day` son sus diez primeros caracteres, así que el historial agrupa por día UTC, no por el día local de España. Si se quiere el día local, la interfaz debe grabar `at` con su desplazamiento, que la validación admite.
10. **Presentaciones sin pintar.** Los textos «Sin fotografía» (DESIGN P-9) y «Sin recuerdo guardado» (DESIGN P-10) no aparecen en el código de la interfaz de la rama. «Sin fotografía» solo está en DESIGN.md; «Sin recuerdo guardado» está también en la prueba e2e de `tests/web-e2e/paciente.e2e.mjs`. Las zonas de C0, C1 y C2 no se pintan.
11. **Opciones del paciente.** «Reanudar al abrir» (`resumeOnOpen`) y «Saltar al tocar la barra» (`seekOnTap`) los tiene que aplicar la interfaz. La última pista ya tiene funciones de guardado y lectura en `store.js` (`saveLastTrack` y `getLastTrack`), pero ningún módulo las llama.
12. **Atajos de una tecla (DESIGN 7.4).** En la rama versionada (cc8ef01) no hay ninguno, y `SEEK_STEP_SECONDS` no lo usa nada. El `frontend/web/js/cuidador/shell.js` sin versionar del worktree local sí los implementa: ← y → llaman a `seekBy` con `SEEK_STEP_SECONDS` (±5 s), y ↑ y ↓ suben o bajan un paso de volumen (10 %). DESIGN fija ↑ y ↓ en ±5 % de volumen, y el reproductor solo admite pasos de 10 %, así que ese atajo no se puede aplicar tal cual.
13. **Aviso de error.** DESIGN 8.1 dice que el aviso permanece «hasta que empiece la siguiente pista». En el código se quita también cuando `play()` reintenta la misma pista. Decidir si el reintento es el comportamiento buscado.
14. **Sin pistas disponibles hacia delante.** Si no quedan pistas disponibles, `next` y el fin de pista muestran «Fin de la lista», aunque el motivo sea la falta de conexión. DESIGN 8.1 no cubre este caso.
15. **Texto no fijado en DESIGN.** «No hay canciones disponibles sin internet.» (`NOTICES.noneAvailable`) solo aparece en el código. Confirmarlo y añadirlo a DESIGN 8.1.
16. **Contratos no localizados.** `player.js` cita el «contrato 2.2», `prefs.js` el «contrato, sección 4» y `store.js` el «Contrato 2.3». Ningún documento de la rama contiene la palabra «contrato».
17. **Pruebas.** `player.test.mjs` no está en `tests/web-unit/index.mjs`. Las pruebas e2e de `tests/web-e2e/` no se han ejecutado para este documento.
18. **Fuera de alcance.** La sección 8.5 de DESIGN (observaciones) no se documenta aquí.
