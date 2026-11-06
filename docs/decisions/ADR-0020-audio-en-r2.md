# ADR-0020: Audio en Cloudflare R2

- Estado: aceptada y completa (fase 3, 2026-11-05): R2 es el único sitio que sirve el audio público. La web ya no publica audio en `frontend/web/audio/`; Vercel redirige `/audio/<id>.opus` al bucket.
- Fecha: 2026-11-05.
- Relacionadas: ADR-0014 y ADR-0017 (buzón y subida), ADR-0008 (publicación por workflows).

> **Nota (2026-11-05):** con [ADR-0024](ADR-0024-audio-privado-en-r2.md) hay un segundo bucket, privado, que es la fuente de verdad de todo el audio. `sync_r2.py` ya no toma el audio público de `audio-library/audio/`: sube al privado el audio nuevo y copia al público, desde la copia local o desde el privado, el de las canciones públicas. Los secretos de GitHub añaden `R2_PRIVATE_BUCKET`.

## Contexto

Vercel sirve el audio público (`frontend/web/audio/`, 188 canciones, unos 315 MB). El 2026-11-04 Vercel avisó de que el equipo gratuito había usado el 75 % de *Fast Origin Transfer* (10 GB al mes); superar el límite pausa los proyectos. Cada móvil que instale la APK con descarga automática (Wi-Fi) baja todo el audio, así que el consumo crece con el número de móviles y de canciones.

Cloudflare R2 no cobra la salida de datos y su capa gratuita incluye 10 GB de almacenamiento al mes (cifras a verificar en la página de precios de Cloudflare antes de activarlo; pide una cuenta con método de pago aunque no se supere el plan gratuito).

## Decisión

1. Se prepara R2 como segundo destino del audio público, sin cambiar de dónde lo lee hoy la web ni la APK. Vercel sigue sirviendo todo y la biblioteca del repositorio sigue siendo la fuente de verdad.
2. `scripts/sync_r2.py` (con `backend/sonidos/r2.py`) sincroniza el audio de las canciones públicas (las de `frontend/web/data/songs.json`, tomado de `audio-library/audio/`) con el bucket en las claves `audio/<id>.opus`, con `Content-Type: audio/ogg; codecs=opus` y `Cache-Control: public, max-age=31536000, immutable` (el id es el SHA-256 del contenido, así que un fichero nunca cambia). Por defecto solo simula; subir exige `--aplicar` y las variables `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` y `R2_BUCKET`. Nunca borra del bucket salvo con `--borrar-sobrantes`. Solo sube lo público: las canciones privadas no están en `songs.json`. Usa un cliente S3 propio con firma SigV4 (`SigV4Client`, solo biblioteca estándar; comprobado con el ejemplo oficial de AWS y contra botocore), así que ningún workflow con credenciales instala paquetes.
3. Las credenciales de R2 serán secretos de GitHub Actions, nunca del repositorio, y solo las lee el paso de publicación (como el token de escritura de `buzon.yml`).

## Estado (2026-11-05, fase 3 completa)

- Bucket `reminiscencia-audio` con acceso público por `r2.dev` y CORS (`GET` y `HEAD` desde la web y `localhost`, con `Range`); secretos `R2_*` en GitHub. Antes de la fase 3 se comprobó que las 205 canciones públicas estaban en R2 con el mismo tamaño que en el repositorio.
- **Publicación:** el job `publicar` de `buzon.yml` y de `biblioteca.yml` ejecuta `sync_r2.py --aplicar --borrar-sobrantes` después de aplicar el paquete y antes de subir a main. Una canción nueva está en R2 antes de que la web o la APK la anuncien, y una despublicada se borra del bucket. Si R2 falla, no se sube nada a main. Nunca vacía el bucket (si no queda ninguna canción pública, no borra nada).
- **Repaso:** `r2.yml` sube lo que falte cuando terminan `buzon` o `biblioteca`, con un push que toque `audio-library/audio/` o `songs.json`, o a mano. Nunca borra.
- **Web:** `publish.py` ya no copia audio a `frontend/web/audio/` (la carpeta se borró del repositorio) y `vercel.json` redirige `/audio/:file` a R2 (307, temporal). El service worker (`fetchAudio`) pide el audio a R2 con `Range`; si falla, el propio origen redirige a R2. La primera visita, sin service worker, también va a R2 por la redirección.
- **APK:** descarga de R2 y, en el segundo intento, de la web (que redirige a R2). El streaming reintenta una vez desde la web si R2 falla (`shouldRetryFromFallback`, `_retryFromFallback`).
- `r2.dev` está pensado para pruebas (Cloudflare puede limitar la velocidad); para producción conviene un dominio propio. Al cambiarlo hay que tocar `AUDIO_ORIGIN` (`offline-core.js`), la CSP y la redirección de `vercel.json`, y `kAudioBase` (APK).
- Pendiente: el historial de Git conserva el audio que hubo en `frontend/web/audio/` (el repositorio no encoge sin reescribir la historia); lo que se ahorra es el crecimiento futuro, la mitad por canción.

## Activación (fases, cada una reversible)

1. Crear el bucket público (dominio propio o `r2.dev`), con CORS para `GET` y `Range` desde el dominio de la web. Subir el audio actual con `python scripts/sync_r2.py --aplicar` y comprobar las URLs.
2. Añadir `AUDIO_BASE_URL` (vacío = el mismo origen, como ahora) a la web y a la APK. En la web, ampliar `media-src` y `connect-src` de la CSP de `vercel.json` y hacer que el service worker (`sw.js`, `offline-core.js`) reconozca el audio de ese origen. En la APK, `LibraryStore.audioUri`.
3. Hacer que `buzon.yml` y `biblioteca.yml` suban a R2 las canciones nuevas antes de que la web las anuncie, y entonces dejar de copiar el audio a `frontend/web/audio/`. *Hecho el 2026-11-05.*
4. Si R2 falla, el audio sigue completo en `audio-library/audio/`: volver atrás es revertir la fase 3 (que `publish.py` vuelva a copiar a la web y quitar la redirección).

## Consecuencias

- Vercel ya no sirve ni despliega audio: solo la web y la redirección. El consumo de *Fast Origin Transfer* por audio desaparece.
- El audio sigue en el repositorio público de GitHub, ahora una sola copia en `audio-library/audio/` (unos 355 MB; el límite recomendado es de 1 GB), así que a largo plazo hay que decidir si el repositorio conserva una copia.
- Antes de activarlo hay que decidir el dominio del bucket y quién guarda las credenciales.

## Validación

- `backend/tests/test_r2.py`: canciones públicas desde `songs.json` (rechaza ids, rutas y audio que faltan o son enlaces), plan de subida, no vaciar el bucket, firma SigV4 con el ejemplo oficial de AWS, cliente S3 con un `urlopen` simulado (paginación, cabeceras, errores sin cuerpo) y el script en simulación sobre el repositorio real.
- `backend/tests/test_r2_workflow.py`: `publicar` sube a R2 antes de `git push`, solo ese paso recibe las credenciales de R2 (y no el token de GitHub), solo corre desde main y ningún paso con credenciales instala paquetes.
- `tests/web-unit/cabeceras.test.mjs`: la redirección de `/audio/:file` a R2 y que la web no lleva audio.
- Firma comparada en local contra botocore 1.43.100 (GET con query, PUT y DELETE): idéntica.
- Sin verificar todavía en vivo: la redirección de Vercel y el paso de R2 de `publicar` (se verá con la primera publicación tras fusionar).
