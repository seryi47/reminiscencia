# Metodología de evaluación de H1 a H5

- **Proyecto:** Reminiscencia (rama `feat/investigacion`).
- **Versión:** 0.1, borrador de diseño (2 de noviembre de 2026).
- **Estado:** no es un protocolo aprobado. Sin informe favorable del comité de ética no se contacta con personas ni se recogen datos de participantes (sección 6).

## 0. Alcance y convenciones

**Qué describe.** Cómo se evaluaría cada hipótesis de [PROJECT_MASTER.md](PROJECT_MASTER.md) con la app y el registro tal como están especificados en [DESIGN.md](docs/user-experience/DESIGN.md), con los instrumentos y las medidas de audio verificados y con las consideraciones éticas y de datos de [SECURITY.md](SECURITY.md).

**Qué no describe.** No fija tamaños de muestra, tamaños del efecto, niveles de significación ni criterios de decisión. Esas decisiones son del investigador y figuran en la sección 7.

**Sin resultados prometidos.** Ninguna hipótesis está demostrada. La música es una hipótesis del proyecto. Cada afirmación sobre efectos se presenta con su nivel de evidencia y sus límites.

**Citas.** Los identificadores entre corchetes son los de los registros de verificación ([clinica-06], [escalas-03], [audio-02], [legal-04], B1 a B6, P1 a P4; la equivalencia está en la sección 9). Una afirmación se cita solo si su registro está verificado, con la corrección aplicada cuando la hay. Si el estado es «parcial», se cita solo lo confirmado. Lo no verificado no se cita y va a la sección 7. Una «pista» es una referencia verificada que aparece dentro de un registro, sin identificador propio: se describe junto al identificador que la menciona.

**Niveles de evidencia.** Siguen los cuatro niveles de [RESEARCH.md](RESEARCH.md) («Cómo leer este documento»), según el tipo de diseño. No son una calificación formal de certeza. La única certeza que se cita es la que reporta la propia revisión [clinica-01].

| Nivel | Tipo de estudio | Identificadores |
|---|---|---|
| 1 | Revisión sistemática con metaanálisis | [clinica-01]; [escalas-01] (sobre un instrumento, no sobre un efecto) |
| 2 | Revisión sistemática sin metaanálisis, o revisión narrativa | [clinica-02]; [B3]; [P3] |
| 3 | Estudio primario con grupo de comparación (incluye el ensayo pragmático) | [clinica-04]; [clinica-03]; [B5]; [B4] (n sin confirmar); [clinica-05] (n no indicado) |
| 4 | Neuroimagen, biomarcadores, hipótesis o caso único (mecanismo, no intervención) | [clinica-06]; [B2]; [P1] |

## 1. Operacionalización de H1 a H5

Los enunciados son los de [PROJECT_MASTER.md](PROJECT_MASTER.md).

### 1.1 Resumen

| Hipótesis | Variable dependiente | Comparación | Medidas previstas | Momento | Estado del diseño |
|---|---|---|---|---|---|
| H1: la música elegida por el paciente produce mayor respuesta emocional que una lista genérica. | Respuesta emocional, sin definición operativa. Secundarias: agitación, síntomas neuropsiquiátricos, calidad de vida | Música elegida por el paciente frente a lista genérica | Observación del cuidador, preferencia, comportamiento de escucha; CMAI, NPI y QoL-AD | Por reproducción; escalas antes y después | Incompleto: no hay campo para quién eligió la canción ni lista genérica definida |
| H2: la música asociada a un recuerdo facilita la evocación autobiográfica frente a silencio o música desconocida. | Evocación autobiográfica (no se mide hoy) | C1 frente a C0; silencio no incluido; música desconocida como familiaridad baja | Exposición al recuerdo; evocación por definir | Durante y justo después de la canción | Incompleto: falta la medida de evocación y la condición de silencio |
| H3: la familiaridad modula la respuesta emocional (se solapa con H1; pendiente de separarla). | Respuesta emocional | Niveles de familiaridad 1 a 5, medidos y no asignados | Familiaridad (C-5) y preferencia (C-6) por separado | Valor vigente en cada reproducción | Medidas previstas; separación frente a H1 no diseñada |
| H4: la asociación de fotografías aumenta el recuerdo frente a la música sola. Sin evidencia directa. | Recuerdo (evocación, como en H2) | C2 frente a C1 (aísla la fotografía) o C2 frente a C0 (fotografía y texto frente a canción sola) | Fotografía mostrada y ampliada; evocación por definir | Durante la canción | Contraste por decidir; falta la medida de evocación |
| H5: una interfaz adaptada reduce dificultades de uso. Es un estudio de usabilidad, separado del clínico. | Dificultades de uso: tareas sin ayuda, errores, peticiones de ayuda, tiempo | Interfaz adaptada frente a un comparador no definido | Observación de tareas; escala subjetiva candidata | Durante la prueba de usabilidad | Protocolo propio; comparador por definir |

### 1.2 H1: «la música elegida por el paciente produce mayor respuesta emocional que una lista genérica.»

**Evidencia previa**
- [clinica-01] (revisión Cochrane de 2025; 30 estudios y 1.720 participantes). Frente a cuidado habitual, mejora ligera de los síntomas depresivos (DME −0,23; certeza moderada) y probablemente ninguna mejora de la agitación ni de la agresión (DME −0,05; certeza moderada). Frente a otras actividades, la certeza es baja y no hay efecto en agitación ni en depresión. La actualización no confirma la mejora del bienestar emocional (DME 0,14) ni de la ansiedad (DME −0,15) que la versión de 2018 señalaba con calidad baja [B1].
- [clinica-04] (ensayo pragmático por conglomerados; 54 residencias y 976 residentes con demencia). La música personalizada no redujo de forma significativa la agitación medida con el CMAI frente a cuidado habitual, que podía incluir música ambiental o grupal. Tampoco redujo de forma significativa el uso de psicótropos.
- Pistas dentro de [clinica-04], que no son resultados del ensayo: Cheung et al. 2025 (24 reclutados; estudio aleatorizado de viabilidad según PubMed, PMID 40148224), donde la lista individualizada no fue más eficaz que una lectura grabada de control; y Hillebrand et al. 2023 (90 participantes), con menos síntomas conductuales solo durante la sesión.

**Límites**
- La agitación y los síntomas depresivos no son la respuesta emocional momentánea que mide H1. Se miden por separado.
- No consta verificado si la revisión separa la música personal de la genérica ([clinica-01]; sección 7.2).
- Cada estudio compara con un control distinto: cuidado habitual, música fija o lectura grabada. El control cambia la pregunta que responde el estudio.

**Variables y medidas**
- *Variable independiente:* origen de la canción, elegida por el paciente o de una lista genérica. La app no la registra. El campo «origen» del registro (DESIGN §8.4) indica desde dónde se inicia la reproducción (lista, carpeta, búsqueda o continua), no si la lista es personal o genérica. Hace falta un campo nuevo o un procedimiento que lo fije por escrito.
- *Variable dependiente:* respuesta emocional. Ningún registro verificado trae una medida validada de respuesta emocional momentánea. Las candidatas son:
  - Las ocho etiquetas de observación del cuidador (DESIGN §8.5: reconoce la canción; canta o tararea; marca el ritmo; pide que se repita; inquietud; tranquilidad; pide cambiar de canción; otra). Las define el proyecto, su fiabilidad no está medida y las registra el cuidador, que conoce la condición.
  - El comportamiento de escucha por reproducción: segundos escuchados, porcentaje completado y final (completo o saltado). Mide implicación, no emoción.
  - Una medida fisiológica. El ensayo de Irish et al. no encontró diferencias en la respuesta galvánica de la piel [B5]. Es un precedente, no una elección.
