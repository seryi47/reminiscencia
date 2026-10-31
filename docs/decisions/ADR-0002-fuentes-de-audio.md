# ADR-0002: Fuentes de audio y barrera legal

- Estado: aceptada (ampliada por ADR-0005: entrada por URL sólo con licencia verificable)
- Fecha: 2026-10-31

## Contexto

El planteamiento inicial pedía extraer audio de enlaces de YouTube y otras plataformas. Descargar vídeo o audio de esas plataformas con herramientas como yt-dlp suele vulnerar sus términos de uso. Además, guardar y distribuir grabaciones protegidas sin licencia puede infringir derechos de autor. Esto afecta de forma directa a la legalidad del proyecto, por lo que se trata como decisión de alto impacto.

## Decisión

1. **Sin adaptador de descarga de plataformas.** No se implementa ningún conector que descargue desde YouTube ni desde servicios de streaming.
2. **Importación sólo de archivos locales con licencia declarada.** `import` exige `--license`. Sin licencia, la canción no entra en la biblioteca (`LicenseRequiredError`, probado).
3. **Fuentes admitidas:**
   - Archivos que la familia posee legalmente (compras digitales, CD propios), bajo revisión jurídica.
   - Catálogos con licencia abierta (Creative Commons, dominio público), por ejemplo Jamendo, Free Music Archive, Internet Archive o Musopen. Cada obra se acepta según su licencia concreta.
   - Reproducción por streaming con SDKs oficiales, sin descarga.
4. **Abogado especialista** antes de usar música comercial de forma distinta a la reproducción privada.

## Consecuencias

- El primer conjunto de canciones será pequeño y de licencia abierta. Sirve para desarrollar y evaluar el reproductor.
- La cobertura de canciones populares depende de decisiones legales y de la fuente elegida, no del código.
- La legalidad del proyecto no depende de una interpretación técnica.

## Pendiente de decisión del usuario

- Qué fuente de música usará el piloto (ver ADR-0003 y PROJECT_MASTER.md).
- Encargar el dictamen legal sobre copia privada y uso de archivos familiares.
