# ADR-0033: Descargas y subidas en el móvil

- Estado: aceptada (rama `feature/descargas-movil`, 2026-11-07; pendiente de fusionar en main). Probada con pruebas automáticas (web en Chrome sin cabeza a 320, 360, 390 y 820 px; APK con pruebas de widgets a 360 × 740 y 320 × 640). **Sin probar en un teléfono real.**
- Fecha: 2026-11-07.
- Relacionadas: ADR-0012 y ADR-0013 (audio local), ADR-0015 (aspecto de Spotify), ADR-0017 (subida para todos), ADR-0020 y ADR-0031 (audio por R2 y por el Worker), ADR-0030 (subida rápida).

## Contexto

En el teléfono (la web en el navegador y la APK), descargar para escuchar sin conexión y subir canciones era lento y tedioso, y la pantalla «quedaba algo bugueada». Reproducido con capturas a 360 × 740, 390 × 844 y 820 × 1180 (web) y con pruebas de widgets a 360 × 740 y 320 × 640 con el texto al 100 % y al 130 % (APK). Fallos encontrados:

1. **Web, barra de acciones de un álbum a 360 px:** seis botones (Me gusta, descargar, «Seleccionar» con texto, «···», aleatorio y reproducir) con 16 px entre ellos no caben en 328 px. «Seleccionar» encogía hasta un círculo con el texto por fuera, encima de «···» y del icono de descarga, y el botón verde se salía 12 px por la derecha. Causa: `flex` sin encoger ni ajustar los huecos y dos `margin-left: auto` (el de «Seleccionar» y el de aleatorio).
2. **Web, descarga sin progreso:** al pulsar «Descargar», el icono no cambiaba; solo un aviso de tres líneas («Descargando para escuchar sin conexión…») tapaba la tabla. No había «n de N», ni bytes, ni forma de cancelar: el botón quedaba con `aria-disabled` y **no respondía** hasta terminar.
3. **Web, descarga lenta:** `saveLibraryOffline` bajaba las canciones **de una en una** (`cache.add` en serie). Con 600 ms de latencia por canción, 8 canciones tardaban 5,4 s.
4. **Web, la descarga no sobrevivía a recargar:** lo que quedaba a medias se perdía; al volver a pulsar se empezaba de cero (aunque saltaba lo ya guardado).
5. **Web, «19 min 16 s» partido:** a 360 px la «s» quedaba sola en la línea siguiente de los metadatos.
6. **Web, hoja «Subir canciones»:** «Subiendo… 0 %» con la barra vacía durante todo el envío de un archivo de un solo trozo (lo normal: el Worker admite trozos de 32 MB), y un archivo ya convertido que espera hueco también decía «Subiendo… 0 %»: parecía colgado. «En cola» mostraba una barra vacía. Con error, «Reintentar» ocupaba una columna a la derecha y el nombre y el error quedaban en una columna estrecha (seis líneas a 360 px). Al elegir archivos, las filas nuevas quedaban debajo del texto de la hoja, fuera de la vista.
7. **Web, al cerrar la hoja en el teléfono no se veía el progreso:** el indicador «Publicándose N canciones» está en la barra lateral, que en el teléfono no existe.
8. **Web, subidas que frenaban el teléfono:** la conversión avisa cada segundo de audio y cada aviso repintaba **todas** las filas de la hoja (cientos de veces por canción, por cada fila).
9. **APK, Inicio mientras guarda sin conexión:** el botón de descarga se cambiaba por el texto «3 de 120» con márgenes, más ancho que el icono: el saludo pasaba a dos líneas y toda la página bajaba (y se movía otra vez al crecer el número). Sin bytes ni forma de cancelar.
10. **APK, descarga lenta:** `LibraryStore.downloadAll` bajaba de una en una y comprobaba canción a canción si ya estaba guardada.
11. **APK, repintados excesivos:** cada avance de una subida (cada trozo, cada cambio de paso) rehacía la lista de canciones de la biblioteca y repintaba Inicio y Tu biblioteca enteros; cada canción descargada, también Inicio entero.
12. **APK, botones que no respondían:** con una subida en marcha, «Subir canciones» y «Reintentar» estaban desactivados y lo elegido mientras tanto (también desde YouTube) se descartaba sin aviso (`start` volvía vacío si estaba ocupado). Un reenvío que fallaba con una excepción dejaba la fila en «Subiendo…» para siempre.
13. **APK, resumen del panel de subidas:** «0 de 10 publicadas» y «Quitar publicadas» iban en una `Row`; con la letra de pruebas a 320 dp y texto al 130 % se salía 35 px por la derecha y, con Figtree, el resumen quedaba apretado en dos líneas.
14. **APK y web, lectores de pantalla:** en la APK, cada fila de subida era una región viva cuyo texto cambiaba con cada porcentaje.