- *Resultados secundarios:* CMAI (agitación), NPI (síntomas neuropsiquiátricos) y QoL-AD (calidad de vida), según la sección 2.
- *Momento:* durante y después de cada reproducción (etiquetas y comportamiento); al final de la sesión (nota libre); antes y después del periodo de estudio (escalas). El intervalo entre medidas no está verificado. La pista de Hillebrand et al. sugiere que los efectos observados pueden limitarse a la sesión [clinica-04], así que conviene medir dentro y fuera de ella.
- *Comparación:* las canciones de los dos grupos deben tener la misma codificación y sonoridad, o registrar esas diferencias como covariables (sección 3).

**Decisiones del investigador:** definición operativa de respuesta emocional; cómo se registra la elección del paciente (quién elige, cuándo y cómo); composición y criterio de la lista genérica; si el control es una lista fija igual para todos o un control activo.

### 1.3 H2: «la música asociada a un recuerdo facilita la evocación autobiográfica frente a silencio o música desconocida.»

**Evidencia previa**
- [clinica-02] (revisión sistemática de 15 estudios clínicos: Alzheimer, DFT conductual, daño cerebral adquirido y depresión). La música evoca recuerdos autobiográficos en estas poblaciones, con más probabilidad si es familiar. En Alzheimer, los recuerdos evocados por música tienen una ventaja relativa frente a los evocados por fotografías, comparado con controles. Los autores concluyen que están relativamente bien conservados, sobre todo en Alzheimer.
- [clinica-03] (El Haj et al. 2015; 22 pacientes con Alzheimer leve y 24 controles; silencio, música del investigador y música elegida por el paciente). En Alzheimer, el recuerdo autobiográfico fue mejor con música elegida, y hubo más recuerdos autodefinitorios. Los controles no mostraron ese beneficio. Mide recuerdo, no respuesta emocional.
- [B5] (Irish et al. 2006; 10 pacientes con Alzheimer leve y 10 controles). Un único fragmento de Vivaldi («Primavera») frente a silencio. Mejor recuerdo autobiográfico con música en Alzheimer y menor ansiedad estado. No es música elegida por el paciente.
- [B4] (El Haj, Postal y Allain 2012). Según el resumen recuperado por OpenAlex, recuerdo mayor con música elegida que con música fija (The Four Seasons de Vivaldi), y mayor con ambas que en silencio. Los 12 participantes no se han podido confirmar en PubMed, y [clinica-03] indica que no hay resumen accesible. Discrepancia abierta (sección 7).
- [clinica-05] (Simmons-Stern et al. 2010). En Alzheimer, las letras de canciones infantiles desconocidas se reconocen mejor cantadas que habladas. Es memoria verbal de codificación, no autobiográfica: antecedente indirecto.
- [B3] (Baird y Samson 2009; revisión narrativa). El reconocimiento de melodías conocidas suele estar alterado en Alzheimer. La memoria procedimental, como tocar un instrumento, puede conservarse en algunos músicos.
- [clinica-06] (Jacobsen et al. 2015; neuroimagen y biomarcadores). En Alzheimer, las regiones que codifican la memoria musical a largo plazo muestran menos atrofia e hipometabolismo, pero no menos amiloide. Los autores escriben que estos hallazgos «may thus explain» la preservación [B2]. Es un mecanismo posible, no una intervención.

**Límites.** Las muestras son pequeñas. Ninguno de estos estudios mide la evocación con un protocolo verificado en este documento. Ninguna cifra sirve como tamaño del efecto para este diseño (sección 5.7).

**Variables y medidas**
- *Variable independiente:* presentación de la canción. El contraste natural es C1 frente a C0, que aísla la tarjeta de recuerdo. El silencio no existe en el diseño actual (sección 4.1). La «música desconocida» puede identificarse con familiaridad 1 o 2, como variable observada, no asignada.
- *Variable dependiente:* evocación autobiográfica, es decir, número y contenido de los recuerdos que evoca cada canción. **El diseño no la mide.** «Recuerdo visto» y «otro recuerdo» (DESIGN §8.4) registran la exposición a la tarjeta, no la evocación. El protocolo debe definir qué se pregunta, cuándo, quién lo registra y cómo se codifica la respuesta. Los precedentes son [clinica-03] y [B4] (recuerdo autobiográfico y autodefinitorio); sus protocolos de codificación no están verificados aquí.
- *Riesgo de medición:* en C1 y C2 el texto del recuerdo está visible en la pantalla principal (DESIGN §6.1, P-10). Si la evocación se mide con el texto a la vista, se mide lectura, no evocación.
- *Riesgo de estímulo:* el texto y la fotografía de cada recuerdo los escribe y elige el cuidador (DESIGN C3c, texto de hasta 1000 caracteres). No hay normas de longitud ni de detalle, así que cada canción tendría un estímulo distinto.

**Momento:** durante la canción y después de ella.

**Decisiones del investigador:** incluir o no el silencio (RESEARCH.md lo pide; DESIGN.md no lo incluye); definición y protocolo de la evocación; si el texto del recuerdo se oculta durante la medición; normas para redactar los recuerdos.

### 1.4 H3: «la familiaridad modula la respuesta emocional (se solapa con H1; pendiente de separarla).»

**Evidencia previa**
- Pista de Garrido et al. 2018 (99 personas con demencia), registrada en [clinica-02]: el resumen comunica diferencias según la depresión, la apatía y el deterioro cognitivo. No comunica ningún resultado sobre la ansiedad, aunque esta figura entre los factores del diseño. No consta verificado si separa la familiaridad de la preferencia (sección 7.2).
- [clinica-02] (Kaiser y Berntsen): la música familiar evoca recuerdos con más probabilidad.
- [clinica-01]: no consta verificado si la revisión separa la música personal de la genérica (sección 7.2).
- [B3]: el reconocimiento de melodías conocidas suele estar alterado en Alzheimer. La familiaridad que juzga el cuidador puede no coincidir con la del paciente.

**Variables y medidas**
- *Variable independiente:* familiaridad de cada canción, en cinco niveles con las anclas de DESIGN C-5: 1 «No la reconoce»; 2 «Le suena poco»; 3 «Le suena algo»; 4 «La reconoce»; 5 «La reconoce bien». La asigna el cuidador en la pestaña Canciones del perfil (C3a). Es una medida, no una asignación.
- *Preferencia:* −1, 0 o +1 («No le gusta», «Le da igual», «Le gusta»; C-6), registrada aparte. RESEARCH.md pide separar ambas variables.
- *Variable dependiente:* la misma respuesta emocional que en H1.
- *Covariables candidatas:* nivel cognitivo (MoCA o MMSE al inicio) y las dimensiones de la pista de Garrido et al. (depresión, ansiedad, apatía). El diseño no define cómo medirlas ni dónde guardarlas.
- *Momento:* el valor vigente en cada reproducción (resumen por reproducción, DESIGN §8.4). Hay que confirmar si ese valor se fija al empezar la reproducción o al terminarla.
- *Separación frente a H1:* la app no separa familiaridad y elección. Si las canciones que elige el paciente son, en la práctica, las más familiares, H1 y H3 quedan confundidas. La separación exige variación de familiaridad dentro de cada origen de elección, o un modelo que incluya ambas variables. Lo decide el investigador.

