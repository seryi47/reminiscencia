# ROADMAP

Cada fase tiene un criterio de cierre. Una fase sólo se marca como terminada cuando sus pruebas pasan y la documentación está al día. La investigación y el desarrollo avanzan en paralelo.

Estado a 2026-11-02, según `main`, con la interfaz única de [ADR-0009](docs/decisions/ADR-0009-interfaz-unica-y-datos-locales.md).

## Estado por fase

| Fase | Estado | Hecho | En curso | Pendiente |
|---|---|---|---|---|
| 0. Investigación | En curso | Bibliografía verificada (30 entradas numeradas). En `main`, RESEARCH, ALZHEIMER_RESEARCH (borrador), METHODOLOGY (borrador v0.1, sin protocolo aprobado) y SECURITY | Revisión sistemática | Revisión de aplicaciones existentes; dictamen legal sobre audio; texto completo de [B4]; 35 puntos en «Pendientes» de BIBLIOGRAPHY.md |
| 1. Base del proyecto | Hecho | Estructura, ADR-0001 a 0003, pruebas en CI, repositorio privado | — | — |
| 2. Motor de audio | En curso | Experimento objetivo de compresión (cinco grabaciones, 2026-10-31) | — | Prueba perceptual MUSHRA; variantes en GitHub Releases; silencios, picos y calidad de señal |
| 3. Servicio y administración | En curso | Catálogo; importación; publicación y despublicación por incidencias, probadas con incidencias reales; administración retirada | — | Borrado de canciones; residuos de seguridad (ver «Pendiente») |
| 4. Web pública | Implementada y rediseñada | Interfaz única (modo paciente y modo cuidador) con la estructura de Apple Music web, datos locales, copia cifrada, uso sin conexión, audio subido desde el dispositivo (ADR-0012), lista de bloqueo de 42 entradas y gestión de la biblioteca por incidencias; desplegada desde `main` | — | Discrepancias funcionales de DESIGN §17; medidas de DESIGN §3, §4 y §5.4 por poner al día con el rediseño |
| 5. Android | En curso | App 1.1.0 con listas, favoritos, modo paciente y copia sin conexión; workflow `android.yml` en `main` | — | Primera ejecución de `android.yml`; firma de producción en CI; pruebas en dispositivo físico; copia de seguridad de la clave |
| 6. Investigación de campo | Pendiente | — | — | Protocolo y aprobación ética; estudio piloto |

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
| Panel de diseño | Especificación de diseño en `docs/user-experience/DESIGN.md` | Hecho: versión 1.0, cierre de diseño del 31-oct-2026. Rediseño visual hecho en `main` (2026-11-02, estructura de Apple Music web, decisión del propietario); DESIGN corregido según el código en su aviso inicial |
| Web de escucha (modo paciente) | Interfaz nueva según el diseño, fotos y recuerdos del perfil activo, uso sin conexión (PWA) | Implementada en la interfaz única (ADR-0009) y rediseñada; pendientes las discrepancias de DESIGN §17 |
| Datos locales del cuidador | Perfiles, fotos, recuerdos, listas, observaciones e historial en IndexedDB; copia cifrada con contraseña | Implementado en la interfaz única: IndexedDB (versión 3), copia cifrada `.rmc` y PIN local |
| Panel del cuidador | Interfaz para gestionar todo lo anterior, con PIN local de ajustes | Implementado como modo cuidador de la interfaz única. La ruta `/cuidar/` del plan original no existe |
| App Android | Listas, modo paciente con botones grandes, icono propio, tableta, ajustes persistentes, pruebas | En curso: lo implementado está en la fase 5; falta la prueba en dispositivo físico |
| Compresión | Experimento reproducible con ffmpeg y métricas objetivas (sin pruebas perceptuales con personas) | En curso: la parte objetiva está hecha (2026-10-31); falta la prueba perceptual |
| Investigación | Referencias verificadas por DOI y estado del arte; metodología del piloto; seguridad y RGPD | En curso: bibliografía, RESEARCH, METHODOLOGY y SECURITY en `main` como borradores; sin protocolo aprobado |
| Documentación técnica | ARCHITECTURE, DATABASE (modelo entidad-relación), PLAYER, AUDIO_ENGINE, GITHUB_STORAGE | Parcial: ARCHITECTURE y GITHUB_STORAGE describen la interfaz (2026-11-02). Pendiente: revisar DATABASE (almacenes de IndexedDB), PLAYER y la parte 2 de AUDIO_ENGINE, que describen la rama antes de la integración |
| Pruebas de extremo a extremo | Navegador: escucha, cuidador, copia cifrada, uso sin conexión | Implementadas en `tests/web-e2e/` y en el workflow `web-e2e.yml`. Resultado de la última ejecución en CHANGELOG |
| Compilación de APK en GitHub Actions | Artefactos de depuración y producción; carpetas `releases/android/debug` y `production` | En curso: `android.yml` y las carpetas están en `main`; sin ninguna ejecución todavía |

