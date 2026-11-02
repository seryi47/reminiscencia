# Compresión y perfiles de reproducción

Estado: **experimento objetivo completado con cinco grabaciones de dominio público; prueba perceptual con oyentes pendiente.** Las cifras de este documento son métricas objetivas: tamaño, tasa efectiva, tiempos, SNR y LSD. No miden la calidad percibida y no sustituyen una prueba MUSHRA (ITU-R BS.1534-3), que este experimento no realiza.

Fecha de la medición: 2026-10-31. Código: `scripts/compression/`. Datos: `research-data/compression/` (`sources.json`, `results.csv`, `controls.csv`, `environment.json`).

## Perfiles disponibles

Definidos en `backend/sonidos/compression.py`. Esta rama no modifica el backend.

| Perfil | Códec | Contenedor | Tasa |
|---|---|---|---|
| opus-48k | Opus (libopus) | .opus | 48 kbps VBR |
| opus-64k | Opus (libopus) | .opus | 64 kbps VBR |
| aac-64k | AAC | .m4a | 64 kbps |
| aac-128k | AAC | .m4a | 128 kbps |
| mp3-128k | MP3 (libmp3lame) | .mp3 | 128 kbps |

Son puntos de partida para experimentar, no configuraciones definitivas. Ninguno aplica filtros destructivos: sólo se descarta el vídeo (`-vn`) y se selecciona la primera pista de audio. El experimento usa exactamente los mismos argumentos de codificación para estos perfiles (ver la tabla de codificaciones).

## Método

### Fuentes

Cinco grabaciones de Internet Archive de dominio público con licencia declarada en sus metadatos, de tipos distintos. Se usa la copia de mayor calidad disponible (FLAC si existe). Cada fuente se recorta a 60 s desde el segundo 30. Los audios no se versionan: se descargan fuera del repositorio y se comprueban por SHA-256 y MD5 (el MD5 es el publicado por Internet Archive).

| Tipo de fuente | Identificador de Internet Archive | Licencia declarada | Fichero usado (formato, origen) | Canales | Frecuencia | Bits | Duración del original |
|---|---|---|---|---|---|---|---|
| Orquesta clásica | `1922-symphony-6-all-mvts-tschaikowsky-col-l-1489-a-b-henry-wood-new-queen-orch` | Public Domain Mark 1.0 | FLAC derivado del WAV original | 1 (mono) | 44100 Hz | 16 | 1829,25 s |
| Voz solista | `georg-hann-bass-dgg-lpe-17108` | Public Domain Mark 1.0 | FLAC derivado (aria "Register-Arie" de Don Giovanni) | 2 | 44100 Hz | 16 | 342,21 s |
| Jazz instrumental | `DukeEllington19431127BuffaloNYFM` | Public Domain Mark 1.0 | FLAC derivado (emisión de radio FM, 27-11-1943) | 2 | 44100 Hz | 16 | 1353,12 s |
| Voz, grabación de 78 rpm | `maurice-elwin-collection-1925-1936-vocal-recordings` | Public Domain Mark 1.0 | FLAC original de 24 bits ("Honeybird", 1927) | 2 | 96000 Hz | 24 | 182,67 s |
| Voz hablada o cantada sencilla | `fiddlin-charlie-waer-interview-1963` | CC0 1.0 | FLAC derivado (entrevista y violín, 1963) | 2 | 44100 Hz | 16 | 3183,00 s |

Notas sobre cada fuente, tomadas de los metadatos del registro:

- **Orquesta.** Sinfonía n.º 6 de Tschaikowsky; intérpretes según el título del registro (Henry Wood New Queen Orch); grabación de 1922 en 78 rpm (COL L 1489-1492, 8 caras). Es una grabación acústica de su época: no representa a las orquestas grabadas con micrófono eléctrico ni a las grabaciones digitales.
- **Voz solista.** Bajo Georg Hann, aria "Register-Arie" de Don Giovanni. Reedición en LP DGG LPE 17108 (emitida en 1958); los metadatos dan 1943 como fecha de grabación.
- **Jazz.** Emisión de radio FM de la orquesta de Duke Ellington. Los títulos de la descripción son Blue Skies, Do Nothing Till You Hear From Me, A Slip Of The Lip, Sentimental Baby, I Wonder Why y Rockin' In Rhythm. No se ha verificado auditivamente que el fragmento de 60 s no contenga voz.
- **Voz 78 rpm.** Colección de The Popular Jazz Archive, marcada como colección 78rpm en Internet Archive. Canción "Honeybird" (1927), cantada por Maurice Elwin con el nombre John Curtis.
- **Voz hablada.** Entrevista y violín de "Fiddlin' Charlie" Waer, Archive of Folk Culture (Library of Congress, AFC 1969/013), grabada en Whittier (California) en julio de 1963 según la descripción del registro.

