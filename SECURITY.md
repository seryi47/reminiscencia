# Seguridad, privacidad y marco legal

Revisión del 3 de noviembre de 2026 sobre `main` (`b058a0c`), con la interfaz sin usuarios de ADR-0015 y el buzón de ADR-0014, actualizada el mismo día con la subida directa a GitHub desde la web pública (ADR-0017: función `frontend/web/api/subir.js`, §3.12). La revisión anterior (2 de noviembre, `8a19a09`) describía la capa de datos del cuidador, retirada desde entonces.

Este documento describe lo que el código de `main` hace hoy, separa lo implementado de lo previsto en el diseño y recoge lo pendiente. No es asesoramiento jurídico ni una evaluación de impacto (ver §5).

## 0. Alcance, estado y convenciones

- **Alcance.** Web pública (`frontend/web/`, incluidas `api/subir.js` y las funciones `api/youtube/*`), app Android (`mobile/`), workflows (`.github/workflows/`), incluido el buzón de subida (`buzon.yml`), y el repositorio.
- **Estado de `main`.** La web y la APK no tienen usuarios (ADR-0015): no hay perfiles, modos paciente ni cuidador, PIN, recuerdos, fotografías, observaciones, registro del estudio ni copia cifrada `.rmc`. Todos ven la misma biblioteca pública. Las listas y «Me gusta» se guardan solo en el navegador o en el teléfono, y el audio subido antes «Solo en este navegador» o «Solo en este teléfono», también (ADR-0012 y ADR-0013). Desde ADR-0017, «Subir canciones» sube siempre para todos: cualquiera que entre en la web sube al buzón del repositorio por la función `/api/subir`, sin cuenta (§3.12), y el buzón lo publica (§3.11). Pruebas en verde el 2026-11-03 en la rama de ADR-0017: 342 unitarias de la web, 133 de extremo a extremo y 671 del backend.
- **Etiquetas.** **Implementado**: existe en el código de `main`. **Retirado**: existía y ADR-0015 lo quitó. **Previsto**: aparece en el diseño o en el changelog, sin código. **Pendiente**: requiere decisión, trabajo o dictamen.
- **Citas.** Los identificadores entre corchetes son los de la verificación ([legal-01] a [legal-06] y [B1-2025]). Cuando una verificación tiene corrección, se cita la versión corregida. Lo que la verificación no confirma queda en §5.
- **Límites de la evidencia.** La música es una hipótesis del proyecto. H1 a H5 están propuestas, no demostradas ([PROJECT_MASTER.md](PROJECT_MASTER.md)). La revisión Cochrane de 2025 [B1-2025] reporta certeza moderada de una mejora ligera de los síntomas depresivos, y de que probablemente no mejoran la agitación ni la agresión. Da certeza baja a una posible mejora de los problemas conductuales globales y no encuentra mejora demostrada del bienestar emocional ni de la ansiedad. Para la cognición, la certeza es baja o muy baja. Este documento no promete ningún efecto clínico.

## 1. Marco legal

### 1.1 Normas y estado de su verificación

| Id | Norma | Estado de la verificación | Hipótesis afectadas |
|---|---|---|---|
| [legal-01] | RGPD, Reglamento (UE) 2016/679 | Parcial; título corregido (EUR-Lex no consultado; se usó la copia del BOE) | H1 a H4 (datos de los participantes) |
| [legal-02] | LOPDGDD, LO 3/2018, disposición adicional decimoséptima | Verificada con correcciones; queda el dictamen (§5) | H1 a H4 |
| [legal-03] | Ley 14/2007, de Investigación biomédica | Verificada | H1, H2 y H4 si hay intervención en personas con deterioro cognitivo; alcance para H5 a valorar |
| [legal-04] | Declaración de Helsinki (WMA, 2024) | Verificada en inglés; traducción no verificada | H1 a H4 |
| [legal-05] | TRLPI (RDL 1/1996), arts. 112 y 119, según la Ley 21/2014 | Verificada con correcciones; se cita la versión corregida | H1, H2 y H4 |
| [legal-06] | Directiva (UE) 2019/790, arts. 2 a 4 | Parcial; se cita la versión corregida | Metodología (minería de textos) |

### 1.2 RGPD [legal-01]

Reglamento (UE) 2016/679 del Parlamento Europeo y del Consejo, de 27 de abril de 2016, relativo a la protección de las personas físicas en lo que respecta al tratamiento de datos personales y a la libre circulación de estos datos y por el que se deroga la Directiva 95/46/CE (Reglamento general de protección de datos, RGPD). DOUE L 119, de 4.5.2016, pp. 1-88.

Aplicación en el proyecto:

- **Datos de salud.** Por prudencia, las respuestas del paciente a la música y las observaciones del cuidador se tratan como datos relativos a la salud (art. 4.15). El art. 9.1 prohíbe tratarlos con carácter general. Las excepciones que el proyecto puede invocar son el consentimiento explícito (art. 9.2.a) y la investigación científica con base en el Derecho de la Unión o nacional (art. 9.2.j). El art. 9.4 permite a los Estados mantener condiciones adicionales.
- **Seudonimización.** Los participantes se identifican con alias y código (art. 4.5). Por prudencia, esos datos se tratan como datos personales seudonimizados, no como anónimos.
- **Uso ulterior y conservación.** Los arts. 5.1.b y 5.1.e permiten el uso ulterior y la conservación con fines de investigación científica, con garantías. Los arts. 89.1 y 89.2 exigen minimización y seudonimización. Solo admiten excepciones a los derechos de los arts. 15, 16, 18 y 21 cuando imposibilitan u obstaculizan gravemente el logro de los fines científicos y son necesarias.

### 1.3 LOPDGDD [legal-02]

Ley Orgánica 3/2018, de 5 de diciembre, de Protección de Datos Personales y garantía de los derechos digitales (BOE de 6.12.2018). Su disposición adicional decimoséptima regula los tratamientos de datos de salud para investigación:

- **Apartado 1.** Los tratamientos regulados por las leyes que enumera, entre ellas la Ley 14/2007 (letra f), se amparan en las letras g), h), i) y j) del art. 9.2 RGPD.
- **Apartado 2.**
  - Letra c: informe previo favorable del comité de ética para reutilizar datos con fines de investigación.
  - Letra d: separación técnica y funcional, y acceso restringido, para los datos seudonimizados.
  - Letra e: excepciones a los derechos de los arts. 15, 16, 18 y 21 RGPD, según el art. 89.2.
  - Letra f: evaluación de impacto en los supuestos del art. 35 RGPD o los que fije la autoridad de control.
  - Letra g: uso de datos seudonimizados con informe previo del comité de ética de la investigación.
