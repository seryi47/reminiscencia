# ADR-0018: Reanudar trabajos externos de YouTube

- Estado: aceptada.
- Fecha: 2026-11-03.
- Relacionadas: ADR-0015 (interfaz sin usuarios), ADR-0017 (publicación común por `/api/subir`).

## Contexto

yttowav puede aceptar una conversión y mantenerla en cola durante más de los diez minutos que espera una sesión de la web o la APK. Las consultas repetidas a `/api/youtube/status` son sondeos del mismo trabajo, no nuevas conversiones. Al agotarse el tiempo, la interfaz anterior perdía el identificador y un reintento podía crear otro trabajo.

El trabajo de producción consultado el 2026-11-03 pasó de la posición 37 a la 33 de una cola de 50 y posteriormente respondió 404 («Job not found»). No se descargó un WAV y no se encontró una ruta pública de cancelación en el sitio del proveedor.

## Decisión

1. La web guardará `jobId` y la traza por ID de vídeo en `localStorage`; Android los guardará en `SharedPreferences`. No se guarda el título, la URL de la playlist ni otro dato de la canción en este registro.
2. Si se vuelve a importar un vídeo con un trabajo pendiente, se consultará el mismo `jobId` en vez de enviar otro `POST /api/youtube/convert`.
3. Un estado terminal de error o una respuesta 404 elimina el trabajo guardado. Solo el siguiente intento explícito podrá crear una conversión nueva. Un timeout de seguimiento o un error temporal conserva el identificador para poder reanudarlo.
4. «Detener seguimiento» y cerrar la hoja abortan las consultas y esperas locales. No se presentarán como cancelación de la conversión externa: el proveedor puede continuar el trabajo.
5. Se conserva el límite de diez minutos por sesión de seguimiento y el flujo de publicación existente. El WAV descargado y validado sigue pasando por la cola común de `/api/subir`.

## Consecuencias

- Reabrir la hoja o la aplicación y volver a introducir la playlist permite retomar trabajos que el proveedor aún conserve.
- Un trabajo vencido no genera reintentos de creación automáticos: se informa del 404, se olvida el ID y la persona decide cuándo volver a intentarlo.
- Borrar los datos del navegador o desinstalar la aplicación también borra el identificador local; no existe un registro central para recuperar el trabajo.
- No se afirma que la conversión ni la publicación se hayan completado hasta descargar el WAV y observar el estado posterior de la cola común.

## Validación posterior

El 2026-11-03 una prueba autorizada posterior completó la conversión, descargó y validó el WAV y publicó la canción en el catálogo. Las respuestas temporales 502 fueron seguidas por consultas correctas al mismo trabajo; no se crearon conversiones repetidas. La reproducción del Opus publicado se comprobó en Chrome de escritorio. La reproducción en un Android físico sigue pendiente.