**Límites.** La familiaridad y la preferencia son escalas de diseño propio, sin validación en los registros, y las asigna el cuidador. No se conoce su concordancia con la respuesta del paciente.

### 1.5 H4: «la asociación de fotografías aumenta el recuerdo frente a la música sola. Sin evidencia directa.»

**Evidencia previa**
- Pista de Baird et al. 2018 (10 pacientes con Alzheimer y 10 controles), registrada en [clinica-02]: en Alzheimer no hubo diferencia en la frecuencia de recuerdos evocados por música y por fotografías.
- [clinica-02] (Kaiser y Berntsen): en Alzheimer, los recuerdos evocados por música tienen una ventaja relativa frente a los evocados por fotografías, comparado con controles. Es evidencia indirecta en contra de que la fotografía supere a la música.
- PROJECT_MASTER.md: no hay evidencia directa sobre la fotografía asociada a la música.

**Contraste.** H4 compara con «la música sola», que en el diseño es C0. Pero C2 frente a C0 cambia dos cosas a la vez: la fotografía y el texto del recuerdo. Para aislar la fotografía hay que comparar C2 con C1, que comparten la tarjeta de recuerdo. El investigador elige el contraste y explica cuál usa.

**Variables y medidas**
- *Variable independiente:* presencia de fotografía (C2 frente a C1, o C2 frente a C0).
- *Variable dependiente:* recuerdo (evocación), igual que en H2.
- *Registro:* fotografía mostrada (sí o no) y evento «fotografía ampliada» (DESIGN §8.4).
- *Momento:* durante la canción. DESIGN no fija si la fotografía aparece al empezar la canción o después.

**Límites.** Las fotografías varían en contenido (personas, lugar, calidad) y no están normalizadas. Pueden mostrar a terceros que no participan en el estudio (sección 6).

### 1.6 H5: «una interfaz adaptada reduce dificultades de uso. Es un estudio de usabilidad, separado del clínico.»

**Evidencia previa**
- Pista MATCH 2025 (13 díadas, pre-post sin grupo control; SUS con mediana de 73,5), registrada en [clinica-04]. Es una pista de usabilidad no comparativa. No permite afirmar que una interfaz adaptada reduzca las dificultades.
- Ningún registro verificado contiene un estudio comparativo de interfaces adaptadas para este uso.

**Medidas**
- *Tareas,* derivadas de DESIGN. Paciente: reproducir y pausar (P1); pasar a la siguiente canción; subir o bajar el volumen (P-8); abrir una lista o una carpeta (P2, P3); buscar por artista (P4); leer el recuerdo completo (P1b); volver al modo cuidador con PIN (P5). Cuidador: crear un perfil (C3e); asociar canciones y presentaciones (C3a); empezar una sesión (C4).
- *Por tarea:* completada sin ayuda (sí o no), errores, peticiones de ayuda y tiempo.
- *Facilidad percibida:* escala por decidir. SUS es candidata, pero su versión en español no está verificada aquí.
- *Requisitos previos de accesibilidad* (DESIGN §10 y §16): VoiceOver, TalkBack, NVDA y recorrido solo con teclado. Son criterios de aceptación, no medidas de usabilidad.

**Comparador.** No está definido. Opciones: una versión de la misma app sin las adaptaciones, o la web pública actual (frontend/web). Esta última existe, pero no tiene perfiles, fotografías ni recuerdos (ROADMAP.md, fase 4).

**Separación y tamaño.** H5 tiene protocolo y consentimiento propios, separados del clínico (PROJECT_MASTER.md). DESIGN §16 prevé validar con cinco cuidadores y cinco pacientes en sesiones de 15 minutos. Es una prueba de diseño, no un cálculo de muestra.

## 2. Instrumentos

Ninguna escala forma parte de la app. Se aplican fuera de ella, y sus datos se guardan fuera del repositorio (sección 5.8). MoCA y MMSE sirven para incluir y estratificar. NPI, CMAI y QoL-AD son resultados secundarios. Ninguno mide la respuesta emocional momentánea de H1: son medidas de periodo, y su intervalo debe fijarse.

| Instrumento | Uso propuesto | Referencias verificadas | Límites |
|---|---|---|---|
| MoCA | Cribado para inclusión y estratificación (no es resultado de H1 a H5) | [escalas-01]. Versión original: Nasreddine et al. 2005 (PMID 15817019), con sensibilidad de 90 % y punto de corte 26 para deterioro cognitivo leve (especificidad de 87 %). Validación en español: Arjol et al. 2026, *Psicothema* 38(3):161-172 (PMID 42528410), estudio de estructura interna en adultos sin deterioro cognitivo de muestra comunitaria; no es un estudio de precisión diagnóstica. Metaanálisis: 80 estudios, 78 de ellos en el análisis (n = 7.457), PMID 42380691 | Heterogeneidad muy alta (I² = 99,3 %). La metarregresión explica el 62 % de la variabilidad; los predictores principales son la edad (β = −0,19 por año) y la educación (β = 1,28 por año). Los autores proponen normas ajustadas, no un punto de corte único |
| MMSE, versión española (MEC-30) | Cribado para inclusión y estratificación; referencia para el ámbito de validez de QoL-AD (MMSE mayor de 10, según Logsdon et al.) | [escalas-02]. Lobo et al. 1999, *Med Clin* (Barc) 112(20):767-74 (PMID 10422057), estudio poblacional de Zaragoza (N = 1.080). Original: Folstein et al. 1975 (PMID 1202204; solo se confirma que es el artículo del MMSE, sin resumen) | Punto de corte 23/24: sensibilidad 89,8 %, especificidad 75,1 %, AUC 0,920; kappa ponderado test-retest 0,637. El criterio de referencia no consta en el registro verificado |
| NPI | Resultado secundario: síntomas neuropsiquiátricos, informados por el cuidador. Relacionado con H1 | [escalas-03]. Cummings et al. 1994, *Neurology* 44(12):2308-14 (PMID 7991117). Adaptaciones al castellano: NPI-Q, Boada et al. 2002 (PMID 12084358; 120 pacientes con Alzheimer; test-retest r = 0,89 en la escala total y 0,90 en el malestar); NPI-NH para residencias, Boada et al. 2005 (PMID 16317587; 80 residentes) | Evalúa 10 alteraciones con frecuencia y gravedad. El periodo de referencia y la versión a usar no están verificados aquí |
| CMAI | Resultado secundario de agitación (H1) | [escalas-04]. Cohen-Mansfield et al. 1989, *J Gerontol* 44(3):M77-84 (PMID 2715584). La atribución al CMAI se respalda con el manual del instrumento; el texto completo no se ha leído. Precursor de 1986 (66 residentes), estudio preliminar. Versión española IAACM: su artículo de validación no está verificado | 29 conductas agitadas valoradas por enfermeras con escala de frecuencia de 7 puntos en 408 residentes; tres síndromes en el análisis factorial. La validación en español queda pendiente |
| QoL-AD (versión del paciente y del cuidador) | Resultado secundario de calidad de vida (relacionado con H1 y H3) | [escalas-05]. Logsdon et al. 2002, *Psychosom Med* 64(3):510-519 (PMID 12021425). Con la corrección aplicada, los autores concluyen que el instrumento parece fiable y válido para pacientes con MMSE mayor de 10; los no completores tenían MMSE de 10 o menos. Validación en español: [escalas-06], León-Salas et al. 2011, *Aging Ment Health* 15(6):775-783 (PMID 21547751). Para centros de día: Gómez-Gallego et al. 2012 (PMID 21570161; *Neurologia* 27(1):4-10) | Logsdon: 177 díadas paciente-cuidador; α de 0,83 a 0,90; validez frente a depresión, funcionalidad y actividades placenteras. León-Salas: 101 pacientes institucionalizados (82 con Alzheimer y 19 con demencia mixta), MMSE medio de 7,2 ± 6,1; α de 0,90 (paciente) y 0,86 (cuidador); ICC de 0,83 (paciente) y 0,51 (cuidador). La versión del paciente tiene menor validez de constructo en esa muestra |

