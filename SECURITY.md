# Seguridad, privacidad y marco legal

Rama `feat/investigacion`. Revisión del 2 de noviembre de 2026 sobre el commit `8a19a09`.

Este documento describe lo que el código de esta rama hace hoy, separa lo implementado de lo previsto en el diseño y recoge lo pendiente. No es asesoramiento jurídico ni una evaluación de impacto (ver §5).

## 0. Alcance, estado y convenciones

- **Alcance.** Web pública (`frontend/web/`), capa de datos del cuidador (`frontend/web/js/`), app Android (`mobile/`), workflows (`.github/workflows/`) y el repositorio.
- **Estado de la rama.** La página pública solo escucha: `index.html` carga `app.js`, que lee `data/songs.json` y `data/folders.json`. La capa de datos del cuidador (IndexedDB, copia cifrada, PIN) está implementada como módulos, con pruebas en `tests/web-unit/`, pero ninguna pantalla del cuidador la usa todavía. Las pruebas no se han ejecutado para este documento, que no cambia código.
- **Etiquetas.** **Implementado**: existe en el código de la rama. **Previsto**: aparece en el diseño o en el changelog, sin código en la rama. **Pendiente**: requiere decisión, trabajo o dictamen.
- **Citas.** Los identificadores entre corchetes son los de la verificación ([legal-01] a [legal-06] y [B1-2025]). Cuando una verificación tiene corrección, se cita la versión corregida. Lo que la verificación no confirma queda en §5.
- **Límites de la evidencia.** La música es una hipótesis del proyecto. H1 a H5 están propuestas, no demostradas ([PROJECT_MASTER.md](PROJECT_MASTER.md)). La revisión Cochrane de 2025 [B1-2025] reporta certeza moderada de una mejora ligera de los síntomas depresivos, y de que probablemente no mejoran la agitación ni la agresión. Da certeza baja a una posible mejora de los problemas conductuales globales y no encuentra mejora demostrada del bienestar emocional ni de la ansiedad. Para la cognición, la certeza es baja o muy baja. Este documento no promete ningún efecto clínico.

## 1. Marco legal

### 1.1 Normas y estado de su verificación

| Id | Norma | Estado de la verificación | Hipótesis afectadas |
|---|---|---|---|
| [legal-01] | RGPD, Reglamento (UE) 2016/679 | Parcial; título corregido (EUR-Lex no consultado; se usó la copia del BOE) | H1 a H4 (datos de los participantes) |
| [legal-02] | LOPDGDD, LO 3/2018, disposición adicional decimoséptima | Parcial; se cita la versión corregida | H1 a H4 |
| [legal-03] | Ley 14/2007, de Investigación biomédica | Verificada | H1, H2 y H4 si hay intervención en personas con deterioro cognitivo; alcance para H5 a valorar |
| [legal-04] | Declaración de Helsinki (WMA, 2024) | Verificada en inglés; traducción no verificada | H1 a H4 |
| [legal-05] | TRLPI (RDL 1/1996), arts. 112 y 119, según la Ley 21/2014 | Parcial; se cita la versión corregida | H1, H2 y H4 |
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
- **Terminología.** Los arts. 4.2 y 20 hablan de «incapacitada legalmente» e «incapacitación». Según la verificación, la Ley 8/2021 (BOE-A-2021-9233) sustituyó la incapacitación judicial por medidas de apoyo; esa norma no consta en los registros verificados y debe confirmarse en el BOE. Se cita el texto literal con esta nota, a confirmar por un jurista.

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
- **Disposición transitoria vigésima primera, apartado 3, de la Ley 21/2014.** Los arts. 110 bis, 112 y 119 se aplican también a grabaciones y fonogramas protegidos a 1 de noviembre de 2013. Según la corrección de la verificación; no está confirmado en el texto del BOE (§5, pendiente 5).
- **Obras.** Tienen otro plazo: vida del autor más 70 años (art. 26).

Consecuencia: el estado de cada pista depende de su fecha de grabación y de su primera publicación lícita. Este documento no declara el estado de protección de ninguna pista (§5).

### 1.7 Directiva (UE) 2019/790 [legal-06]