La licencia es la declarada en los metadatos de Internet Archive. No es un análisis jurídico: Creative Commons indica que la Public Domain Mark 1.0 identifica obras libres de restricciones conocidas, sin garantía, y que puede no cumplirse en todas las jurisdicciones.

### Referencia y recorte

Cada fuente se recorta con `ffmpeg -ss 30 -t 60` a un WAV sin pérdida con la misma frecuencia de muestreo, los mismos canales y la misma profundidad que el original (`pcm_s16le` o `pcm_s24le`). El experimento comprueba que la referencia tiene exactamente 60 s por la frecuencia de muestreo de la fuente.

### Codificaciones

| Configuración | Códec | Encoder de ffmpeg | Argumentos | Extensión |
|---|---|---|---|---|
| opus-24k-vbr, opus-32k-vbr, opus-48k-vbr, opus-64k-vbr, opus-96k-vbr | Opus | libopus | `-c:a libopus -b:a <tasa> -vbr on` | .opus |
| aac-48k, aac-64k, aac-96k, aac-128k | AAC | aac (nativo) | `-c:a aac -b:a <tasa>` | .m4a |
| mp3-64k, mp3-96k, mp3-128k | MP3 | libmp3lame | `-c:a libmp3lame -b:a <tasa>` | .mp3 |
| flac-lossless | FLAC | flac | `-c:a flac -compression_level 5` | .flac |

- Los argumentos de opus-48k-vbr, opus-64k-vbr, aac-64k, aac-128k y mp3-128k son los de los perfiles de `backend/sonidos/compression.py`.
- **Opus.** `-vbr on` es el modo VBR; la documentación de ffmpeg indica que es el valor por defecto de libopus, y se fija explícitamente. La tasa indicada es el objetivo: la tasa efectiva se mide en cada fichero.
- **AAC.** Encoder nativo de ffmpeg, con `-b:a` como tasa fija (CBR), según la documentación de ffmpeg.
- **MP3.** libmp3lame con `-b:a` sin `abr`, es decir, tasa fija (CBR).
- **FLAC.** Referencia sin pérdida: la salida decodificada debe ser idéntica a la referencia.
- **Vorbis no se ha ejecutado.** `ffmpeg -encoders` de esta instalación (ffmpeg 8.1.2) no lista libvorbis. El encoder nativo `vorbis` aparece marcado como experimental y no se ha usado.
- **Frecuencias de muestreo.** libopus solo admite 48, 24, 16, 12 y 8 kHz, y libmp3lame no admite 96 kHz (`ffmpeg -h encoder=...`). Por eso Opus se codifica a 48 kHz en todas las fuentes, y MP3 a 48 kHz en la fuente de 96 kHz. En el resto, la frecuencia de codificación es la de la fuente. La columna `encoded_sample_rate_hz` de `results.csv` registra la frecuencia real de cada fichero.

### Métricas

Todas se calculan sobre PCM float32 a la frecuencia nativa de la fuente (`scripts/compression/metrics.py`):

- **Alineación.** Desfase entero estimado por correlación cruzada (FFT) sobre la mezcla mono, en ±0,25 s. Se registran el desfase (`lag_samples`) y el coeficiente de correlación alineada (`alignment_corr`). En todas las filas el desfase está entre −1 y 0 muestras.
- **SNR (dB)** = 10 log10(Σx² / Σ(x−y)²), con todos los canales juntos y las señales alineadas.
- **LSD (dB).** Para cada canal y cada trama de 2048 muestras (ventana de Hann periódica, salto de 512), distancia = raíz de la media de (10 log10(P_ref + ε) − 10 log10(P_dec + ε))² sobre las bins de 0 a fs/2, con ε = 1e-10. Se promedian las tramas y después los canales.
- **Ganancia óptima** g, la que minimiza Σ(x − g·y)², expresada en dB (`best_gain_db` = 20 log10 g). Un valor positivo indica que la salida decodificada queda por debajo de la referencia; uno negativo, que queda por encima. Separa el error de nivel del error de forma de onda. Con g se calculan el **SNR tras ganancia** y el **LSD tras ganancia**.
- **Energía por debajo de 20 Hz**: fracción de la energía de la referencia (`ref_low_share_lt20hz`) y del error x−y (`err_low_share_lt20hz`), con ventana de Hann sobre todo el fragmento.
- **Duración**: diferencia entre el número de muestras decodificadas y el de la referencia, en ms. Se considera conservada si la diferencia es de 50 ms o menos. En todas las filas la diferencia es de 0 ms, salvo +0,363 ms (16 muestras a 44,1 kHz) en AAC sobre las fuentes de 44,1 kHz.
- **Tasa efectiva** = bytes del fichero · 8 / 60 s.

