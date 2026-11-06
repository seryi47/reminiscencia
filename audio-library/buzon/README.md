# Buzón de canciones

Carpeta de paso para subir canciones a la biblioteca (ADR-0014). Solo pueden subir las cuentas con permiso de escritura en el repositorio.

1. Abre https://github.com/seryi47/reminiscencia/upload/main/audio-library/buzon y arrastra los archivos: WAV, MP3, M4A, FLAC u OGG.
2. En la descripción del commit, escribe una línea con la licencia, por ejemplo `Licencia: CC BY 4.0`. Sin esa línea, las canciones entran como privadas.
3. Elige «Commit directly to the main branch» y confirma.

El workflow `buzon` convierte cada archivo a Opus, lo añade al catálogo con el nombre del archivo como título, limpio (sin «(Official Video)» ni el número de pista, y «Artista - Título» separado en artista y título; ADR-0032), y lo borra de aquí. Lo que se sube queda en el historial de git aunque se borre del buzón.

También se puede subir un `.zip` con canciones (WAV, MP3, M4A, FLAC, OGG u OPUS, también en subcarpetas). El workflow lo descomprime fuera del repositorio, procesa cada canción como un archivo del buzón, con la licencia del commit y como título el nombre de su archivo sin carpeta ni extensión (`Disco/Cara A/01 Vals.mp3` pasa a «Vals»: el número de pista se quita, ADR-0032), y borra el ZIP de aquí. Las carpetas, lo de `__MACOSX/`, los ocultos, los enlaces simbólicos y lo que no es audio se ignoran y se cuentan en el resumen de la ejecución. Un ZIP con contraseña o dañado se rechaza entero y se borra.

Desde el navegador, GitHub admite hasta 25 MiB por archivo (también por ZIP): usa MP3 o FLAC antes que WAV. Quien sube responde de la licencia que declara.

## Portadas

Las portadas de canciones y de carpetas (álbumes) van en `portadas/`: https://github.com/seryi47/reminiscencia/upload/main/audio-library/buzon/portadas (ADR-0016).

- Nombre: el id de la canción (`S` + 16 caracteres hexadecimales) o de la carpeta (`F` + 16) con extensión `.jpg`, `.jpeg`, `.png` o `.webp`, por ejemplo `S5aac103b6eb2ecf4.png`. Los ids están en `audio-library/indexes/catalog.json`.
- Hasta 10 MB. Sin línea de licencia.
- El workflow la convierte a JPEG de 640×640 (recorte centrado) en `audio-library/covers/<id>.jpg` y la borra de aquí. Si el id no existe o la imagen no es válida, se rechaza y se borra; el motivo sale en el resumen de la ejecución.
- Nada de fotografías de pacientes ni de otras personas: lo que se sube queda en el historial de git.