- **Nota.** El art. 89 de la LOPDGDD regula la videovigilancia y la grabación de sonidos en el lugar de trabajo. No es base para la investigación y no se cita como tal.

### 1.4 Ley 14/2007, de Investigación biomédica [legal-03]

Ley 14/2007, de 3 de julio (BOE-A-2007-12945; BOE de 4.7.2007).

- **Ámbito (arts. 1.1.a y 1.3).** Investigaciones con procedimientos invasivos, incluida la investigación clínica. Quedan excluidos los ensayos clínicos con medicamentos y productos sanitarios.
- **Procedimiento invasivo (art. 3.t).** Intervención con riesgo físico o psíquico. Hay que valorar, tarea por tarea, si alguna del estudio encaja en el concepto.
- **Comité de ética (art. 2.e).** Informe favorable previo y preceptivo.
- **Consentimiento (arts. 4.1 y 4.2).** Expreso y escrito. Si la persona no puede consentir por sí misma, lo presta su representante, con participación según sus capacidades.
- **Publicación (art. 5.5).** Los resultados identificables solo se publican con consentimiento previo y expreso.
- **Personas que no pueden consentir (art. 20).** Solo con beneficio directo para su salud o, de forma excepcional, con riesgo y carga mínimos. El art. 20.2.c prevé la comunicación al Ministerio Fiscal.
- **Referencias vigentes.** El art. 5.1 cita la LO 15/1999, derogada por la LOPDGDD (disposición derogatoria única, apartado 1).
- **Terminología.** Los arts. 4.2 y 20 hablan de «incapacitada legalmente» e «incapacitación». La Ley 8/2021 (BOE-A-2021-9233) reforma la legislación civil para el apoyo a las personas con discapacidad; su preámbulo describe el cambio de la incapacitación por medidas de apoyo, y no cita la Ley 14/2007 (consulta del 2-nov-2026). Se cita el texto literal con esta nota, a confirmar por un jurista.

### 1.5 Declaración de Helsinki [legal-04]

World Medical Association Declaration of Helsinki: Ethical Principles for Medical Research Involving Human Participants. Revisión de octubre de 2024 (75.ª Asamblea General de la WMA), publicada en JAMA en 2025. DOI 10.1001/jama.2024.21972.

Principios que el protocolo debe cumplir:

- Consentimiento libre e informado, documentado, y aprobación previa del comité de ética (secciones «Free and Informed Consent» y «Research Ethics Committees»).
- Personas incapaces de consentir: consentimiento del representante legal que considere las preferencias y los valores de la persona; asentimiento cuando pueda darlo; respeto a su disidencia; inclusión solo si el estudio puede beneficiarla personalmente o implica riesgo y carga mínimos.
- Uso secundario de datos almacenados sin consentimiento, solo con aprobación del comité y cuando el consentimiento es imposible o impracticable.

La verificación se hizo sobre el texto en inglés. La traducción al español no está verificada.

### 1.6 Grabaciones: TRLPI [legal-05]

Real Decreto Legislativo 1/1996, de 12 de abril (TRLPI), arts. 112 y 119, en la redacción de la Ley 21/2014, que transpone la Directiva 2011/77/UE. Versión corregida tras la verificación:

- **Art. 112 (artistas intérpretes).** 50 años desde el 1 de enero del año siguiente a la interpretación. Si dentro de ese período la grabación se publica o se comunica lícitamente por medio distinto del fonograma, 50 años desde el 1 de enero del año siguiente a esa primera publicación o comunicación. Si es en fonograma, 70 años con el mismo cómputo.
- **Art. 119 (productores de fonogramas).** 50 años desde la grabación. Si hay publicación lícita dentro de ese plazo, 70 años desde la primera publicación lícita; sin publicación lícita, 70 años desde la primera comunicación lícita al público. Todos los plazos se computan desde el 1 de enero del año siguiente.
- **Disposición transitoria vigésima primera, apartado 3, de la Ley 21/2014.** Según el texto consolidado del BOE (consulta del 2-nov-2026), los arts. 110 bis, 112 y 119 se aplican a las grabaciones y fonogramas que gozan de protección a 1 de noviembre de 2013 conforme a la legislación anterior, y a los posteriores. Su aplicación a cada pista queda para dictamen (§5, pendiente 5).
- **Obras.** Tienen otro plazo: vida del autor más 70 años (art. 26).

Consecuencia: el estado de cada pista depende de su fecha de grabación y de su primera publicación lícita. Este documento no declara el estado de protección de ninguna pista (§5).

### 1.7 Directiva (UE) 2019/790 [legal-06]

Directiva (UE) 2019/790 del Parlamento Europeo y del Consejo, de 17 de abril de 2019, sobre los derechos de autor y derechos afines en el mercado único digital y por la que se modifican las Directivas 96/9/CE y 2001/29/CE (DOUE L 130, de 17.5.2019, pp. 92-125). En España se transpone en el Libro cuarto (arts. 65 a 80) del Real Decreto-ley 24/2021, de 2 de noviembre (BOE-A-2021-17910), que transpone también la Directiva (UE) 2019/789. La minería de textos y datos está en su art. 67.

Contenido confirmado de la Directiva: art. 2.1 (organismo de investigación), art. 2.2 (definición de minería de textos y datos), art. 3.1 (excepción obligatoria para organismos de investigación, con fines de investigación científica sobre obras de acceso lícito) y arts. 4.1 y 4.3 (excepción general, con reserva expresa, por ejemplo mediante lectura mecánica en contenidos en línea).

Uso en el proyecto: la metodología de revisión de literatura. Si el investigador no es organismo de investigación en el sentido del art. 2.1, el caso dependería del art. 4. Es una interpretación jurídica pendiente de confirmar (§5).

### 1.8 Licencias del catálogo

El catálogo (`audio-library/indexes/catalog.json`) tiene 14 canciones. Cada una declara su licencia en el campo `license`: tomada del ítem de Internet Archive, declarada por el depositante o, en el buzón, declarada por quien sube en el mensaje del commit (ADR-0014). Diez tienen `public: true` y son las que se sirven en la web pública: nueve de dominio público según Internet Archive y una con CC BY 4.0. Si esa declaración basta para publicar en Europa es el punto pendiente de dictamen (ADR-0005).