Directiva (UE) 2019/790 del Parlamento Europeo y del Consejo, de 17 de abril de 2019, sobre los derechos de autor y derechos afines en el mercado único digital y por la que se modifican las Directivas 96/9/CE y 2001/29/CE (DOUE L 130, de 17.5.2019, pp. 92-125). En España se transpone en el Libro cuarto (arts. 65 a 80) del Real Decreto-ley 24/2021, de 2 de noviembre (BOE-A-2021-17910), que transpone también la Directiva (UE) 2019/789. La minería de textos y datos está en su art. 67.

Contenido confirmado de la Directiva: art. 2.1 (organismo de investigación), art. 2.2 (definición de minería de textos y datos), art. 3.1 (excepción obligatoria para organismos de investigación, con fines de investigación científica sobre obras de acceso lícito) y arts. 4.1 y 4.3 (excepción general, con reserva expresa, por ejemplo mediante lectura mecánica en contenidos en línea).

Uso en el proyecto: la metodología de revisión de literatura. Si el investigador no es organismo de investigación en el sentido del art. 2.1, el caso dependería del art. 4. Es una interpretación jurídica pendiente de confirmar (§5).

### 1.8 Licencias del catálogo

El catálogo (`audio-library/indexes/catalog.json`) tiene 11 canciones. Cada una declara su licencia en el campo `license`, tomada del ítem de Internet Archive o declarada por el depositante. Nueve tienen `public: true` y son las que se sirven en la web pública. Si esa declaración basta para publicar en Europa es el punto pendiente de dictamen (ADR-0005).

## 2. Datos que se tratan y minimización

### 2.1 Qué se guarda y dónde

Fuentes: `docs/user-experience/DESIGN.md`, §8.4 y §9 (en adelante, «DESIGN»).

| Dato | Dónde (diseño) | Estado en la rama |
|---|---|---|
| Perfiles: alias y código de participante opcional | IndexedDB, almacén `profiles` | Implementado en la capa de datos (`store.js`). El alias se valida en `schema.js`: límite de caracteres y sin caracteres de control. |
| Asociaciones canción-perfil (familiaridad, preferencia, presentación) | IndexedDB, `songLinks` | Implementado en la capa de datos. |
| Recuerdos, fotografías, listas, observaciones e historial | IndexedDB, `memories`, `photos`, `playlists`, `observations`, `history` | Implementado en la capa de datos. Límite de fotografía en el código: 8 MB (`store.js`, línea 452). DESIGN fija 10 MB (C-22). |
| Opciones del paciente y ajustes del cuidador | IndexedDB, `meta` (`settings`) y opciones por perfil | Implementado en la capa de datos, con valores por defecto en `store.js`. |
| Hash del PIN | IndexedDB, `meta` (clave `pin`) | Implementado: PBKDF2-SHA-256, 310 000 iteraciones y sal de 16 bytes (`crypto.js`). |
| Registro del estudio (eventos con marca de tiempo) | IndexedDB (DESIGN §8.4 y §9) | Pendiente. `store.js` no tiene almacén propio para los eventos. |
| Preferencias de pantalla | localStorage (DESIGN §9) | Previsto. No aparece en el código de la rama. |
| Audio sin conexión | Cache Storage (DESIGN §9) | Módulo implementado (`sw.js`, `offline-core.js`), pero `index.html` no carga `js/pwa.js`. No está activo. |

Los recuerdos autobiográficos son el material de H2, y las fotografías el de H4. Por eso su tratamiento tiene más peso que el de las preferencias musicales.

### 2.2 Qué nunca entra en el repositorio

- **Datos de personas.** Nombres reales, fotografías, recuerdos y datos de participantes (CLAUDE.md). `.gitignore` excluye `research-data/personal/`, `research-data/**/raw/`, `*.sqlite` y `.env`. En `research-data/` no aparecen las palabras nombre, alias, paciente, participante ni correo electrónico; esto no sustituye una revisión manual de los ficheros.
- **Copias cifradas (.rmc).** Se generan en el navegador del cuidador. No hay ninguna en el árbol versionado.
- **Claves de firma de Android.** No hay ficheros `.jks`, `.keystore`, `key.properties` ni `.p12` versionados. Las claves locales están en `~/.android-keys/` (CLAUDE.md).
- **Secretos.** Una búsqueda de patrones habituales (tokens de GitHub, claves privadas, contraseñas asignadas, `ADMIN_PASSWORD`, `GITHUB_TOKEN`) sobre los ficheros de texto versionados no encontró valores. Solo aparecen nombres de variables y marcadores, como `<contraseña del almacén>` en `docs/android/RELEASE.md`. No se ha revisado el historial de git.

