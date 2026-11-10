# ADR-0037: Segunda dirección de la web en Netlify, mientras Vercel está bloqueado

- Estado: aceptada (2026-11-10), rama `feature/web-en-netlify`. La vista previa de la rama se compiló bien en Netlify; la comprobación en producción se hace al fusionar en `main`.
- Fecha: 2026-11-10.
- Relacionadas: [ADR-0034](ADR-0034-web-en-cloudflare.md) (la web y el API en el Worker de Cloudflare), [ADR-0031](ADR-0031-audio-por-el-worker.md) (audio por el Worker) y [ADR-0029](ADR-0029-worker-cloudflare-y-portadas.md) (el Worker y su CORS).

## Contexto

- Vercel tiene bloqueado el equipo Hobby hasta el 2026-12-07 (ADR-0034). Desde ADR-0034, la web, el API, el audio, los datos y las portadas ya los sirve el Worker de Cloudflare en https://reminiscencia.cometia.es. Lo único que sigue en Vercel son las funciones de YouTube (`api/youtube/*`).
- El propietario conectó el repositorio a un sitio de Netlify. Ese sitio:
  - publicaba la raíz del repositorio entera, no `frontend/web`;
  - pedía iniciar sesión en Netlify a cualquier visitante (401);
  - desplegaba con cada push a `main`.
- Plan gratuito de Netlify ([créditos](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/), consultado el 2026-11-10):
  - 300 créditos al mes, con tope fijo;
  - 15 créditos por despliegue de producción correcto;
  - 20 créditos por GB servido;
  - 2 créditos por cada 10 000 peticiones;
  - las vistas previas, los despliegues de ramas y los despliegues fallidos no gastan.
  - Si se acaban, **Netlify pausa todos los sitios de la cuenta**.
- En `main` entran decenas de commits al mes, muchos del buzón (`data/` y `covers/`). Desplegar cada uno agotaría los créditos en pocos días.

## Decisión

Netlify es una **segunda dirección de la web**, https://reminiscencia.netlify.app, con el mismo modelo que la web de Vercel: Netlify sirve los ficheros de la web y todo lo demás va al Worker. No hay funciones de Netlify ni variables de entorno en Netlify.

- **`netlify.toml`** (en la raíz del repositorio; la configuración de Netlify va en el repositorio, no en el panel):
  - **Qué publica:** `frontend/web` copiado a `netlify-dist/` con `rsync` y la misma lista de exclusiones que Cloudflare (`frontend/web/.assetsignore`: funciones de Vercel, `server/`, `package.json`, `vercel.json`…). Tampoco van `data/` ni `covers/`.
  - **Datos y portadas** (`/data/*`, `/covers/*`): Netlify los pide al Worker y los sirve en su propio origen (estado 200, `force`). Siempre están al día sin desplegar en Netlify.
  - **Audio** (`/audio/*`): redirección temporal (307) al Worker, como `vercel.json`. No pasa por Netlify ni gasta su ancho de banda.
  - **YouTube** (`/api/youtube/*`): se reenvía al Worker (200), que a su vez lo reenvía a Vercel. Funcionará también aquí cuando vuelva Vercel.
  - **El resto del API** (`/api/subir`, `/api/editar`, `/api/portadas`, `/api/salud`…): la web ya lo llama directamente en el Worker (`WORKER_API_BASE`, con CORS), igual que desde Vercel.
  - **Cuándo despliega** (`ignore`): solo si el commit cambia el código de la web (`frontend/web`, sin `data/`, `covers/`, `api/`, `server/` ni `vercel.json`) o `netlify.toml`. En el primer despliegue de una rama, o si git no puede comparar, despliega.
- **Cabeceras:** las de `frontend/web/_headers`, que Netlify lee igual que Cloudflare (la misma CSP; una sola copia). En Netlify, los datos y las portadas son del propio origen y el API está en `connect-src`, así que la CSP no cambia.
- **Rutas:** la web usa rutas con `#` (`location.hash`), así que un enlace directo siempre abre `index.html`. No hace falta una regla de SPA.
- **CORS del Worker:** `ALLOWED_ORIGINS = "https://reminiscencia.netlify.app"` en `worker/wrangler.toml`. Es la variable que ya existía para orígenes extra; no hace falta cambiar código. No admite las vistas previas de ramas.
- **Panel de Netlify** (sitio `reminiscencia`, cuenta `seryi-ros`, cambiado por la API el 2026-11-10):
  - nombre `reminiscencia` (antes `imaginative-mandazi-351ae7`);
  - inicio de sesión de Netlify solo para lo que no es producción (`sso_login_context = non_production`); la producción es pública;
  - despliegues de rama permitidos para `main` y `feature/web-en-netlify`.
- **Vercel no se toca:** `vercel.json`, `api/`, `server/` y `package.json` siguen como estaban.

## Consecuencias

- **No es independiente de Cloudflare:** datos, portadas, audio y API vienen del Worker. Sirve de segunda puerta de entrada si falla la de Cloudflare, no de copia completa.
- **YouTube** («En YouTube» y Homeostasia) sigue sin funcionar en ninguna dirección hasta que vuelva Vercel. No se ha portado a Netlify: sus funciones dependen de `yt-dlp` y de convertir audio, y no se reconstruyen en otra plataforma.
- **Créditos:** cada cambio de la web que llega a `main` gasta 15 créditos, lo que da para unos 20 al mes. Lo servido por Netlify (shell, datos y portadas, unos cientos de KB por visita) gasta 20 créditos por GB. El panel de Netlify (Usage) muestra el consumo.
- **Pruebas:** `tests/web-unit/netlify.test.mjs` comprueba:
  - qué se publica;
  - la regla `ignore`;
  - que las reglas van a `WORKER_API_BASE` con el estado correcto;
  - que el audio nunca pasa por Netlify;
  - que el Worker admite el origen de Netlify y no otros.
- **Comprobar producción:** `node scripts/smoke_produccion.mjs https://reminiscencia.netlify.app`.

### Volver a Vercel (o dejar Netlify)

- **Vercel vuelve solo** el 2026-12-07 (o antes, con el plan Pro): su configuración no ha cambiado y sigue conectado a `main`. Con él vuelve YouTube en las tres direcciones, porque el Worker y Netlify lo reenvían allí.
- **Para retirar Netlify:**
  1. borrar `netlify.toml` y `tests/web-unit/netlify.test.mjs`;
  2. dejar `ALLOWED_ORIGINS = ""` en `worker/wrangler.toml`;
  3. quitar las líneas de `netlify-dist/` y `.netlify/` de `.gitignore`;
  4. en el panel de Netlify, desconectar el repositorio o borrar el sitio.
