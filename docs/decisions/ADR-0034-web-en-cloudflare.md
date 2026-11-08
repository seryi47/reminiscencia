# ADR-0034: La web en Cloudflare, con el Worker, en reminiscencia.cometia.es

- Estado: aceptada (2026-11-08), en la rama `feature/web-en-cloudflare`. **Sin desplegar**: falta el primer `wrangler deploy` y conectar Cloudflare Workers Builds (ver «Despliegue»).
- Fecha: 2026-11-08
- Modifica: [ADR-0007](ADR-0007-catalogo-y-flujo-desde-vercel.md) (la web estática deja de servirse solo desde Vercel), [ADR-0029](ADR-0029-worker-cloudflare-y-portadas.md) (el Worker sirve también la web y tiene dominio propio) y [ADR-0031](ADR-0031-audio-por-el-worker.md) (en el dominio propio el audio es del mismo origen; la redirección de `vercel.json` va al dominio propio).
- Relacionadas: [ADR-0021](ADR-0021-buscar-en-youtube.md) y [ADR-0019](ADR-0019-playlists-de-youtube-como-albumes.md) (las funciones de YouTube, que siguen en Vercel).

## Contexto

- Vercel ha bloqueado todo el equipo Hobby (HTTP 402 `DEPLOYMENT_DISABLED`, por pasarse de «Fast Origin Transfer») hasta el 2026-12-07. Mientras dure, https://reminiscencia.vercel.app no sirve nada: ni la web ni `data/*.json` (que lee la APK) ni las portadas `covers/` ni las funciones.
- El Worker `reminiscencia-api` (ADR-0029) ya atiende `/api/subir`, `/api/editar`, `/api/portada`, `/api/portadas`, `/api/salud` y el audio (`/audio/<id>.opus`, ADR-0031) en `https://reminiscencia-api.reminiscencia-app.workers.dev`.
- La zona `cometia.es` ya está en Cloudflare. El subdominio `reminiscencia.cometia.es` no existe todavía.
- Petición del propietario: llevar a Cloudflare **todo lo que se pueda tal como está**, dejar el resto en Vercel y **no añadir funciones nuevas**: solo mover piezas y cambiar direcciones y configuración.

## Decisión

### 1. Un solo dominio: `https://reminiscencia.cometia.es`

El mismo Worker sirve la web estática y el API en el dominio propio (`worker/wrangler.toml`):

- `routes = [{ pattern = "reminiscencia.cometia.es", custom_domain = true }]`: al desplegar, Cloudflare crea el registro DNS del subdominio y su certificado.
- `workers_dev = true` se mantiene: las APK ya instaladas (1.2.4+8 y anteriores) llaman a `reminiscencia-api.reminiscencia-app.workers.dev`.
- `[assets]` (Workers Static Assets): `directory = "../frontend/web"`, `binding = "ASSETS"` y `run_worker_first = ["/api/*", "/audio/*"]`. Solo esas rutas pasan por el código del Worker; el resto (la página, `js/`, `css/`, `data/`, `covers/`…) lo sirve Cloudflare directamente desde los ficheros. Una ruta que no existe da 404, como en Vercel (sin reescrituras de aplicación de una página: la web usa `#/…`).
- En el código (`worker/src/index.js`), lo que no empieza por `/api/` ni `/audio/` se entrega a `env.ASSETS` antes de CORS y de las rutas del API. En producción no llega (lo decide `run_worker_first`), pero así el orden no depende solo de la configuración y se prueba.
- La ruta del `[assets]` es relativa a `worker/`, igual que las importaciones de `../frontend/web/server/` que ya empaquetaba wrangler. Funciona desde una copia completa del repositorio, que es lo que clona Workers Builds.

### 2. Solo se publica la web

`frontend/web/.assetsignore` deja fuera `api/`, `server/`, `node_modules`, `package.json`, `package-lock.json`, `vercel.json`, `.vercel`, `.gitignore` y `.DS_Store`. Comprobado con `npx --yes wrangler@4.151.3 deploy --dry-run` (con `WRANGLER_LOG=debug`, que lista cada fichero): se suben 51 ficheros: `index.html`, `sw.js`, `manifest.webmanifest`, `js/**` (34 módulos), `css/` (2), `fonts/` (4 `.woff2` y la licencia), `icons/` (3), `data/` (3 JSON) y `covers/`; `_headers` y `.assetsignore` no se sirven (Cloudflare los lee como configuración).

### 3. La configuración de Vercel, en Cloudflare

