# ADR-0009: Interfaz única y datos locales

- Estado: aceptada. Describe la rama `feat/ui-publica` (último commit `cc8ef01`), pendiente de fusión en `main`.
- Fecha: 2026-11-02
- Relacionada con: ADR-0001 (stack), ADR-0004 (app Android), ADR-0007 (catálogo público). Especificación: `docs/user-experience/DESIGN.md`.

## Contexto

- `docs/user-experience/DESIGN.md` (versión 1.0, cierre de diseño del 31-oct-2026) es la especificación de la interfaz: dos modos, paciente y cuidador; tokens visuales; y la lista de comprobación WCAG 2.2 AA de su sección 10.
- La web es una aplicación progresiva (PWA) en HTML, CSS y JavaScript sin framework, que debe funcionar sin conexión (DESIGN sección 1). ADR-0001, punto 5, fija HTML, CSS y JavaScript estáticos, sin framework (sustituye la propuesta de Next.js); no trata el funcionamiento sin conexión.
- Los datos personales (perfiles, fotografías, recuerdos, observaciones e historial) se guardan solo en el navegador del cuidador. No hay cuentas, sincronización en la nube, publicidad ni scripts de terceros (DESIGN sección 1 y decisión D38).
- El catálogo de canciones es público y se sirve desde `frontend/web` (ADR-0007). Lo que el cuidador registra no forma parte de ese catálogo.
- IndexedDB es una base de datos, pero vive en el navegador del cuidador, y la web no envía datos personales a ningún servidor (ver decisión 7). La fuente de verdad del catálogo sigue siendo `audio-library/indexes/catalog.json` (ADR-0007). La frase de `CLAUDE.md` «No hay panel local ni base de datos local» necesita matizarse para incluir este almacén (ver Pendiente).

## Decisión

1. **Interfaz única en módulos ES, sin framework y sin dependencias de runtime.** Los módulos de `frontend/web/js/` se importan con rutas relativas. No hay `package.json` bajo `frontend/web/`. Las dependencias de prueba están solo en `tests/web-e2e/` (puppeteer-core y axe-core) y no llegan al navegador.

2. **IndexedDB es el almacén de datos personales** (`frontend/web/js/store.js`; base `reminiscencia`, versión 2 del esquema en esta rama). Guarda los almacenes `profiles`, `songLinks`, `memories`, `photos`, `playlists`, `observations`, `history` y `studyEvents` (registro del estudio), y el almacén `meta` para los ajustes, el PIN, el perfil activo y la fecha de la última copia.

3. **Preferencias de pantalla en localStorage** (`frontend/web/js/prefs.js`): tamaño de texto, contraste, apariencia, movimiento y atajos. Van en una sola clave con un objeto JSON y no contienen datos personales. Todo acceso va en try/catch: si el navegador no deja escribir, el valor vale solo durante la sesión (DESIGN sección 9 y D38).

4. **PIN y copia cifrada con WebCrypto, sin librerías** (`frontend/web/js/crypto.js`):
   - **PIN de 4 a 6 dígitos** (DESIGN D12; `PIN_PATTERN` en `frontend/web/js/schema.js`). Solo se guarda el hash PBKDF2-SHA-256, con sal aleatoria de 16 bytes y 310 000 iteraciones (`PIN_ITERATIONS`). Cinco fallos seguidos bloquean 60 segundos sin borrar nada (`PIN_MAX_FAILURES` y `PIN_LOCK_MS` en `store.js`). `removePin()` quita solo el PIN y su bloqueo, y los datos se conservan. La acción «Olvidé el PIN» debe llamarla, pero la interfaz no está en la rama (ver Pendiente).
   - **Copia solo en el navegador** (DESIGN sección 9, D26 y D38): un fichero `.rmc` que descarga el propio cuidador. La web no la sube a ningún servidor. Va cifrada con AES-GCM de 256 bits. La clave sale de la contraseña con PBKDF2-SHA-256 y 600 000 iteraciones (`BACKUP_ITERATIONS`); la sal es de 16 bytes y el IV de 12. La cabecera del sobre se autentica como datos adicionales (AAD). La contraseña tiene al menos 10 caracteres (`MIN_PASSPHRASE_LENGTH`). Cualquier fallo de descifrado da el mismo mensaje, y la copia no incluye el hash del PIN.
   - Importar tiene dos modos: combinar (por defecto) y sustituir (`restoreBackup`, con `mode` `merge` o `replace`).

