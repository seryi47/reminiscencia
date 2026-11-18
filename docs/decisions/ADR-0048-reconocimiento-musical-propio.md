# ADR-0048. Reconocimiento musical propio (tipo Shazam) con dos vías: huella acústica contra la biblioteca y letra contra Lyrics.ovh

Fecha: 2026-11-18. APK: 1.4.2+26.

## Contexto

El usuario pide un botón «Reconocer canción» tipo Shazam en la app y en la web, que identifique lo que suena en el entorno y, si no está en su biblioteca, lo descargue por YouTube para añadirlo. La restricción adicional: **hacerlo nosotros, sin APIs comerciales** (AudD, ACRCloud).

Honestidad sobre el alcance real: un «Shazam universal» DIY no existe; Shazam puede identificar cualquier canción comercial porque tiene la huella de ~200 millones de temas y la base pesa petabytes. Nosotros no vamos a replicar eso. Lo que sí podemos hacer de verdad es:

1. **Reconocer cualquier canción de la propia biblioteca** (515 temas publicados) de forma instantánea y gratuita: precalculamos las huellas acústicas y las consultamos en una base indexada.
2. **Identificar canciones fuera de la biblioteca por su letra** usando una transcripción automática (Whisper) y una base pública de letras (Lyrics.ovh). Lo identificado se ofrece como importación automática por YouTube, con el mismo pipeline de Spotify Transfer. La próxima vez que esa canción suene, la vía 1 ya la tendrá.

## Decisión

### Vía 1 — Huella acústica contra la biblioteca (D1)

- Algoritmo **Shazam-style constellation map** escrito desde cero (sin librerías):
  - Resample PCM mono a **16 kHz**, ventana FFT de **4096** muestras con **75 % de solape** (hop 1024).
  - **32 bandas logarítmicas** de 60 a 4000 Hz; se escoge el pico máximo por banda y los **5 más fuertes** del fotograma como anclas.
  - Para cada ancla se empareja con **10 objetivos**, uno por fotograma siguiente (deltas 1–30), para repartir los hashes en varios deltas y no agotarlos en el primero.
  - Hash de **22 bits**: `anchor_band:6 | target_band:6 | delta_frames:10`, empaquetado en int32.
- Implementación **gemela en Dart y JS** (`mobile/lib/fingerprint.dart` ↔ `frontend/web/server/recognize-fingerprint.js`); misma constante → **mismos hashes bit a bit** (verificado con un tono de prueba). Esto permite que el móvil envíe hashes que el Worker busque en el mismo espacio que el índice precalculado.
- **Base D1 en Cloudflare** (`reminiscencia-recognize`, región WEUR):
  - `songs(id PRIMARY KEY, title, artist)`.
  - `hashes(hash INTEGER, song_id TEXT, offset INTEGER)` con índice por `hash`.
  - Precálculo offline: `scripts/recognize/generate_db.mjs` descarga cada `.opus` del catálogo, decodifica a PCM con ffmpeg, calcula los hashes con la MISMA implementación JS y emite el `INSERT` SQL. Se podan hashes (`--stride=4`, `--max-per-hash-song=3`) para bajar de ~150 k a ~8 k hashes por canción. 515 canciones → **3,89 M filas de hashes, 180 MB de DB, 166 s de importación**.
- **Endpoint `POST /api/recognize`** del Worker (`frontend/web/server/recognize-endpoint.js`): recibe `{v:1, hashes, offsets}`, consulta D1 por lotes de 90 hashes (`SELECT song_id, offset FROM hashes WHERE hash IN (?,…)`), construye un índice en memoria y llama al matcher puro (`recognize-core.js`) que puntúa candidatos por **histograma de deltas** (cada hit vota `(songId, offset_en_canción − offset_en_fragmento)`; el candidato con más votos en el MISMO delta gana). Enriquece el match con `title/artist` de la tabla `songs`.
- Si el binding D1 no está, responde `matched:false, reason:db_not_ready` **sin fallar**: la UI del móvil lo trata con un mensaje explícito y, si procede, salta a la vía 2.

### Vía 2 — Letra contra Lyrics.ovh (Workers AI + base pública)

- **Endpoint `POST /api/recognize-lyrics`** del Worker (`frontend/web/server/recognize-lyrics.js`): recibe el WAV crudo que capturó el micrófono.
- **Transcripción con `@cf/openai/whisper-large-v3-turbo`** (Cloudflare Workers AI). Dos ventajas sobre el `whisper` básico: autodetecta el idioma (crucial para música en español que Whisper básico transcribía forzando inglés) y acepta base64 (más eficiente que `Array.from(bytes)`). Verificado con un fragmento real de «8 AM» de Nicki Nicole: Whisper devuelve «My baby girl Honey, 8 in the morning, Y tú estás callin', Yo acabo de verte, baby…», alternando español e inglés como está cantada la letra real.
- **Búsqueda de la canción en dos fuentes complementarias**:
  - **Lyrics.ovh** (`/suggest/<frase>`): BUSCA POR CONTENIDO DE LA LETRA. Devuelve metadatos Deezer con `title_short` y `artist.name`. Gratis, sin token. El truco clave: las queries son **ventanas consecutivas de 3–5 palabras del transcrito centradas en cada palabra «rara»** (fuera de una lista de ~50 muletillas). Agrupar las palabras raras sueltas no funciona (pierde la frase; Lyrics.ovh no la encuentra).
  - **LRClib** (`/api/search?q=…`): fallback por título/artista. Su `search` NO busca por contenido de letra, solo por metadatos del track. Útil cuando Whisper devuelve algo parecido al título.