## Decisión

### Descargas para escuchar sin conexión

1. **Un gestor que vive en la app, no en la pantalla.** Web: `js/offline-downloads.js` (lógica pura, con la descarga y la caché inyectadas; `js/pwa.js` aporta `downloadAudioToCache`). APK: `lib/offline_downloads.dart` (`runLimited`, `OfflineProgress`, `OfflineCancel`) usado por `LibraryStore.downloadAll` y `LibraryController`.
2. **Cuatro canciones a la vez** (`OFFLINE_CONCURRENCY` en la web, `kOfflineConcurrency` en la APK), con un límite común a todas las descargas. El audio lo sirve el Worker sin el límite de r2.dev (ADR-0031); el contrato del audio no cambia.
3. **Lo guardado no se vuelve a bajar** (se lee la caché o la carpeta una vez) y en la web una canción que piden dos descargas a la vez (un álbum y «Todas las canciones») se baja una sola vez.
4. **Cada canción entera o nada.** Web: se lee la respuesta completa contando bytes y solo entonces se guarda en `reminiscencia-audio-v1`. APK: se escribe en un `.part` propio de cada descarga y se renombra al terminar; al cancelar o fallar, se borra.
5. **Progreso real y estable:** «n de N» de toda la colección (lo guardado cuenta como hecho, así que nunca retrocede) y los bytes recibidos («Descargando 3 de 8 · 2,4 MB» en la web; «Guardando 3 de 120 · 2,5 MB» en la APK). Los bytes de un intento fallido se descuentan. Los avisos de bytes se juntan (150 ms) y los de canción se dan al momento.
6. **Cancelable:** en la web, el botón de descarga se convierte en un anillo verde con una cruz («Cancelar la descarga (3 de 8)»); en la APK, igual en Inicio y en Ajustes. Lo guardado se queda. En la APK, cancelar también apaga «guardar lo nuevo al sincronizar».
7. **Sigue al cambiar de pantalla y tras recargar:** en la web, las descargas en marcha se guardan en `localStorage` (`reminiscencia.descargas`) y se retoman al abrir la página (o al volver la conexión), sin bajar otra vez lo guardado. En la APK ya se retomaba en la siguiente sincronización con «escuchar sin conexión» activado; ahora además va en paralelo y sin repetir.
8. **Sin mover la página:** en la web, la línea de progreso va en el hueco inferior de la barra de acciones (posición absoluta); los botones se ponen al día en su sitio, sin volver a pintar la página en cada canción (el foco no se mueve). En la APK, el anillo mide lo mismo que el botón (48 × 48) y la línea «Guardando…» va bajo el saludo; solo esos dos widgets escuchan `offlineProgress`.
9. **Barra de acciones del teléfono (web):** «Seleccionar» queda en su icono (44 px; el nombre sigue en `aria-label` y en «···»), 8 px entre botones por debajo de 400 px y, por debajo de 360 px, «Seleccionar» solo en «···».

### Subidas