La cita de 1999 de Logsdon et al. (*J Ment Health Aging* 5:21-32; «Quality of life in Alzheimer's disease: patient and caregiver reports») no está verificada y no se cita. El registro PsycTests (DOI 10.1037/t03352-000) confirma autores y año, pero no el artículo.

**Decisiones del investigador:** instrumento de cribado (MoCA, MMSE o ambos); versión de NPI, CMAI y QoL-AD; versión del paciente o del cuidador en QoL-AD; periodo entre medidas; quién responde, quién puntúa y con qué formación. Si el estudio usa el CMAI en su versión española, la validación de IAACM debe resolverse antes.

## 3. Medidas de audio

Las medidas de audio no miden H1 a H5. Sirven para tres cosas: comprobar que los estímulos tienen calidad suficiente, igualar la sonoridad entre condiciones y documentar la codificación.

### 3.1 Escucha con referencia oculta y anclas (MUSHRA)

- **Norma.** UIT-R BS.1534-3 (10/2015, en vigor) [audio-01]. El método MUSHRA exige una referencia oculta y anclas ocultas: un paso bajo a 3,5 kHz (ancla estándar) y otro a 7 kHz (ancla de calidad media). La escala es continua, de 0 a 100. Se recomienda no incluir más de 12 señales por prueba; por ejemplo, 9 sistemas, el ancla baja, el ancla media y la referencia. La norma advierte que el nombre MUSHRA se usa mal en pruebas sin referencia oculta ni anclas.
- **Implementación web.** webMUSHRA (Schoeffler et al. 2018; DOI 10.5334/jors.187) [audio-01].
- **Uso previsto.** Control de calidad de los estímulos: comprobar que la codificación elegida no es audiblemente peor que la referencia sin compresión antes de usarla en el estudio. No mide respuesta emocional ni memoria.
- **Estado.** No iniciado. COMPRESSION.md lo plantea como próximo paso, pero ROADMAP.md (Plan v2) fija «sin pruebas perceptuales con personas» para el frente de compresión. Hay que decidirlo antes de cualquier escucha. Si participan personas, requiere aprobación ética.
- **Por fijar:** referencia sin pérdida; codificaciones a comparar; perfil y número de oyentes; entorno de escucha según la norma (no revisado aquí en detalle); número de pruebas por sesión.

### 3.2 Normalización de sonoridad

- **Medición.** UIT-R BS.1770-5 (11/2023, en vigor; sustituye a la de 10/2015) [audio-02]. Filtro K de dos etapas; bloques de 400 ms con 75 % de solapamiento; puerta absoluta de −70 LKFS; puerta relativa de −10 dB respecto al nivel medido tras la puerta absoluta. La norma escribe la puerta relativa en dB; LU es el término de EBU R 128. El anexo cubre la medición de true-peak.
- **Referencia de radiodifusión.** EBU R 128 (V5, 11/2023), según [audio-02]: objetivo de −23,0 LUFS; tolerancia de ±1,0 LU cuando no se puede alcanzar el objetivo (por ejemplo, en directos) y de ±0,2 LU en control de calidad. El título y el editor de EBU R 128 están pendientes de transcribir.
- **Objetivo del estudio.** Lo fija el investigador. El valor de EBU R 128 es una referencia, no un valor validado para este estudio.
- **Regla del proyecto.** No hay filtros destructivos por defecto, y cualquier normalización debe medirse antes de activarse (CLAUDE.md). Por eso la normalización no se activa por defecto: primero se mide su efecto sobre la sonoridad y el true-peak.
- **Lo que no controla.** El volumen de la app: arranque al 60 % con fundido de 1,5 s en la primera pista de cada sesión (DESIGN §8.1, D14); límite por perfil entre 50 % y 100 %; el paciente sube o baja el volumen en pasos del 10 % (P-8). Ningún cambio de volumen se registra. Es un confusor no resuelto (sección 4.6).

### 3.3 Códec Opus

- **Especificación.** RFC 6716 (Standards Track, septiembre de 2012) define Opus, de 6 a 510 kbit/s, con predicción lineal y MDCT [audio-03]. La RFC 8251 (Standards Track, octubre de 2017) la actualiza («Updates: 6716») [audio-03]. Para fijar la versión del códec bajo prueba hay que citar las dos. Las RFC no contienen resultados de escucha.
- **Implementación.** El experimento de compresión usa libopus 1.6.1 y ffmpeg 8.1.2 (docs/audio-processing/COMPRESSION.md). En VBR la tasa efectiva se aleja de la nominal: para 96 kb/s nominales, de 73,72 a 124,97 kb/s.
- **Consecuencia.** El estudio usará la misma codificación en todas las condiciones, o registrará la codificación de cada canción como covariable. El códec de los estímulos del estudio no está decidido.

### 3.4 Pendiente: Valin et al. 2010

[audio-04] queda pendiente hasta leer la versión publicada en IEEE, porque IEEE Xplore no devolvió contenido. Este documento no usa ninguna cifra de ese estudio.

### 3.5 Medidas objetivas y su validez

- [audio-05] (Hu y Loizou 2008; IEEE TASLP 16(1):229-238; DOI 10.1109/TASL.2007.911054), verificado en parte. Compara medidas objetivas con escalas de escucha ITU-T P.835 (distorsión de la señal, del ruido y calidad global) y propone medidas compuestas por regresión. Las conclusiones sobre la SNR segmental y PESQ no están verificadas en fuente primaria y quedan pendientes. El estudio trata voz, no música.
- La SNR y el LSD del experimento de compresión (docs/audio-processing/COMPRESSION.md) son métricas objetivas. El propio documento dice que no miden la calidad percibida. Sirven como comprobaciones técnicas, no como resultado.
- [audio-06] (Gray y Markel 1976; IEEE TASSP 24(5):380-391; DOI 10.1109/TASSP.1976.1162849). Se cita solo como referencia general de medidas de distancia. Su resumen recoge la distancia logarítmica espectral rms entre cuatro medidas para el habla. No se ha leído la fórmula exacta y su validez para música no está verificada.

## 4. Diseño piloto

### 4.1 Condiciones

Fuente: DESIGN §8.3.

| Código | Presentación | Portada | Fotografía | Recuerdo | Qué permite evaluar |
|---|---|---|---|---|---|
| C0 | Solo canción | Sí | Texto «Sin fotografía» | Texto «Sin recuerdo guardado» | Línea base: canción sin recuerdo ni fotografía |
| C1 | Canción y recuerdo | Sí | Texto «Sin fotografía» | Tarjeta con texto | C1 frente a C0: efecto del recuerdo (H2) |
| C2 | Canción, foto y recuerdo | Sí | Fotografía | Tarjeta con texto | C2 frente a C1: efecto de la fotografía (H4). C2 frente a C0: fotografía y texto a la vez |

Según DESIGN §8.3, las zonas no cambian de posición ni de tamaño (D5), y las zonas ausentes muestran los textos de una canción sin contenido (D7). Los textos «Sin fotografía» (C0 y C1) y «Sin recuerdo guardado» (C0) son visibles para el paciente, así que la condición no queda oculta del todo. Si los textos de ausencia deben ser idénticos en C0 y C1 está pendiente de confirmar (DESIGN §16).

El diseño no incluye silencio ni lista genérica como condiciones. RESEARCH.md sí las pide (secciones 2 y 5).

### 4.2 Prerrequisitos técnicos

Según el estado de la rama en la revisión de [SECURITY.md](SECURITY.md) del 2 de noviembre de 2026, el piloto no puede empezar todavía:

- La capa de datos del cuidador existe, pero la interfaz del cuidador todavía no la usa (SECURITY.md §3.1; pendiente 10).
- El registro del estudio no tiene almacén propio (SECURITY.md §2.1; pendiente 14). Hoy no se registra ningún evento de escucha.
- Faltan la persistencia del almacenamiento (pendiente 11), la reducción de fotografías y la eliminación de sus metadatos de ubicación (R6; pendiente 12), y la alineación de los parámetros del PIN con el diseño (pendiente 13).
- Si se decide registrar el volumen o la elección del paciente, hay que añadir esos campos (sección 5.8).

### 4.3 Cómo se asigna una condición

- La presentación es un atributo de cada canción dentro de cada perfil (C3a). Por defecto es C0 (D6). Una canción de un perfil tiene una sola presentación activa, así que comparar la misma canción entre condiciones exige cambios entre sesiones.
- La condición de sesión (C4) puede ser «Según cada canción» (por defecto), que usa la presentación de cada canción, o «Solo audio», que fuerza C0 en toda la sesión (DESIGN §8.2). Alternar entre ambas permite comparar C0 con C1 o C2 para la misma canción.
- La app no asigna ni aleatoriza condiciones. Cada cambio de presentación o de condición de sesión lo hace el cuidador a mano, y debe anotarse en el protocolo.

### 4.4 Orden de presentación

- DESIGN no define el orden, y la app no reordena al azar (D18). El orden de las canciones es el de la lista, que el cuidador ajusta con «Subir» y «Bajar» (C3b). «Repetir lista» (Sí por defecto) vuelve a empezar la lista al terminar.
- La secuencia de canciones y condiciones la define el investigador antes de cada sesión, fuera de la app, y la aplica el cuidador. Opciones: orden fijo igual para todos; orden aleatorio por participante, con la lista de aleatorización guardada fuera del repositorio; o contrabalanceo entre participantes. Ninguna se elige aquí.
- Riesgos a controlar con cualquier orden: fatiga, habituación a una misma canción, aprendizaje del recuerdo y repeticiones por «Repetir lista». La posición de la canción en la sesión no es un campo del registro. Se puede derivar de las marcas de tiempo, pero conviene registrarla.

### 4.5 Qué se registra (DESIGN §8.4 y §8.5)

- Eventos: inicio y fin de sesión; inicio, pausa y reanudación; fin de pista (completa o saltada); recuerdo visto; otro recuerdo; fotografía ampliada; error de audio; observación registrada.
- Resumen por reproducción: segundos escuchados, porcentaje completado, final, fotografía mostrada (sí o no), recuerdo mostrado (sí o no), familiaridad y preferencia vigentes.
- Datos de cada evento: sesión; perfil (identificador interno y código de participante); canción (identificador de catálogo); presentación y condición efectivas; origen (lista, carpeta, búsqueda o continua).
- Observaciones: una de las ocho etiquetas, canción opcional y nota libre de hasta 500 caracteres.
- Exportación: CSV desde Historial (C3a).
- «Fotografía mostrada» y «recuerdo mostrado» sirven para comprobar que lo que se vio coincide con lo asignado.

### 4.6 Amenazas del diseño actual

1. **Sin ocultación.** El cuidador asigna la condición, fija la familiaridad y la preferencia, y observa. El paciente ve la fotografía o la tarjeta de recuerdo.
2. **Volumen no registrado.** Ver la sección 3.2.
3. **Texto del recuerdo visible.** Ver la sección 1.3.
4. **Presentación por defecto.** Una canción sin revisar queda en C0 (D6). Conviene comprobar la presentación de cada canción antes de cada sesión.
5. **Sesiones partidas.** La sesión de registro se cierra al salir del modo paciente o tras 3 horas sin reproducción (DESIGN §8.2). Cambiar de modo no detiene la música (§3.3). La unidad de análisis, visita o sesión, debe fijarse en el protocolo.
6. **Errores de audio.** Tras 6 s con error, la app pasa a la siguiente pista (§8.1). Esas reproducciones se excluyen con una regla fijada antes.
7. **Registro activado por defecto** (§8.4). Puede guardar sesiones que no son del estudio.
8. **Familiaridad y preferencia.** El resumen toma los valores vigentes. Hay que confirmar si son los del inicio de la reproducción. El diseño no especifica historial de cambios. Las teclas 1 a 5 de la tabla cambian la familiaridad (DESIGN §7.4), con «Deshacer» de 10 s, lo que deja margen para pulsaciones accidentales.
9. **Código de participante opcional** (C3). Para el estudio debe ser obligatorio.
10. **Datos locales.** IndexedDB depende del navegador, y Safari puede borrar los datos de un sitio sin uso en iOS (§9; D27). La copia cifrada es el único respaldo previsto, con recordatorio cada 14 días (D26).
11. **Canciones sin conexión.** Las pistas no descargadas se deshabilitan sin internet (§8.1). Esas reproducciones no ocurren y no dejan registro. Conviene tener descargadas todas las canciones antes de cada sesión.

### 4.7 Qué decide el investigador

- Si se mantienen C0 a C2 tal como están, o si se añaden el silencio y la lista genérica que pide RESEARCH.md.
- El contraste de H4, y si las comparaciones son dentro de la misma canción o entre canciones.
- El orden de presentación y la aleatorización.
- La duración de la sesión y el temporizador de apagado (C4).
- El número de cuidadores, participantes, sesiones y canciones por condición (sección 5.7).
- Los criterios de inclusión y exclusión, y el cribado (sección 2).
- El contexto de reclutamiento: domicilio, centro de día o residencia. Los registros no lo definen.
- Quién observa, si el observador desconoce la condición, y cuándo se registran las etiquetas.
- Los textos de ausencia (DESIGN §16).
- Si el registro se activa solo en las sesiones del estudio.

### 4.8 Qué no está verificado

- No hay tamaño del efecto ni tamaño muestral para este diseño.
- Las escalas de diseño propio (familiaridad, preferencia y etiquetas) no tienen fiabilidad medida.
- No se conoce la concordancia entre cuidador y paciente sobre la familiaridad.
- El diseño no garantiza que el registro contenga lo necesario para cada análisis (volumen, evocación, elección del paciente).
- Pendientes de DESIGN §16: pruebas en tableta física; validación con cinco cuidadores y cinco pacientes, con consentimiento y tutor; verificación en iOS e iPadOS (GainNode, Wake Lock, Media Session y persistencia).
- Estas validaciones requieren aprobación ética antes de empezar (sección 6).

## 5. Análisis

### 5.1 Principios

- Antes de recoger datos hay que fijar por escrito la hipótesis, el resultado principal de cada una, los contrastes y las reglas de exclusión. Este documento no los fija.
- H1, H2 y H4 son direccionales («mayor», «facilita», «aumenta»). Antes de recoger datos, el plan debe decidir si los contrastes son unilaterales o bilaterales.
- Las reproducciones están anidadas en sesiones, y estas en participantes. El análisis debe respetar esa estructura.
- Este documento no fija niveles de significación, criterios de decisión ni cifras.

### 5.2 Descriptivo

Por condición y por participante: segundos escuchados; porcentaje completado; proporción de canciones saltadas; número de veces que se muestra la fotografía o el recuerdo; frecuencia de cada etiqueta de observación; distribución de familiaridad y preferencia; errores de audio.

### 5.3 Contrastes previstos (no ejecutados)

- **H1:** origen de la elección (personal frente a genérica) sobre la respuesta emocional, con la familiaridad como covariable.
- **H2:** C1 frente a C0 sobre la evocación. Si se incluye el silencio, silencio frente a C0 y frente a C1.
- **H3:** familiaridad (1 a 5) como predictor de la respuesta emocional, con la preferencia como covariable separada, y el origen de la elección incluido para separarla de H1.
- **H4:** C2 frente a C1 (fotografía) y/o C2 frente a C0 (fotografía y texto), según la decisión de la sección 1.5.
- **H5:** descriptivo, con el comparador por definir.

### 5.4 Modelos candidatos

- Modelos mixtos con efectos aleatorios por participante y por canción, para datos anidados. La familia del modelo depende de la escala de cada medida (continua, ordinal o binaria). Es una propuesta: no está verificada en este proyecto, y la decide el investigador con apoyo estadístico.
- Covariables candidatas: nivel cognitivo; depresión, ansiedad y apatía (dimensiones de la pista de Garrido et al.); posición en la sesión; primera pista de la sesión (arranque al 60 % con fundido); cuidador que observa.

### 5.5 Exclusiones y datos ausentes

Reglas que hay que fijar antes de ver los datos: reproducciones con error de audio; canciones no disponibles sin conexión; sesiones interrumpidas; primera pista de cada sesión (excluirla o analizarla aparte); datos de sesiones con el registro desactivado; observaciones incompletas. El tratamiento de los datos ausentes está pendiente.

### 5.6 Sensibilidad

Pendiente. Por ejemplo, repetir el análisis sin la primera pista de cada sesión, o sin las canciones sin familiaridad asignada.

### 5.7 Potencia y tamaño de muestra

**Pendiente de decisión del investigador.** No se ha calculado ni estimado un tamaño del efecto para este diseño, y ningún registro verificado da uno comparable. Los estudios citados son pequeños: 22 pacientes con Alzheimer leve en [clinica-03], 10 en [B5] y 12 en [B4] (sin confirmar). El ensayo de [clinica-04] es grande (976 residentes), pero responde a otra pregunta: la agitación en residencias frente a cuidado habitual.

### 5.8 Datos que se registran y lagunas

| Dato | Origen | Estado |
|---|---|---|
| Eventos y resumen por reproducción | Registro del estudio (DESIGN §8.4) | Previsto; sin almacén en la rama (SECURITY.md §2.1) |
| Observaciones del cuidador | DESIGN §8.5 | Previsto; fiabilidad no medida |
| Familiaridad y preferencia | Cuidador, C-5 y C-6 | Previsto; escalas de diseño propio |
| Origen de la elección (personal o genérica) | — | Falta |
| Evocación autobiográfica | — | Falta; protocolo por definir |
| Volumen y cambios de volumen | — | Falta; no está en el registro |
| Posición de la canción en la sesión | Marcas de tiempo | Derivable; no es un campo |
| Codificación y sonoridad de cada canción | Catálogo y medición (sección 3) | Por registrar como covariable |
| MoCA, MMSE, NPI, CMAI, QoL-AD | Fuera de la app | Sin lugar de almacenamiento definido |
| Depresión, ansiedad y apatía | Fuera de la app | Sin instrumento elegido |

## 6. Consideraciones éticas y de datos

### 6.1 Estado

- No hay informe del comité de ética en el repositorio. «Protocolo y aprobación ética» es un punto pendiente de la fase 6 de [ROADMAP.md](ROADMAP.md) (SECURITY.md, pendiente 2).
- Hasta tener el informe favorable no se contacta con personas ni se recogen datos de participantes, incluidas las validaciones de DESIGN §16.

### 6.2 Marco legal

El marco legal, con la verificación de cada norma, está en [SECURITY.md](SECURITY.md) §1. Aquí se recogen los puntos que afectan al diseño.

- **Datos de salud.** Las respuestas del paciente a la música y las observaciones del cuidador se tratan como datos relativos a la salud (art. 4.15 RGPD [legal-01]; SECURITY.md §1.2).
- **Base del tratamiento.** Si el estudio entra en el ámbito de la Ley 14/2007, sus tratamientos se amparan en las letras g), h), i) y j) del art. 9.2 RGPD, según la disposición adicional decimoséptima de la LOPDGDD [legal-02]. Esa disposición exige informe previo favorable del comité de ética para reutilizar datos con fines de investigación (letra c) y evaluación de impacto en los supuestos del art. 35 RGPD o de la lista de la autoridad de control (letra f). El art. 89 de la LOPDGDD no sirve como base: regula la videovigilancia en el lugar de trabajo.
- **Ámbito de la Ley 14/2007** [legal-03]. Si el estudio entra en su ámbito (arts. 1.1.a y 1.3), exige informe favorable previo del comité de ética (art. 2.e), consentimiento expreso y escrito (art. 4.1) y, para quien no puede consentir por sí mismo, representación con participación según sus capacidades (art. 4.2). Si una tarea es «procedimiento invasivo» (art. 3.t) lo valorará un jurista.
- **Personas que no pueden consentir** ([legal-03], art. 20; [legal-04]). La ley exige beneficio directo para la salud o, de forma excepcional, riesgo y carga mínimos, con comunicación al Ministerio Fiscal. La Declaración de Helsinki pide el consentimiento del representante legal que considere las preferencias y los valores de la persona, el asentimiento cuando pueda darlo y el respeto a su disidencia. La terminología de la ley («incapacitación») está pendiente de revisión jurídica (SECURITY.md, pendiente 6).
- **Grabaciones como estímulo** [legal-05]. Los plazos de protección dependen de la fecha de grabación, de la publicación lícita y del cómputo desde el 1 de enero siguiente. Hasta tener dictamen, los estímulos son solo canciones con licencia declarada en el catálogo (ADR-0002, ADR-0005). Una licencia declarada no sustituye ese dictamen (SECURITY.md, pendientes 4 y 5).
- **Minería de textos** [legal-06]. Solo afecta a la revisión sistemática, si se usa minería de textos. La excepción aplicable depende de si el organismo es de investigación (art. 2.1). Requiere dictamen (SECURITY.md, pendiente 9).