## Fase 3: servicio y administración (en curso)
- [x] Catálogo versionado en el repositorio como fuente de verdad (ADR-0007).
- [x] Importación por URL en GitHub Actions, probada con ítems reales de Internet Archive.
- [x] Prueba real con incidencias `biblioteca`: importar, publicar y despublicar «Tell me pretty maiden» (incidencias #1 a #3, 2026-11-02). El workflow respondió y cerró las tres.
- [x] Administración retirada en favor de incidencias de GitHub (ADR-0008): no hay `ADMIN_PASSWORD` que configurar.
- [x] Funciones de Vercel con contraseña, validación y falla cerrada (retiradas después, en ADR-0008).
- [x] Con la versión anterior del workflow, ya retirada: publicar, despublicar, carpetas y edición de metadatos, probados en GitHub.
- [ ] Borrado de canciones (hoy solo se despublican).
- **Cierre:** una importación y una publicación probadas con incidencias reales. Este criterio está cumplido; la fase se marcará como terminada cuando la documentación esté al día, según la regla general de esta hoja.

## Fase 4: web pública (implementada y rediseñada)
- [x] Escucha por listas y carpetas, búsqueda y reproductor en el modo paciente (ADR-0009).
- [x] Desplegada en https://reminiscencia.vercel.app (Git integration, Root Directory `frontend/web`).
- [x] Gestión de la biblioteca por incidencias desde Biblioteca del modo cuidador («Gestionar la biblioteca»), que valida el formato en el navegador (ADR-0008).
- [x] Panel de cuidador: perfiles, fotos, recuerdos, listas, observaciones, historial y copia cifrada, en la interfaz única.
- [x] Rediseño con la estructura de Apple Music web (decisión del propietario, 2026-11-02), en `main`.
- [x] Audio subido desde el dispositivo, solo en el navegador (ADR-0012), en `main`.
- [x] Lista de bloqueo de la web igual que la del backend (42 entradas), en `main`.
- [x] Cabeceras de seguridad (CSP) en `frontend/web/vercel.json`, en `main`.
- [x] Sesión de escucha solo desde la entrada en C4 y bloqueo del PIN de 60 s, en `main`.
- [ ] Pruebas de extremo a extremo: 147 de 148 en verde sobre `c663e5c`; no repetidas sobre `main` (CHANGELOG).
- [ ] Discrepancias funcionales de DESIGN §17 (lista en «Pendiente»).
- **Cierre:** panel de cuidador con perfiles.

## Fase 5: Android (en curso)
- [x] ADR-0004 (Flutter), app que lee la biblioteca de la web.
- [x] Listas, favoritos, ajustes persistentes, modo paciente, diseño de tableta e icono propio (integrado el 2026-10-31).
- [x] Workflow `android.yml` en `main`: análisis, pruebas, APK de depuración y de producción, y release por etiqueta `android-vX.Y.Z`.
- [ ] Primera ejecución de `android.yml` en GitHub Actions. Todavía no hay ninguna, y el APK de producción necesita cuatro secretos de firma que hoy no existen en el repositorio.
- [x] Reproducción en streaming y en segundo plano, notificación y auriculares (emulador Android 15).
- [x] Copia para escuchar sin conexión, probada con la red apagada.
- [x] APK 1.1.0 firmada para producción (clave de subida propia).
- [x] Subida de audio local en la APK, convertida a Opus con FFmpeg y solo en el dispositivo (ADR-0013, en `main`). Pendiente de probar en dispositivo físico, como el resto de la fase.
- [ ] Pruebas en dispositivo físico: llamadas, Bluetooth, TalkBack, tabletas.
- [ ] Copia de seguridad de la clave de firma fuera de este equipo.
- **Cierre:** probada en dispositivo real.

## Fase 6: investigación de campo
- [ ] Protocolo y aprobación ética.
- [ ] Estudio piloto.
- **Cierre:** análisis y resultados con sus limitaciones.

## Pendiente

Del propietario (no lo puede hacer el repositorio):
- Borrar las variables `ADMIN_PASSWORD` y `GITHUB_TOKEN` de Vercel. Ningún fichero del código las lee (ADR-0008).
- Revocar el token de GitHub que usaba la administración retirada.
- Clave de firma de Android: sin ella no se puede verificar la compilación de release.
- Leer el texto completo de [B4] para resolver la discrepancia abierta con [clinica-03] (BIBLIOGRAPHY.md).
- Publicar una canción real en GitHub: sin probar. Publicar cambia la parte pública; requiere permiso expreso del propietario.
- Las 18 referencias abiertas de BIBLIOGRAPHY.md: no verificadas o parciales; no se citan hasta resolverlas.
- Fallo e2e: «Biblioteca a 1440 px: se ven 11 filas completas» (`tests/web-e2e/cuidador.e2e.mjs`, línea 81) mide 10 filas. Decidir si el código o la prueba cambian; no se ha tocado en la tarea de documentación.

Hecho en `main` (2026-11-02), antes en esta lista: rediseño con la estructura de Apple Music web; lista de bloqueo igualada (42 entradas); sesión solo desde C4; PIN de 60 s en P-16 de DESIGN.

Interfaz única (ADR-0009; discrepancias funcionales en DESIGN §17):
- Parámetros de ruta de la biblioteca: `mountLibrary` no los lee (`frontend/web/js/cuidador/biblioteca.js`, línea 309). El enlace de Inicio a «sin familiaridad» y las carpetas muestran todo el catálogo.
- «Terminar sesión» en el modo cuidador (DESIGN §8.2): no existe.
- Borrador del recuerdo: se escribe cada 5 s y nunca se recupera al reabrir.
- Atajos: ↑ y ↓ cambian el volumen en pasos de 10 % (DESIGN §7.4 dice 5 %). En el paciente, ←/→ mueven el progreso con «Saltar al tocar la barra» (`frontend/web/js/paciente/escuchar.js`, líneas 825 a 832), contra DESIGN §12.
- «Olvidé el PIN» está en P5, y DESIGN §12 dice que ninguna acción destructiva está al alcance del paciente. La especificación debe decidir.
- Registro del estudio: el resumen no incluye familiaridad ni preferencia, y el evento «observación registrada» no aparece en el código. Borrar un perfil borra también sus eventos; DESIGN §9 no lo precisa.
- Validadores más laxos que la interfaz: familiaridad de 0 a 5, preferencia de −2 a 2 y nota de observación de 1000 caracteres (`frontend/web/js/schema.js`).
- Carpetas del cuidador: sin menú por debajo de 1280 px, y el clic no filtra.
- Primer uso: falta la elección entre modo cuidador y modo paciente (DESIGN §3.3).
- Falta el texto «Suelta las fotografías aquí» (DESIGN C-22).
- Deshacer en Biblioteca: restaura la asociación con `setSongLink` en lugar de `deleteSongLink` (`frontend/web/js/cuidador/biblioteca.js`, líneas 726 a 735). Pendiente de verificar en el navegador.
- Pruebas e2e: el resultado de la última ejecución está en CHANGELOG. El comentario de `.github/workflows/web-e2e.yml` (línea 19) habla de una interfaz incompleta; revisarlo con ese resultado.
- Cifras de pruebas web: `node --test "tests/web-unit/*.test.mjs"` da 650 de 650 en `main` (2026-11-02, commit `8638a86`).
- Documentación técnica: revisar `docs/user-experience/PLAYER.md`, `docs/datos/DATABASE.md` (almacenes de IndexedDB) y la parte 2 de `docs/audio-processing/AUDIO_ENGINE.md`.

Fusión de `feat/ui-publica` (hecha en `main`, merge `0629371`):
- Retirados en `main`: `frontend/web/js/gestion.js`, `app.js` y `listen.css` de la raíz, y `tests/web-unit/gestion.test.mjs`.
- Pendiente: `frontend/web/js/intake.js` y `tests/web-unit/intake.test.mjs` siguen en `main`. La app no importa `intake.js`, pero `js/offline-core.js` lo lista en `SHELL_ASSETS`. Retirarlo exige cambiar código y la versión del shell.

Residuos de seguridad y de código:
- [x] `publicar` regenera los datos públicos desde el catálogo, en lugar de aplicar los que trae el paquete (hecho el 2026-11-02; ADR-0011).
- [x] Corregido en la documentación: `backend.yml` no ejecuta pruebas web. Las pruebas web las ejecutan `web.yml` (sintaxis y `node --test`) y `web-e2e.yml` (extremo a extremo).

Colaboradores e Internet Archive:
- Colaboradores con permiso de escritura e Internet Archive `/download/`: fusionados en `main` (commit `8d29978`, merge `5c060c1`).

Documentación por actualizar:
- ADR-0005, ADR-0007, ADR-0008 (sus cifras de pruebas están desactualizadas), RELEASE.md y DESIGN.md (§17 al día; las tablas de medidas de §3, §4 y §5.4, pendientes de poner al día con el rediseño).
- Numeración: `ADR-0009` es la interfaz única y `ADR-0010` el procesado y la publicación separados (renumerado el 2026-11-02).
