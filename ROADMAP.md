# ROADMAP

Cada fase tiene un criterio de cierre. Una fase sólo se marca como terminada cuando sus pruebas pasan y la documentación está al día. La investigación y el desarrollo avanzan en paralelo.

Estado a 2026-11-03, según `main`: web y APK sin usuarios y con el aspecto de Spotify ([ADR-0015](docs/decisions/ADR-0015-interfaz-sin-usuarios-aspecto-spotify.md)), que sustituye en parte a la interfaz única de [ADR-0009](docs/decisions/ADR-0009-interfaz-unica-y-datos-locales.md); portadas y álbumes ([ADR-0016](docs/decisions/ADR-0016-portadas-y-albumes.md)); artista y año importados de Internet Archive; y «Subir canciones» para todos en la web y la APK por la función de Vercel `/api/subir` ([ADR-0017](docs/decisions/ADR-0017-subida-directa-github-web-publica.md)), probada en producción el 2026-11-03.

## Estado por fase

| Fase | Estado | Hecho | En curso | Pendiente |
|---|---|---|---|---|
| 0. Investigación | En curso | Bibliografía verificada (30 entradas numeradas). En `main`, RESEARCH, ALZHEIMER_RESEARCH (borrador), METHODOLOGY (borrador v0.1, sin protocolo aprobado) y SECURITY | Revisión sistemática | Revisión de aplicaciones existentes; dictamen legal sobre audio; texto completo de [B4]; 35 puntos en «Pendientes» de BIBLIOGRAPHY.md |
| 1. Base del proyecto | Hecho | Estructura, ADR-0001 a 0003, pruebas en CI, repositorio privado | — | — |
| 2. Motor de audio | En curso | Experimento objetivo de compresión (cinco grabaciones, 2026-10-31) | — | Prueba perceptual MUSHRA; variantes en GitHub Releases; silencios, picos y calidad de señal |
| 3. Servicio y administración | En curso | Catálogo; importación; publicación y despublicación por incidencias, probadas con incidencias reales; buzón de subida (`buzon.yml`, ADR-0014), probado por las vías privada y pública; subida desde la web y la APK por `/api/subir` (ADR-0017), probada en producción; administración retirada | — | Cola compartida del buzón con `biblioteca.yml`; borrado de canciones |
| 4. Web pública | Implementada sin usuarios | Interfaz sin usuarios con el aspecto de Spotify (ADR-0015, DESIGN 3.0): listas y «Me gusta» en este navegador, uso sin conexión, «Subir canciones» para todos por `/api/subir` (ADR-0017), portadas y álbumes (ADR-0016) e «Importar desde Internet Archive» (incidencia, lista de bloqueo de 42 entradas); desplegada desde `main` | — | Lectores de pantalla y dispositivos reales; `added_at` en los datos públicos; llevar listas a otro navegador (DESIGN §15) |
| 5. Android | En curso | App 1.2.6+10 sin usuarios, con el aspecto de Spotify, listas y «Me gusta» en el teléfono, copia sin conexión, «Subir canciones» para todos por `/api/subir` (ADR-0017) e importación de YouTube desde Homeostasia; análisis, pruebas y APK de depuración validados en CI | — | Release `android-v1.2.4`; firma de producción en CI (requiere recuperar/configurar la clave sin subirla al repositorio); pruebas en dispositivo físico |
| 6. Investigación de campo | Pendiente | — | — | Decidir cómo se estudian las hipótesis sin el registro del estudio (ADR-0015); protocolo y aprobación ética; estudio piloto |

## Fase 0: investigación (en curso)
- [x] Búsqueda de referencias clave y verificación de existencia (BIBLIOGRAPHY.md).
- [ ] Revisión sistemática completa.
- [ ] Revisión de aplicaciones existentes de recuerdos musicales.
- [ ] Dictamen legal sobre audio (ADR-0002).
- [ ] Lectura del texto completo de [B4] (El Haj, Postal y Allain 2012) para resolver la discrepancia abierta sobre n y diseño (BIBLIOGRAPHY.md, «Pendientes»).
- **Cierre:** lista de referencias verificadas y dictamen recibido.

