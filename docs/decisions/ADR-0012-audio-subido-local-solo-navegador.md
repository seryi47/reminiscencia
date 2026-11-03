# ADR-0012: Audio subido desde este dispositivo, solo en el navegador

- Estado: aceptada (ampliada a la APK por ADR-0013; sustituida en parte por [ADR-0015](ADR-0015-interfaz-sin-usuarios-aspecto-spotify.md) el 2026-11-03, ver la nota de estado)
- Fecha: 2026-11-02
- Relaciona: ADR-0003 (audio en GitHub), ADR-0006 (audio publicado en la web), ADR-0007 (catálogo), ADR-0008 (entrada por incidencias) y ADR-0009 (interfaz única y datos locales del cuidador)

> **Nota de estado (2026-11-03).** Con [ADR-0015](ADR-0015-interfaz-sin-usuarios-aspecto-spotify.md) la web no tiene usuarios ni modo cuidador: la subida es la opción «Solo en este navegador» de la hoja «Subir canciones», al alcance de cualquiera que use ese navegador. Siguen vigentes el origen, el almacenamiento en `reminiscencia-audio-local`, las tasas de Opus, los límites y el aviso a navegadores sin soporte (decisiones 1 a 5 y 8). Cambian:
> - **Decisión 6 y consecuencia «Metadatos fuera de la copia»:** la copia cifrada `.rmc` se retiró (ADR-0015, decisión 4), así que el pendiente de confirmar qué entra en ella ya no aplica.
> - **Decisión 7:** la CSP de producción (`media-src 'self'`) no admite URL de objeto. Con el service worker activo, cada canción local se pide en `audio/L<16 hex>.opus` y `sw.js` la sirve desde IndexedDB, con rangos; sin service worker se usa la URL de objeto, que la CSP bloquea (ADR-0015, decisión 7). El reproductor es el de ADR-0015, sin modo paciente.
> - **Decisión 9:** `SHELL_VERSION` es hoy 5.
> - **Consecuencia sobre el borrado:** resuelto el pendiente de los vínculos huérfanos. Al borrar una canción local se quita también de «Me gusta» y de las listas (`forgetSong` en `js/local-library.js`). Ya no hay perfiles a los que vincularla.

## Contexto

El cuidador quiere escuchar con el paciente canciones que tiene en su propio dispositivo y que no están en el catálogo público. El flujo de catálogo (incidencias, GitHub Actions, publicación en Vercel) no sirve para esto: exige licencia verificada, pasa por GitHub y acaba en la web pública. Hace falta una vía local que no salga del navegador.

## Decisión

1. **Origen.** El cuidador elige archivos desde su navegador (WAV, MP3, M4A, OGG o FLAC, lo que el navegador pueda decodificar). El archivo se decodifica con `decodeAudioData`, se remuestrea a 48 kHz y se codifica a Opus con `AudioEncoder` (WebCodecs). El resultado se empaqueta como Ogg Opus, el mismo contenedor que el catálogo (RFC 7845).
2. **Almacenamiento.** Se guarda solo en IndexedDB de ese navegador, en una base aparte: `reminiscencia-audio-local`, versión 1, almacén `pistas` (clave `id`). No es la base principal `reminiscencia` de `store.js`, así que esta decisión no cambia su versión ni sus migraciones.
3. **Tasas de Opus.** Mono a 32 kbps y estéreo a 48 kbps, con mezcla a estéreo para más de dos canales. Medido con el codificador libopus de ffmpeg en una canción real del catálogo: unos 252 KB por minuto en mono y 378 KB por minuto en estéreo. El catálogo publicado va a unos 64 kbps estéreo; aquí se elige la tasa más baja que se considera aceptable para escucha.
4. **Límites.** 60 MB por archivo y 20 minutos de duración (la duración acota la memoria: el audio decodificado ocupa 4 bytes por muestra y canal). El espacio se comprueba con `navigator.storage.estimate()` antes de convertir cada archivo, con una reserva de 50 MB. Si no cabe, se avisa con texto y no se guarda. Si el navegador no da cifras, no se bloquea y se indica que no se pudo comprobar.
5. **Fuera del servidor.** No hay `fetch` ni `POST` con el audio. No se tocan `frontend/web/data/*`, `audio-library/*`, el backend, `.github`, Vercel ni la APK. Solo se pide a la API de persistencia del navegador (`navigator.storage.persist()`) que no borre los datos.
6. **Fuera de la copia cifrada.** `backup.js` y `store.js` no leen la base `reminiscencia-audio-local`. La copia no incluye ni el audio ni los metadatos de estas canciones, y su formato no cambia.
7. **Reproducción.** Las canciones se añaden al catálogo en memoria con `local: true` y con `audio` apuntando a una URL de objeto del blob guardado. El reproductor del paciente ya lee `song.audio`, así que no necesita cambios. Sin conexión suenan porque su URL es local (`isPlayable` en `app.js`). La descarga sin conexión las excluye (`listAudioUrls`), porque no existen en el servidor.
8. **Navegadores sin soporte.** Si no hay `AudioEncoder` con Opus, la biblioteca muestra un mensaje en texto desde el principio y, al pulsar el botón, lo repite. No falla en silencio.
9. **Versión del shell.** El módulo nuevo se añade a `SHELL_ASSETS` y `SHELL_VERSION` pasa de 2 a 3, para que el service worker lo precargue.

## Consecuencias

- Las canciones viven solo en ese navegador. Borrar los datos del sitio o cambiar de dispositivo las elimina. No hay copia de estos audios, y es una decisión, no un descuido.
- **Metadatos fuera de la copia.** El encargo decía «solo metadatos» en la copia cifrada. Aquí la copia no lleva ni audio ni metadatos de estas canciones. Incluirlos exigiría subir `payloadVersion` y la validación de `schema.js`, y sin el audio no suenan. **Pendiente de confirmar por el propietario.**
- Borrado: cada canción subida desde este navegador se borra desde «Más opciones» de su fila, con confirmación («¿Borrar esta canción de este navegador? No se puede deshacer.»). Quita el registro de IndexedDB y la URL de objeto. Las canciones públicas no tienen esa opción. Los vínculos de esa canción con perfiles y listas no se borran: quedan en el almacén sin canción a la que apuntar. Pendiente de limpiar.
- La canción se identifica con `L` más 16 hexadecimales. Los identificadores del catálogo empiezan por `S`, así que no chocan.
- Verificación: pruebas unitarias en Node (título, límites, tamaño, espacio, CRC y empaquetado Ogg). Conversión real probada en Chrome 155 con WAV, MP3, FLAC y M4A: duración exacta, Ogg Opus que ffmpeg decodifica sin avisos y que el `<audio>` del navegador reproduce. Fidelidad objetiva de 31 dB en un estéreo de tonos puros. Esto no sustituye una prueba de escucha.

## Cuándo cambiar

- Si se quiere copia de estos audios o sincronizarlos entre dispositivos, hace falta una decisión de almacenamiento (ADR-0003) y de privacidad antes de tocar la copia cifrada.
- Si 20 minutos o 60 MB resultan cortos, se ajustan las constantes tras medir la memoria en un dispositivo de gama baja.
- Si Safari o Firefox ofrecen `AudioEncoder` con Opus, revisar el mensaje de navegadores sin soporte.
