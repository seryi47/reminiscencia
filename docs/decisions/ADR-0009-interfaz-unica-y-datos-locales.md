# ADR-0009: Interfaz única y datos locales

- Estado: aceptada e implementada en `main` (fusión de `feat/ui-publica`, merge `0629371`, 2026-11-02).
- Fecha: 2026-11-02
- Relacionada con: ADR-0001 (stack), ADR-0004 (app Android), ADR-0007 (catálogo público), ADR-0008 (entrada por incidencias), ADR-0012 (audio subido desde el dispositivo, solo en el navegador). Especificación: `docs/user-experience/DESIGN.md`. Estado de la implementación: DESIGN sección 17 y [ROADMAP](../../ROADMAP.md).

## Contexto

- `docs/user-experience/DESIGN.md` (versión 1.0, cierre de diseño del 31-oct-2026) es la especificación de la interfaz: dos modos, paciente y cuidador; tokens visuales; y la lista de comprobación WCAG 2.2 AA de su sección 10. Su parte visual se rediseñó en `main` el 2026-11-02, con la estructura de Apple Music web (decisión del propietario); DESIGN se corrige según el código en su aviso inicial.
- La web es una aplicación progresiva (PWA) en HTML, CSS y JavaScript sin framework, que debe funcionar sin conexión (DESIGN sección 1). ADR-0001, punto 5, fija HTML, CSS y JavaScript estáticos, sin framework (sustituye la propuesta de Next.js); no trata el funcionamiento sin conexión.
- Los datos personales (perfiles, fotografías, recuerdos, observaciones e historial) se guardan solo en el navegador del cuidador. No hay cuentas, sincronización en la nube, publicidad ni scripts de terceros (DESIGN sección 1 y decisión D38).
- El catálogo de canciones es público y se sirve desde `frontend/web` (ADR-0007). Lo que el cuidador registra no forma parte de ese catálogo.
- IndexedDB es una base de datos, pero vive en el navegador del cuidador, no en el servidor. La web no envía datos personales a ningún servidor (decisión 7). La fuente de verdad del catálogo sigue siendo `audio-library/indexes/catalog.json` (ADR-0007). `CLAUDE.md` dice que no hay base de datos en el servidor, y eso sigue siendo cierto.

## Decisión

1. **Interfaz única en módulos ES, sin framework y sin dependencias de runtime.** `frontend/web/index.html` carga `js/app.js`, que arranca el modo paciente (`js/paciente/`) y el modo cuidador (`js/cuidador/`). Los módulos se importan con rutas relativas. No hay `package.json` bajo `frontend/web/`. Las dependencias de prueba están solo en `tests/web-e2e/` (puppeteer-core y axe-core) y no llegan al navegador.

2. **IndexedDB es el almacén de datos personales** (`frontend/web/js/store.js`; base `reminiscencia`, versión 3 del esquema). Almacenes: `profiles`, `songLinks`, `memories`, `photos`, `playlists`, `observations` e `history` (versión 1); `studyEvents`, con el registro del estudio (versión 2); `memoryDrafts`, con los borradores de recuerdo (versión 3); y `meta`, con los ajustes, el PIN, el perfil activo y la fecha de la última copia. El audio subido desde el dispositivo del cuidador no está en este almacén: vive en su propia base, `reminiscencia-audio-local` (ADR-0012).

3. **Preferencias de pantalla en localStorage** (`frontend/web/js/prefs.js`): tamaño de texto, contraste, apariencia, movimiento y atajos. Van en una sola clave con un objeto JSON y no contienen datos personales. Todo acceso va en try/catch: si el navegador no deja escribir, el valor vale solo durante la sesión (DESIGN sección 9 y D38). `js/app.js` guarda además el último modo y la última condición de sesión, que tampoco son datos personales.