### Tiempos

- **Codificación:** proceso completo de `ffmpeg` (lectura del WAV, codificación y escritura del fichero), 3 repeticiones, mediana.
- **Decodificación:** `ffmpeg` con salida `-f null` (decodifica y remuestrea a la frecuencia de la fuente, sin escribir), 3 repeticiones, mediana.
- Los tiempos incluyen el arranque del proceso `ffmpeg`, que pesa en las decodificaciones más rápidas (del orden de 0,04 s).
- Equipo: Apple M4 (10 CPU lógicas, 24 GB de memoria), macOS 27.0.1, ffmpeg 8.1.2 de Homebrew, libopus y libmp3lame de Homebrew (opus 1.6.1 y lame 3.100 según `brew list --versions`), Python 3.14.6 y numpy 2.4.4. Los datos completos están en `research-data/compression/environment.json`.

### Reproducibilidad

- **AAC, MP3 y FLAC:** los ficheros codificados son idénticos bit a bit entre las tres repeticiones de cada configuración (`enc_file_repeats_identical`).
- **Opus:** los bytes del fichero no son idénticos entre codificaciones de la misma entrada. Dos codificaciones consecutivas de la fuente de 1922 con opus-24k difieren en 504 bytes; los primeros bytes distintos están en las cabeceras de las páginas Ogg (posiciones 15 a 18 y 23 del fichero). El PCM decodificado de ambas es idéntico (mismo MD5). La causa exacta no se ha investigado. Por eso el experimento comprueba además la repetibilidad del PCM decodificado (`enc_pcm_repeats_identical`), que es verdadera en las 65 filas.
- **Dos ejecuciones completas** del mismo código sobre las mismas fuentes dan el mismo tamaño de fichero, la misma tasa, el mismo SNR y el mismo LSD en las 65 filas. Solo cambian los `encoded_sha256` de las 25 filas de Opus, por la diferencia de bytes descrita arriba.

## Controles de la cadena de medida

Antes de interpretar los SNR y LSD de Opus, se midió la cadena de remuestreo sin códec (`research-data/compression/controls.csv`): la referencia se remuestrea a 48 kHz y se vuelve a la frecuencia nativa, y después se miden SNR y LSD frente a la referencia.

| Fuente | Frecuencia y ruta | SNR de la ida y vuelta | LSD de la ida y vuelta | Energía de la referencia por debajo de 20 Hz |
|---|---|---|---|---|
| Orquesta (1922) | 44100 → 48000 → 44100 Hz | 70,6 dB | 2,15 dB | 78,23 % |
| Voz solista (Hann) | 44100 → 48000 → 44100 Hz | 71,8 dB | 2,18 dB | 0,0000016 % |
| Jazz (Ellington) | 44100 → 48000 → 44100 Hz | 67,6 dB | 2,24 dB | 0,073 % |
| Voz 78 rpm (Elwin) | 96000 → 48000 → 96000 Hz | 36,8 dB | 31,88 dB | 13,63 % |
| Voz hablada (Waer) | 44100 → 48000 → 44100 Hz | 63,9 dB | 2,15 dB | 0,0019 % |

El remuestreo solo no explica los SNR bajos de Opus en las fuentes de 44,1 kHz (8,9 a 26,0 dB): el techo de la cadena sin códec es de 63,9 a 71,8 dB. En la fuente de 96 kHz el techo es de 36,8 dB y el LSD de la ida y vuelta ya es de 31,88 dB. La representación a 48 kHz no puede contener energía por encima de 24 kHz, y el LSD pondera en dB todas las bins por igual, así que es sensible a esa banda.

