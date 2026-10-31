# ADR-0004: App Android con Flutter

- Estado: aceptada (actualizada el 2026-10-31)

## Decisión

Flutter (Dart), con `just_audio` para la reproducción, `audio_service` para la sesión multimedia y el servicio en primer plano, `audio_session` para interrupciones y auriculares, `http` para leer la biblioteca y `path_provider` para la copia local.

- La biblioteca se lee de `https://reminiscencia.vercel.app/data/songs.json` y `folders.json` (la misma web que escucha el público).
- Las canciones se guardan en el dispositivo cuando se escuchan (caché) o con el botón «Guardar para escuchar sin conexión».
- La APK **no lleva audios dentro**: pesa unos 50 MB y se actualiza sin recompilar cuando cambia la biblioteca.

Motivos de Flutter: la toolchain ya estaba instalada, y es la opción con paquetes de reproducción en segundo plano maduros. Alternativa descartada por ahora: Kotlin con Media3, que daría más control nativo a costa de duplicar la interfaz.

## Qué está verificado (emulador Android 15, arm64)

- Análisis estático sin incidencias; pruebas unitarias del modelo y del árbol de carpetas en verde.
- APK de publicación firmada con la clave de subida de OrbitaLabs (`CN=Sonidos para recordar`), verificada con `apksigner`. Versión 1.1.0 (código 2).
- Carga de la biblioteca desde Vercel: 9 canciones, estado «en línea».
- Reproducción en streaming: `PLAYING`, con foco de audio, sin errores.
- Descarga para escuchar sin conexión: la interfaz sigue respondiendo durante la descarga.
- Con la red apagada: la app abre con «sin conexión (copia guardada)» y reproduce desde el fichero guardado.
- Pausa y reproducción desde la notificación y las teclas de auriculares.

## Problemas encontrados y corregidos

1. **Reproducción bloqueada en la APK de publicación.** La caché de audio de `just_audio` usa un servidor local en `127.0.0.1` con HTTP sin cifrar, y Android lo bloquea en compilaciones de publicación. Solución: una configuración de red que permite HTTP solo hacia `127.0.0.1` y `localhost`. El resto de la red exige HTTPS.
2. **Bloqueo de la interfaz («isn't responding») al arrancar el servicio de audio.** El servicio pide un bloqueo de CPU (`WAKE_LOCK`) que el manifiesto no declaraba; el sistema lo mató por no llegar a `startForeground`. Solución: declarar `WAKE_LOCK`.
3. **La biblioteca no cargaba aunque la red funcionaba.** El error venía de preparar el audio, no del catálogo. Solución: separar la carga de la lista y la preparación del reproductor; si el audio falla, la lista sigue visible.

## Qué no está verificado

- Llamadas entrantes y otras interrupciones de audio. En el emulador, una llamada pausa la reproducción; no quedó claro si debe reanudarse sola al colgar. Para uso con personas mayores lo prudente es que no se reanude sin que alguien la pulse. Decisión pendiente.
- Auriculares Bluetooth y desconexiones reales: solo en un dispositivo físico.
- TalkBack y pantallas de tableta.
- Publicación en Google Play: no está previsto por ahora.

## Decisiones pendientes

- Identificador de paquete `es.orbitalabs.reminiscencia`: se confirma antes de cualquier publicación en tienda.
- Copia de seguridad de la clave de firma (`~/.android-keys/`), fuera de este equipo: si se pierde, no se pueden publicar actualizaciones de la app.