- **CSP.** `frontend/web/_headers` aplica a todas las rutas (`/*`) la misma `Content-Security-Policy` que `vercel.json`. `tests/web-unit/cabeceras.test.mjs` comprueba que las dos copias son idénticas. Cloudflare aplica `_headers` solo a los ficheros estáticos; las respuestas del Worker llevan sus propias cabeceras.
- La política añade `https://reminiscencia.cometia.es` a `connect-src` y `media-src` (lo necesita la web de Vercel cuando vuelva, porque su API y su audio son ahora el dominio propio), y en `media-src` lo pone en lugar del Worker exacto de `workers.dev`. En el dominio propio basta `'self'`. Se mantienen `r2.dev` (respaldo del audio y portadas) y `https://*.workers.dev` en `connect-src`.
- **Redirección `/audio/:file`.** En Cloudflare no hace falta: el Worker sirve `/audio/<id>.opus` en el mismo origen (`worker/src/audio.js`). En `vercel.json` se mantiene y ahora apunta a `https://reminiscencia.cometia.es/audio/:file` (`WORKER_AUDIO_ORIGIN`; la prueba lo exige).
- `vercel.json` sigue en el repositorio y solo cambian esas dos direcciones: cuando Vercel desbloquee el equipo, https://reminiscencia.vercel.app vuelve a funcionar igual que antes.

### 4. Lo que se queda en Vercel: las funciones de YouTube

`frontend/web/api/youtube/*` (búsqueda, playlists, conversión, estado y descarga) dependen de `yt-dlp` empaquetado por Vercel (`includeFiles` de `vercel.json`) y de `node:child_process`, que un Worker no tiene. **No se tocan.** El Worker reenvía `/api/youtube/*` tal cual a `https://reminiscencia.vercel.app/api/youtube/…`:

- mismo método, ruta y consulta; el cuerpo (JSON pequeño) se lee y se reenvía; de las cabeceras, solo las que usan esas funciones (`Accept`, `Accept-Language`, `Content-Type`, `Range`, `If-None-Match`, `User-Agent`, `X-Homeostasia-Trace` y `X-Homeostasia-Poll`), nunca `Cookie`, `Authorization` ni `Origin`;
- la respuesta vuelve en flujo (también el WAV de la descarga), con su estado y sus cabeceras, más las del Worker (CORS y `X-Reminiscencia-Api`); las redirecciones no se siguen (`redirect: 'manual'`);
- si Vercel no responde, 502 con un mensaje claro. Un origen no admitido recibe 403 sin reenviar nada.

Así la web y la APK siguen llamando a las mismas rutas relativas. **Mientras dure el bloqueo, Vercel responde 402 y el Worker lo devuelve tal cual: el buscador «En YouTube» y Homeostasia fallan hasta el 2026-12-07.** Lo demás funciona.

Las funciones `api/subir.js` y `api/editar.js` también siguen en Vercel, pero en el dominio propio ganan las rutas del Worker (las mismas, ADR-0029).

### 5. Los clientes apuntan al dominio propio

- **Web:** `WORKER_API_BASE = 'https://reminiscencia.cometia.es'` (`js/api-config.js`). En el dominio propio, el API y el audio son el propio origen; en Vercel (cuando vuelva), los llama con CORS. El respaldo «Vercel» del cliente del API (rutas relativas) en el dominio propio también acaba en el Worker. `SHELL_VERSION` pasa de 32 a 33.
- **APK** 1.2.5+9: `kLibraryBase` (`lib/library_store.dart`: datos, portadas `covers/`, respaldo del audio y de las rutas del API), `kWorkerApiBase` (`lib/api_config.dart`), `kEmbedOrigin` (`lib/youtube_embed.dart`) y la base por defecto de `CoverCache` (`lib/covers.dart`) pasan a `https://reminiscencia.cometia.es/`. `kR2AudioBase` y `kCoverBucketBase` (`r2.dev`) no cambian.
- **CORS** del Worker: admite `https://reminiscencia.cometia.es` (`SITE_ORIGIN`) y sigue admitiendo `https://reminiscencia.vercel.app` (`WEB_ORIGIN`).
- **Comprobador:** `scripts/smoke_produccion.mjs` comprueba por defecto `https://reminiscencia.cometia.es`; la de Vercel se comprueba pasándola como argumento.

### 6. Despliegue continuo con Cloudflare Workers Builds