4. **PIN y copia cifrada con WebCrypto, sin librerías** (`frontend/web/js/crypto.js`):
   - **PIN de 4 a 6 dígitos** (DESIGN D12; `PIN_PATTERN` en `js/schema.js`). Solo se guarda el hash PBKDF2-SHA-256, con sal aleatoria de 16 bytes y 310 000 iteraciones (`PIN_ITERATIONS`). Cinco fallos seguidos bloquean 60 segundos sin borrar nada (`PIN_MAX_FAILURES` y `PIN_LOCK_MS` en `store.js`). `removePin()` quita solo el PIN y su bloqueo, y los datos se conservan. Se llama desde Ajustes («Quitar PIN», con el PIN actual) y desde la pantalla de salida del paciente («Olvidé el PIN», tras confirmación).
   - **Copia solo en el navegador** (DESIGN sección 9, D26 y D38): un fichero `.rmc` que descarga el propio cuidador. La web no la sube a ningún servidor. Va cifrada con AES-GCM de 256 bits. La clave sale de la contraseña con PBKDF2-SHA-256 y 600 000 iteraciones (`BACKUP_ITERATIONS`); la sal es de 16 bytes y el IV de 12. La cabecera del sobre se autentica como datos adicionales (AAD). La contraseña tiene al menos 10 caracteres (`MIN_PASSPHRASE_LENGTH`). El lector acepta de 100 000 a 2 000 000 iteraciones. Cualquier fallo de descifrado da el mismo mensaje. La copia no incluye el hash del PIN ni los ajustes, y sí el registro del estudio (`js/backup.js`).
   - Importar tiene dos modos: combinar (por defecto) y sustituir (`restoreBackup`, con `mode` `merge` o `replace`).

5. **Sin conexión con service worker y Cache Storage** (`frontend/web/sw.js` y `frontend/web/js/offline-core.js`):
   - El shell (páginas, CSS, JavaScript, datos e iconos) se sirve con `staleWhileRevalidate` desde la caché `reminiscencia-shell-v4` (`SHELL_VERSION` = 4). `SHELL_ASSETS` lista 55 rutas, todas existentes en el árbol.
   - Los JSON de `data/` van primero a la red y, si falla, a la caché.
   - El audio que el usuario guarda para escuchar sin conexión está en la caché `reminiscencia-audio-v1`. Su nombre lo da `audioCacheName()` en `js/offline-core.js`, y lo usan `js/pwa.js` y el editor de listas del cuidador.
   - `js/pwa.js` registra el service worker desde `app.js`; `index.html` enlaza `manifest.webmanifest`.

6. **Fuente Atkinson Hyperlegible Next autoalojada**, en los pesos 400, 600 y 700, en WOFF2 y con licencia SIL OFL 1.1 (`frontend/web/fonts/`). La declara un `@font-face` en `frontend/web/css/base.css` (DESIGN sección 5.3 y D31).

7. **Sin scripts de terceros ni analítica.** `index.html` carga solo hojas y scripts propios. Las únicas peticiones de red son lecturas de ficheros estáticos del mismo origen (`data/*.json`, audio y shell). El único enlace a otro dominio es el de «Gestionar la biblioteca», que abre en GitHub, en pestaña nueva, una incidencia nueva con el texto escrito (`js/cuidador/incidencias.js`; ADR-0008). La interfaz no llama a la API de GitHub ni guarda ningún token.

## Consecuencias

- **Lógica probada sin navegador:** `tests/web-unit/` usa `node:test` y no tiene dependencias npm. `node --test "tests/web-unit/*.test.mjs"` ejecuta todos los ficheros, y `index.mjs` carga todos los `*.test.mjs` de la carpeta, incluido `player.test.mjs`.
- **Extremo a extremo y accesibilidad:** `tests/web-e2e/` usa puppeteer-core y axe-core con las etiquetas WCAG 2.2 AA (`helpers/elementos.mjs`). Necesita Chrome (variable `CHROME_PATH`, o rutas habituales) y Node 22.12 o superior. Levanta un servidor estático local en 127.0.0.1. Su prueba de accesibilidad falla ante fallos de gravedad serious o critical (`a11y.e2e.mjs`). El workflow `web-e2e.yml` se lanza con push y pull request que cambian `frontend/web/**` o `tests/web-e2e/**`.
- **Sin sincronización entre dispositivos:** un perfil existe solo en el navegador donde se creó. La copia `.rmc` es la única vía para llevarlo a otro, y sin su contraseña no hay recuperación (DESIGN sección 9).
- **El PIN no protege los datos** frente a quien tenga el dispositivo desbloqueado. Evita salidas accidentales y nada más (DESIGN sección 9).
- **Riesgo de purga en Safari, mitigado:** se pide `navigator.storage.persist()` al crear el primer perfil (`js/cuidador/asistente.js`) y desde Ajustes. Si el navegador no la concede, Inicio lo avisa. Inicio también recomienda instalar la app en iOS. El navegador puede negar la persistencia en cualquier momento.
- **Avisos de almacenamiento:** Inicio avisa cuando el uso supera el 80 % de la cuota que informa `navigator.storage.estimate()`, y cuando han pasado más de 14 días desde la última copia (`lastBackupAt`).
- **Iteraciones dentro del sobre:** cada copia guarda sus iteraciones, y el lector acepta el rango indicado en la decisión 4.
- **Versión del shell:** cada cambio del shell exige subir `SHELL_VERSION` en `frontend/web/js/offline-core.js`, como indica la cabecera de `sw.js`.
- **Sin dependencias de runtime:** introducir un framework o una librería de runtime cambia esta decisión y requiere un ADR nuevo.

