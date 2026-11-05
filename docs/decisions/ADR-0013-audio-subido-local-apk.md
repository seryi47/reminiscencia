# ADR-0013: Audio subido desde el teléfono, solo en la APK

- Estado: aceptada; la subida de canciones nuevas solo en el teléfono queda sustituida por [ADR-0017](ADR-0017-subida-directa-github-web-publica.md) el 2026-11-03 (ver la nota de estado)
- Fecha: 2026-11-02
- Relaciona: ADR-0012 (misma decisión en la web; este ADR la extiende a la APK y cambia su línea «no se tocan ... la APK»), ADR-0004 (app Android), ADR-0007 (catálogo desde la web) y ADR-0009 (datos locales del cuidador).

> **Nota de estado (2026-11-03, ADR-0017).** La APK ya no guarda canciones nuevas solo en el teléfono. «Subir canciones» (`mobile/lib/shared_upload.dart`, commit `b148b74`, merge `3d97a37`) sube siempre para todos, como la web: elige uno o varios archivos (WAV, MP3, M4A, FLAC u OGG), convierte cada uno a Opus con FFmpeg en el teléfono, sin los límites de 60 MB y 20 minutos de la decisión 4, y lo envía en trozos de hasta 4 MiB a `https://reminiscencia.vercel.app/api/subir`, que lo guarda en el buzón del repositorio con el `GITHUB_TOKEN` de Vercel; el workflow `buzon` lo publica con la licencia fija de la web. La app no guarda ningún token. Las canciones subidas antes con este ADR siguen en `biblioteca-local/`, suenan sin red y se borran desde su fila (decisiones 3, 5, 6, 7 y 9 vigentes para ellas). La decisión 12 (conversión solo en primer plano) se aplica también a la subida para todos: lo que no llegó a subirse queda como pendiente. Lo que este ADR dice de «nada sale del dispositivo» describe la subida de antes.

## Contexto

El cuidador quiere escuchar con el paciente canciones que tiene en el teléfono y que no están en el catálogo público. La web ya lo permite (ADR-0012). La APK necesita lo mismo, con las mismas reglas: nada sale del dispositivo y nada se publica.

## Decisión

1. **Origen.** El cuidador elige archivos (WAV, MP3, M4A, FLAC u OGG) con el selector del sistema. Cada archivo se convierte a Ogg Opus con FFmpeg (`ffmpeg_kit_flutter_new_audio`, que incluye libopus; el paquete `_min` no lo trae y falla con «Unknown encoder libopus»). Tasas como en la web: mono 32 kbps y estéreo 48 kbps, 48 kHz; más de dos canales se mezclan a estéreo. La conversión la hace FFmpeg del propio dispositivo: no hay red.
2. **Título.** El nombre del archivo sin la última extensión. Sin nombre útil, «Sin título». Máximo 200 caracteres.
3. **Almacenamiento.** `biblioteca-local/` dentro del almacenamiento privado de la app: `audio/<id>.opus` para el audio y `pistas.json` para los metadatos. Los ids empiezan por `L`, así no chocan con el catálogo (`S`). Nada de esto se sube a GitHub, a Vercel ni a ningún servidor.
4. **Límites.** 60 MB por archivo y 20 minutos de duración. Sin comprobación de espacio libre: Flutter no tiene una API equivalente a `navigator.storage.estimate()` sin un plugin adicional. Es una diferencia respecto a la web.
5. **Copia de seguridad.** Igual que la web (ADR-0012, punto 6): la copia no incluye ni el audio ni los metadatos de las canciones subidas desde este teléfono. En Android, toda la carpeta `biblioteca-local/` queda excluida de la copia automática (`backup_rules.xml`), de la copia en la nube y del traspaso entre dispositivos (`data_extraction_rules.xml`). Se prueba en `test/backup_rules_test.dart`, que lee ambos ficheros y el manifiesto.
6. **Borrado.** Cada canción local se borra desde su fila («Borrar de este teléfono») con confirmación. Sale del índice y después se borra el fichero. Las canciones del catálogo no tienen esa opción.
7. **Reproducción.** Las canciones locales entran en la lista y en la cola como cualquier otra. Su `audio` es la ruta del fichero, así que suenan sin red y en segundo plano.
8. **Sincronización sin temporizadores (ahorro de batería).** La biblioteca se sincroniza al abrir la app, al refrescar a mano y al volver a primer plano solo si han pasado 10 minutos desde la última vez. No hay sondeos ni tareas periódicas. Sin red se usa la copia guardada y no hay error bloqueante.
9. **Retirada de canciones.** Al sincronizar, el audio guardado de una canción que ya no está en la web se borra solo si no está sonando ni en la cola. Si está en uso, se borra cuando deja de estarlo. Las canciones locales no se tocan nunca.
10. **Descarga sin conexión.** Con la opción «Guardar para escuchar sin conexión» (que se recuerda), la sincronización descarga las canciones nuevas solo con Wi-Fi o cable. *Actualización 2026-11-05: ya no se distingue la red; se descarga también con datos móviles, a petición del usuario.* Sin esa opción, no se descarga nada en la sincronización. Pedir la descarga a mano usa cualquier red, como antes.
11. **Sin red en la reproducción.** Una canción descargada o local suena sin red, en la cola y al pasar de una a otra. Una canción no descargada sin red se salta con un mensaje y no detiene la cola.
12. **Conversión en primer plano.** Al salir de la app (`onPause`) la conversión se para. Los archivos ya guardados se conservan; el resto se marca como pendiente y el cuidador lo vuelve a añadir. No sigue en segundo plano.
13. **Navegadores y sistemas sin soporte.** No aplica: FFmpeg está incluido en la APK. Si la conversión de un archivo falla, se indica el motivo.

## Consecuencias

- La APK pesa más: el paquete mínimo de FFmpeg añade sus bibliotecas nativas (`libffmpegkit.so`, `libswscale`, `libswresample` y otras por arquitectura). La APK de depuración pesa 223 MB con todas las arquitecturas, sin reducir. No hay medida previa a la incorporación de FFmpeg, así que el impacto exacto no se midió.
- Permisos: `INTERNET` (ya existía), `ACCESS_NETWORK_STATE` (nuevo, para saber si hay Wi-Fi). No hay permisos de almacenamiento: el selector del sistema da acceso a los archivos elegidos.
- Wakelocks: la app no pide ninguno. `audio_service` y `just_audio` mantienen el bloqueo solo mientras suena música. Sin reproducción no queda trabajo en segundo plano.
- Las canciones locales viven en un teléfono. Desinstalar la app, borrar sus datos o cambiar de teléfono las elimina; no hay copia de estos audios ni de sus metadatos.

## Verificación

- Pruebas unitarias Flutter de la lógica (título, tasas, límites, identificadores, índice, alta, borrado, poda protegida por la cola, sincronización por tiempo, descarga solo en Wi-Fi, cancelación de la conversión) y de las reglas de copia de Android.
- `flutter analyze` sin avisos y `flutter build apk --debug` correcto.
- Sin verificar en dispositivo: reproducción real con la pantalla bloqueada y el salto de canciones no descargadas sin red. Eso requiere un teléfono. La copia de Android solo se comprueba en el contenido de sus reglas, no en una copia real.

## Cuándo cambiar

- Si se quiere copia de estas canciones o sincronizarlas entre dispositivos, hace falta una decisión de almacenamiento (ADR-0003) y de privacidad, igual que en ADR-0012.
- Si se quiere desactivar «escuchar sin conexión» desde la interfaz, falta un control; hoy la opción se recuerda y no se puede quitar desde la app.
