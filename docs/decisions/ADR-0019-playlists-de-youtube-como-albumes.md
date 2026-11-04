# ADR-0019: Importar playlists de YouTube como álbumes

- Estado: aceptada.
- Fecha: 2026-11-03.
- Relacionadas: ADR-0016 (carpetas como álbumes), ADR-0017 (subida común por `/api/subir`) y ADR-0018 (seguimiento de trabajos de YouTube).

## Contexto

Homeostasia ya importa vídeos y playlists de YouTube en la web y la APK, pero la lectura de playlists dependía de `yt-dlp` y podía fallar aunque una playlist pública fuera accesible desde YouTube Music. Además, las canciones importadas se publicaban sin conservar el nombre de la playlist ni su relación de álbum.

La URL de una playlist debe producir una lista de canciones y su metadata `{id, title}`; cada canción debe conservar también el artista que YouTube Music muestra. Esa metadata tiene que sobrevivir la conversión y la subida por trozos, sin crear una segunda vía de publicación ni alterar las subidas normales.

## Decisión

1. `GET /api/youtube/playlist` usa `yt-dlp` como fuente principal de canciones, con máximo 200 elementos. Completa el artista desde la columna de artista de YouTube Music, asociando cada elemento por ID de vídeo incluso cuando `yt-dlp` ya devuelve la lista. Si no obtiene canciones o título, usa la página y el endpoint de navegación de YouTube Music, incluidas sus continuaciones; como último respaldo intenta extraer los datos públicos del HTML de YouTube. Las peticiones de metadata a YouTube usan un User-Agent de navegador: el User-Agent genérico del proxy recibía una página mínima sin la configuración necesaria para leer YouTube Music. Devuelve el nombre original y el ID de la playlist junto a las canciones. Si no puede obtener el nombre, falla explícitamente y no inicia la importación.
2. Web y Android mantienen la metadata de álbum y el artista de cada canción hasta la subida común. Envían `X-Album-Id`, `X-Album-Name` y `X-Artista-Cancion` con los trozos de `/api/subir`; la función valida los campos y los copia al manifiesto cuando termina la subida. La metadata es opcional, por lo que las subidas corrientes y los manifiestos antiguos conservan su contrato.
3. `sonidos.buzon` asigna el artista a la canción y crea o reutiliza una carpeta superior como álbum. El ID del álbum es `F` más los primeros 16 caracteres hexadecimales de SHA-256 de `youtube:<playlistId>`. Asigna el mismo `folder_id` a todas las canciones de esa playlist; conserva el nombre recibido y el ID de playlist solo como metadata interna. La publicación expone artista, nombre de carpeta y `folder_id` de las canciones mediante los datos públicos existentes, sin revelar el ID interno.
4. Los vídeos individuales no reciben álbum. La visibilidad y la licencia siguen las reglas ya existentes de `/api/subir` y el buzón; que una playlist sea pública no demuestra por sí solo que el audio tenga licencia. Solo se deben importar contenidos para los que quien sube tenga derechos.
5. Si una importación anterior llegó al catálogo sin metadatos completos, `organize_youtube_playlist` permite reparar en una única petición el álbum estable y los artistas de sus canciones existentes, sin volver a convertir ni subir el audio.

## Consecuencias

- Web y APK usan el mismo proxy, manifiesto, workflow y catálogo: el álbum se organiza igual en ambas.
- Una playlist ya publicada puede corregirse en lote desde el flujo de biblioteca, conservando el ID estable que se usa en futuras importaciones.
- Un fallo al obtener el nombre de la playlist es visible y no se sustituye por su ID; así no se publican álbumes con títulos incorrectos.
- El fallback de YouTube Music usa una API web no documentada y puede cambiar. Se limita la respuesta a 200 canciones y se prueban los datos y las continuaciones con respuestas simuladas.
- Las subidas manuales, los vídeos individuales y las canciones ya catalogadas no cambian.

## Validación

- Las pruebas unitarias comprueban `yt-dlp`, el enriquecimiento de artistas desde YouTube Music aunque `yt-dlp` tenga éxito, las alternativas de YouTube Music y HTML, las continuaciones, el manifiesto opcional, la creación/reutilización del álbum y la propagación en web y Android.
- La ejecución local de `handlePlaylist` sobre `PLVU-jIOit29A` devolvió HTTP 200, el título «Nuestro desacato» y los siete temas. En esta máquina `yt-dlp` no está instalado, por lo que la prueba ejercitó realmente el respaldo de YouTube Music. Esto no valida el despliegue ni la publicación de extremo a extremo; siguen pendientes la puesta en producción y la comprobación del álbum en el catálogo público.