### 2.3 Identificación de participantes

- Los participantes se identifican con alias y código de participante. El registro del estudio no usa nombres reales (DESIGN §8.4).
- DESIGN §9 dice que los nombres reales son opcionales. El código no impide escribirlos en el alias. Recomendación: no usarlos (riesgo R8).

### 2.4 Minimización en la copia cifrada

La copia incluye perfiles, asociaciones, listas, recuerdos, fotografías, observaciones, historial y opciones. No incluye el hash del PIN, los ajustes del dispositivo (`backup.js`, comentario de cabecera) ni el audio, que solo se referencia por identificador de catálogo (DESIGN §9).

## 3. Medidas de seguridad de la aplicación

### 3.1 Datos solo en el navegador del cuidador: Implementado (capa de datos)

- Almacén IndexedDB, base `reminiscencia`, versión 1. `store.js` declara que los datos no salen del navegador.
- Sin cuentas ni sincronización en la nube (DESIGN §1).
- La página no envía datos a ningún servidor. Las únicas peticiones de `app.js` son a `data/songs.json` y `data/folders.json`, del mismo origen. No hay URLs externas en `frontend/web/`, salvo una base local usada para resolver rutas en `offline-core.js`.
- Límite: sin interfaz del cuidador en la rama, el almacén no recibe datos desde la página.

### 3.2 Copia cifrada con contraseña y sin recuperación: Implementado (módulo)

- AES-GCM de 256 bits. La clave se deriva de la contraseña con PBKDF2-SHA-256, 600 000 iteraciones y sal aleatoria de 16 bytes (`crypto.js`).
- La cabecera del fichero se usa como dato adicional autenticado, así que una alteración de la cabecera hace fallar el descifrado.
- Contraseña de al menos 10 caracteres (`MIN_PASSPHRASE_LENGTH`).
- Al importar, las iteraciones se aceptan solo entre 100 000 y 2 000 000.
- Los errores de descifrado dan un único mensaje («Contraseña incorrecta o copia dañada»). No revelan si falló la contraseña o si el contenido está dañado.
- Sin contraseña no hay recuperación. La aplicación no guarda ni envía la contraseña (DESIGN §9).
- Pendiente de interfaz: el aviso antes de exportar (DESIGN §9).

### 3.3 PIN local: Implementado en parte, con protección limitada

- Se guarda solo el hash PBKDF2-SHA-256 (310 000 iteraciones, sal de 16 bytes). El PIN nunca se guarda en claro (`setPin`, `checkPin` y `hasPin` en `store.js`).
- «Olvidé el PIN» quita solo el PIN y conserva los datos (`removePin`, `store.js`).
- Finalidad declarada: evitar salidas accidentales del modo paciente. No protege los datos frente a quien tenga el dispositivo desbloqueado (DESIGN §9).
- Divergencias:
  - Longitud. `schema.js` acepta de 4 a 12 dígitos. DESIGN §9 dice de 4 a 6, y P-16 muestra indicadores para 4 o 6.
  - Bloqueo. DESIGN §9 fija 60 s tras cinco fallos, y P-16 fija 45 s. El bloqueo no está en el código de la rama.

### 3.4 Sin administración ni contraseñas en la web: Implementado

- El commit `0fa6ed3` retiró `frontend/web/admin`, `frontend/web/api` y `frontend/web/lib`. Según su mensaje, el propietario ha pedido que no exista ninguna administración en la web. Ya no hay funciones de Vercel ni `ADMIN_PASSWORD` (CHANGELOG.md, línea 23).
- No hay campos de contraseña de administración en la web pública. La única contraseña de la aplicación es la de la copia cifrada (§3.2).
- La documentación todavía describe la administración retirada (§5, C).