## Resultados

Cada fila de la tabla agrega las cinco fuentes: media y, entre corchetes, mínimo y máximo. Hay una sola grabación por tipo de fuente, así que no hay varianza dentro de cada tipo: los rangos son la variación entre las cinco grabaciones.

### Tabla agregada por códec y tasa

| Configuración | Tasa efectiva (kb/s) | SNR (dB) | SNR tras ganancia (dB) | Ganancia óptima (dB) | LSD (dB) | Codificación (s) | Decodificación (s) |
|---|---|---|---|---|---|---|---|
| opus-24k-vbr | 25,18 [20,85–30,52] | 11,45 [8,89–15,50] | 11,51 [9,06–15,53] | −0,258 [−0,620 a −0,044] | 24,06 [15,10–40,48] | 0,336 [0,218–0,601] | 0,089 [0,070–0,134] |
| opus-32k-vbr | 33,51 [28,42–40,47] | 12,92 [9,27–17,43] | 12,96 [9,27–17,46] | −0,185 [−0,362 a −0,034] | 23,91 [14,89–40,41] | 0,353 [0,261–0,523] | 0,108 [0,084–0,159] |
| opus-48k-vbr | 49,93 [42,47–61,08] | 14,36 [9,42–19,29] | 14,39 [9,42–19,30] | −0,123 [−0,263 a −0,017] | 23,57 [14,52–40,35] | 0,427 [0,272–0,574] | 0,146 [0,084–0,312] |
| opus-64k-vbr | 65,18 [53,18–82,42] | 16,95 [9,50–22,10] | 16,97 [9,50–22,11] | −0,066 [−0,140 a −0,002] | 23,35 [14,08–40,32] | 0,343 [0,231–0,460] | 0,099 [0,079–0,119] |
| opus-96k-vbr | 95,98 [73,72–124,97] | 19,79 [9,54–26,00] | 19,80 [9,54–26,01] | −0,030 [−0,068 a −0,000] | 19,48 [13,77–40,27] | 0,383 [0,230–0,463] | 0,109 [0,084–0,133] |
| aac-48k | 50,84 [49,71–54,69] | 16,03 [2,56–26,84] | 16,33 [4,04–26,84] | −0,744 [−3,602 a −0,004] | 41,51 [25,82–53,23] | 0,770 [0,307–1,982] | 0,054 [0,043–0,073] |
| aac-64k | 65,33 [62,88–66,05] | 16,35 [2,57–28,58] | 16,56 [3,60–28,58] | −0,696 [−3,264 a −0,003] | 34,89 [23,64–48,25] | 0,768 [0,282–1,851] | 0,058 [0,049–0,080] |
| aac-96k | 98,49 [97,72–100,64] | 23,00 [11,14–36,42] | 23,06 [11,33–36,45] | −0,070 [−0,497 a +0,059] | 28,00 [18,41–42,19] | 0,703 [0,359–1,480] | 0,059 [0,049–0,077] |
| aac-128k | 130,59 [129,80–132,74] | 30,28 [14,47–41,81] | 30,33 [14,51–41,83] | −0,014 [−0,159 a +0,042] | 23,33 [5,92–42,04] | 0,702 [0,292–1,412] | 0,062 [0,047–0,084] |
| mp3-64k | 64,06 [64,06–64,07] | 19,71 [14,59–25,37] | 21,91 [14,75–33,64] | +0,389 [+0,320 a +0,443] | 38,57 [25,08–54,27] | 0,417 [0,304–0,493] | 0,067 [0,052–0,088] |
| mp3-96k | 96,09 [96,08–96,09] | 21,64 [16,28–25,99] | 26,76 [16,59–45,39] | +0,413 [+0,358 a +0,445] | 31,08 [24,21–49,23] | 0,500 [0,400–0,691] | 0,072 [0,058–0,093] |
| mp3-128k | 128,12 [128,11–128,12] | 23,87 [17,89–26,01] | 33,79 [18,40–49,81] | +0,431 [+0,379 a +0,445] | 27,75 [19,00–46,14] | 0,508 [0,357–0,758] | 0,078 [0,060–0,103] |
| flac-lossless | 946,13 [340,24–2857,47] | ∞ (sin pérdida) | ∞ (sin pérdida) | 0,000 | 0,00 | 0,175 [0,111–0,367] | 0,049 [0,035–0,090] |

