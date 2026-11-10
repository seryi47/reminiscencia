# ADR-0038: YouTube en Netlify ahora y en Vercel al volver, con failover automático

- Estado: aceptada (2026-11-10). Pendiente de comprobar en producción tras el despliegue (ver «Comprobar en producción»).
- Fecha: 2026-11-10.
- Relacionadas: [ADR-0037](ADR-0037-web-en-netlify.md) (segunda dirección en Netlify), [ADR-0034](ADR-0034-web-en-cloudflare.md) (web y API en el Worker; el Worker reenviaba `/api/youtube/*` a Vercel), [ADR-0021](ADR-0021-buscar-en-youtube.md) (buscar en YouTube) y [ADR-0031](ADR-0031-audio-por-el-worker.md) (no servir audio por funciones).

## Contexto

- Vercel tiene bloqueado el equipo Hobby hasta el 2026-12-07 (Fast Origin Transfer). Desde ADR-0034 todo está en el Worker de Cloudflare **salvo las funciones de YouTube** (`/api/youtube/*`), que el Worker reenviaba a Vercel. Con Vercel pausado, el **visor de YouTube** («En YouTube» del buscador y «Homeostasia») está caído en todas las direcciones.
- ADR-0037 trajo una segunda dirección en Netlify, pero solo con el shell: YouTube seguía reenviándose al Worker y de ahí a Vercel. No resolvía el visor.
- Las cinco funciones de YouTube no son iguales:
  - `search` y `playlist` usan `yt-dlp` (`node:child_process`) con respaldos por HTTP (HTML, oEmbed, YouTube Music). **No** se pueden ejecutar en el Worker (Cloudflare no tiene `child_process`).
  - `convert`, `status` y `download` son **proxies `fetch` puros** al conversor externo (`api.yttowav.org`), sin binarios. `download` transmite el WAV, que puede ser grande.
- El núcleo ya es portable: cada función es un handler Web estándar (`Request→Response`) en `frontend/web/server/youtube-*.js`, con `spawn`/`env`/`fetch` inyectables. Vercel las usa con wrappers finos en `frontend/web/api/youtube/*.js`.
- El plan gratuito de Netlify limita las funciones síncronas a ~10 s: transmitir un WAV largo por una función de Netlify fallaría.

## Decisión

Repartir las funciones por **capacidad** y dar al Worker un **reenvío con failover** para que use Netlify ahora y Vercel en cuanto vuelva, sin ningún cambio manual.

1. **El Worker ejecuta `convert`, `status` y `download`** (proxies `fetch` puros) él mismo, importando `handleConvert`/`handleStatus`/`handleDownload` de `frontend/web/server/`. Así dejan de depender de Vercel/Netlify **para siempre**, no gastan Fast Origin Transfer (ataca la causa del bloqueo, ADR-0031) y la descarga del WAV no choca con el límite de 10 s de Netlify.
2. **Netlify ejecuta `search` y `playlist`** como funciones propias (`netlify/functions/youtube-search.mjs` y `youtube-playlist.mjs`), adaptadores finos del mismo núcleo, con la ruta fijada por `config.path`. `youtube-dl-exec` va como **módulo externo** y no se incluye el binario de `yt-dlp`: la ruta HTML/oEmbed/YouTube Music cubre el caso normal; el respaldo `yt-dlp` puede no estar en Netlify (degradación aceptada mientras dura el puente). Con Vercel de vuelta, respaldo completo.
3. **El Worker reenvía `search` y `playlist`** a una lista de upstreams en orden (`YOUTUBE_UPSTREAMS` de `wrangler.toml`, por defecto `[Vercel, Netlify]`) y usa **el primero que responda con la cabecera-marca** `X-Reminiscencia-Youtube` (`frontend/web/server/youtube-mark.js`, que ponen tanto los wrappers de Vercel como las funciones de Netlify). Una respuesta sin la marca (Vercel pausado = 402; Netlify caído = página de error) o que no responde significa «plataforma caída»: el Worker la recuerda unos 5 minutos (memoria por isolate, caduca sola) y prueba la siguiente. Como Vercel va primero, **cuando se desbloquee el 2026-12-07 vuelve a usarse solo**; mientras tanto, el visor funciona por Netlify.
4. **`netlify.toml`:** `search`/`playlist` las sirven las funciones (no se redirigen: redirigirlas al Worker, que las reenvía a Netlify, haría un bucle); `convert`/`status`/`download` se redirigen al Worker (200); se añade el bloque `[functions]` (esbuild, `youtube-dl-exec` externo); la regla `ignore` despliega también si cambian `netlify/functions` o su núcleo `frontend/web/server`.