5. **Sin conexión con service worker y Cache Storage** (`frontend/web/sw.js` y `frontend/web/js/offline-core.js`; ya en `main` por `feat/pwa-offline`):
   - El shell (páginas, CSS, JavaScript, datos e iconos) se sirve con `staleWhileRevalidate` desde la caché `reminiscencia-shell-v<N>`.
   - Los JSON de `data/` van primero a la red y, si falla, a la caché.
   - El audio que el usuario guarda para escuchar sin conexión está en la caché `reminiscencia-audio-v1`. Su nombre lo da `audioCacheName()` en `frontend/web/js/offline-core.js`, y lo usa `frontend/web/js/pwa.js`.

6. **Fuente Atkinson Hyperlegible Next autoalojada**, en los pesos 400, 600 y 700, en WOFF2 y con licencia SIL OFL 1.1 (`frontend/web/fonts/`). La declara un `@font-face` en `frontend/web/css/base.css` (DESIGN sección 5.3 y D31).

7. **Sin scripts de terceros ni analítica.** `index.html` carga solo hojas y script propios. En `frontend/web/js/` no hay referencias a dominios externos, y las únicas peticiones de red son lecturas de ficheros estáticos del mismo origen (`data/*.json`, audio y shell).

## Consecuencias

- **Lógica probada sin navegador:** `tests/web-unit/` usa `node:test`. `node --test tests/web-unit/` ejecuta el índice `index.mjs`, que carga cinco suites; `node --test tests/web-unit/*.test.mjs` ejecuta todas, incluido `player.test.mjs`, que no está en el índice.
- **Extremo a extremo y accesibilidad en Chrome:** `tests/web-e2e/` usa puppeteer-core y axe-core con las etiquetas WCAG 2.2 AA (`helpers/elementos.mjs`). Su prueba de accesibilidad falla ante fallos de gravedad serious o critical (`a11y.e2e.mjs`).
- **Sin sincronización entre dispositivos:** un perfil existe solo en el navegador donde se creó. La copia `.rmc` es la única vía para llevarlo a otro, y sin su contraseña no hay recuperación (DESIGN sección 9).
- **El PIN no protege los datos** frente a quien tenga el dispositivo desbloqueado. Evita salidas accidentales y nada más (DESIGN sección 9).
- **Riesgo de purga en Safari:** puede borrar los datos de un sitio sin uso. DESIGN pide persistencia y un aviso para instalar la app en iOS (D27); en el código de esta rama todavía no están (ver Pendiente).
- **Iteraciones dentro del sobre:** cada copia guarda sus iteraciones. El lector acepta de 100 000 a 2 000 000 (`MIN_ITERATIONS` y `MAX_ITERATIONS`), así que las copias antiguas siguen leyéndose mientras estén en ese rango.
- **Versión del shell:** cada cambio del shell exige subir `SHELL_VERSION` en `frontend/web/js/offline-core.js`, como indica la cabecera de `sw.js`.
- **Sin dependencias de runtime:** introducir un framework o una librería de runtime cambia esta decisión y requiere un ADR nuevo.

## Alternativas descartadas

- **Framework de interfaz** (por ejemplo, Next.js). ADR-0001 lo descartó porque añadiría un framework sin función real mientras no exista una API con datos personales. DESIGN sección 1 lo excluye.
- **Almacenamiento en la nube y sincronización entre dispositivos.** Excluidos por DESIGN sección 1. Los datos personales se quedan en el navegador del cuidador (D38).
- **Cuentas de usuario.** Excluidas por DESIGN sección 1. Sin cuentas no hace falta un servidor de datos personales.
- **Recuperar el PIN restableciendo el navegador** (propuesta A de DESIGN). Descartada porque borra todos los datos (D12 y sección 14).

## Pendiente

