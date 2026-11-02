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
| 4. Web pública | Implementada; pendiente de rediseño | Interfaz única (modo paciente y modo cuidador) con datos locales, copia cifrada, uso sin conexión y gestión de la biblioteca por incidencias; desplegada desde `main` | — | Rediseño visual (decisión del propietario, 2026-11-02); discrepancias funcionales de DESIGN §17; resultado de las pruebas e2e (CHANGELOG) |
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
| Panel de diseño | Especificación de diseño en `docs/user-experience/DESIGN.md` | Hecho: versión 1.0, cierre de diseño del 31-oct-2026. Rediseño visual pendiente (decisión del propietario, 2026-11-02) |
| Web de escucha (modo paciente) | Interfaz nueva según el diseño, fotos y recuerdos del perfil activo, uso sin conexión (PWA) | Implementada en la interfaz única (ADR-0009); pendiente de rediseño visual y de las discrepancias de DESIGN §17 |
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

## Fase 4: web pública (implementada; pendiente de rediseño)
- [x] Escucha por listas y carpetas, búsqueda y reproductor en el modo paciente (ADR-0009).
- [x] Desplegada en https://reminiscencia.vercel.app (Git integration, Root Directory `frontend/web`).
- [x] Gestión de la biblioteca por incidencias desde Biblioteca del modo cuidador («Gestionar la biblioteca»), que valida el formato en el navegador (ADR-0008).
- [x] Panel de cuidador: perfiles, fotos, recuerdos, listas, observaciones, historial y copia cifrada, en la interfaz única.
- [ ] Probada en escritorio y teléfono con la versión fusionada en `main`. La última prueba es de una versión anterior.
- [ ] Pruebas de extremo a extremo: resultado en CHANGELOG.
- [ ] Rediseño visual según la estructura de Apple Music web (decisión del propietario, 2026-11-02).
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
- Rediseño visual de la interfaz según la estructura de Apple Music web (decisión del propietario, 2026-11-02). Hasta entonces, la parte visual de DESIGN no se actualiza.

Interfaz única (ADR-0009; discrepancias funcionales en DESIGN §17):
- Sesión al arrancar: con perfil y modo paciente se abre una sesión sin pasar por C4 (`frontend/web/js/app.js`, líneas 1076 a 1079), y el registro del estudio la recoge. Decidir y corregir.
- Parámetros de ruta de la biblioteca: `mountLibrary` no los lee (`frontend/web/js/cuidador/biblioteca.js`, línea 309). El enlace de Inicio a «sin familiaridad» y las carpetas muestran todo el catálogo.
- Lista de bloqueo de la web: `BLOCKED_HOSTS` en `frontend/web/js/cuidador/incidencias.js` tiene 11 dominios; la de `backend/sonidos/sources.py` tiene más. ADR-0008 exige que la web no acepte más que el backend. Igualarla.
- «Terminar sesión» en el modo cuidador (DESIGN §8.2): no existe.
- Borrador del recuerdo: se escribe cada 5 s y nunca se recupera al reabrir.
- Atajos: ↑ y ↓ cambian el volumen en pasos de 10 % (DESIGN §7.4 dice 5 %). En el paciente, ←/→ mueven el progreso con «Saltar al tocar la barra» (`frontend/web/js/paciente/escuchar.js`, líneas 825 a 832), contra DESIGN §12.
- «Olvidé el PIN» está en P5, y DESIGN §12 dice que ninguna acción destructiva está al alcance del paciente. La especificación debe decidir.
- Bloqueo del PIN: DESIGN P-16 dice 45 s; D12 y §9 dicen 60 s. El código usa 60 s.
- Registro del estudio: el resumen no incluye familiaridad ni preferencia, y el evento «observación registrada» no aparece en el código. Borrar un perfil borra también sus eventos; DESIGN §9 no lo precisa.
- Validadores más laxos que la interfaz: familiaridad de 0 a 5, preferencia de −2 a 2 y nota de observación de 1000 caracteres (`frontend/web/js/schema.js`).
- Carpetas del cuidador: sin menú por debajo de 1280 px, y el clic no filtra.
- Primer uso: falta la elección entre modo cuidador y modo paciente (DESIGN §3.3).
- Falta el texto «Suelta las fotografías aquí» (DESIGN C-22).
- Deshacer en Biblioteca: restaura la asociación con `setSongLink` en lugar de `deleteSongLink` (`frontend/web/js/cuidador/biblioteca.js`, líneas 726 a 735). Pendiente de verificar en el navegador.
- Pruebas e2e: el resultado de la última ejecución está en CHANGELOG. El comentario de `.github/workflows/web-e2e.yml` (línea 19) habla de una interfaz incompleta; revisarlo con ese resultado.
- Cifras de pruebas web: las de `main` antes de la fusión (188 de 189) no valen para el código fusionado. Recalcular con `node --test`.
- Documentación técnica: revisar `docs/user-experience/PLAYER.md`, `docs/datos/DATABASE.md` (almacenes de IndexedDB) y la parte 2 de `docs/audio-processing/AUDIO_ENGINE.md`.

Antes de cerrar la fusión de `feat/ui-publica` en `main`:
- Conflictos previstos (simulación de fusión del 2026-11-02): `frontend/web/index.html` (ambas ramas lo cambian) y `frontend/web/listen.css` (borrado en la rama, modificado en `main`).
- Sin borrarlos, sobreviven a la fusión `frontend/web/js/gestion.js`, `frontend/web/js/intake.js`, `frontend/web/listen.css`, `tests/web-unit/gestion.test.mjs` y `tests/web-unit/intake.test.mjs`. Hay que retirarlos.
- `frontend/web/vercel.json` de la rama no tiene la política de contenido (CSP) que sí tiene `main`. Conservarla y comprobarla después de la fusión.

Residuos de seguridad y de código:
- [x] `publicar` regenera los datos públicos desde el catálogo, en lugar de aplicar los que trae el paquete (hecho el 2026-11-02; ADR-0011).
- [x] Corregido en la documentación: `backend.yml` no ejecuta pruebas web. Las pruebas web las ejecutan `web.yml` (sintaxis y `node --test`) y `web-e2e.yml` (extremo a extremo).

Colaboradores e Internet Archive:
- Colaboradores con permiso de escritura: el contrato está en `feat/contrato-colaboradores`, con cambios sin confirmar. Nada de ese trabajo está en `main`.
- Internet Archive `/download/`: en `main`, `sources.py` ya acepta `archive.org/download/<id>`. Queda por concretar qué falta en la rama de colaboradores.

Documentación por actualizar:
- ADR-0005, ADR-0007, ADR-0008 (sus cifras de pruebas están desactualizadas), RELEASE.md y DESIGN.md (sección 17 al día; la parte visual, pendiente de rediseño).
- Numeración: `ADR-0009` es la interfaz única y `ADR-0010` el procesado y la publicación separados (renumerado el 2026-11-02).