Los tiempos de codificación y decodificación de la tabla son los de la mediana de tres repeticiones en cada fichero, y sus rangos son los de las cinco fuentes. Los tiempos de codificación AAC son los más altos en la fuente de 96 kHz (de 1,41 a 1,98 s para las cuatro tasas de AAC, frente a 0,28 a 0,70 s en las fuentes de 44,1 kHz).

### Por tipo de fuente

**SNR (dB) por fuente:**

| Configuración | Orquesta (1922) | Voz solista (Hann) | Jazz (Ellington) | Voz 78 rpm (Elwin) | Voz hablada (Waer) |
|---|---|---|---|---|---|
| opus-24k-vbr | 9,15 | 13,17 | 8,89 | 10,52 | 15,50 |
| opus-32k-vbr | 9,27 | 15,54 | 10,87 | 11,48 | 17,43 |
| opus-48k-vbr | 9,42 | 17,68 | 12,37 | 13,03 | 19,29 |
| opus-64k-vbr | 9,50 | 20,89 | 17,79 | 14,47 | 22,10 |
| opus-96k-vbr | 9,54 | 25,03 | 21,60 | 16,76 | 26,00 |
| aac-48k | 26,84 | 16,09 | 16,66 | 2,56 | 18,02 |
| aac-64k | 28,58 | 15,91 | 15,86 | 2,57 | 18,83 |
| aac-96k | 36,42 | 19,76 | 21,34 | 11,14 | 26,34 |
| aac-128k | 41,81 | 24,36 | 31,15 | 14,47 | 39,62 |
| mp3-64k | 25,37 | 18,60 | 19,66 | 14,59 | 20,31 |
| mp3-96k | 25,99 | 20,81 | 22,45 | 16,28 | 22,66 |
| mp3-128k | 26,01 | 24,19 | 25,58 | 17,89 | 25,68 |

**LSD (dB) por fuente:**

| Configuración | Orquesta (1922) | Voz solista (Hann) | Jazz (Ellington) | Voz 78 rpm (Elwin) | Voz hablada (Waer) |
|---|---|---|---|---|---|
| opus-24k-vbr | 16,24 | 15,10 | 32,83 | 40,48 | 15,67 |
| opus-32k-vbr | 16,10 | 14,89 | 32,84 | 40,41 | 15,29 |
| opus-48k-vbr | 15,86 | 14,57 | 32,55 | 40,35 | 14,52 |
| opus-64k-vbr | 15,61 | 14,21 | 32,55 | 40,32 | 14,08 |
| opus-96k-vbr | 15,20 | 13,77 | 14,25 | 40,27 | 13,88 |
| aac-48k | 25,82 | 44,88 | 39,00 | 53,23 | 44,63 |
| aac-64k | 23,64 | 35,45 | 31,51 | 48,25 | 35,60 |
| aac-96k | 18,41 | 26,96 | 24,87 | 42,19 | 27,57 |
| aac-128k | 5,92 | 23,03 | 21,81 | 42,04 | 23,85 |
| mp3-64k | 25,08 | 39,70 | 34,29 | 54,27 | 39,50 |
| mp3-96k | 24,21 | 27,90 | 25,50 | 49,23 | 28,56 |
| mp3-128k | 19,00 | 25,02 | 23,35 | 46,14 | 25,27 |

**Ganancia óptima (dB) por fuente** (positiva: la salida queda por debajo de la referencia):

| Configuración | Orquesta (1922) | Voz solista (Hann) | Jazz (Ellington) | Voz 78 rpm (Elwin) | Voz hablada (Waer) |
|---|---|---|---|---|---|
| opus-24k-vbr | −0,044 | −0,225 | −0,620 | −0,275 | −0,128 |
| opus-32k-vbr | −0,034 | −0,130 | −0,362 | −0,307 | −0,094 |
| opus-48k-vbr | −0,017 | −0,080 | −0,263 | −0,199 | −0,054 |
| opus-64k-vbr | −0,002 | −0,050 | −0,102 | −0,140 | −0,034 |
| opus-96k-vbr | −0,000 | −0,023 | −0,043 | −0,068 | −0,017 |
| aac-48k | −0,004 | −0,049 | −0,053 | −3,602 | −0,011 |
| aac-64k | −0,003 | −0,040 | −0,121 | −3,264 | −0,055 |
| aac-96k | +0,011 | +0,031 | +0,059 | −0,497 | +0,047 |
| aac-128k | +0,005 | +0,042 | +0,028 | −0,159 | +0,012 |
| mp3-64k | +0,443 | +0,381 | +0,391 | +0,320 | +0,407 |
| mp3-96k | +0,445 | +0,403 | +0,430 | +0,358 | +0,429 |
| mp3-128k | +0,445 | +0,440 | +0,443 | +0,379 | +0,445 |