**Validación con personas y dispositivos (DESIGN sección 16):**
- Validar con cinco cuidadores y cinco pacientes, con consentimiento y tutor, en sesiones de 15 minutos.
- Probar en tableta física con VoiceOver (iPadOS y macOS), TalkBack (Android), NVDA (Windows) y solo con teclado.
- Verificar en iOS e iPadOS el GainNode, el Wake Lock, la Media Session y la persistencia del almacenamiento.
- Confirmar con el investigador los puntos de la sección 16: textos de ausencia, carpetas del paciente, repetición de la lista, preferencia de tres niveles y registro del estudio con su texto de consentimiento.
- Confirmar la fuente y la licencia de cada canción del catálogo para la ficha.

**Estado de `feat/ui-publica` (commit `cc8ef01`, comprobado en el código; no es la interfaz final):**
- `index.html`, `app.js`, `styles.css`, `listen.css` y `sw.js` no cambian respecto a `main`. La interfaz nueva aún no está conectada a la página.
- `css/base.css` (con la `@font-face`) y `css/tokens.css` no los enlaza ningún HTML de la rama.
- La fuente y los CSS no están en `SHELL_ASSETS` ni en los patrones que cubre el service worker (`SHELL_PATHS` y `SHELL_PATTERNS` en `offline-core.js`). Sin conexión, no estarían disponibles. DESIGN sección 5.3 dice que la fuente la precachea el service worker, y hoy no es así.
- `SHELL_ASSETS` incluye `/gestion.js` y `/js/intake.js`, y en `main` y en esta rama no existe ningún fichero en esas rutas. Los de la gestión web están solo en `feat/gestion-web`, sin fusionar, como `frontend/web/js/gestion.js` y `frontend/web/js/intake.js` (rutas `/js/gestion.js` y `/js/intake.js`): la entrada `/gestion.js` no coincide con ninguna. La precarga los omite; conviene corregir la lista.
- `navigator.storage.persist()` (DESIGN sección 9 y D27) no se llama en ningún fichero de `frontend/web`. Tampoco hay aviso para instalar la app en iOS.
- La acción «Olvidé el PIN» (DESIGN P5 y D12) no está en la rama: nada llama a `removePin()`.
- No aparecen en el código el aviso de cuota al 80 % ni el recordatorio de copia cada 14 días (D26). Sí se guarda la fecha de la última copia (`lastBackupAt`).
- `main` todavía no tiene el PIN de 4 a 6 dígitos (acepta de 4 a 12 en `frontend/web/js/schema.js`), ni el bloqueo tras cinco fallos, ni el almacén versión 2 con `studyEvents` (`DB_VERSION` = 1). Eso llega con la fusión de `feat/ui-publica`.
- En el worktree local de `feat/ui-publica` hay cambios sin confirmar (en el momento de la revisión, `app.js`, `styles.css` y `listen.css` aparecen borrados, e `index.html` y `sw.js` modificados). Esta ADR describe el commit `cc8ef01`, no ese estado.
- Esta ADR no afirma resultados de pruebas: las suites `tests/web-unit/` y `tests/web-e2e/` no se han ejecutado al redactarla.

**Decisión abierta sobre la app Android:**
- DESIGN sección 1 dice que «la app Android empaqueta las mismas pantallas». La app Flutter de ADR-0004 tiene su propia interfaz en Dart (`mobile/lib/ui/` en `main`) y no hay WebView en `mobile/`. Hay que decidir si la interfaz única incluye la app o si son dos interfaces.

**Documentos a actualizar al fusionar** (revisión con grep de los `.md` del repositorio; no se han corregido, porque este encargo solo escribe esta ADR):
- `PROJECT_MASTER.md`, tabla de ADR (líneas 33 a 39): falta la fila de ADR-0009.
- `ROADMAP.md`, línea 35: «Datos locales del cuidador» figura como pendiente, aunque su código ya está en `main` (`feat/datos-locales`). Línea 36: «Panel del cuidador (`/cuidar/`)» no coincide con DESIGN sección 1, que describe dos modos en una misma aplicación.
- `ROADMAP.md`, fila «Documentación técnica»: el documento DATABASE debería describir los almacenes de IndexedDB, además del modelo entidad-relación.
- `CLAUDE.md`, línea 16: matizar «No hay panel local ni base de datos local» para incluir el almacén IndexedDB del navegador.
- `CHANGELOG.md`: añadir una entrada para este ADR al fusionar.
