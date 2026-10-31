# ADR-0004: App Android con Flutter

- Estado: aceptada
- Fecha: 2026-10-31

## Contexto

La app Android debe reproducir en segundo plano, mostrar los controles del sistema y funcionar con la biblioteca empaquetada, sin depender de la red.

## Decisión

Flutter (Dart), con `just_audio` para la reproducción, `audio_service` para la sesión multimedia y el servicio en primer plano, y `audio_session` para interrupciones y auriculares.

Motivos:
- La toolchain de Flutter, el JDK y el SDK de Android ya estaban instalados en este equipo.
- Permite compartir el modelo de datos y la lógica de la biblioteca con otras plataformas, sin duplicar la interfaz.
- Los paquetes elegidos son los de referencia para reproducción en segundo plano en Flutter.

Alternativa descartada por ahora: Kotlin con Jetpack Compose y Media3. Daría más control nativo, pero duplicaría la interfaz. Se reconsiderará si `audio_service` presenta problemas en dispositivos reales.

## Qué está verificado

- Análisis estático sin incidencias y 2 pruebas unitarias del modelo de canción.
- APK de publicación compilada (60 MB). Está firmada con la clave de depuración de la plantilla de Flutter, no con una clave de producción.
- Instalación y arranque en un emulador Android 15 (arm64).
- Reproducción iniciada, con estado `PLAYING` y posición avanzando.
- Tras pasar a segundo plano: notificación presente y foco de audio `USAGE_MEDIA` activo.
- Tecla de pausa y de reproducción de auriculares: cambian el estado a `PAUSED` y `PLAYING`.
- Tecla siguiente: avanza a la pista 2.

## Qué NO está verificado

- Llamadas entrantes y otras interrupciones de audio.
- Desconexión de auriculares con cable o Bluetooth en un dispositivo real.
- Pantallas de otros tamaños y tabletas.
- Accesibilidad con lector de pantalla (TalkBack).
- Firma de producción: falta una clave de firma propia.

## Decisiones pendientes del usuario

- Identificador de paquete `es.orbitalabs.sonidos_recordar`: confirmar o cambiar antes de publicar.
- Clave de firma de producción: hay que generarla y guardarla fuera del repositorio.