### 3.5 Incidencias de GitHub solo para el propietario: Previsto

- CHANGELOG.md, línea 19, prevé la gestión pública mediante incidencias de GitHub, solo del propietario y con revisión de seguridad.
- Ningún workflow se dispara con incidencias. Los únicos disparadores son `workflow_dispatch`, `push` y `pull_request`.
- Condiciones antes de implementarlo:
  1. Comprobar en el propio workflow que el autor de la incidencia es el propietario, no solo en la interfaz.
  2. Tratar el título y el cuerpo como datos: pasarlos por variables de entorno y nunca interpolarlos en `run:`. `library.yml` ya pasa sus entradas por `env` (líneas 66 a 73).
  3. Permisos mínimos en ese job (§3.7).

### 3.6 Secretos fuera del repositorio: Implementado, con pendiente

- No hay secretos en los ficheros versionados (§2.2).
- Las claves de firma de Android están en GitHub Secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` y `ANDROID_KEY_PASSWORD` (cabecera de `android.yml`). El almacén se reconstruye en el runner y se borra en un paso con `if: always()`.
- La huella SHA-256 del certificado de producción es un dato público, porque va en cada APK firmado. Está en `android.yml`.
- Pendiente: copia de seguridad de la clave de firma fuera del equipo (ROADMAP.md, sin marcar; CHANGELOG.md, línea 50).

### 3.7 Permisos mínimos en los workflows: Parcial

| Workflow | Permisos declarados | Estado |
|---|---|---|
| `android.yml` | `contents: read` a nivel de workflow. El job de producción hace checkout con `persist-credentials: false`. Solo el job de publicación de la release (etiquetas `android-v*`) tiene `contents: write`. | Implementado. Es el modelo a seguir. |
| `library.yml` | `contents: write` a nivel de workflow. Un único job hace la descarga, el procesado con ffmpeg y el push a `main`. | Pendiente (R1 y R2). |
| `backend.yml` | Sin bloque `permissions`. Hereda el valor por defecto del repositorio. | Pendiente: declarar `contents: read`. |

- `library.yml` solo tiene `workflow_dispatch`. Lo puede lanzar quien tenga permiso de escritura en el repositorio. Es el comportamiento habitual de GitHub, no comprobado con otra cuenta.
- Ningún workflow usa `pull_request_target`.

### 3.8 Web pública: terceros y cabeceras: Parcial

- Sin scripts, fuentes, analítica ni recursos de terceros. `index.html` carga solo `app.js` y las hojas de estilo locales. No hay SDK de analítica en `mobile/pubspec.yaml` ni en los ficheros Gradle.
- Los títulos y artistas se escriben con `textContent` (`app.js`, líneas 119 a 121), no con `innerHTML`.
- `vercel.json` solo define el `Content-Type` del audio. No hay Content-Security-Policy ni otras cabeceras (R9).
- DESIGN §5.3 prevé la tipografía autoalojada en WOFF2. La rama no contiene ficheros de fuente.

### 3.9 Fotografías y almacenamiento del navegador: Previsto

- Diseño: máximo 10 fotografías por recuerdo, reducción a 1600 px en el lado mayor (JPEG al 85 %) y eliminación de los metadatos EXIF, incluida la ubicación (DESIGN §9 y C-22).
- En el código no hay reducción ni tratamiento de EXIF. `store.js` (línea 452) dice que la reducción la hace la interfaz, que todavía no existe.
- Persistencia: DESIGN §9 prevé `navigator.storage.persist()` al crear el primer perfil. No aparece en el código. `pwa.js` sí consulta `navigator.storage.estimate()` (línea 74), para la caché.
- El recordatorio de copia cada 14 días (DESIGN §9) no se ha localizado en el código de la rama.

### 3.10 Aplicación Android (`mobile/`): Implementado, sin datos del cuidador

- Permisos del manifiesto: acceso a la red (INTERNET), reproducción en segundo plano (FOREGROUND_SERVICE_MEDIA_PLAYBACK, WAKE_LOCK) y notificaciones (POST_NOTIFICATIONS).
- En `mobile/lib` no hay código de PIN.
- `AndroidManifest.xml` no declara `android:allowBackup`. Por defecto, Android permite la copia de seguridad del sistema. Hay que decidirlo (§5).
- Discrepancia con el diseño: DESIGN §1 dice que la app Android empaqueta las mismas pantallas que la PWA. `mobile/` es una app Flutter que lee la biblioteca de la web (ADR-0004).

## 4. Amenazas y riesgos residuales

**R1. Procesado de ficheros externos con ffmpeg en el mismo job con permiso de escritura.**

- Evidencia: `library.yml` declara `contents: write` a nivel de workflow. En el mismo job, `intake.py` descarga la URL, `compression.py` ejecuta ffmpeg y, en el paso siguiente, se hace `git push` a `main`.
- Mitigación actual: solo Internet Archive con licencia declarada, o ficheros directos con licencia declarada (ADR-0005). Bloqueo de plataformas en `sources.py` (`BLOCKED_HOSTS`). Descarga limitada a 200 MiB y escritura solo dentro del directorio de destino (`intake.py`). ffmpeg se llama con una lista de argumentos, con `-map 0:a:0` y `-vn` (`compression.py`). `check_repo_limits.py` se ejecuta antes del commit.
- Riesgo residual: un fichero preparado para explotar el decodificador de ffmpeg podría ejecutar código en el runner, que tiene permiso de escritura y el token de R2. Además, `git add -A frontend/web` incluye cualquier fichero que deje el procesado. Como Vercel sirve esa carpeta, ese fichero se publicaría.
- Propuesta, no implementada: dos jobs. El procesado, con `contents: read` y `persist-credentials: false`, entrega los ficheros validados como artefacto. El job de escritura solo añade rutas concretas y hace el push.

**R2. Token de GitHub disponible en los pasos del procesado.**

- Evidencia: el checkout de `library.yml` (línea 53) no fija `persist-credentials: false`. Por defecto, `actions/checkout` deja las credenciales en la configuración local de git del espacio de trabajo. Ese espacio lo usan el paso «Aplicar la acción» (línea 65), que procesa las URL, y «Comprobar límites y guardar cambios» (línea 83), que hace el push.
- Riesgo: el código que corre en el paso de procesado (R1) podría leer el token y escribir en `main`.
- Mitigación: ninguna todavía. Propuesta: `persist-credentials: false`, token solo en el paso de push, o separación en un job aparte (R1).

**R3. Publicación accidental del repositorio.**

- Evidencia: el repositorio es privado, según la consulta a GitHub del 2 de noviembre de 2026. Si se hiciera público, serían visibles el catálogo con las 11 canciones, incluidas las 2 con `public: false`; los dos ficheros de audio no publicados, versionados en `audio-library/audio/`; y todo el historial de git, que no se ha revisado en busca de secretos.
- Mitigación actual: repositorio privado.
- Propuesta: no hacerlo público sin revisar el historial con un escáner de secretos, sin dictamen sobre la licencia de cada pista y sin decidir si el audio no publicado debe seguir versionado.

**R4. Publicación de pistas antes del dictamen sobre la licencia.**

- Evidencia: nueve pistas con `public: true` en `catalog.json`, con licencia declarada en Internet Archive o por el depositante. ADR-0005 deja pendiente si esa declaración basta para publicar en Europa, lo que puede depender de la fecha de fijación y del país.
- Riesgo: legal. Una pista podría no estar en dominio público en España o en la UE.
- Mitigación actual: solo se aceptan licencias declaradas, y se registran en el catálogo.
- Propuesta: revisar pista a pista con [legal-05] y con el dictamen antes de ampliar la publicación.

**R5. Datos del cuidador en el navegador.**

- Evidencia: el PIN no protege frente a un dispositivo desbloqueado (DESIGN §9). `store.js` escribe los registros sin cifrarlos. El cifrado se usa solo en la copia (`backup.js`), y el hash, solo en el PIN. No hay cifrado en reposo de los registros.
- Riesgos: pérdida de datos si el navegador borra el sitio (DESIGN §9 lo advierte para iOS y Safari), y acceso por quien use un dispositivo desbloqueado o una tableta compartida.
- Mitigación prevista: persistencia (no implementada), recordatorio de copia (DESIGN §9, no localizado en el código) y el ajuste «Abrir siempre en modo paciente» (DESIGN §3.3).
- Propuesta: implementar la persistencia y el recordatorio. Decidir si los registros se cifran en reposo y cómo se gestiona la clave (§5).

**R6. Fotografías con metadatos de ubicación y personas identificables.**

- Evidencia: no hay eliminación de EXIF ni reducción de imagen en el código (§3.9). El límite de tamaño del código es de 8 MB.
- Riesgo: la ubicación puede viajar en los metadatos EXIF. Las fotografías de familiares son datos personales. Son el material de H4.
- Mitigación: prevista (DESIGN §9 y C-22), no implementada.
- Propuesta: implementar la reducción y la eliminación de EXIF antes de guardar ninguna foto, y probarlo con una imagen de prueba que tenga metadatos.

**R7. Contraseña débil en la copia cifrada.**

- Evidencia: mínimo de 10 caracteres. PBKDF2 con 600 000 iteraciones (`crypto.js`).
- Riesgo: si el fichero `.rmc` se filtra y la contraseña es débil, puede atacarse sin conexión.
- Mitigación: longitud mínima, iteraciones altas y sin recuperación.
- Propuesta: mostrar la fuerza de la contraseña en la interfaz y recomendar una frase larga.

**R8. Reidentificación por combinación de datos.**

- Evidencia: el alias admite cualquier texto válido (`schema.js`). Los nombres reales son opcionales (DESIGN §9). El registro combina sesión, perfil, canción, presentación y marca de tiempo (DESIGN §8.4). Las fotografías pueden mostrar personas, y los recuerdos (H2) describen la vida de la persona.
- Riesgo: un alias con nombre real, o la combinación de fechas, fotos y recuerdos, permite identificar a la persona.
- Mitigación: alias y código. El registro no usa nombres (DESIGN §8.4).
- Propuesta: texto de ayuda al crear el perfil («usa un alias, no un nombre»). Revisar los CSV antes de compartirlos.

**R9. Sin cabeceras de seguridad en la web pública.**

- Evidencia: `vercel.json` solo define el `Content-Type` del audio.
- Riesgo: bajo hoy, porque no hay terceros. Crece si se añade un script externo o contenido sin escapar.
- Propuesta: Content-Security-Policy que solo permita el origen propio; `X-Content-Type-Options: nosniff`; `Referrer-Policy`; `frame-ancestors 'none'`.

**R10. Documentación desactualizada.**

- Evidencia: CLAUDE.md, PROJECT_MASTER.md, ROADMAP.md, ADR-0005 (actualización del 31-oct-2026), ADR-0007 y la cabecera de `library.yml` describen la administración en Vercel, `ADMIN_PASSWORD`, `GITHUB_TOKEN` en Vercel y `frontend/web/lib/validate.js`. Ninguno existe ya en la rama.
- Riesgo: que alguien dé por protegida una vía que no existe, o mantenga una lista de bloqueo duplicada que ya no existe.
- Propuesta: corregir los documentos (§5, C).

**R11. Pérdida de la clave de firma de Android.**

- Evidencia: copia de seguridad pendiente (ROADMAP.md; CHANGELOG.md, línea 50).
- Riesgo: sin la clave no se pueden publicar actualizaciones que los usuarios instalen (ADR-0004; `docs/android/RELEASE.md`).
- Propuesta: copia cifrada fuera del equipo.

## 5. Pendientes

**A. Legales y éticos (decisión o dictamen)**

1. Evaluación de impacto. Decidir si es necesaria según el art. 35 RGPD y la lista de la autoridad de control ([legal-02], disposición adicional decimoséptima, apartado 2, letra f). Hasta entonces no se tratan datos de participantes (PROJECT_MASTER.md: «Perfiles de pacientes y datos personales», no iniciado).
2. Comité de ética. Informe previo favorable: Ley 14/2007, art. 2.e ([legal-03]); disposición adicional decimoséptima, apartado 2, letra c ([legal-02]); Helsinki ([legal-04]). No hay informe en el repositorio. Es requisito previo a cualquier dato de pacientes.
3. Consentimiento. Documentos de consentimiento expreso y escrito (art. 4.1 de la Ley 14/2007, [legal-03]), con representante y asentimiento cuando corresponda ([legal-04]). La validación con cinco cuidadores y cinco pacientes exige consentimiento y tutor (DESIGN §16).
4. Dictamen sobre la licencia de Internet Archive para publicar en Europa, incluidas las grabaciones antiguas (ADR-0005). También, el dictamen sobre copia privada y archivos familiares (ADR-0002) y el dictamen legal sobre audio (ROADMAP.md).
5. Plazos de protección de las grabaciones. Aplicar [legal-05] pista a pista: fecha de grabación, primera publicación o comunicación lícita, reglas de cómputo y disposición transitoria vigésima primera, apartado 3. Obtener dictamen. No se declara el estado de ninguna pista.
6. Terminología de la capacidad en los arts. 4.2 y 20 de la Ley 14/2007, frente a la Ley 8/2021 ([legal-03]).
7. Clasificación de cada tarea del estudio según el art. 3.t de la Ley 14/2007 ([legal-03]).
8. Traducción española de la Declaración de Helsinki. No verificada ([legal-04]).
9. Excepción de minería de textos: interpretación del art. 2.1 frente al art. 4 de la Directiva ([legal-06]), a confirmar por un jurista.

**B. Implementación (previsto y no hecho)**

10. Conectar la capa de datos a la interfaz del cuidador. En la rama, `index.html` solo carga `app.js`, y `js/pwa.js` no se carga.
11. Persistencia del almacenamiento (`navigator.storage.persist()`) y aviso de cuota (DESIGN §9).
12. Fotografías: reducción a 1600 px y eliminación de EXIF. Alinear el límite, que es de 8 MB en `store.js` y de 10 MB en DESIGN C-22.
13. PIN: alinear la longitud (de 4 a 12 en `schema.js`, de 4 a 6 en DESIGN §9) y decidir el bloqueo tras cinco fallos (60 s en §9, 45 s en P-16).
14. Registro del estudio: decidir el almacén (DESIGN §8.4 y §9), porque `store.js` no tiene uno propio.
15. Gestión por incidencias de GitHub, solo del propietario (CHANGELOG.md, línea 19), con las condiciones de §3.5.
16. Workflows: separar procesado y escritura (R1 y R2), `persist-credentials: false` en el checkout del procesado y `permissions: contents: read` en `backend.yml`.
17. Cabeceras y CSP en `vercel.json` (R9).
18. Fuentes: añadir los ficheros WOFF2 autoalojados o corregir DESIGN §5.3.
19. `android:allowBackup`: decidir el valor y declararlo en `AndroidManifest.xml`.
20. Copia de seguridad de la clave de firma de Android fuera del equipo (R11).
21. Decidir si los registros de IndexedDB se cifran en reposo (R5).
22. Antes de hacer público el repositorio: escaneo del historial y decisión sobre el audio no publicado (R3).

**C. Documentación obsoleta (fuera de este fichero, sin modificar)**

23. CLAUDE.md: la sección de Restricciones (secretos de Vercel, `ADMIN_PASSWORD`, `GITHUB_TOKEN`, lista de bloqueo duplicada en `validate.js`) y la de Arquitectura (`admin/`, `api/`, `lib/`). CHANGELOG.md, línea 23, indica que la administración ya se retiró.
24. PROJECT_MASTER.md: fila «Administración en Vercel (`/admin/`)» de la tabla de módulos.
25. ROADMAP.md: líneas 28 y 49 (`ADMIN_PASSWORD` y administración sin usar).
26. ADR-0005: sección «Actualización (2026-10-31)». ADR-0007: puntos 4 y 5.
27. `.github/workflows/library.yml`: comentario de cabecera (líneas 3 y 4).
28. DESIGN.md: longitud del PIN, bloqueo (60 s en §9 frente a 45 s en P-16), tamaño de fotografía y §1 (la app Android no es la PWA).
