# Buzón de canciones

Carpeta de paso para subir canciones a la biblioteca (ADR-0014). Solo pueden subir las cuentas con permiso de escritura en el repositorio.

1. Abre https://github.com/seryi47/reminiscencia/upload/main/audio-library/buzon y arrastra los archivos: WAV, MP3, M4A, FLAC u OGG.
2. En la descripción del commit, escribe una línea con la licencia, por ejemplo `Licencia: CC BY 4.0`. Sin esa línea, las canciones entran como privadas.
3. Elige «Commit directly to the main branch» y confirma.

El workflow `buzon` convierte cada archivo a Opus, lo añade al catálogo con el nombre del archivo como título y lo borra de aquí. Lo que se sube queda en el historial de git aunque se borre del buzón.

Desde el navegador, GitHub admite hasta 25 MiB por archivo: usa MP3 o FLAC antes que WAV. Quien sube responde de la licencia que declara.