## Fase 1: base del proyecto
- [x] Estructura de carpetas y control de versiones.
- [x] Decisiones de stack documentadas (ADR-0001 a 0003).
- [x] Núcleo de biblioteca, importación y transcodificación con pruebas.
- [x] Repositorio privado en GitHub y primer push (github.com/seryi47/doctorado-reminiscencia, privado; hoy seryi47/reminiscencia).
- [x] Verificación de la integración continua en GitHub Actions (Python 3.12 y 3.13, verde en el commit 891149c).
- **Cierre:** pruebas en verde en local y en GitHub Actions.

## Fase 2: motor de audio (en curso)
- [x] Experimento de compresión objetivo con cinco grabaciones de dominio público (docs/audio-processing/COMPRESSION.md, medido el 2026-10-31).
- [ ] Prueba perceptual MUSHRA (ITU-R BS.1534-3) con oyentes y entorno controlado. No iniciada.
- [ ] Publicación de variantes como assets de GitHub Releases (ADR-0003).
- [ ] Detección de silencios, picos y calidad de señal.
- **Cierre:** tabla de resultados medidos y script de publicación probado.

## Plan v2 (en curso desde 2026-10-31)

Se trabaja en paralelo, cada frente en su propia rama, y se integra en `main` por fases. La administración en Vercel queda **retirada** (ADR-0008): la biblioteca se gestiona con incidencias de GitHub y no hay `ADMIN_PASSWORD` que configurar.

| Frente | Qué entrega | Estado |
|---|---|---|
| Auditoría del brief | Matriz de requisitos con evidencia y verificación adversarial de lo marcado como hecho | Hecho (según CHANGELOG): 0 requisitos cumplidos del todo, 40 parciales, 8 pendientes y 1 descartado |
| Panel de diseño | Especificación de diseño en `docs/user-experience/DESIGN.md` | Hecho: versión 1.0, cierre de diseño del 31-oct-2026. Sustituida por DESIGN 2.0 (2026-11-03): interfaz sin usuarios con el aspecto de Spotify (ADR-0015), y esta por DESIGN 3.0 (2026-11-03: distribución de Spotify de 2025, portadas, álbumes y edición). La versión 1.0 y el rediseño con la estructura de Apple Music quedan en el historial de git |
| Web de escucha | Interfaz nueva según el diseño y uso sin conexión (PWA) | Implementada sin usuarios (ADR-0015). Las fotos y los recuerdos por perfil se retiraron con el modo paciente |
| Datos locales del cuidador | Perfiles, fotos, recuerdos, listas, observaciones e historial en IndexedDB; copia cifrada con contraseña | **Retirado** por ADR-0015: quedan solo las listas y «Me gusta» (`reminiscencia-biblioteca`), sin copia |
| Panel del cuidador | Interfaz para gestionar todo lo anterior, con PIN local de ajustes | **Retirado** por ADR-0015, con el modo cuidador y el PIN |
| App Android | Listas, icono propio, tableta, ajustes persistentes, pruebas | En curso: lo implementado está en la fase 5 (el modo paciente se retiró en la 1.2.0); falta la prueba en dispositivo físico |
| Compresión | Experimento reproducible con ffmpeg y métricas objetivas (sin pruebas perceptuales con personas) | En curso: la parte objetiva está hecha (2026-10-31); falta la prueba perceptual |
| Investigación | Referencias verificadas por DOI y estado del arte; metodología del piloto; seguridad y RGPD | En curso: bibliografía, RESEARCH, METHODOLOGY y SECURITY en `main` como borradores; sin protocolo aprobado |
| Documentación técnica | ARCHITECTURE, DATABASE (modelo entidad-relación), PLAYER, AUDIO_ENGINE, GITHUB_STORAGE | Al día con ADR-0015, ADR-0016 y ADR-0017 (2026-11-03): ARCHITECTURE, DATABASE, GITHUB_STORAGE y PLAYER. La parte 2 de AUDIO_ENGINE describe el reproductor retirado y queda marcada como tal |
| Pruebas de extremo a extremo | Navegador: escucha, subida, uso sin conexión, accesibilidad y medidas | Rehechas para ADR-0015 en `tests/web-e2e/` (`funcional`, `a11y` y `medidas`); `web-e2e.yml` en verde sobre `ae22479` |
| Compilación de APK en GitHub Actions | Artefactos de depuración y producción; carpetas `releases/android/debug` y `production` | En curso: `android.yml` y las carpetas están en `main`; la release lleva un APK por arquitectura. Sin ninguna ejecución todavía |