### 6.3 Consentimiento, representación y tutor

- Cada participante con capacidad da un consentimiento informado, expreso y escrito. Si no puede consentir, consiente su representante legal, y se recoge su asentimiento cuando puede darlo.
- DESIGN §16 menciona «consentimiento y tutor», pero no define el papel del tutor. Hay que aclararlo con el comité.
- El texto del registro (DESIGN §8.4: «Se guardan eventos de escucha en este navegador para el estudio. No se usan nombres reales.») informa de lo que se guarda, pero no es un consentimiento informado. Su revisión está pendiente (DESIGN §16).
- El cuidador también participa. Su papel de observador y su posible sesgo deben figurar en el consentimiento.
- El registro, activado por defecto, debe activarse solo en las sesiones del estudio y con consentimiento.

### 6.4 Seudonimización

- El registro guarda el identificador interno y el código de participante, no el alias ni el nombre (DESIGN §8.4). Hay que comprobar que la exportación CSV tampoco los incluya (SECURITY.md, R8).
- Para el estudio, el código debe ser obligatorio y no derivarse de datos identificables. Un alias con nombre real identifica a la persona, por eso se recomienda no usarlos (SECURITY.md §2.3).
- La relación entre código y persona se guarda aparte de los datos, como corresponde a la seudonimización (art. 4.5 RGPD [legal-01]).
- Los recuerdos y las fotografías contienen datos de la familia y de terceros. No se versionan (CLAUDE.md), y su uso requiere revisión del comité.