**Energía por debajo de 20 Hz**, en la referencia y en el error de cada codificación:

| Señal | Orquesta (1922) | Voz solista (Hann) | Jazz (Ellington) | Voz 78 rpm (Elwin) | Voz hablada (Waer) |
|---|---|---|---|---|---|
| Referencia | 78,23 % | 0,0000016 % | 0,073 % | 13,63 % | 0,0019 % |
| Error de opus-24k-vbr | 89,71 % | 0,66 % | 0,54 % | 13,39 % | 0,24 % |
| Error de opus-96k-vbr | 98,10 % | 1,06 % | 7,75 % | 38,58 % | 0,18 % |
| Error de aac-128k | 5,32 % | 0,20 % | 0,42 % | 0,97 % | 0,35 % |
| Error de mp3-128k | 77,88 % | 0,05 % | 0,09 % | 2,31 % | 0,01 % |

### Perfiles actuales frente a los resultados

| Perfil | Tasa nominal | Tasa efectiva, media [mín–máx] (kb/s) | SNR medio (dB) | LSD medio (dB) |
|---|---|---|---|---|
| opus-48k | 48 kbps VBR | 49,93 [42,47–61,08] | 14,36 | 23,57 |
| opus-64k | 64 kbps VBR | 65,18 [53,18–82,42] | 16,95 | 23,35 |
| aac-64k | 64 kbps | 65,33 [62,88–66,05] | 16,35 | 34,89 |
| aac-128k | 128 kbps | 130,59 [129,80–132,74] | 30,28 | 23,33 |
| mp3-128k | 128 kbps | 128,12 [128,11–128,12] | 23,87 | 27,75 |

## Interpretación, con cautela

**Lo que los datos sostienen, con cautela:**

1. **AAC frente a MP3 a unos 128 kb/s.** AAC a 128 kb/s (tasa efectiva de 129,80 a 132,74 kb/s) tiene menor LSD que MP3 a 128 kb/s en las cinco fuentes: 5,92 frente a 19,00 dB en la orquesta; 23,03 frente a 25,02 en la voz solista; 21,81 frente a 23,35 en el jazz; 42,04 frente a 46,14 en la fuente de 96 kHz; y 23,85 frente a 25,27 en la voz hablada. Su SNR es mayor en cuatro de cinco; la excepción es la fuente de 96 kHz (14,47 frente a 17,89 dB), donde MP3 se codifica a 48 kHz.
2. **Opus a 96 kb/s nominales.** En las cinco fuentes, Opus a 96 kb/s tiene el LSD más bajo de los tres códecs a esa tasa nominal (13,77 a 40,27 dB, frente a 18,41 a 42,19 dB en AAC y 24,21 a 49,23 dB en MP3). Pero su tasa efectiva fue de 73,72 a 124,97 kb/s, frente a 97,72 a 100,64 kb/s en AAC y 96,08 a 96,09 kb/s en MP3. Como las tasas efectivas no coinciden, la comparación no es concluyente.
3. **MP3 tiene una desviación de nivel medible.** A 64, 96 y 128 kb/s, la salida de MP3 queda entre 0,32 y 0,45 dB por debajo de la referencia en las cinco fuentes. Corregida esa ganancia, el SNR de MP3 a 128 kb/s sube de 17,89–26,01 dB a 18,40–49,81 dB; en la orquesta llega a 49,81 dB frente a 26,01 dB sin corregir. Los datos no dicen si esa desviación se percibe.
4. **Opus en la grabación de 1922.** Su SNR apenas cambia con la tasa (9,15 dB a 24 kb/s; 9,54 dB a 96 kb/s), mientras que su LSD baja de 16,24 a 15,20 dB. El 89,71 % del error de opus-24k y el 98,10 % del de opus-96k están por debajo de 20 Hz, donde la referencia tiene el 78,23 % de su energía. El control sin códec descarta la ruta a 48 kHz como causa (70,6 dB). La causa dentro del códec no se ha investigado. Por eso el SNR de esta fuente no sirve para juzgar a Opus.
5. **Fuente de 96 kHz.** Todas las configuraciones tienen LSD entre 40,27 y 54,27 dB, y el control sin códec ya da 31,88 dB. El LSD de esa fuente depende en buena parte de la ruta a 48 kHz, así que no es comparable con el de las fuentes de 44,1 kHz.
6. **Jazz y el salto de Opus.** En la fuente de jazz, el LSD de Opus es de 32,55 dB a 53,18 kb/s efectivos y baja a 14,25 dB a 73,72 kb/s efectivos. El experimento no investiga la causa de ese salto.
7. **Voces con poca energía subsónica.** En la voz solista y la voz hablada, la energía por debajo de 20 Hz es casi nula (0,0000016 % y 0,0019 %). Las diferencias de SNR entre códecs son, por tanto, diferencias de forma de onda en la banda audible: en la voz hablada, Opus a 96 kb/s da 26,00 dB, AAC a 128 kb/s 39,62 dB y MP3 a 128 kb/s 25,68 dB.
8. **Tiempos.** En este equipo, la codificación de Opus tarda de 0,22 a 0,60 s, la de MP3 de 0,30 a 0,76 s, la de AAC de 0,28 a 0,70 s en las fuentes de 44,1 kHz y de 1,41 a 1,98 s en la fuente de 96 kHz. La decodificación tarda de 0,035 a 0,31 s en todos los códecs. FLAC se codifica en 0,11 a 0,37 s.