## Consecuencias

- **El visor de YouTube vuelve a funcionar** con Vercel pausado: búsqueda y metadatos por Netlify; conversión y descarga por el Worker.
- **Menos dependencia de Vercel y menos riesgo de bloqueo:** 3 de las 5 rutas (incluida la descarga de audio) dejan de pasar por plataformas de funciones.
- **Vuelta automática a Vercel** el 2026-12-07, sin tocar nada, por el orden de `YOUTUBE_UPSTREAMS` y el failover por cabecera-marca.
- **Degradación conocida:** en Netlify, el respaldo `yt-dlp` de `search`/`playlist` puede no estar (sin binario). Si algún día hace falta, se incluye el binario de Linux x64 y se fija `YTDLP_PATH`.
- **Créditos de Netlify:** ahora hay funciones. El despliegue sigue limitado por la regla `ignore` (solo con cambios de web, funciones o su núcleo). Las invocaciones de funciones gastan según el plan; el visor es de uso puntual.
- **Pruebas:** `tests/web-unit/worker.test.mjs` (ejecución nativa de convert/status/download; reenvío de search/playlist con Vercel primero; failover a Netlify sin la marca; memoria de caídos; 502 si todos caen; 403 de otro origen sin reenviar) y `tests/web-unit/netlify.test.mjs` (bloque `[functions]`, redirecciones de los tres proxies, ausencia del comodín que haría bucle, `YOUTUBE_UPSTREAMS`, y que las funciones declaran su ruta y la cabecera-marca). Suite web verde.

## Pitfalls (trampas)

- **Bucle de reenvío:** no redirigir `/api/youtube/search` ni `/playlist` al Worker en `netlify.toml`. El Worker reenvía a Netlify; si Netlify los devuelve al Worker, es un bucle. Solo `convert`/`status`/`download` se redirigen.
- **Detección de «plataforma caída»:** por la ausencia de la cabecera-marca, no por el código de estado. Una función real puede devolver 502 (p. ej. «YouTube devolvió demasiados datos») y debe tratarse como respuesta válida, no como caída.
- **La memoria de salud es por isolate** y persiste entre peticiones (y entre pruebas en el mismo proceso): en las pruebas se reinicia con `resetYoutubeUpstreamHealth()` en `beforeEach`.
- **Cloudflare no tiene `child_process`:** por eso `search`/`playlist` no se ejecutan en el Worker, solo se reenvían.
- **Regla `ignore` de Netlify:** al mover el núcleo de las funciones a `frontend/web/server`, ya no se excluye esa carpeta; si se volviera a excluir, un arreglo de las funciones no se desplegaría.

## Comprobar en producción (pendiente)

- `node scripts/smoke_produccion.mjs https://reminiscencia.netlify.app` y la del Worker.
- Búsqueda real en «En YouTube» desde https://reminiscencia.netlify.app (Netlify) y desde https://reminiscencia.cometia.es (Worker → Netlify).
- Una conversión+descarga desde «Homeostasia» (convert/status/download por el Worker).
- Tras el 2026-12-07: comprobar que `search`/`playlist` vuelven a servirse desde Vercel sin tocar nada.