## 2. Datos que se tratan y minimización

### 2.1 Qué se guarda y dónde

Fuentes: `docs/datos/DATABASE.md` y el código de `frontend/web/js/` y `mobile/lib/`.

| Dato | Dónde | Estado |
|---|---|---|
| Listas y «Me gusta» (identificadores de canción, nombres de lista y fechas) | Navegador: IndexedDB `reminiscencia-biblioteca` (`js/local-library.js`). Teléfono: `colecciones.json` | Implementado. Sin cuenta ni sincronización |
| Audio subido antes «Solo en este navegador» o «Solo en este teléfono» | IndexedDB `reminiscencia-audio-local` (ADR-0012); `biblioteca-local/` de la app (ADR-0013) | Implementado. No sale del dispositivo. La web ya no guarda canciones nuevas aquí (ADR-0017): las que existan suenan y se borran |
| Volumen, aleatorio y repetir | localStorage `reminiscencia.reproductor` | Implementado. No son datos personales |
| Audio y shell para escuchar sin conexión | Cache Storage (`reminiscencia-shell-v8`, `reminiscencia-audio-v1`, `reminiscencia-portadas-v1`) | Implementado |
| Perfiles, recuerdos, fotografías, observaciones, registro del estudio, PIN y preferencias de pantalla | Base `reminiscencia` de la versión anterior | **Retirado** (ADR-0015). La web nueva no la abre ni la borra: sigue en los navegadores que la usaron (R5) |
| Canciones subidas al buzón (desde la web y la APK por `/api/subir`, o desde GitHub) | Repositorio: catálogo, `audio-library/audio/` y, en el historial de git, el archivo subido al buzón (desde la web, sus trozos Opus en `audio-library/buzon/.partes/`) | Implementado (ADR-0014 y ADR-0017, §3.11 y §3.12) |

La web y la APK ya no tratan datos de participantes. Los recuerdos autobiográficos (material de H2) y las fotografías (material de H4) no tienen hoy instrumento en la aplicación (ADR-0015, consecuencias).

### 2.2 Qué nunca entra en el repositorio

- **Datos de personas.** Nombres reales, fotografías, recuerdos y datos de participantes (CLAUDE.md). `.gitignore` excluye `research-data/personal/`, `research-data/**/raw/`, `*.sqlite` y `.env`. En `research-data/` no aparecen las palabras nombre, alias, paciente, participante ni correo electrónico; esto no sustituye una revisión manual de los ficheros.
- **Copias cifradas (.rmc).** Retiradas con ADR-0015. No hay ninguna en el árbol versionado.
- **Grabaciones de pacientes o sin derechos, también por el buzón.** Lo que se sube al buzón queda en el historial de git aunque el workflow lo borre y aunque la canción entre como privada (§3.11).
- **Claves de firma de Android.** No hay ficheros `.jks`, `.keystore`, `key.properties` ni `.p12` versionados. Las claves locales están en `~/.android-keys/` (CLAUDE.md).
- **Secretos.** Una búsqueda de patrones habituales (tokens de GitHub, claves privadas, contraseñas asignadas, `ADMIN_PASSWORD`, `GITHUB_TOKEN`) sobre los ficheros de texto versionados no encontró valores. Solo aparecen nombres de variables y marcadores, como `<contraseña del almacén>` en `docs/android/RELEASE.md`. No se ha revisado el historial de git. El único secreto de la web, `GITHUB_TOKEN` de la función `/api/subir`, vive en las variables de entorno de Vercel, no en el repositorio (ADR-0017, §3.12).

### 2.3 Identificación de participantes

**Retirado** (ADR-0015). La aplicación ya no tiene alias, códigos de participante ni registro del estudio. Si el estudio vuelve a necesitar un instrumento con datos de participantes, esta sección y la evaluación de §5 (A.1) se rehacen antes de recoger nada.

### 2.4 Minimización en la copia cifrada

**Retirado** (ADR-0015, decisión 4): no hay copia cifrada.

## 3. Medidas de seguridad de la aplicación

### 3.1 Datos solo en el dispositivo: Implementado

- Las listas, los «Me gusta» y el audio subido antes «Solo en este navegador» se guardan en IndexedDB y no salen del navegador; en la APK, en el almacenamiento privado de la app.
- Sin cuentas ni sincronización en la nube (ADR-0015).
- La página no envía datos personales a ningún servidor. Sus peticiones son al mismo origen: `data/*.json`, audio y shell y, al subir canciones, el audio convertido a Opus y su nombre de archivo a `POST /api/subir` (§3.12). Los enlaces a otro dominio solo abren GitHub en otra pestaña: el formulario de incidencia nueva y la subida de portadas (§3.8).

### 3.2 Copia cifrada: Retirado

ADR-0015 (decisión 4) retira la copia `.rmc` y borra `js/crypto.js` y `js/backup.js`. Las copias exportadas antes ya no se pueden importar.

### 3.3 PIN local: Retirado

ADR-0015 retira el PIN con los modos paciente y cuidador. No hay ninguna contraseña ni PIN en la aplicación.

### 3.4 Sin administración ni contraseñas en la web: Implementado, con funciones públicas

- El commit `0fa6ed3` retiró `frontend/web/admin`, `frontend/web/api` y `frontend/web/lib`. Según su mensaje, el propietario ha pedido que no exista ninguna administración en la web. Ya no hay funciones de Vercel ni `ADMIN_PASSWORD` (CHANGELOG.md, línea 23).
- No hay campos de contraseña en la web pública ni en la APK.
- Desde ADR-0017, `frontend/web/api/subir.js` sube al buzón con `GITHUB_TOKEN` (variable de entorno de Vercel); no es administración, solo escribe trozos de audio en `audio-library/buzon/.partes/` (§3.12). Las funciones `frontend/web/api/youtube/*` extraen metadatos de playlists y actúan como proxy de yttowav (§3.13); no usan el token de GitHub. Siguen sin existir `frontend/web/admin` y `frontend/web/lib` (`backend/tests/test_biblioteca_workflow.py`).

### 3.5 Incidencias de GitHub con permiso de escritura: Implementado, con pendientes