## Fase 3: servicio y administración (en curso)
- [x] Catálogo versionado en el repositorio como fuente de verdad (ADR-0007).
- [x] Importación por URL en GitHub Actions, probada con ítems reales de Internet Archive.
- [x] Prueba real con incidencias `biblioteca`: importar, publicar y despublicar «Tell me pretty maiden» (incidencias #1 a #3, 2026-11-02). El workflow respondió y cerró las tres.
- [x] Publicación real de una canción por incidencia: «Nomyn Fragments» (CC BY 4.0), 2026-11-02, commit del bot `7b73d19`.
- [x] Buzón de subida (ADR-0014), en `main`. Probado en GitHub por la vía privada el 2026-11-03 (ejecución manual; la primera por push no procesó nada y se corrigió en `34a1f06`).
- [x] Buzón por la vía pública: «prueba-licencia» subida desde GitHub con «Licencia: CC0 1.0 …» (commit `9c8c6ef`) entró pública (`d3b4877`), 2026-11-03.
- [x] Subida desde la web por `/api/subir` (ADR-0017), probada en producción el 2026-11-03: «Prueba subida directa.mp3» (commit `8ac2d17`) se publicó como «Prueba subida directa» (`e7eaa73`) y se despublicó después con la incidencia #21 (`6d62aee`).
- [x] Artista y año importados de los metadatos de Internet Archive (`800b1ce`, merge `007c7eb`).
- [ ] Buzón: la cola compartida con `biblioteca.yml`.
- [x] Administración retirada en favor de incidencias de GitHub (ADR-0008): no hay `ADMIN_PASSWORD` que configurar.
- [x] Funciones de Vercel con contraseña, validación y falla cerrada (retiradas después, en ADR-0008).
- [x] Con la versión anterior del workflow, ya retirada: publicar, despublicar, carpetas y edición de metadatos, probados en GitHub.
- [ ] Borrado de canciones (hoy solo se despublican).
- **Cierre:** una importación y una publicación probadas con incidencias reales. Este criterio está cumplido; la fase se marcará como terminada cuando la documentación esté al día, según la regla general de esta hoja.

## Fase 4: web pública (implementada sin usuarios)
- [x] Desplegada en https://reminiscencia.vercel.app (Git integration, Root Directory `frontend/web`).
- [x] En Cloudflare, con el Worker, en https://reminiscencia.cometia.es (ADR-0034; Vercel bloqueado hasta el 2026-12-07): primer `wrangler deploy`, Workers Builds y APK 1.2.5+9 (2026-11-09). Las funciones de YouTube siguen en Vercel.
- [x] Segunda dirección en Netlify, https://reminiscencia.netlify.app (ADR-0037), mientras Vercel está bloqueado: desplegada y comprobada el 2026-11-10. Cuando vuelva Vercel, decidir si se mantiene o se retira.
- [ ] APK 1.2.6+10: pantalla de apertura propia (ADR-0035) y reproductor estable en sesiones largas y sin canción al abrir (ADR-0036); probada en el emulador, falta un teléfono real.
- [x] Interfaz sin usuarios con el aspecto de Spotify (ADR-0015, DESIGN 3.0), en `main` el 2026-11-03: Inicio, Buscar, Tu biblioteca, páginas de carpeta y lista, reproductor con cola, aleatorio y repetir.
- [x] Listas y «Me gusta» solo en este navegador (`js/local-library.js`).
- [x] «Subir canciones» sube siempre para todos (ADR-0017): uno o varios archivos, convertidos a Opus en el navegador y enviados por trozos de hasta 4 MiB a `/api/subir`, sin pasos ni límites de tamaño ni por hora; «Importar desde Internet Archive» (incidencia, ADR-0008). Las canciones guardadas antes «Solo en este navegador» (ADR-0012) siguen sonando y se borran limpiando listas y «Me gusta».
- [x] Portadas de canciones y álbumes (ADR-0016).
- [x] Lista de bloqueo de la web igual que la del backend (42 entradas).
- [x] Cabeceras de seguridad (CSP) en `frontend/web/vercel.json`; las canciones locales suenan por el service worker sin abrir la CSP a `blob:`.
- [x] Pruebas unitarias (342 el 2026-11-03, local) y de extremo a extremo (`funcional`, `a11y` y `medidas`), en verde en `main`.
- [x] Comprobador de producción `scripts/smoke_produccion.mjs`.
- Retirado por ADR-0015 (antes marcado como hecho): modos paciente y cuidador, perfiles, PIN, recuerdos, fotografías, observaciones, sesiones y registro del estudio, copia cifrada `.rmc` y la hoja «Gestionar la biblioteca».
- [ ] Lectores de pantalla y dispositivos reales (DESIGN §12).
- [ ] Fechas de alta (`added_at`) en los datos públicos para «Añadidas recientemente» (DESIGN §15).
- [ ] Llevar listas y «Me gusta» a otro navegador (sin copia ni exportación; DESIGN §15).
- **Cierre (propuesto):** probada en dispositivos reales y con lectores de pantalla. El criterio anterior, «panel de cuidador con perfiles», se retiró con ADR-0015.

## Fase 5: Android (en curso)
- [x] ADR-0004 (Flutter), app que lee la biblioteca de la web.
- [x] Listas, favoritos, ajustes persistentes, diseño de tableta e icono propio (integrado el 2026-10-31). El modo paciente se retiró en la 1.2.0 (ADR-0015).
- [x] Versión 1.2.0+3: sin usuarios, aspecto de la app de Spotify, «Me gusta», «Subir canciones» (en `main` el 2026-11-03). Desde `b148b74` (merge `3d97a37`) sube para todos por `/api/subir`, como la web (ADR-0017).
- [x] Release por etiqueta con un APK de producción por arquitectura (`arm64-v8a`, `armeabi-v7a` y `x86_64`) y `SHA256SUMS.txt`.
- [ ] Etiqueta `android-v1.2.4` y su release en GitHub.
- [x] Workflow `android.yml` en `main`: análisis, pruebas, APK de depuración y de producción, y release por etiqueta `android-vX.Y.Z`.
- [ ] Primera ejecución de `android.yml` en GitHub Actions. Todavía no hay ninguna, y el APK de producción necesita cuatro secretos de firma que hoy no existen en el repositorio.
- [x] Reproducción en streaming y en segundo plano, notificación y auriculares (emulador Android 15).
- [x] Copia para escuchar sin conexión, probada con la red apagada.
- [x] APK 1.1.0 firmada para producción (clave de subida propia).
- [x] Subida de audio local en la APK, convertida a Opus con FFmpeg y solo en el dispositivo (ADR-0013). Sustituida por la subida para todos de ADR-0017; las canciones locales de antes siguen sonando y se borran. Pendiente de probar en dispositivo físico, como el resto de la fase.
- [ ] Pruebas en dispositivo físico: llamadas, Bluetooth, TalkBack, tabletas.
- [ ] Copia de seguridad de la clave de firma fuera de este equipo.
- **Cierre:** probada en dispositivo real.

## Fase 6: investigación de campo
- [ ] Protocolo y aprobación ética.
- [ ] Estudio piloto.
- **Cierre:** análisis y resultados con sus limitaciones.

## Pendiente

Del propietario (no lo puede hacer el repositorio):
- Borrar la variable `ADMIN_PASSWORD` de Vercel si sigue configurada: ningún fichero del código la lee (ADR-0008). `GITHUB_TOKEN` **no** se borra: lo usa la función `/api/subir` (ADR-0017).
- Revocar el token de GitHub que usaba la administración retirada, si no es el mismo que hoy está en `GITHUB_TOKEN`.
- Clave de firma de Android: sin ella no se puede verificar la compilación de release.
- Leer el texto completo de [B4] para resolver la discrepancia abierta con [clinica-03] (BIBLIOGRAPHY.md).
- Las 18 referencias abiertas de BIBLIOGRAPHY.md: no verificadas o parciales; no se citan hasta resolverlas.
- Probar la cola compartida del buzón con `biblioteca.yml`.

Investigación (ADR-0015, consecuencias):
- **Cómo estudiar las hipótesis sin el registro del estudio.** La web ya no registra sesiones, eventos, condiciones C0 a C2, recuerdos ni observaciones. H2 (recuerdo autobiográfico), H3 (familiaridad) y H4 (fotografía asociada) necesitan otro instrumento o una decisión nueva antes del piloto. Hasta entonces, `METHODOLOGY.md` (borrador v0.1) describe un instrumento que ya no existe.

Interfaz (DESIGN §15):
- Probar con dispositivos y lectores de pantalla reales (VoiceOver, TalkBack y NVDA).
- Fechas de alta (`added_at`) en los datos públicos para que «Añadidas recientemente» sea fiel.
- Llevar listas y «Me gusta» a otro navegador (no hay copia ni exportación).

Retirado por ADR-0015 (antes en esta lista): las discrepancias de DESIGN §17 de la versión 1.0 (parámetros de ruta de la biblioteca del cuidador, «Terminar sesión», borrador del recuerdo, atajos del paciente, «Olvidé el PIN», registro del estudio, validadores de `schema.js`, carpetas del cuidador, elección de modo en el primer uso, texto de fotografías y deshacer en Biblioteca) y el fallo e2e de filas de la Biblioteca del cuidador. Ese código ya no existe.

Hecho, antes en esta lista: `js/intake.js` ya no es un residuo (lo usa la hoja «Subir canciones» para validar la importación); publicar una canción real en GitHub («Nomyn Fragments», 2026-11-02); `publicar` regenera los datos públicos desde el catálogo (ADR-0011); `backend.yml` no ejecuta pruebas web (las ejecutan `web.yml` y `web-e2e.yml`); colaboradores con permiso de escritura e Internet Archive `/download/` (commit `8d29978`, merge `5c060c1`); los comentarios del código que citaban ADR-0014 para la interfaz sin usuarios ya citan ADR-0015 (`88f9275`); el buzón por la vía pública con «Licencia: …» (2026-11-03).

Documentación por actualizar:
- ADR-0005, ADR-0007, ADR-0008 (sus cifras de pruebas están desactualizadas) y RELEASE.md.
- `METHODOLOGY.md`, cuando se decida el instrumento del estudio (ver «Investigación»).
- Numeración: `ADR-0009` es la interfaz única y `ADR-0010` el procesado y la publicación separados (renumerado el 2026-11-02); `ADR-0014` es el buzón y `ADR-0015` la interfaz sin usuarios (renumerado el 2026-11-03).