## Alternativas descartadas

- **Framework de interfaz** (por ejemplo, Next.js). ADR-0001 lo descartó porque añadiría un framework sin función real mientras no exista una API con datos personales. DESIGN sección 1 lo excluye.
- **Almacenamiento en la nube y sincronización entre dispositivos.** Excluidos por DESIGN sección 1. Los datos personales se quedan en el navegador del cuidador (D38).
- **Cuentas de usuario.** Excluidas por DESIGN sección 1. Sin cuentas no hace falta un servidor de datos personales.
- **Recuperar el PIN restableciendo el navegador** (propuesta A de DESIGN). Descartada porque borra todos los datos (D12 y sección 14).

## Estado de la implementación (2026-11-02)

- Las pantallas del paciente (P1 a P6) y del cuidador (C1 a C5) existen en el código. El detalle, pantalla por pantalla, está en DESIGN sección 17 (estado funcional). El estado visual se rediseñó el 2026-11-02.
- Discrepancias resueltas en `main` (2026-11-02):
  1. La sesión de escucha solo se abre desde la entrada en C4 (`js/app.js`, `beginSession`). Arrancar la app no abre sesión.
  2. La lista de bloqueo de la web (`BLOCKED_HOSTS` en `js/cuidador/incidencias.js`) tiene las mismas 42 entradas que la del backend (`BLOCKED_HOSTS` en `backend/sonidos/sources.py`). Lo comprueba `tests/web-unit/cuidador-incidencias-paridad.test.mjs`, como exige ADR-0008.

## Pendiente

**Validación con personas y dispositivos (DESIGN sección 16):**
- Validar con cinco cuidadores y cinco pacientes, con consentimiento y tutor, en sesiones de 15 minutos.
- Probar en tableta física con VoiceOver (iPadOS y macOS), TalkBack (Android), NVDA (Windows) y solo con teclado.
- Verificar en iOS e iPadOS el GainNode, el Wake Lock, la Media Session y la persistencia del almacenamiento.
- Confirmar con el investigador los puntos de la sección 16: textos de ausencia, carpetas del paciente, repetición de la lista, preferencia de tres niveles y registro del estudio con su texto de consentimiento.
- Confirmar la fuente y la licencia de cada canción del catálogo para la ficha.

**Rediseño visual:** hecho en `main` el 2026-11-02, con la estructura de Apple Music web (decisión del propietario). Pendiente: poner al día las tablas de medidas de DESIGN (§3, §4 y §5.4), que siguen los valores anteriores al rediseño.

**Decisión abierta sobre la app Android:**
- DESIGN sección 1 dice que «la app Android empaqueta las mismas pantallas». La app Flutter de ADR-0004 tiene su propia interfaz en Dart (`mobile/lib/ui/`) y no hay WebView en `mobile/`. Hay que decidir si la interfaz única incluye la app o si son dos interfaces.
- ADR-0013 añade la subida de audio local a la APK con código Dart propio (`mobile/lib/local_audio.dart`). Eso no resuelve la decisión: sigue abierta si la interfaz única incluye la app.

**Documentación técnica por revisar:** `docs/user-experience/PLAYER.md`, `docs/datos/DATABASE.md` y la parte 2 de `docs/audio-processing/AUDIO_ENGINE.md` describen la rama antes de la integración. Revisarlos sección por sección.

**Documentos actualizados el 2026-11-02:** CLAUDE.md, README.md, PROJECT_MASTER.md, ROADMAP.md, CHANGELOG.md, `docs/arquitectura/ARCHITECTURE.md`, `docs/arquitectura/GITHUB_STORAGE.md`, `docs/user-experience/DESIGN.md` (solo las notas de estado) y este ADR.
