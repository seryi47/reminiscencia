# CHANGELOG

## Sin publicar (2026-11-02)

### Añadido
- Datos locales del cuidador (almacén IndexedDB, copia cifrada y validación) y PWA con service worker, manifiesto e iconos para escuchar sin conexión (`8a19a09`).
- Integración continua de la web en `.github/workflows/web.yml`: sintaxis y pruebas con `node:test` (`7f93756`).
- Investigación verificada (`4b79df2`): bibliografía maestra en `BIBLIOGRAPHY.md`, `RESEARCH.md`, `ALZHEIMER_RESEARCH.md`, `METHODOLOGY.md` y `SECURITY.md`.
- Documentación técnica (`43034bc`): ADR-0009 de interfaz única y datos locales, `docs/audio-processing/AUDIO_ENGINE.md`, `docs/datos/DATABASE.md` y `docs/user-experience/PLAYER.md`.
- Backend de la biblioteca por incidencias y paquete de cambios (`b6c986b`; ADR-0008): el procesado deja un paquete de cambios y la publicación lo valida y lo aplica por separado. El paquete solo admite rutas de audio con identificador y de los tres JSON públicos, y solo puede borrar audio; el catálogo y los datos públicos se reescriben. El workflow `library` pasa a `biblioteca`.
- Web con gestión por incidencias y la misma lista de bloqueo que el backend (42 entradas), con rechazo de caracteres de formato (`14dbe82`).
- Prueba real de importar, publicar y despublicar «Tell me pretty maiden» con las incidencias #1, #2 y #3, todas cerradas. La pista queda en el catálogo con `public: false`.
- Prueba real de importación privada por incidencia (#5, 2026-11-02): la ejecución 41490773271 pasa por `autorizar`, `procesar` y `publicar` en success. El commit `e988292` del bot («biblioteca: import») añade el audio y el catálogo de la canción (+16 líneas en `catalog.json`), y la parte pública no cambia. Sin probar: publicar una canción (la parte pública cambia) y la concurrencia `queue: max`.
- Interfaz única (ADR-0009): modo paciente (escucha, listas, carpetas, búsqueda y salida con PIN) y modo cuidador (inicio, biblioteca, perfiles, recuerdos, observaciones, copia cifrada, PIN local y ajustes) en una sola página (`frontend/web/index.html`, `js/app.js`, `js/paciente/`, `js/cuidador/` y `css/`). Los datos del cuidador están en IndexedDB (versión 3), con copia cifrada `.rmc` y uso sin conexión.
- Pruebas de extremo a extremo y de accesibilidad en `tests/web-e2e/` (puppeteer-core y axe-core) y workflow `web-e2e.yml`. Resultado de la última ejecución: {{RESULTADO_E2E}}.

### Cambiado
- «Gestionar la biblioteca» pasa de la página de escucha a Biblioteca del modo cuidador (`js/cuidador/incidencias.js`). La petición sigue siendo una incidencia de GitHub con la etiqueta `biblioteca` (ADR-0008).
- Publicar regenera la parte pública desde el catálogo (`ba1825e`; ADR-0011). El paquete del procesado ya no lleva `frontend/web/data/*.json` ni el audio publicado: `publicar` los regenera con `sonidos.publish.sync_public` después de aplicar el paquete, compara el audio por contenido, valida el identificador de cada canción pública y avisa, sin fallar, de lo que la regeneración cambia fuera del paquete o sustituye.
- Revisión de la bibliografía, consulta del 2026-11-02 (`61eb229`): quedan resueltos 17 de los 35 pendientes de `BIBLIOGRAPHY.md`, con Crossref y PubMed (y, según el caso, Europe PMC, la página de la revista en Cambridge Core y el manuscrito aceptado en PMC). Quedan 18 abiertos. Corregido: el resumen de Garrido et al. 2018 no comunica resultados sobre la ansiedad, y se retira esa atribución de `RESEARCH.md` y `METHODOLOGY.md`.

### Retirado
- Página de escucha anterior (`app.js`, `styles.css` y `listen.css` de la raíz de `frontend/web/`) y la sección «Gestionar» de esa página (`js/gestion.js`, `js/intake.js` y sus pruebas), sustituidas por la interfaz única (ADR-0009).
- Administración de la web pública (`0fa6ed3`): se borran `frontend/web/admin/`, las funciones `api/` (catálogo, despacho y ejecuciones) y `lib/` (autenticación, GitHub y validación).

### En curso
- Contrato de colaboradores e Internet Archive `/download/` en `feat/contrato-colaboradores`, que todavía no tiene commits propios.

## Integrado: app Android y entrega de APK (2026-10-31)

### Añadido
- App Android: listas de reproducción locales (crear, renombrar, borrar, añadir y quitar canciones), favoritos, ajustes persistentes (tamaño de texto de 1.0 a 1.6, modo paciente, alto contraste, reducir animaciones), diseño de tableta a partir de 720 dp con navegación lateral, gestión de errores con reintento e icono propio generado con `scripts/android/make_icon.py`.
- 48 pruebas Flutter en verde; análisis estático sin avisos.
- Workflow `android.yml`: compilación de depuración y de producción por etiquetas `android-v*`, verificación de la firma con la huella del certificado de producción y publicación en GitHub Releases.
- Carpetas `releases/android/debug/` y `releases/android/production/` (los APK no se versionan) y `docs/android/RELEASE.md` con el procedimiento para una versión nueva.
- `scripts/android/verify_apk.sh` para comprobar paquete, versión y firma de un APK.

### Pendiente de comprobar
- El workflow `android.yml` todavía no se ha ejecutado en GitHub Actions: se probará con la primera etiqueta.
- Los secretos de firma (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) hay que crearlos en el repositorio; no están configurados.

## En curso (plan v2)

- Auditoría del brief: hecha. Resultado estricto: 0 requisitos completamente cumplidos, 40 parciales, 8 pendientes y 1 descartado (plataformas de vídeo, por motivos legales).
- Gestión pública sin administración: peticiones como incidencias de GitHub, solo del propietario (backend y web en ramas separadas, con revisión de seguridad).
- Investigación, metodología del piloto, seguridad y RGPD, y experimento reproducible de compresión (ramas con verificación independiente de las referencias).
- Datos locales del cuidador (perfiles, fotos, recuerdos, listas, observaciones, historial, copia cifrada y PIN local) y uso sin conexión (service worker, manifiesto e iconos).
- Diseño de la interfaz: panel de tres propuestas, jurado y síntesis.
- La administración en Vercel queda sin uso; se retira junto con `ADMIN_PASSWORD` y `GITHUB_TOKEN`, que ya no hacen falta.

## Administración en Vercel, catálogo versionado y app 1.1.0

### Añadido
- Catálogo `audio-library/indexes/catalog.json` como fuente de verdad (ADR-0007): carpetas, metadatos, licencia, hash y estado público.
- Workflow `library` en GitHub Actions: importar por URL, publicar/despublicar, crear/renombrar/borrar carpetas y editar metadatos. Probado en GitHub con ítems reales de Internet Archive.
- Administración en `/admin/` de la web de Vercel, con contraseña (`ADMIN_PASSWORD`) y falla cerrada. Funciones `api/catalog`, `api/dispatch` y `api/runs`, con validación de entradas y permisos mínimos.
- Web de escucha rediseñada: lista densa, carpetas, búsqueda, reproductor fijo y vista a pantalla completa en el teléfono.
- App Android 1.1.0: biblioteca desde Vercel, copia para escuchar sin conexión y reproducción probada con la red apagada.
- ADR-0005 (entrada por URL con licencia), ADR-0006 (audio publicado en el repositorio), ADR-0007 (catálogo y flujo desde Vercel).

### Corregido
- La web daba 404 en el audio porque estaba fuera de Git (ADR-0006).
- Reproducción bloqueada en la APK de publicación: caché de audio en 127.0.0.1 con HTTP sin cifrar (solo se permite ese destino).
- La app se bloqueaba al arrancar el servicio de audio: faltaba el permiso `WAKE_LOCK`.
- La biblioteca no cargaba si fallaba el audio: ahora la lista se muestra aunque el reproductor falle.
- El directorio raíz de Vercel estaba vacío: cada despliegue habría publicado el repositorio entero. Fijado a `frontend/web`.

### Retirado
- Panel local (`python -m sonidos serve`), API de FastAPI, cola en memoria y `frontend/admin` local.
- Base de datos SQLite como fuente de verdad (migrada al catálogo y eliminada en local).
- Audio empaquetado dentro de la APK.

### Pendiente
- Configurar `ADMIN_PASSWORD` en Vercel (Production) y probar el panel de extremo a extremo.
- Pruebas de la app en dispositivo físico (llamadas, Bluetooth, TalkBack).
- Copia de seguridad de la clave de firma de Android fuera de este equipo.

## [Sin publicar]

### Añadido
- Estructura inicial del proyecto y control de versiones.
- Núcleo de backend en Python: lectura de metadatos con ffprobe, huella SHA-256, perfiles de transcodificación (Opus, AAC, MP3), biblioteca SQLite con detección de duplicados y licencia obligatoria, índice JSON sin rutas locales, CLI.
- 11 pruebas automatizadas con audio sintético generado por ffmpeg; todas pasan en local.
- Flujo de integración continua en GitHub Actions (Python 3.12 y 3.13).
- Documentación: CLAUDE.md, PROJECT_MASTER.md, RESEARCH.md, BIBLIOGRAPHY.md, ROADMAP.md, ADR-0001 a ADR-0003, COMPRESSION.md.

### Añadido (límites y publicación)
- `sonidos/limits.py`: constantes de los límites verificados de GitHub; rechaza assets de release de 2 GiB o más; reparte en lotes de hasta 999 assets más manifiesto; audita los ficheros versionados (aviso > 50 MiB, bloqueo > 100 MiB, repositorio > 1 GiB ideal y > 5 GiB máximo).
- `sonidos/release.py`: manifiesto SHA256SUMS y comandos `gh release create/upload`. Sólo simula salvo que se pida ejecutar.
- `scripts/check_repo_limits.py` y job de GitHub Actions que falla si el repositorio incumple los límites.
- 11 pruebas nuevas (22 en total).

### Añadido (biblioteca, web y Android)
- Ocho grabaciones de dominio público de Internet Archive (declaradas en el ítem original), importadas con su licencia y con variante Opus 64 kbps. Verificadas por SHA-256 tras descargarlas de la release.
- Publicación del lote de audio como release privada `audio-2026-10-31-01` en GitHub, con manifiesto SHA-256. Corregido un fallo: las variantes tenían el mismo nombre y se pisaban.
- Web de reproducción en HTML estático, desplegada en Vercel. Probada en Chrome: carga, reproducción, siguiente y pausa.
- App Flutter (`mobile/`) con reproducción en segundo plano, controles multimedia y auriculares. Probada en emulador Android 15.
- `sonidos build-web` y `scripts/sync_mobile_assets.sh`.
- APK firmada para producción (release `apk-2026-10-31-produccion`), verificada con apksigner y probada otra vez en emulador tras reinstalar.
- Job de Flutter en GitHub Actions (versión 3.44.9): análisis y pruebas.
- Web pública en https://reminiscencia.vercel.app, con `vercel.json` que sirve los `.opus` como `audio/ogg; codecs=opus`.

### Añadido (entrada por URL y panel)
- ADR-0005: entrada por URL restringida. Internet Archive con licencia en los metadatos y ficheros directos con licencia declarada. Plataformas de vídeo y streaming bloqueadas por código.
- `sonidos/sources.py`, `sonidos/intake.py`, `sonidos/api.py`: resolución, descarga con límite de 200 MB e importación.
- Panel local `frontend/admin` (importar, buscar, estadísticas, preparar la web) servido por `python -m sonidos serve`.
- Pista nueva importada y publicada: Christmas Bells (Internet Archive, dominio público declarado). Web pública con 9 pistas.
- Corregido: las rutas guardadas en la base de datos apuntaban a la carpeta antigua tras renombrar el proyecto.

### Añadido (procesado en segundo plano)
- `sonidos/jobs.py`: cola de importaciones con un único hilo trabajador. `POST /api/intake` responde 202 al instante y `GET /api/jobs/{id}` da el estado. Una URL no admitida se rechaza antes de encolar.
- El panel muestra el progreso de cada importación.
- Pruebas en vivo: respuesta en 39 ms; importación de `DvorakSymphonyNo.9fromTheNewWorld` (dominio público declarado) completada en segundo plano, con audio Opus de 8 min 26 s.
- Limitación: el estado de los trabajos vive en memoria.

### Decidido
- Sin descarga desde YouTube ni otras plataformas (ADR-0002).
- Audio de reproducción en GitHub Releases; el repositorio contiene índice, código y documentación (ADR-0003).
