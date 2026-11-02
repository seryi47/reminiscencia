# ROADMAP

Cada fase tiene un criterio de cierre. Una fase sólo se marca como terminada cuando sus pruebas pasan y la documentación está al día. La investigación y el desarrollo avanzan en paralelo.

Estado a 2026-11-02, según `main`. Lo que solo existe en una rama aparece como «en curso».

## Estado por fase

| Fase | Estado | Hecho | En curso | Pendiente |
|---|---|---|---|---|
| 0. Investigación | En curso | Bibliografía verificada (30 entradas numeradas). En `main`, RESEARCH, ALZHEIMER_RESEARCH (borrador), METHODOLOGY (borrador v0.1, sin protocolo aprobado) y SECURITY | Revisión sistemática | Revisión de aplicaciones existentes; dictamen legal sobre audio; texto completo de [B4]; 35 puntos en «Pendientes» de BIBLIOGRAPHY.md |
| 1. Base del proyecto | Hecho | Estructura, ADR-0001 a 0003, pruebas en CI, repositorio privado | — | — |
| 2. Motor de audio | En curso | Experimento objetivo de compresión (cinco grabaciones, 2026-10-31) | — | Prueba perceptual MUSHRA; variantes en GitHub Releases; silencios, picos y calidad de señal |
| 3. Servicio y administración | En curso | Catálogo; importación; publicación y despublicación por incidencias, probadas con incidencias reales; administración retirada | — | Borrado de canciones; residuos de seguridad (ver «Pendiente») |
| 4. Web pública | En curso | Escucha, búsqueda y reproductor; gestión por incidencias desde la propia página; desplegada desde `main` | Interfaz única con el panel de cuidador (`feat/ui-publica`) | Repetir la prueba en navegador con `main`; panel de cuidador en `main` |
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
| Panel de diseño | Especificación de diseño en `docs/user-experience/DESIGN.md` | Hecho: versión 1.0, cierre de diseño del 31-oct-2026 |
| Web de escucha (modo paciente) | Interfaz nueva según el diseño, fotos y recuerdos del perfil activo, uso sin conexión (PWA) | En curso: la interfaz está en `feat/ui-publica`; la PWA está en `main` sin conectar a la página |
| Datos locales del cuidador | Perfiles, fotos, recuerdos, listas, observaciones e historial en IndexedDB; copia cifrada con contraseña | En curso: almacén, copia cifrada y validación en `main`, sin conectar; la interfaz, en `feat/ui-publica` |
| Panel del cuidador | Interfaz para gestionar todo lo anterior, con PIN local de ajustes | En curso: dentro de la interfaz única de `feat/ui-publica`. La ruta `/cuidar/` del plan original ya no aparece en la rama |
| App Android | Listas, modo paciente con botones grandes, icono propio, tableta, ajustes persistentes, pruebas | En curso: lo implementado está en la fase 5; falta la prueba en dispositivo físico |
| Compresión | Experimento reproducible con ffmpeg y métricas objetivas (sin pruebas perceptuales con personas) | En curso: la parte objetiva está hecha (2026-10-31); falta la prueba perceptual |
| Investigación | Referencias verificadas por DOI y estado del arte; metodología del piloto; seguridad y RGPD | En curso: bibliografía, RESEARCH, METHODOLOGY y SECURITY en `main` como borradores; sin protocolo aprobado |
| Documentación técnica | ARCHITECTURE, DATABASE (modelo entidad-relación), PLAYER, AUDIO_ENGINE, GITHUB_STORAGE | En curso: DATABASE, PLAYER y AUDIO_ENGINE están en `main` y en buena parte describen `feat/ui-publica`, pendiente de fusión. ARCHITECTURE y GITHUB_STORAGE no existen todavía |
| Pruebas de extremo a extremo | Navegador: escucha, cuidador, copia cifrada, uso sin conexión | En curso: `tests/web-e2e/` en `feat/ui-publica`, con fallos abiertos; no está en `main` |
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

## Fase 4: web pública (en curso)
- [x] Escucha por carpetas, búsqueda, reproductor y vista a pantalla completa en el teléfono.
- [x] Desplegada en https://reminiscencia.vercel.app (Git integration, Root Directory `frontend/web`).
- [x] Sección «Gestionar» en la página: prepara las incidencias de la biblioteca y valida el formato en el navegador (en `main`).
- [ ] Probada en escritorio y teléfono con la versión actual de `main`. La última prueba es de una versión anterior.
- [ ] Panel de cuidador: perfiles, fotos y recuerdos (depende de la fase 6). En curso en `feat/ui-publica`.
- **Cierre:** panel de cuidador con perfiles.

## Fase 5: Android (en curso)
- [x] ADR-0004 (Flutter), app que lee la biblioteca de la web.
- [x] Listas, favoritos, ajustes persistentes, modo paciente, diseño de tableta e icono propio (integrado el 2026-10-31).
- [x] Workflow `android.yml` en `main`: análisis, pruebas, APK de depuración y de producción, y release por etiqueta `android-vX.Y.Z`.
- [ ] Primera ejecución de `android.yml` en GitHub Actions. Todavía no hay ninguna, y el APK de producción necesita cuatro secretos de firma que hoy no existen en el repositorio.
- [x] Reproducción en streaming y en segundo plano, notificación y auriculares (emulador Android 15).
- [x] Copia para escuchar sin conexión, probada con la red apagada.
- [x] APK 1.1.0 firmada para producción (clave de subida propia).
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

Residuos de seguridad y de código:
- `publicar` debe regenerar los datos públicos desde el catálogo, en lugar de aplicar los que trae el paquete. Hoy `procesar` los genera con `sonidos.publish` (`scripts/ci_library.py`).
- El job de pruebas web está duplicado en `backend.yml` y en `web.yml`.
- La prueba «la lista de la web es idéntica a la del backend» (`tests/web-unit/intake.test.mjs`) está marcada `todo` con una nota antigua («33 entradas»). Hoy las dos listas tienen 42 entradas y son iguales, así que la marca sobra.
- Dos fallos de diseño de la interfaz única, señalados en la revisión del 2026-11-02 y pendientes de confirmar y corregir: no se pide el PIN al salir del modo paciente, y se crea una sesión implícita que contamina el registro del estudio.
- Suite e2e de `feat/ui-publica`: fallos abiertos, sobre todo de medidas de diseño y de accesibilidad.

Colaboradores e Internet Archive:
- Colaboradores con permiso de escritura: el contrato está en `feat/contrato-colaboradores`, con cambios sin confirmar. Nada de ese trabajo está en `main`.
- Internet Archive `/download/`: en `main`, `sources.py` ya acepta `archive.org/download/<id>`. Queda por concretar qué falta en la rama de colaboradores.

Documentación por actualizar:
- CHANGELOG, ADR-0005, ADR-0007, ADR-0008 (sus cifras de pruebas están desactualizadas), RELEASE.md y DESIGN.md (su estado).
- Las referencias a ARCHITECTURE y GITHUB_STORAGE, que todavía no existen.
- Numeración: `ADR-0009` es la interfaz única y `ADR-0010` el procesado y la publicación separados (renumerado el 2026-11-02).