- `biblioteca.yml` se dispara al abrir una incidencia (`issues: opened`). En incidencias, el job `procesar` solo corre si el job `autorizar` comprueba que el autor tiene permiso de escritura (`admin`, `maintain` o `write`). Es la enmienda de ADR-0008 (2026-11-02) a su decisión 3, que hablaba solo del propietario.
- Condiciones que cumple el workflow:
  1. El permiso del autor se consulta en el propio workflow, con la API de GitHub, no en la interfaz.
  2. El cuerpo de la incidencia y los campos pasan por variables de entorno (`env`); ningún texto se interpola en `run:`.
  3. Permisos mínimos por job (§3.7): `autorizar` solo tiene `issues: write`.
- Verificado en GitHub (2-nov-2026): la importación por la incidencia #5, con los tres jobs en success, y la publicación de «Nomyn Fragments» (ejecución 41512760196, commit del bot `7b73d19`). Sin verificar: la concurrencia `queue: max` (ADR-0010).
- Desde ADR-0015 la web solo prepara incidencias de importación (hoja «Subir canciones», «Desde Internet Archive»). Publicar, editar y las carpetas se escriben a mano; el workflow las valida igual.

### 3.6 Secretos fuera del repositorio: Implementado, con pendiente

- No hay secretos en los ficheros versionados (§2.2).
- Las claves de firma de Android están en GitHub Secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` y `ANDROID_KEY_PASSWORD` (cabecera de `android.yml`). El almacén se reconstruye en el runner y se borra en un paso con `if: always()`.
- La huella SHA-256 del certificado de producción es un dato público, porque va en cada APK firmado. Está en `android.yml`.
- Pendiente: copia de seguridad de la clave de firma fuera del equipo (ROADMAP.md, sin marcar; CHANGELOG.md, línea 50).

### 3.7 Permisos mínimos en los workflows: Parcial

| Workflow | Permisos declarados | Estado |
|---|---|---|
| `android.yml` | `contents: read` a nivel de workflow. El job de producción hace checkout con `persist-credentials: false`. Solo el job de publicación de la release (etiquetas `android-v*`) tiene `contents: write`. | Implementado. Es el modelo a seguir. |
| `biblioteca.yml` | Sin bloque de permisos a nivel de workflow. `autorizar`: `issues: write`. `procesar`: `contents: read`, sin token y con `persist-credentials: false`. `publicar`: `contents: write` e `issues: write`; el token solo llega a los pasos que suben a `main` y responden. | Implementado (ADR-0010). Importación y publicación verificadas en GitHub el 2-nov-2026. |
| `buzon.yml` | Sin bloque a nivel de workflow. `autorizar`: `contents: read` (consulta el permiso; sin checkout). `procesar`: `contents: read`, sin token y con `persist-credentials: false`. `publicar`: `contents: write`; el token solo llega al paso que sube a `main`. Acciones fijadas por SHA. | Implementado (ADR-0014, §3.11). |
| `backend.yml` | Sin bloque `permissions`. Hereda el valor por defecto del repositorio. | Pendiente: declarar `contents: read`. |

- `biblioteca.yml` y `buzon.yml` se lanzan con `workflow_dispatch` (quien tenga permiso de escritura en el repositorio). `biblioteca.yml` también al abrirse una incidencia (§3.5) y `buzon.yml` con un push a `main` que toca el buzón (§3.11). Es el comportamiento habitual de GitHub, no comprobado con otra cuenta.
- Ningún workflow usa `pull_request_target`.

### 3.8 Web pública: terceros y cabeceras: Parcial

- Sin scripts, fuentes, analítica ni recursos de terceros. `index.html` carga solo `js/app.js` (módulo), el manifiesto, las fuentes y las hojas de estilo locales. Los únicos enlaces a otro dominio abren GitHub en otra pestaña (incidencias y subida de portadas). La subida de canciones va al mismo origen (`/api/subir`), así que la CSP no cambia (`connect-src 'self'`). No hay SDK de analítica en `mobile/pubspec.yaml` ni en los ficheros Gradle.
- Los textos (títulos, artistas, nombres de lista) se pintan con nodos del DOM (`js/ui/dom.js`); no hay `innerHTML` en `frontend/web/js/` (comprobado con grep el 2026-11-03). Los títulos que vienen de nombres de archivo del buzón se escriben así también.
- `vercel.json` define el `Content-Type` del audio y una Content-Security-Policy para todas las rutas (`default-src 'self'`, `frame-ancestors 'none'`, entre otras). No define `X-Content-Type-Options` ni `Referrer-Policy` (R9). `media-src 'self'` no admite `blob:`: las canciones locales las sirve el service worker en `audio/L….opus` (ADR-0015, decisión 7).
- Tipografía Figtree (SIL OFL 1.1) autoalojada en WOFF2 en `frontend/web/fonts/` (pesos 400, 600, 700 y 800), con su licencia.

### 3.9 Fotografías: Retirado

ADR-0015 retira las fotografías y los recuerdos. Persistencia: `js/cuidador/subida-local.js` pide `navigator.storage.persist()` al guardar audio local y comprueba el espacio con `navigator.storage.estimate()` (ADR-0012).

### 3.10 Aplicación Android (`mobile/`): Implementado, sin usuarios

- Versión 1.2.0+3, sin perfiles ni modo paciente (ADR-0015). La clave antigua del modo paciente se borra al leer los ajustes (`settings_store.dart`).
- Permisos del manifiesto: acceso a la red (INTERNET y ACCESS_NETWORK_STATE, este para la descarga solo con Wi-Fi), reproducción en segundo plano (FOREGROUND_SERVICE, FOREGROUND_SERVICE_MEDIA_PLAYBACK y WAKE_LOCK) y notificaciones (POST_NOTIFICATIONS). Sin permisos de almacenamiento: el selector del sistema da acceso a los archivos elegidos (ADR-0013).
- En `mobile/lib` no hay código de PIN ni de cuentas.
- Copia de Android: el manifiesto no declara `android:allowBackup` (vale el valor por defecto), pero sí `fullBackupContent` y `dataExtractionRules`, que excluyen `biblioteca-local/` (el audio subido en el teléfono) de la copia y del traspaso entre dispositivos. Las listas y «Me gusta» (`colecciones.json`) sí pueden entrar en la copia del sistema; no son datos sensibles.
- La subida para todos usa la misma función `/api/subir` de la web (ADR-0017); la app no guarda tokens.

### 3.11 Buzón de canciones (`buzon.yml`, ADR-0014): Implementado, verificado en GitHub

**Quién puede subir.**
- Subir a `audio-library/buzon/` desde la página de subida de GitHub exige permiso de escritura en el repositorio, porque es un commit a `main`.
- Desde ADR-0017, la web y la APK suben sin cuenta por `/api/subir` (§3.12): el commit lo hace la cuenta del token de Vercel, que tiene permiso de escritura. En la práctica, **cualquiera puede subir**.
- El job `autorizar` comprueba además, con la API de GitHub, que `github.actor` (quien hizo el push o lanzó la ejecución) y `github.triggering_actor` (quien la relanza) tienen permiso `admin`, `maintain` o `write`. Si la consulta falla, cuenta como sin permiso. Sin checkout.
- El push del bot no vuelve a lanzar el workflow (GitHub no lanza workflows con pushes hechos con `GITHUB_TOKEN`).

**Qué se valida.**
- En `procesar` (sin token, `contents: read`, `persist-credentials: false`, guarda de rama antes de instalar nada): extensión de audio (WAV, MP3, M4A, FLAC, OGG u OPUS), archivo no vacío, como máximo 100 MiB, que ffprobe lo lea como audio y que ffmpeg lo convierta. Lo que no cumple se borra del buzón y se anota.
- Se dejan en el buzón, para revisarlos a mano, los enlaces simbólicos, las carpetas, las subcarpetas y los nombres fuera de la lista de `nombre_valido` (hasta 200 caracteres y 255 bytes, sin punto ni guion iniciales). Un buzón que sea enlace simbólico o una cuenta con nombre que no es de GitHub detienen el procesado.
- Licencia: la primera línea que empiece por `Licencia:` en el mensaje del commit, hasta 300 caracteres, sin caracteres de control ni de formato. Con ella, `public: true`; sin ella, `public: false` y licencia `Sin declarar`, que `update_song` no deja publicar. **El workflow no comprueba que la declaración sea cierta:** la registra con la cuenta (`source`: `Subida por <cuenta>`). Quien sube responde de ella.
- Ningún nombre de archivo ni mensaje de commit se interpola en `run:`: `scripts/buzon.py` los lee del evento (`GITHUB_EVENT_PATH`). En el resumen del job van escapados y en bloques de código.
- En `publicar` (`contents: write`, sin ffmpeg ni código del procesado): el paquete se valida antes de tocar el repositorio. La acción `buzon` es la única que puede tocar `audio-library/buzon/`, y solo para borrar archivos con nombre válido (nunca `README.md` ni `.gitkeep`). Después se regenera la parte pública desde el catálogo (ADR-0011) y se comprueban los límites con `check_repo_limits.py`. El token solo llega al paso que sube.

**Qué queda en el historial de git.**
- El archivo original subido (WAV, MP3, etc.) queda en el commit de subida aunque `publicar` lo borre del buzón, y también si entra como privado o se rechaza. Retirarlo exige reescribir el historial. Por eso no se sube nada sin derecho a usarlo ni datos de pacientes (README del buzón).
- El Opus de cada canción, también de las privadas, queda en `audio-library/audio/`.
- El nombre de la cuenta que subió queda en el catálogo y, para las canciones públicas, en `frontend/web/data/catalog.json` (campo `source`). Es el nombre público de una cuenta de GitHub.

**Subidas por trozos (ADR-0017).** Una carpeta `audio-library/buzon/.partes/<UUID>/` sin `manifiesto.json` se ignora. Con manifiesto válido (`{"nombre": "<nombre>.opus", "partes": N}`, de 1 a 1000) y todas las partes, se unen en orden en el buzón (con sufijo si el nombre existe) y se procesan como cualquier archivo, con la licencia del commit del manifiesto o, si el push no lo trae, la de la web. Un manifiesto no válido se rechaza y borra su carpeta; un id que no es UUID, enlaces, elementos que no son partes y partes que faltan se dejan para revisar. El paquete solo puede borrar `.partes/<UUID>/<índice>.part` y `.partes/<UUID>/manifiesto.json`, y solo con la acción `buzon`.

**Verificación en GitHub (2026-11-03).** La ejecución por push del archivo de prueba terminó en verde sin procesar nada: el evento no traía las listas de archivos. Desde `34a1f06`, si el evento no nombra archivos (o la ejecución es manual), se procesa lo que haya en el buzón con el mensaje del último commit del push. La ejecución manual dio de alta «tono-de-prueba-buzon» como privada (`4f6c73d`). Vía pública: «prueba-licencia», subida desde GitHub con «Licencia: CC0 1.0 …» (`9c8c6ef`), entró pública (`d3b4877`) y se despublicó después. Subida por trozos desde la web: ver §3.12. Sin verificar: la cola compartida con `biblioteca.yml`.

### 3.12 Subida desde la web pública (`frontend/web/api/subir.js`, ADR-0017): Implementado, probado en producción

- **Decisión del propietario.** «Subir canciones» sube siempre al repositorio, para todos, sin cuenta. No hay límite de subidas por hora ni de tamaño por archivo; solo el de Vercel (4,5 MB por petición), por eso se sube en trozos de hasta 4 MiB.
- **Token.** Solo en `process.env.GITHUB_TOKEN` (Vercel). Va solo a `api.github.com`, en la cabecera `Authorization`. No se escribe en los registros (solo el estado HTTP de GitHub) ni en las respuestas; si falta, la función responde 500 con un mensaje claro. El código del navegador no conoce ningún token (`tests/web-unit/upload.test.mjs`). Debe ser un token personal con «Contents: write» solo en este repositorio.
- **Validación en la función**: primer trozo Ogg Opus (página de inicio `OggS` con `OpusHead` versión 1); cada trozo no vacío y hasta 4 MiB; un archivo por petición (se rechaza `multipart/*`); cabeceras `X-Nombre-Archivo`, `X-Subida-Id` (UUID), `X-Parte` y `X-Partes` (de 1 a 1000) validadas; nombre limpio (sin ruta ni extensión original, NFC, solo los caracteres de `nombre_valido`, hasta 150 caracteres y 180 bytes, con `.opus`); escribe solo en `audio-library/buzon/.partes/<UUID>/`; nunca sobrescribe (trozo repetido igual: sin commit; distinto: 409; fuera de orden: 409; tras el manifiesto: 409; nombre final con sufijo si existe). Commit en `main` con la API de git (blob, árbol, commit y referencia sin forzar, con reintento si `main` cambió).
- **ZIP (2026-11-03).** La web (`js/cuidador/zip.js`) y la APK (`lib/zip_audio.dart`) descomprimen el `.zip` en el dispositivo y suben cada canción por el mismo camino; el ZIP nunca llega a `/api/subir`, que sigue aceptando solo Ogg Opus. Solo se usa el nombre base de cada entrada (sin rutas: zip-slip), se comprueba el CRC y se ignoran carpetas, `__MACOSX/`, ocultos y no-audio. El buzón (`sonidos.buzon`) acepta además `.zip` subidos por la página de GitHub: los extrae entrada a entrada fuera del repositorio, ignora enlaces simbólicos y rutas absolutas o con `..`, rechaza entero un ZIP cifrado o dañado y borra el ZIP. Sin límite de tamaño, por orden del propietario.
- **No hay**: límite por hora, captcha, cuentas, moderación previa ni comprobación de derechos. La web muestra un texto fijo: «Al subir, declaras que tienes derecho a publicar estos archivos».
- Pruebas: `tests/web-unit/api-subir.test.mjs` (GitHub simulado), `tests/web-unit/subida-publica.test.mjs` y `tests/web-e2e/funcional.e2e.mjs` (función simulada en el servidor de pruebas). **Probado en producción el 2026-11-03**, con Vercel y el token real: «Prueba subida directa.mp3» llegó por `/api/subir` (commit `8ac2d17`, un trozo y su manifiesto, con la cuenta del token), `buzon.yml` la aceptó (`autorizar` pasó con esa cuenta), la unió y la publicó como «Prueba subida directa» (`e7eaa73`), y se despublicó después con la incidencia #21 (`6d62aee`). Los trozos intermedios no lanzan el workflow: el filtro de `buzon.yml` excluye `audio-library/buzon/.partes/**/*.part`. No se ha probado una subida de varios trozos en producción.

### 3.13 Importación de playlists propias de YouTube desde Homeostasia: Implementada en código, pendiente de despliegue y verificación externa

- `GET /api/youtube/playlist` solo acepta URLs HTTPS de YouTube, llama a `yt-dlp` mediante `spawn` con argumentos separados, limita la playlist a 200 elementos y 45 segundos, y devuelve IDs/títulos, no descarga los vídeos. Requiere que el runtime de Vercel tenga `yt-dlp` instalado o empaquetado y que `YTDLP_PATH` apunte al ejecutable si no está en `PATH`.
- `POST /api/youtube/convert`, `GET /api/youtube/status` y `GET /api/youtube/download` usan como upstream fijo `api.yttowav.org`, validan los IDs, aplican timeout y no exponen direcciones de descarga externas. La descarga valida la cabecera RIFF/WAVE, se transmite sin almacenarla entera en memoria y tiene un máximo de 256 MiB.
- La interfaz declara que se deben importar contenidos propios o autorizados. No hay autenticación de usuario ni verificación automática de derechos. El 2026-11-03 se observó en producción un rechazo al crear un trabajo: el proxy devolvió HTTP 502 y sus logs no conservaron el estado externo. La integración ahora separa las solicitudes de creación dos segundos y expone el código HTTP y un mensaje seguro del proveedor; la conversión y descarga real siguen pendientes de validar tras este ajuste. Ver la sección de playlists de YouTube del [README](README.md).

## 4. Amenazas y riesgos residuales

**R1. Procesado de ficheros externos con ffmpeg y escritura en el repositorio.** Mitigado con procesar y publicar separados (ADR-0010); el flujo de importación se verificó en GitHub el 2-nov-2026.

- Evidencia: en `biblioteca.yml`, el job `procesar` (`contents: read`) descarga la URL con `intake.py` y ejecuta ffmpeg con `compression.py`; lo que cambia sale como artefacto `biblioteca-paquete`. El job `publicar` (`contents: write`, `needs: procesar`) valida el paquete por ruta y tipo de fichero (`backend/sonidos/paquete.py`), lo aplica sobre `main` y confirma.
- Mitigación actual: solo Internet Archive con licencia declarada, o ficheros directos con licencia declarada (ADR-0005). Bloqueo de plataformas en `sources.py` (`BLOCKED_HOSTS`). Descarga limitada a 200 MiB y escritura solo dentro del directorio de destino (`intake.py`). ffmpeg se llama con una lista de argumentos, con `-map 0:a:0` y `-vn` (`compression.py`). `check_repo_limits.py` se ejecuta antes del commit. `publicar` regenera la parte pública desde el catálogo y no acepta la que trae el paquete (ADR-0011).
- El buzón (§3.11) procesa con ffmpeg archivos subidos por cuentas con permiso de escritura, con la misma separación entre `procesar` y `publicar`.
- Riesgo residual: un fichero preparado para explotar el decodificador de ffmpeg podría ejecutar código en `procesar`, que no tiene token ni permiso de escritura. Ese código sí puede alterar el catálogo y el audio de `audio-library/`, que son las fuentes de la parte pública, porque la validación comprueba rutas y tipos, no el contenido (ADR-0010).
- Verificado en GitHub (2-nov-2026): el flujo de importación, con el artefacto entre jobs y los permisos efectivos, y la publicación de una canción. Pendiente: la concurrencia `queue: max`.

**R2. Token de GitHub disponible en los pasos del procesado.** Mitigado en el workflow (ADR-0010); verificado en la importación real del 2-nov-2026.

- Evidencia: `procesar` tiene `persist-credentials: false` en el checkout y ningún paso usa `github.token`. El token solo llega a los pasos de `publicar` que suben a `main` y responden (`GH_TOKEN`).
- Riesgo residual: `publicar` ejecuta scripts del checkout de `main` con permiso de escritura, pero no ejecuta nada del paquete (`scripts/aplicar_paquete.py`; ADR-0010).
- Verificado también con la publicación real del 2-nov-2026 y, en `buzon.yml`, con la ejecución manual del 3-nov-2026.

**R3. Publicación accidental del repositorio.**

- Evidencia: el repositorio es privado, según la consulta a GitHub del 2 de noviembre de 2026. Si se hiciera público, serían visibles el catálogo con las 14 canciones, incluidas las 4 con `public: false`; sus ficheros de audio, versionados en `audio-library/audio/`; los archivos originales subidos al buzón, que siguen en el historial; y todo el historial de git, que no se ha revisado en busca de secretos.
- Mitigación actual: repositorio privado.
- Propuesta: no hacerlo público sin revisar el historial con un escáner de secretos, sin dictamen sobre la licencia de cada pista y sin decidir si el audio no publicado debe seguir versionado.

**R4. Publicación de pistas antes del dictamen sobre la licencia.**

- Evidencia: diez pistas con `public: true` en `catalog.json`, con licencia declarada en Internet Archive o por el depositante. Por el buzón, la licencia la declara quien sube y el workflow no la comprueba (§3.11). ADR-0005 deja pendiente si esa declaración basta para publicar en Europa, lo que puede depender de la fecha de fijación y del país.
- Riesgo: legal. Una pista podría no estar en dominio público en España o en la UE.
- Mitigación actual: solo se aceptan licencias declaradas, y se registran en el catálogo.
- Propuesta: revisar pista a pista con [legal-05] y con el dictamen antes de ampliar la publicación.

**R5. Datos de la versión anterior que siguen en los navegadores.**

- Evidencia: ADR-0015 (decisión 3) deja la base `reminiscencia` sin abrir ni borrar en los navegadores que usaron la versión anterior, con sus perfiles, recuerdos, fotografías y observaciones, sin cifrar en reposo.
- Riesgo: quien use ese dispositivo desbloqueado puede leerla con las herramientas del navegador, y la interfaz ya no ofrece borrarla.
- Mitigación: no se borra sin que la persona lo pida (decisión del propietario). Se elimina borrando los datos del sitio en el navegador.
- Propuesta: explicar en la ayuda o en el README cómo borrar los datos del sitio, si hubo pruebas con datos reales.

**R6. Fotografías con metadatos de ubicación.** Retirado (ADR-0015): la aplicación ya no guarda fotografías.

**R7. Contraseña débil en la copia cifrada.** Retirado (ADR-0015): no hay copia cifrada. Las copias `.rmc` exportadas antes siguen protegidas solo por su contraseña donde se hayan guardado.

**R8. Reidentificación por combinación de datos.** Retirado de la aplicación (ADR-0015): no hay alias, recuerdos ni registro del estudio. Vuelve a aplicar si se define un instrumento nuevo para el estudio.

**R9. Cabeceras de seguridad incompletas en la web pública.**

- Evidencia: `vercel.json` define el `Content-Type` del audio y una Content-Security-Policy para todas las rutas. No define `X-Content-Type-Options` ni `Referrer-Policy`.
- Riesgo: bajo hoy, porque no hay terceros. Crece si se añade un script externo o contenido sin escapar.
- Propuesta: añadir `X-Content-Type-Options: nosniff` y `Referrer-Policy`. La CSP ya existe y ya incluye `frame-ancestors 'none'`.

**R10. Documentación desactualizada.** Resuelta en lo principal (2-nov-2026).

- Nota (3-nov-2026): la documentación se puso al día con ADR-0014, ADR-0015, ADR-0016 y ADR-0017. `METHODOLOGY.md` y la parte 2 de `AUDIO_ENGINE.md` describen el instrumento y el reproductor retirados y llevan nota de estado; los comentarios del código ya citan ADR-0015 para la interfaz (`88f9275`).

- Evidencia: CLAUDE.md, PROJECT_MASTER.md, ROADMAP.md, ADR-0005 y ADR-0007 ya indican que la administración está retirada; ADR-0005 y ADR-0007 llevan nota de estado de 2026-11-02. Ningún fichero del repositorio lee `ADMIN_PASSWORD`; `GITHUB_TOKEN` solo lo lee la función `/api/subir` (ADR-0017), además del token propio de los workflows. Las referencias antiguas a `library.yml` y a la administración de `docs/audio-processing/AUDIO_ENGINE.md` y `docs/datos/DATABASE.md` se corrigieron el 2-nov-2026.
- Riesgo: que alguien dé por protegida una vía que no existe, o mantenga una lista de bloqueo duplicada que ya no existe.
- Propuesta: borrar `ADMIN_PASSWORD` de Vercel si sigue configurada (ROADMAP.md, «Pendiente»). `GITHUB_TOKEN` se queda: lo usa `/api/subir`.

**R11. Pérdida de la clave de firma de Android.**

- Evidencia: copia de seguridad pendiente (ROADMAP.md; CHANGELOG.md, línea 50).
- Riesgo: sin la clave no se pueden publicar actualizaciones que los usuarios instalen (ADR-0004; `docs/android/RELEASE.md`).
- Propuesta: copia cifrada fuera del equipo.

**R12. Buzón: licencias, historial y atribución.**

- Evidencia: §3.11. La licencia la declara quien sube y no se comprueba; los archivos subidos quedan en el historial de git; la fuente pública es `Subida por <cuenta>`.
- Riesgos: (a) publicar una grabación con una licencia falsa o equivocada (R4); (b) versionar para siempre una grabación sin derechos o con datos de pacientes, aunque entre como privada; (c) atribución inexacta cuando el evento no nombra archivos o la ejecución es manual: entonces se procesa todo lo que haya en el buzón con el mensaje del último commit y con la cuenta que hizo el push o lanzó la ejecución, así que un archivo pendiente de una subida anterior puede quedar a nombre de otra cuenta, y con otra licencia; a mano, siempre privado y sin licencia.
- Mitigación: solo cuentas con permiso de escritura; sin línea de licencia la canción entra privada y no se puede publicar con `Sin declarar`; el resumen del job anota cada caso.
- Propuesta: revisar el resumen de cada ejecución del buzón; antes de publicar una canción subida, comprobar su licencia; no relanzar a mano con archivos de varias personas en el buzón.

**R13. Subida pública sin cuentas (ADR-0017).**

- Evidencia: §3.12. Cualquiera que entre en la web puede subir audio, y entra público en la biblioteca con la licencia de la web.
- Riesgos: (a) publicación de grabaciones sin derechos, ofensivas o con datos de pacientes, que quedan para siempre en el historial de git aunque se retiren; (b) crecimiento del repositorio sin límite (trozos en el historial y audio convertido), hasta los límites de GitHub (R3, `check_repo_limits.py`); (c) agotar la cuota de la API del token (5000 peticiones por hora) o los minutos de Actions con muchas subidas (cada trozo es un commit; solo el del manifiesto lanza una ejecución del buzón); (d) si el token se filtrara, da escritura en el repositorio; (e) atribución: todas las subidas de la web quedan como «Subida por <cuenta del token>».
- Mitigación: solo Ogg Opus en el primer trozo, nombre y ruta cerrados al buzón, sin sobrescribir; el buzón vuelve a validar y convierte con ffmpeg sin token (§3.11, R1); el token no llega al navegador. Riesgos aceptados por el propietario.
- Propuesta: token de grano fino limitado a este repositorio y a «Contents: write», con caducidad; revisar el resumen de cada ejecución del buzón; vigilar el tamaño del repositorio; si hay abuso, añadir un límite o un captcha (decisión del propietario).

## 5. Pendientes

**A. Legales y éticos (decisión o dictamen)**

1. Evaluación de impacto. Decidir si es necesaria según el art. 35 RGPD y la lista de la autoridad de control ([legal-02], disposición adicional decimoséptima, apartado 2, letra f), cuando se defina el instrumento del estudio que sustituya al registro retirado (ADR-0015). Hasta entonces no se tratan datos de participantes.
2. Comité de ética. Informe previo favorable: Ley 14/2007, art. 2.e ([legal-03]); disposición adicional decimoséptima, apartado 2, letra c ([legal-02]); Helsinki ([legal-04]). No hay informe en el repositorio. Es requisito previo a cualquier dato de pacientes.
3. Consentimiento. Documentos de consentimiento expreso y escrito (art. 4.1 de la Ley 14/2007, [legal-03]), con representante y asentimiento cuando corresponda ([legal-04]). La validación con cinco cuidadores y cinco pacientes exigía consentimiento y tutor (DESIGN 1.0, §16; retirada con ADR-0015). Cualquier validación con personas que se defina después lo exigirá igual.
4. Dictamen sobre la licencia de Internet Archive para publicar en Europa, incluidas las grabaciones antiguas (ADR-0005). También, el dictamen sobre copia privada y archivos familiares (ADR-0002) y el dictamen legal sobre audio (ROADMAP.md).
5. Plazos de protección de las grabaciones. Aplicar [legal-05] pista a pista: fecha de grabación, primera publicación o comunicación lícita, reglas de cómputo y disposición transitoria vigésima primera, apartado 3. Obtener dictamen. No se declara el estado de ninguna pista.
6. Terminología de la capacidad en los arts. 4.2 y 20 de la Ley 14/2007, frente a la Ley 8/2021 ([legal-03]).
7. Clasificación de cada tarea del estudio según el art. 3.t de la Ley 14/2007 ([legal-03]).
8. Traducción española de la Declaración de Helsinki. No verificada ([legal-04]).
9. Excepción de minería de textos: interpretación del art. 2.1 frente al art. 4 de la Directiva ([legal-06]), a confirmar por un jurista.

**B. Implementación (previsto y no hecho)**

10. Retirados por ADR-0015, antes en esta lista: conectar la capa de datos del cuidador, persistencia y aviso de cuota de la copia, fotografías (reducción y EXIF), PIN y almacén del registro del estudio.
11. Decidir el instrumento del estudio que sustituya al registro retirado (ADR-0015, consecuencias) y rehacer §2.3 antes de recoger datos.
12. Buzón: probar la cola compartida con `biblioteca.yml`; revisar la atribución cuando el evento no nombra archivos (R12). Subida desde la web (§3.12): probar en producción una subida de varios trozos. Hecho el 2026-11-03: la vía pública con «Licencia: …», la función real en Vercel con el token, que `autorizar` acepta la cuenta del token y que solo el manifiesto lanza el workflow (los `.part` están excluidos del filtro de `buzon.yml`).
13. Licencias declaradas en el buzón: incluirlas en el dictamen de §5 A.4.
14. Base `reminiscencia` de la versión anterior en los navegadores: decidir si se explica cómo borrarla (R5).
15. Gestión por incidencias de GitHub: implementada para cuentas con permiso de escritura (§3.5). Pendiente: revisar el filtro de autor antes de hacer público el repositorio (ADR-0008).
16. Workflows: la separación de procesado y escritura, y `persist-credentials: false` en el procesado, están hechos en `biblioteca.yml` (R1 y R2; importación verificada en GitHub el 2-nov-2026; falta la publicación). Pendiente: `permissions: contents: read` en `backend.yml`.
17. Cabeceras y CSP en `vercel.json` (R9).
18. Fuentes: resuelto. Figtree autoalojada en WOFF2 con su licencia (§3.8).
19. `android:allowBackup`: no se declara, pero las reglas de copia excluyen el audio local (§3.10). Decidir si se declara de forma explícita.
20. Copia de seguridad de la clave de firma de Android fuera del equipo (R11).
21. Cifrado en reposo de IndexedDB: ya no aplica a los datos actuales (listas, «Me gusta» y audio local). Sí a la base antigua `reminiscencia` (R5).
22. Antes de hacer público el repositorio: escaneo del historial, incluidos los archivos subidos al buzón, y decisión sobre el audio no publicado (R3).

**C. Documentación obsoleta (fuera de este fichero, sin modificar)**

23. Resuelto: CLAUDE.md ya no describe la administración ni la lista de bloqueo duplicada en `validate.js` (comprobado el 2-nov-2026).
24. Resuelto: la fila de administración de PROJECT_MASTER.md figura como retirada (ADR-0008).
25. Resuelto en lo referente a la administración. Queda la acción del propietario de borrar `ADMIN_PASSWORD` en Vercel. `GITHUB_TOKEN` ya no se borra: lo usa la función `/api/subir` (ADR-0017). ROADMAP.md, «Pendiente», ya solo pide borrar `ADMIN_PASSWORD` (corregido el 2026-11-03).
26. Resuelto: ADR-0005 y ADR-0007 llevan nota de estado de 2026-11-02, y los puntos 4 y 5 de ADR-0007 están superados por ADR-0008.
27. Resuelto: `.github/workflows/library.yml` ya no existe en `main`; su comentario obsoleto salió con el fichero.
28. Resuelto: DESIGN.md 2.0 (ADR-0015) ya no trata fotografías, PIN ni la app Android como PWA.