El equivalente a la integración de Git de Vercel: Workers Builds (en el panel de Cloudflare) despliega el Worker, y con él la web, con cada push a `main`. Eso incluye los commits de `buzon.yml` y `biblioteca.yml` que actualizan `frontend/web/data/*.json` y `covers/`. No hay workflow de GitHub que despliegue ni secretos nuevos en GitHub.

## Alternativas descartadas

- **Cloudflare Pages para la web y el Worker aparte.** Dos proyectos, dos despliegues y dos dominios (o reglas de enrutado entre ellos). Workers Static Assets es la opción recomendada por Cloudflare para proyectos nuevos y deja la web y el API en el mismo origen sin CORS.
- **Mover también las funciones de YouTube.** Exigiría reescribirlas sin `yt-dlp` ni `child_process`: es funcionalidad nueva, fuera de lo pedido.
- **Dejar `WORKER_API_BASE` en `workers.dev`.** Funcionaría, pero la web del dominio propio haría todas las llamadas a otro origen (CORS y *preflight* en cada subida) teniendo el Worker en el mismo.
- **Vaciar `WORKER_API_BASE` (todo relativo).** En el dominio propio llegaría al Worker igual, pero el cliente creería hablar con Vercel: trozos de 4 MB en vez de 32 MB (ADR-0030), sin índice de portadas (ADR-0029) y el audio empezaría en `r2.dev` (ADR-0031).

## Consecuencias

- Las peticiones a los ficheros estáticos no ejecutan el Worker; según la documentación de Cloudflare, en el plan gratuito no cuentan como peticiones del Worker. Las de `/api/*` y `/audio/*` sí cuentan (100 000 al día en el plan gratuito, ADR-0031). **No se ha comprobado con el uso real.**
- Los ficheros estáticos llevan las cabeceras de caché por defecto de Cloudflare (revalidación con `ETag`), como en Vercel: un `data/songs.json` nuevo se ve en la siguiente visita.
- Con la configuración por defecto de Workers Static Assets (`html_handling = "auto-trailing-slash"`), `/index.html` redirige a `/`. El service worker ya lo contempla (no guarda respuestas redirigidas; `sw.js`, `isCacheable`).
- Las APK instaladas (1.2.4+8 y anteriores) leen la biblioteca y las portadas de `reminiscencia.vercel.app`: hasta que Vercel vuelva, solo les funciona lo que va por `workers.dev` (audio, subidas, ediciones). Hay que instalar la 1.2.5+9.
- Mientras Vercel esté bloqueado, «En YouTube» y Homeostasia fallan (402 reenviado).

## Despliegue (pasos del propietario)

Requisito: la zona `cometia.es` debe estar en **la misma cuenta de Cloudflare** que el Worker `reminiscencia-api` (la de los buckets; subdominio `reminiscencia-app` de `workers.dev`), y no debe existir ya un registro DNS `reminiscencia` en esa zona (si existe, borrarlo antes: el dominio propio lo crea él).

1. **Fusionar la rama en `main`** (sin push todavía si se quiere hacer el primer despliegue a mano desde la rama fusionada en local).
2. **Primer despliegue a mano**, desde `worker/` (Node 20 o superior):
   - `npx --yes wrangler@4.151.3 login` (si no hay sesión).
   - `npx --yes wrangler@4.151.3 deploy --dry-run --outdir /tmp/reminiscencia-dist` (comprobación: «Read N files from the assets directory» y los *bindings* `PRIVATE_BUCKET`, `PUBLIC_BUCKET` y `ASSETS`).
   - `npx --yes wrangler@4.151.3 deploy`. Al terminar lista `reminiscencia-api.reminiscencia-app.workers.dev` y `reminiscencia.cometia.es (custom domain)`. El secreto `GITHUB_TOKEN` ya está en el Worker y se conserva.
3. **Comprobar** (el certificado puede tardar unos minutos):
   - `curl -sI https://reminiscencia.cometia.es/` → `200`, `content-type: text/html` y `content-security-policy`.
   - `curl -s https://reminiscencia.cometia.es/api/salud` → `{"ok":true,"servicio":"reminiscencia-api",…}`.
   - `curl -sI https://reminiscencia.cometia.es/audio/<id público>.opus` → `200` con `x-reminiscencia-api: 1`.
   - `curl -sI https://reminiscencia.cometia.es/package.json`, `…/vercel.json` y `…/server/upload-core.js` → `404` (no se publican).
   - `node scripts/smoke_produccion.mjs --concurrencia=4` (por defecto ya usa el dominio propio) → sin FALLO.