10. **Estados que no parecen parados:** «Esperando para subir» (sin barra) para lo convertido que espera hueco; «Subiendo…» con la barra en movimiento hasta el primer trozo confirmado y «Subiendo… 45 %» después; sin barra (pero con su hueco) en cola, con error o pendiente de aparecer. Igual en la web (`statusText`, `progressOf`) y en la APK (`statusText`, `progress`, `showsBar`). El contrato de `/api/subir` no cambia.
11. **Repintar solo lo que cambia:** en la web, el gestor no avisa si un avance no cambia el porcentaje visible y cada fila solo toca el DOM si cambia lo que muestra. En la APK, el panel de subidas escucha al rastreador directamente y la biblioteca solo se rehace cuando cambian las canciones provisionales o su etiqueta (no con cada trozo).
12. **Elegir más y reintentar mientras otras se suben (APK, como la web):** cada tanda y cada reintento entran en una cola y se hacen de una en una y en orden (el destino, Worker o Vercel, se fija al empezar cada tanda y nunca cambia a mitad de un archivo). Se ven «En espera» al momento. Si se sale de la app mientras una tanda espera su turno, no empieza (la conversión no sigue en segundo plano) y queda con «Reintentar», como lo que se estaba subiendo.
13. **Filas que usan todo el ancho en el teléfono:** en la web, hasta 600 px «Reintentar» y «Reproducir» van debajo del texto; en la APK, el resumen y «Quitar publicadas» van en un `Wrap`.
14. **El progreso se ve en el teléfono con la hoja cerrada (web):** «Tu biblioteca» del teléfono muestra «Publicándose N canciones» (`library-page-uploads`) bajo la cabecera, y abre la hoja.
15. **Al elegir archivos, la primera fila nueva se trae a la vista.** La hoja respeta la barra de gestos (`env(safe-area-inset-bottom)`).
16. **Lectores de pantalla:** en la APK, la región viva de cada fila anuncia el paso, no cada porcentaje (como la web).

`SHELL_VERSION` pasa de 31 a 32 y `js/offline-downloads.js` entra en `SHELL_ASSETS`.

## Consecuencias

- Medido con el servidor de pruebas y 600 ms de latencia por canción (Chrome sin cabeza): un álbum de 8 canciones pasa de 5,4 s a 1,8 s, y las 12 restantes de «Todas las canciones», de 7,3 s a 1,9 s. Con latencia alta (lo habitual en el móvil) la mejora se acerca a ×4; si lo que limita es el ancho de banda, es menor.
- En la web, cada descarga en marcha retiene en memoria hasta cuatro canciones mientras se bajan (unos pocos MB cada una).
- La web hace como mucho cuatro peticiones de audio a la vez por pestaña (antes, una). El Worker no tiene límite de peticiones y responde desde su caché.
- En la APK, cancelar apaga la descarga automática al sincronizar; para volver a activarla basta con pulsar «Guardar para escuchar sin conexión».
- La APK sigue sin descarga por álbum o lista (solo toda la biblioteca, en Inicio y Ajustes); la web la tiene por colección. Queda como pendiente si se quiere igualar.
- Pruebas: `tests/web-unit/offline-downloads.test.mjs` (concurrencia, salto de lo guardado, deduplicación, progreso, cancelar, reintentos, retomar), `tests/web-unit/offline-core.test.mjs` (`downloadAudioToCache`), `tests/web-unit/subida-estado.test.mjs` (estados nuevos), `tests/web-e2e/movil.e2e.mjs` (anchos de teléfono, sin desbordamiento, nada tapado por las barras, progreso sin saltos, cancelar, recargar, hoja de subidas) y tres pantallas nuevas en `tests/web-e2e/a11y.e2e.mjs`; en la APK, `test/offline_downloads_test.dart`, `test/descargas_subidas_movil_test.dart` (360 × 740 y 320 × 640, texto al 100 % y al 130 %; con `CAPTURAS_DIR=<carpeta>` guarda capturas) y la cola de tandas en `test/upload_tracker_test.dart`.

## Pendiente

- Probar en un teléfono real (Android con la APK y Chrome/Safari con la web), con red móvil lenta y con la pantalla apagada a mitad de una descarga.
- Descarga por álbum o lista en la APK.
- Progreso real dentro de un trozo al subir (hoy, por trozos; un archivo de un solo trozo se ve «Subiendo…» con la barra en movimiento).
