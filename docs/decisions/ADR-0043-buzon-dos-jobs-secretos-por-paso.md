# ADR-0043: Publicación del buzón en dos jobs, con los secretos puestos por paso

- Estado: aceptada (2026-11-10). Estructura y guardas de seguridad probadas en backend (`backend/tests/test_buzon_workflow.py`, 30 pruebas; suite completa 1430 verde). El tiempo de extremo a extremo se confirma en la siguiente subida real (lo ve el usuario).
- Fecha: 2026-11-10.
- Relacionadas: continúa [ADR-0042](ADR-0042-publicacion-rapida-sin-ffmpeg-para-opus.md) (que ya quitó el cuello de botella de ffmpeg) y [ADR-0030](ADR-0030-subida-rapida.md); afina el aislamiento de [ADR-0024](ADR-0024-audio-privado-en-r2.md) (de «por runner» a «por paso» para los secretos de solo lectura); mantiene [ADR-0010](ADR-0010-procesado-y-publicacion-separados.md) y [ADR-0025](ADR-0025-publicar-reintenta-si-main-avanza.md).

## Contexto

Tras ADR-0042 la publicación de una subida de la web/APK bajó de ~8 min a ~1 min (se eliminó la instalación de ffmpeg, que era el 97 % del tiempo). Lo que queda son, sobre todo, los **arranques de los cuatro runners aislados** del buzón (`autorizar`, `recoger`, `procesar`, `publicar`) y el **traspaso de artefactos** entre ellos.

El usuario autorizó expresamente tocar seguridad para ganar velocidad, siempre «asegurando que todo está bien y sin fallos». La clave para hacerlo sin perder lo importante: en GitHub Actions los secretos se declaran **por paso** (`env:` de cada `step`), no solo por job. El aislamiento que buscaba ADR-0024 —que el código que procesa subidas ajenas (`scripts/buzon.py`) no tenga en su entorno ni el token ni las credenciales— se conserva con secretos por paso **aunque los pasos compartan runner**: las variables de entorno de un paso no llegan al siguiente.

## Decisión

1. **Fusionar `autorizar` + `recoger` + `procesar` en un solo job `preparar`.** Los secretos van por paso:
   - El **token de lectura** (`github.token`) solo en los pasos de comprobar el permiso y de mirar si queda algo pendiente (ambos usan `gh api`).
   - Las **claves de R2** (solo lectura del bucket privado) solo en el paso de recoger.
   - El paso que ejecuta **`scripts/buzon.py`** (código sobre subidas ajenas) y el de empaquetar **no tienen ningún secreto en su entorno**.
2. **`publicar` no cambia:** otro runner, con el **token de ESCRITURA aislado** (solo en el paso que sube a `main`), solo código de confianza y el rebase con reintento de ADR-0025. Depende de `preparar` (`needs: preparar`, `if: needs.preparar.outputs.publicar == 'true'`).
3. **Se elimina el artefacto intermedio `buzon-entrada`:** recoger y procesar comparten ya el disco del runner, así que las subidas pasan por `$RUNNER_TEMP/entrada` sin salir a un artefacto. El paquete (`buzon-paquete`, sin nada privado) sigue cruzando a `publicar`.
4. **Un «plan de publicación»** en `preparar` junta lo pendiente en el buzón de `main` y lo recogido de R2 (`cantidad`): si no hay nada, no se procesa ni se instala ffmpeg y `publicar` no se lanza (`publicar=false`).

## Consecuencias

- **Menos arranques de runner (4 → 2)** y un traspaso de artefacto menos: la publicación es más rápida. No afirmo un número sin medir (lección de ADR-0042); el ahorro (unos 20-30 s sobre el ~1 min actual) se confirma en la siguiente subida real.
- **Seguridad.** El token con el que se puede **escribir** en el repositorio (el único cuya fuga equivaldría a tomar el repositorio) **sigue en otro runner** y nunca llega a `buzon.py`. La única diferencia con ADR-0024: las **claves de R2 de solo lectura** y el **token de solo lectura** viven ahora en el mismo runner que `buzon.py`, pero en pasos distintos, así que no están en el entorno del paso que ejecuta `buzon.py`. Es una reducción pequeña de la defensa en profundidad (de aislamiento por runner a aislamiento por paso, solo para secretos de solo lectura), aceptada a cambio de velocidad. Si `buzon.py` fuera explotado, lo que obtendría —en el peor caso teórico de leer el entorno de un paso anterior, que GitHub no deja de forma trivial— es lectura del bucket privado de audio, no escritura en el repositorio.
- **Pruebas.** `backend/tests/test_buzon_workflow.py` reescrito para la estructura de dos jobs, con una invariante nueva y explícita: `test_the_untrusted_processing_step_has_no_secret_in_its_environment`. Siguen comprobados el token solo en el paso de push, el checkout sin credenciales, el rebase con reintento, las rutas protegidas iguales a `sonidos.paquete.ruta_de_publicacion`, el ffmpeg estático fijado por SHA256 y el sparse-checkout. Suite backend verde (1430).
- **`biblioteca.yml` no cambia** (sigue con `autorizar`/`procesar`/`publicar` por incidencias): el audio que importa viene de fuentes con licencia, no de subidas anónimas, y su `procesar` sí necesita ffmpeg siempre.
- **Verificación de extremo a extremo:** como las ejecuciones de GitHub Actions no se pueden correr desde el entorno de desarrollo, el funcionamiento real (y el tiempo) se confirman en la siguiente subida de verdad, observando el run.