4. **Conectar Workers Builds** (panel de Cloudflare › Workers & Pages › `reminiscencia-api` › Settings › Builds › Connect):
   - Git: GitHub, repositorio `seryi47/reminiscencia` (autorizar la app de Cloudflare en GitHub si lo pide, solo para ese repositorio).
   - Production branch: `main`.
   - Build command: vacío.
   - Deploy command: `npx --yes wrangler@4.151.3 deploy`.
   - Root directory: `worker`.
   - Builds for non-production branches: desactivado (las ramas no deben publicar nada).
   - Build watch paths: los de por defecto (todo el repositorio), para que los commits del buzón que solo tocan `frontend/web/data/` también desplieguen.
   - No hace falta ninguna variable: el token de la API de Cloudflare lo crea Workers Builds, y el nombre del Worker (`reminiscencia-api`) debe coincidir con `name` de `wrangler.toml` (coincide).
5. **Comprobar el despliegue continuo:** el siguiente push a `main` (o «Retry build» en el panel) debe terminar en verde en la pestaña Deployments del Worker.
6. **APK:** compilar y publicar la 1.2.5+9 (desde `mobile/`: `flutter build apk --release --split-per-abi`, o lanzar `android.yml` a mano con los secretos de firma, o la etiqueta `android-v1.2.5`).

### Volver atrás

- **A Vercel** (cuando desbloquee el equipo): https://reminiscencia.vercel.app sigue desplegándose desde `main` con su `vercel.json`; su API y su audio van al Worker del dominio propio (CORS admitido). Si el dominio propio fallara, devolver `WORKER_API_BASE`, `kWorkerApiBase`, `kLibraryBase`, `kEmbedOrigin` y la redirección y la CSP de `vercel.json` a las direcciones anteriores (`workers.dev` y `vercel.app`).
- **Quitar la web del Worker:** borrar `[assets]` y `routes` de `wrangler.toml` y desplegar; el Worker vuelve a ser solo el API en `workers.dev`.

## Cómo se prueba

- `tests/web-unit/worker.test.mjs` («web en Cloudflare (ADR-0034)», 6 pruebas): el dominio propio es un origen admitido y `vercel.app` sigue; lo que no es `/api/*` ni `/audio/*` va a `ASSETS` sin CORS ni rutas del API, y `/api/*` y `/audio/*` siguen siendo del Worker; `/api/youtube/*` se reenvía a un Vercel simulado (nunca el real) con método, ruta, consulta, cuerpo y solo las cabeceras útiles, sin seguir redirecciones; la respuesta vuelve en flujo con su estado y sus cabeceras (también 429); Vercel caído → 502; otro origen → 403 sin reenviar; `/api/subir` sigue en el Worker.
- `tests/web-unit/cabeceras.test.mjs`: `_headers` tiene una sola regla `/*` con la misma CSP que `vercel.json`; `WORKER_API_BASE` es el dominio propio; `wrangler.toml` tiene `[assets]` con el directorio, el *binding*, `run_worker_first`, el dominio propio y `workers_dev = true`; `.assetsignore` deja fuera las funciones y la configuración de Node, y nada de la web.
- `mobile/test/api_config_test.dart`: las constantes de la APK apuntan al dominio propio y no queda ninguna dirección de `vercel.app` ni de `workers.dev` en `lib/`; `test/flutter_test_config.dart` manda los nombres de producción a un proxy inexistente (`cometia.es`, `vercel.app`, `workers.dev`, `r2.dev` y `github.com`).
- E2E: Chrome de las pruebas tampoco resuelve `*.cometia.es`, `*.vercel.app` ni `api.github.com` (además de `*.r2.dev` y `*.workers.dev`; `helpers/navegador.mjs`), y `worker.e2e.mjs` lo comprueba.

## Qué no se ha verificado en vivo

- Nada se ha desplegado. Solo `wrangler deploy --dry-run` con la versión fijada 4.151.3 (acepta `[assets]`, `run_worker_first` con lista de rutas, `routes` con `custom_domain`, `.assetsignore` y `_headers`).
- Que la zona `cometia.es` esté en la misma cuenta que el Worker.
- Que Workers Builds se dispare con los push que hacen los workflows con `GITHUB_TOKEN` (los eventos de push sí llegan a las apps de GitHub; lo que no hacen es lanzar otros workflows).
- Que `_headers` se aplique tal cual en producción y que el reenvío de la descarga de YouTube funcione con Vercel de vuelta.