### 6.5 Datos fuera del repositorio

CLAUDE.md prohíbe datos personales de pacientes en el repositorio. No se versionan las exportaciones CSV, las observaciones, los textos de recuerdos, las fotografías, las escalas completadas, la clave de seudonimización ni las listas de aleatorización con identidades (SECURITY.md §2.2). Los datos del estudio van a una carpeta fuera del repositorio. Hoy research-data/ solo contiene datos de compresión.

### 6.6 Seguridad y copia

- Los datos se guardan en el navegador del cuidador (IndexedDB), en la copia cifrada y, para el audio sin conexión, en Cache Storage (DESIGN §9; SECURITY.md §2.1).
- La copia cifrada usa AES-GCM de 256 bits, con clave derivada de la contraseña por PBKDF2-SHA-256 (600 000 iteraciones). Sin contraseña no hay recuperación. No incluye el hash del PIN ni el audio (SECURITY.md §3.2).
- El PIN evita salidas accidentales del modo paciente y no protege los datos frente a un dispositivo desbloqueado (SECURITY.md §3.3; R5). Los registros no se cifran en reposo, y esa decisión está pendiente (SECURITY.md, pendiente 21).
- La vista previa de importación cuenta «1204 eventos» (DESIGN §9), pero la lista de contenidos de la copia no menciona el registro del estudio. Hay que aclararlo antes del piloto.
- Las fotografías deben reducirse y perder sus metadatos de ubicación antes de guardarse (DESIGN §9). La rama todavía no lo hace (SECURITY.md, R6).