**Lo que los datos no permiten concluir:**

- Qué perfil debe ser el por defecto. La calidad percibida no se ha medido; la prueba MUSHRA está pendiente.
- Qué códec es mejor en general: son cinco grabaciones, una por tipo de fuente.
- Si una diferencia de SNR o de LSD es audible.
- Nada sobre efectos en la escucha de las personas, que quedan fuera del alcance de este experimento.

## Límites del experimento

- **Muestra pequeña.** Cinco fuentes, una por tipo, de 60 s cada una. Los rangos reflejan diferencias entre grabaciones, no variación del códec sobre muestras independientes.
- **Métricas objetivas.** No hay prueba de escucha. El SNR pondera la energía y el LSD pondera todas las bins por igual en dB; por eso dan respuestas distintas en la grabación de 1922.
- **Fuente de 1922.** Grabación acústica de 78 rpm con el 78,23 % de la energía por debajo de 20 Hz. No representa grabaciones de orquesta con micrófono eléctrico ni grabaciones digitales.
- **Fuente de jazz.** Fragmento de una emisión de radio FM. No se ha verificado auditivamente que no contenga voz; la clasificación como jazz instrumental se basa en los metadatos.
- **Licencias.** Las declaradas en Internet Archive, sin análisis jurídico.
- **Remuestreo.** Opus opera a 48 kHz, y MP3 también en la fuente de 96 kHz. La salida se remuestrea a la frecuencia original para compararla. El control sin códec cuantifica ese efecto (63,9 a 71,8 dB en 44,1 kHz; 36,8 dB en 96 kHz).
- **Tasas.** AAC y MP3 se codifican a tasa fija (CBR). Opus usa VBR, y su tasa efectiva se aleja del nominal (de 73,72 a 124,97 kb/s para 96 kb/s nominales).
- **Tiempos.** Un solo equipo (Apple M4, macOS 27.0.1, ffmpeg 8.1.2), 3 repeticiones y mediana. Los tiempos incluyen el arranque del proceso. No se miden en el dispositivo de reproducción ni el consumo de energía.
- **Vorbis.** No ejecutado: libvorbis no está compilado en esta ffmpeg.
- **Versiones.** Los valores dependen de ffmpeg 8.1.2, libopus 1.6.1 y lame 3.100 (Homebrew). Otra versión puede dar valores distintos.

## Próximos pasos