- **Scoring** (`scoreCandidate`): descarga la letra completa del candidato (`loadLyrics`, primero LRClib `/api/get`, luego Lyrics.ovh `/v1/{artist}/{title}`) y suma por 1) palabras raras del transcrito presentes como palabra entera en la letra, 2) ventanas de 2–6 palabras consecutivas que aparezcan en la letra, 3) umbral adaptativo por longitud del transcrito. Devuelve `matched:true` con `confidence ∈ [0, 1]` o `low_lyrics_confidence` con `bestGuess` si no supera el umbral.

### Captura y UI

- **Móvil**: `lib/mic_capture.dart` graba con `record: 5.1.2` a 16 kHz PCM mono WAV. Permiso de `RECORD_AUDIO` con `permission_handler`. La captura devuelve muestras Float32 (para la huella local) y bytes WAV (para enviar a Whisper si la vía 1 falla).
- **UI móvil** (`lib/ui/recognize_sheet.dart`): hoja modal con botón flotante (FAB en todas las pestañas), animación de pulso de 3 anillos, estados «Preparado / Escuchando / Analizando / Consultando / Identificada / No identificada / Error» y, si el match es por letra, botón «Añadir a mi biblioteca» que lanza búsqueda de YouTube con `${title} ${artist}` y pasa la mejor pista al mismo `uploadShared` que Spotify Transfer.
- **Historial** (`lib/recognition_history.dart`): persistente en SharedPreferences, cap 100 entradas. Cada entrada registra estado (`inLibrary`, `pendingImport`, `imported`, `importFailed`, `notMatched`), permitiendo reintentar importaciones fallidas desde el historial.
- **Web** (`frontend/web/js/views/recognize.js`): mismo flujo. `getUserMedia({audio})` → `AudioContext` + `ScriptProcessor` (deprecated pero suficiente para <10 s) → downsample 48→16 kHz → `fingerprintSamples` (JS puro, compartido con el Worker) → mismos endpoints. Botón en el menú «Crear» de la biblioteca. `SHELL_VERSION` bumpeado a 48 para que el service worker meta `recognize.js` en la caché.

### Infraestructura

- `worker/wrangler.toml` añade bindings `RECOGNIZE_DB` (D1) y `AI` (Workers AI). Ambos bajo el plan gratuito con cuota suficiente para uso personal; la cuota de AI se mide en «Neurons» y Whisper-large consume pocos por invocación.
- El Worker se autodespliega por Cloudflare Workers Builds con cada push a `main`.

## Honestidad de alcance y limitaciones

- La vía 1 es **determinista y fiable** para cualquier canción de la biblioteca (515 temas hoy).
- La vía 2 **depende de dos factores poco controlables**: que Whisper sepa transcribir vocales cantadas sobre música con ruido de bar (bien en pop lento con voz clara; peor en rap acelerado, metal o sitios muy ruidosos) y que Lyrics.ovh (base pública construida sobre Deezer) tenga esa canción indexada por un fragmento de letra. Cuando falla, devolvemos `low_lyrics_confidence` o `no_lyrics_match` **sin inventar**.
- No hay ningún modo en el que inventemos un match. Si no estamos seguros, lo decimos.

## Alternativas descartadas

- **AudD / ACRCloud / Shazam API**: comerciales, de pago. Descartadas a petición del usuario.
- **AcoustID + Chromaprint**: base abierta de ~60 M grabaciones, pero su algoritmo está pensado para comparar ficheros completos, no para fragmentos ambiente de 8 s. En un bar con ruido falla mucho. Lo mantenemos como motor secundario si algún día se quiere.
- **LRClib como motor principal de letras**: su `/api/search` solo busca por título/artista (verificado), no por contenido de letra. Queda como fallback.
- **Base de huellas en Workers Assets o KV**: 515 canciones × ~8 k hashes = 3,89 M filas → ~180 MB de datos; no cabe en assets (25 MB/fichero) y KV no lo gestiona bien. D1 es la vía adecuada.
- **Construir nuestra propia base de letras**: trabajo muy grande y Lyrics.ovh ya la tiene. Mejor reutilizarla.

## Resultados verificados end-to-end

- Vía 1: 8 segundos de «8 AM» de Nicki Nicole → `matched:true, songId:"S07057c72fc32f4a3", title:"8 AM", artist:"Nicki Nicole", votes:214, confidence:0.37`.
- Vía 2: 8 segundos del mismo audio → `matched:true, source:"lyrics", title:"8 AM", artist:"Nicki Nicole", confidence:1.0, transcript:"My baby girl Honey, 8 in the morning Y tú estás callin' Yo acabo de verte, baby Honey, 8 in the morning"`.
- Equivalencia Dart ↔ JS del fingerprinter: el mismo tono de 1 kHz produce los mismos 1125 hashes en ambos.
- Pruebas: 1068 web-unit verdes (incluidos 11 nuevos de `recognize-lyrics` y 7 de `recognize-core`/`recognize-endpoint` con D1 simulada), 5 de `fingerprint_test.dart` en la APK, `flutter analyze` limpio.