### 6.7 Retención, publicación y riesgos

- La retención y la destrucción de los datos están pendientes.
- Los resultados se publican en agregado. Los resultados identificables solo se publican con consentimiento previo y expreso (art. 5.5 de la Ley 14/2007, si aplica).
- Riesgos: el contenido de los recuerdos puede revelar información familiar sensible; las etiquetas de observación no son diagnósticos y no deben leerse como tales; el cuidador debe saber qué se registra.

## 7. Pendientes

### 7.1 Decisiones del investigador

1. Definición operativa de respuesta emocional y de evocación autobiográfica, con su protocolo de codificación.
2. Cómo se registra la elección del paciente y cómo se construye la lista genérica (criterio y control).
3. Incluir el silencio y la lista genérica como condiciones, o justificar su ausencia (RESEARCH.md frente a DESIGN §8.3).
4. Contraste de H4: C2 frente a C1 o frente a C0.
5. Orden de presentación y aleatorización; lista de aleatorización fuera del repositorio.
6. Si el texto del recuerdo y la fotografía se ocultan durante la medición de evocación, y cuándo aparece la fotografía.
7. Normas para redactar los recuerdos y elegir las fotografías.
8. Registro del volumen y de sus cambios, o fijación del volumen.
9. Valor objetivo de la normalización, y activación solo tras medir su efecto.
10. Quién observa, si lo hace a ciegas, y cuándo se registran las etiquetas.
11. Duración de la sesión, temporizador y unidad de análisis.
12. Periodo entre medidas y versión de NPI, CMAI y QoL-AD.
13. Criterios de inclusión y exclusión, cribado (MoCA o MMSE) y umbral de MMSE mayor de 10 para QoL-AD.
14. Validación y forma de administración de la familiaridad y la preferencia.
15. Comparador de H5, medidas de usabilidad y escala de facilidad.
16. Potencia, tamaño muestral, nivel de significación y control de multiplicidad, con apoyo estadístico.
17. Reglas de exclusión y tratamiento de los datos ausentes.
18. Reclutamiento: domicilio, centro de día o residencia.
19. Código de participante obligatorio y custodia de la clave de seudonimización.
20. Lugar de almacenamiento de las escalas de referencia, fuera de la app.
21. Si el registro se activa solo en las sesiones del estudio, y su texto de consentimiento.
22. Si el piloto incluye pruebas perceptuales con personas (MUSHRA), dado el Plan v2 de ROADMAP.md.
23. Documentar en un ADR las decisiones de viabilidad científica (CLAUDE.md).

### 7.2 Verificación pendiente (no citar hasta resolver)

- [audio-04]: leer la versión IEEE de Valin et al. 2010.
- [audio-05]: leer el artículo de Hu y Loizou 2008 para las conclusiones sobre SNR segmental y PESQ. La fuente de Quackenbush, Barnwell y Clements (1988) no está verificada. El LSD no aparece en lo verificado.
- [audio-06]: leer el texto de Gray y Markel 1976 para la fórmula exacta. Su validez para música no está verificada.
- [audio-02]: título y editor de EBU R 128 (V5), desde el PDF oficial.
- [escalas-01]: el DOI de Arjol et al. 2026 en Psicothema (10.70478/psicothema.2026.38.15) consta en Crossref y PubMed (consulta del 2-nov-2026). Siguen pendientes el volumen y las páginas del metaanálisis (PMID 42380691).
- [escalas-02]: leer el texto de Folstein et al. 1975 (PMID 1202204, sin resumen) antes de citar su contenido.
- [escalas-03]: periodo de referencia y versión del NPI, según el texto del instrumento.
- [escalas-04]: el artículo de validación del IAACM no está verificado. El texto completo de Cohen-Mansfield et al. 1989 no se ha leído.
- [escalas-05]: Logsdon et al. 1999 (*J Ment Health Aging* 5:21-32) no está en PubMed ni en Crossref.
- [escalas-06]: el DOI de Gómez-Gallego et al. 2012 (10.1016/j.nrl.2011.03.006) consta en Crossref y PubMed (consulta del 2-nov-2026).
- [B4]: n = 12 y diseño, con discrepancia respecto a [clinica-03]. Leer el texto completo.
- [clinica-03]: resuelto (2-nov-2026). La página de Cambridge Core lista cinco autores, como PubMed y Europe PMC; «Brodaty H», solo en Crossref, no se cita.
- [clinica-05]: el resumen no indica el tamaño muestral. El manuscrito aceptado en PMC (PMC2914108) da 13 pacientes y 14 controles reclutados; resuelto con reservas, porque la versión publicada no se ha leído.
- [clinica-04]: la frase sobre barreras consta en el resumen de PubMed (resuelto el 2-nov-2026). La conclusión sobre la práctica real sigue siendo inferencia del proyecto y no se cita como resultado.
- Autores de las pistas (Garrido, Baird, Cheung, Hillebrand y MATCH 2025): resuelto el 2-nov-2026 desde PubMed o Crossref.
- [clinica-04]: resuelto el 2-nov-2026. PubMed (PMID 40148224) da el título «A Randomized Controlled Feasibility Study»; se cita como estudio aleatorizado de viabilidad.
- [clinica-01]: no consta verificado si la revisión separa la música personal de la genérica, que es la comparación que necesita H1.
- [escalas-01]: resuelto el 2-nov-2026. El resumen de PubMed describe una muestra comunitaria sin deterioro cognitivo, evaluada en centros de atención primaria; las dos descripciones son compatibles.