1. **Prueba perceptual MUSHRA** (ITU-R BS.1534-3) con oyentes y entorno controlado, al menos para los cinco perfiles actuales y las configuraciones de la tabla de resultados. Es la única prueba que puede decidir la calidad percibida.
2. **Más fuentes por tipo.** Con una grabación por tipo no se puede separar el efecto del códec del de la grabación. Conviene añadir grabaciones digitales modernas de orquesta y de voz solista, y fuentes de 48 kHz nativos para no depender del remuestreo en Opus y MP3.
3. **Energía subsónica.** En la grabación de 1922 la mayor parte de la energía está por debajo de 20 Hz. Antes de cualquier filtrado habría que medir su efecto en las métricas y en la escucha, porque el proyecto no aplica filtros destructivos por defecto.
4. **Vorbis.** Completar la tabla con libvorbis en una ffmpeg que lo incluya.
5. **Tiempos en el dispositivo.** Medir la decodificación en Android e iOS, donde se reproduce la biblioteca, en lugar de en el equipo de desarrollo.

## Cómo reproducirlo

Desde la raíz del repositorio, con un entorno virtual y un directorio de trabajo fuera del repositorio:

```
python3 -m venv <ruta-fuera-del-repo>/venv
<ruta-fuera-del-repo>/venv/bin/pip install -r scripts/compression/requirements.txt
<ruta-fuera-del-repo>/venv/bin/python scripts/compression/test_metrics.py
<ruta-fuera-del-repo>/venv/bin/python scripts/compression/run_experiment.py --work-dir <ruta-fuera-del-repo>/trabajo
```

El script descarga las fuentes desde `sources.json`, comprueba la licencia en los metadatos de Internet Archive y el SHA-256 de cada fichero, y escribe `results.csv`, `controls.csv` y `environment.json`. Con `--skip-metadata-check` no consulta los metadatos y solo verifica el SHA-256 local. Si el directorio de trabajo está dentro del repositorio, el script se niega a continuar.

## Referencias

### Verificadas

Todas se abrieron el 2026-10-31.

1. Creative Commons. *Public Domain Mark 1.0 Universal*. https://creativecommons.org/publicdomain/mark/1.0/ — Marca que identifica una obra libre de restricciones conocidas de derecho de autor; la página advierte que puede no cumplirse en todas las jurisdicciones.
2. Creative Commons. *CC0 1.0 Universal*. https://creativecommons.org/publicdomain/zero/1.0/ — Dedicación al dominio público mediante renuncia de derechos.
3. ITU. *Recomendación ITU-R BS.1534-3* (10/2015), "Method for the subjective assessment of intermediate quality level of audio systems" (MUSHRA). https://www.itu.int/rec/R-REC-BS.1534 — Versión vigente, aprobada en 2015-10.
4. IETF. *RFC 6716: Definition of the Opus Audio Codec*, septiembre de 2012, Proposed Standard (actualizada por RFC 8251). https://www.rfc-editor.org/rfc/rfc6716 — Tabla 1 de la sección 2: anchos de banda NB 4 kHz, MB 6 kHz, WB 8 kHz, SWB 12 kHz y FB 20 kHz.
5. FFmpeg. *FFmpeg Codecs Documentation*. https://ffmpeg.org/ffmpeg-codecs.html — Opciones de libopus (`vbr`, valor por defecto `on`), de flac (`compression_level`, valor por defecto 5), de libmp3lame (`b`, `abr`) y del encoder nativo aac (`b` activa CBR).
6. Internet Archive. *Item Metadata API: Read*. https://archive.org/developers/md-read.html — Endpoint `https://archive.org/metadata/{identifier}` y campos por fichero `md5`, `sha1`, `size`, `format` y `source`. La página no confirma el campo `licenseurl` a nivel de ítem; ese campo se leyó en el JSON de metadatos de cada ítem.
7. Internet Archive. Metadatos de las cinco fuentes: `https://archive.org/metadata/<identificador>` para los identificadores de la tabla de fuentes. Se abrieron el 2026-10-31; se comprobaron la licencia (`licenseurl`), el tamaño y el MD5 de cada fichero.

### Pendientes de verificar

No se citan en el texto hasta comprobarlas.

- Gray, A. H., y Markel, J. D. (1976). "Distance measures for speech processing". *IEEE Transactions on Acoustics, Speech, and Signal Processing*, 24(5). DOI 10.1109/TASSP.1976.1162849. Motivo: el DOI redirige a IEEE Xplore, pero la página no devolvió contenido en la comprobación del 2026-10-31, así que no se han confirmado título, autores ni año. Se atribuye a este trabajo el origen de la distancia espectral logarítmica; hasta confirmarlo, la definición del LSD de este documento es la de `scripts/compression/metrics.py`, sin cita.
