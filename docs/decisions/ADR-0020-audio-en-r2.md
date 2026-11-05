# ADR-0020: Audio en Cloudflare R2 (preparación, sin cortar Vercel)

- Estado: aceptada; activa en la APK y en la copia automática. La web también lee de R2 (por su service worker), con Vercel de respaldo.
- Fecha: 2026-11-05.
- Relacionadas: ADR-0014 y ADR-0017 (buzón y subida), ADR-0008 (publicación por workflows).

## Contexto

Vercel sirve el audio público (`frontend/web/audio/`, 188 canciones, unos 315 MB). El 2026-11-04 Vercel avisó de que el equipo gratuito había usado el 75 % de *Fast Origin Transfer* (10 GB al mes); superar el límite pausa los proyectos. Cada móvil que instale la APK con descarga automática (Wi-Fi) baja todo el audio, así que el consumo crece con el número de móviles y de canciones.

Cloudflare R2 no cobra la salida de datos y su capa gratuita incluye 10 GB de almacenamiento al mes (cifras a verificar en la página de precios de Cloudflare antes de activarlo; pide una cuenta con método de pago aunque no se supere el plan gratuito).

## Decisión

1. Se prepara R2 como segundo destino del audio público, sin cambiar de dónde lo lee hoy la web ni la APK. Vercel sigue sirviendo todo y la biblioteca del repositorio sigue siendo la fuente de verdad.
2. `scripts/sync_r2.py` (con `backend/sonidos/r2.py`) sincroniza `frontend/web/audio/*.opus` con el bucket en las claves `audio/<id>.opus`, con `Content-Type: audio/ogg; codecs=opus` y `Cache-Control: public, max-age=31536000, immutable` (el id es el SHA-256 del contenido, así que un fichero nunca cambia). Por defecto solo simula; subir exige `--aplicar` y las variables `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` y `R2_BUCKET`. Nunca borra del bucket salvo con `--borrar-sobrantes`. Solo sube lo público: las canciones privadas no están en `frontend/web/audio/`.
3. Las credenciales de R2 serán secretos de GitHub Actions, nunca del repositorio, y solo las lee el paso de publicación (como el token de escritura de `buzon.yml`).

## Estado (2026-11-05)

- Hecho: bucket `reminiscencia-audio` con acceso público por `r2.dev` y CORS (`GET` y `HEAD` desde la web y `localhost`, con `Range`); 188 canciones subidas; secretos `R2_*` en GitHub; `.github/workflows/r2.yml` copia el audio nuevo cuando terminan `buzon` o `biblioteca` (sin permiso de escritura, sin borrar); la APK descarga de R2 (`kAudioBase`) y, si falla, de Vercel (segundo intento).
- La web mantiene las rutas `/audio/<id>.opus`; el service worker (`fetchAudio`) las pide a R2 con `Range` y, si falla, al propio origen; la CSP añade solo el bucket a `connect-src`. Sin service worker activo (primera visita) el audio sale de Vercel. El streaming de la APK lee de R2 y no tiene respaldo, así que una canción recién subida puede tardar unos segundos en sonar hasta que `r2.yml` la copie.
- `r2.dev` está pensado para pruebas (Cloudflare puede limitar la velocidad); para producción conviene un dominio propio.

## Activación (fases, cada una reversible)

1. Crear el bucket público (dominio propio o `r2.dev`), con CORS para `GET` y `Range` desde el dominio de la web. Subir el audio actual con `python scripts/sync_r2.py --aplicar` y comprobar las URLs.
2. Añadir `AUDIO_BASE_URL` (vacío = el mismo origen, como ahora) a la web y a la APK. En la web, ampliar `media-src` y `connect-src` de la CSP de `vercel.json` y hacer que el service worker (`sw.js`, `offline-core.js`) reconozca el audio de ese origen. En la APK, `LibraryStore.audioUri`.
3. Hacer que `buzon.yml` y `biblioteca.yml` suban a R2 las canciones nuevas antes de que la web las anuncie, y entonces dejar de copiar el audio a `frontend/web/audio/`.
4. Si R2 falla, basta vaciar `AUDIO_BASE_URL`: el audio sigue en el repositorio y Vercel.

## Consecuencias

- Mientras no se activen las fases 1-3, nada cambia para el usuario y no hay riesgo de cortar Vercel.
- El audio seguiría en el repositorio público de GitHub (unos 315 MB; el límite recomendado es de 1 GB), así que a largo plazo hay que decidir si el repositorio conserva una copia.
- Antes de activarlo hay que decidir el dominio del bucket y quién guarda las credenciales.

## Validación

`backend/tests/test_r2.py` (plan de subida, no borrar por defecto, paginación y cabeceras con un cliente S3 simulado, y simulación sin credenciales). `python scripts/sync_r2.py` en modo simulación: 188 canciones, 314,5 MB por subir.