### 7.3 Dictámenes y consultas

Véase [SECURITY.md](SECURITY.md) §5, pendientes 1 a 9: evaluación de impacto, comité de ética, consentimiento, licencias del catálogo, plazos de grabaciones, terminología de la capacidad, clasificación de tareas según el art. 3.t, traducción de Helsinki y minería de textos. Además, el dictamen sobre audio (ROADMAP.md, fase 0; ADR-0002).

### 7.4 Implementación

Véase [SECURITY.md](SECURITY.md) §5, pendientes 10 a 14: conexión de la interfaz del cuidador, persistencia, fotografías, PIN y registro del estudio.

## 8. Discrepancias con otros documentos del repositorio

Este documento no modifica estos ficheros. Cada punto necesita corrección o una decisión del investigador.

- **[RESEARCH.md](RESEARCH.md)**: las correcciones de las verificaciones ([B1], [B2], [B4], [B5] y [B6]) están aplicadas desde el 2 de noviembre de 2026. La antigua «Réplica en 2015» no era una réplica de B4: es otro estudio ([clinica-03]).
- **RESEARCH.md**, sección 5: pide comparar «música personalizada, lista genérica, silencio y, si se contrasta H4, con y sin fotografía». DESIGN §8.3 no incluye silencio ni lista genérica.
- **DESIGN.md**, §1: declara que la interfaz permite evaluar familiaridad, recuerdos y fotografía (H3, H2 y H4). No define la comparación de H1.
- **DESIGN.md**, §9 y P-16, frente a **SECURITY.md** §3.3: el bloqueo del PIN es de 60 s en §9 y en P-16 (corregido el 2026-11-02), y el código acepta de 4 a 6 dígitos. SECURITY.md §2.1 señala además que DESIGN fija 10 MB en C-22 y el código 8 MB.
- **ROADMAP.md**, línea 38 (Plan v2: «sin pruebas perceptuales con personas» en compresión), frente a **docs/audio-processing/COMPRESSION.md**, «Próximos pasos» (prueba MUSHRA).
- **docs/audio-processing/COMPRESSION.md**, líneas 264, 265 y 274: ya coinciden con la bibliografía (BS.1534-3, RFC 6716 en Standards Track y Gray y Markel registrado en Crossref). No queda discrepancia en esas líneas.
- **[BIBLIOGRAPHY.md](BIBLIOGRAPHY.md)**, apartado «Documentos de uso»: dice que ALZHEIMER_RESEARCH, METHODOLOGY y SECURITY existían «en el worktree (sin commit)». Corregido: están en `main` desde el commit 0d8b004.
- **[ALZHEIMER_RESEARCH.md](ALZHEIMER_RESEARCH.md)** (borrador): agrupa las mismas referencias en categorías sin numerar, coherentes con los niveles de RESEARCH.md. Si cambia la numeración de RESEARCH.md, hay que revisar también ese documento.

## 9. Identificadores usados

| Identificador | Referencia abreviada | Estado | Uso en este documento |
|---|---|---|---|
| [clinica-01] (= B1-2025) | Cochrane 2025, van der Steen et al. | Parcial, con corrección de DOI | H1; contexto de agitación y respuesta emocional |
| [clinica-02] | Kaiser y Berntsen 2023 | Verificada | H2 a H4; pistas de Garrido et al. 2018 y Baird et al. 2018 |
| [clinica-03] (= B6) | El Haj et al. 2015 | Verificada con correcciones (autores) | H1 y H2 |
| [clinica-04] | McCreedy et al. 2022 | Parcial, con corrección de DOI | H1 y H5; pistas de Cheung 2025, Hillebrand 2023 y MATCH 2025 |
| [clinica-05] (= P2) | Simmons-Stern et al. 2010 | Verificada | H2, antecedente indirecto |
| [clinica-06] (= B2) | Jacobsen et al. 2015 | Verificada, con la corrección terminológica de B2 | H2, mecanismo |
| [escalas-01] | Arjol et al. 2026 (MoCA) | Verificada | Instrumentos |
| [escalas-02] | Lobo et al. 1999 (MEC-30) | Verificada | Instrumentos |
| [escalas-03] | Cummings et al. 1994 (NPI) | Verificada | Instrumentos |
| [escalas-04] | Cohen-Mansfield et al. 1989 (CMAI) | Verificada | Instrumentos |
| [escalas-05] | Logsdon et al. 2002 (QoL-AD) | Parcial, con corrección aplicada | Instrumentos |
| [escalas-06] | León-Salas et al. 2011 (QoL-AD en español) | Verificada | Instrumentos |
| [audio-01] (= P4) | UIT-R BS.1534-3 (MUSHRA) | Verificada | Medidas de audio |
| [audio-02] | UIT-R BS.1770-5 | Verificada, con la corrección de unidades | Medidas de audio |
| [audio-03] | RFC 6716 y RFC 8251 | Verificada | Medidas de audio |
| [audio-04] | Valin et al. 2010 | Parcial | No citado: pendiente |
| [audio-05] | Hu y Loizou 2008 | Parcial | Solo lo confirmado |
| [audio-06] | Gray y Markel 1976 | Verificada | Referencia general de medidas de distancia |
| [legal-01] | RGPD | Parcial, con título corregido | Ética y datos |
| [legal-02] | LOPDGDD, disposición adicional decimoséptima | Verificada con correcciones; queda el dictamen | Ética y datos |
| [legal-03] | Ley 14/2007 | Verificada | Ética y datos |
| [legal-04] | Declaración de Helsinki de la WMA (2024), en inglés | Verificada | Ética y consentimiento |
| [legal-05] | TRLPI, arts. 112 y 114-119 | Verificada con correcciones | Estímulos |
| [legal-06] | Directiva (UE) 2019/790 | Parcial | Solo revisión sistemática |
| B1 | Cochrane 2018 | Verificada con correcciones | H1, contexto |
| B2 | Equivale a [clinica-06] | Verificada con correcciones | H2 |
| B3 | Baird y Samson 2009 | Verificada | H2 y H3 |
| B4 | El Haj, Postal y Allain 2012 | Verificada según el registro de existentes; discrepancia abierta | H2; n = 12 sin confirmar |
| B5 | Irish et al. 2006 | Verificada con correcciones | H1 y H2 |
| B6 | Equivale a [clinica-03] | Verificada con correcciones | H1 y H2 |
| P1 | Cuddy y Duffin 2005 | Verificada con correcciones | Hipótesis y caso único; no es evidencia |
| P2 | Equivale a [clinica-05] | Verificada con correcciones | H2 |
| P3 | Matziorinis y Koelsch 2022 | Verificada con correcciones | Revisión narrativa |
| P4 | Equivale a [audio-01] | Verificada con correcciones | Medidas de audio |
