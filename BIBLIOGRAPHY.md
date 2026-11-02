# Bibliografía verificada

Fecha de la última verificación: 2026-11-02. Sustituye a la versión del 2026-10-31.

Solo se listan publicaciones, normas y fuentes oficiales cuya existencia se ha comprobado en registros o textos oficiales (Crossref, PubMed, Europe PMC, BOE, UIT, RFC Editor, WMA, NICE). Sus afirmaciones se citan en la medida en que se contrastaron; lo que queda sin confirmar aparece como parcial o en Pendientes. Los datos proceden de cinco registros de verificación: verificadas-clinica, verificadas-escalas, verificadas-audio, verificadas-legal y verificadas-existentes. Ninguna entrada demuestra un efecto de la música: son fuentes sobre el estado del conocimiento y sobre el marco metodológico y legal del proyecto.

## Método de verificación

### Significado de los estados

- **verificada**: la existencia se comprobó en Crossref, PubMed o la fuente oficial, y la afirmación se contrastó con el resumen o el texto oficial. Se cita tal cual.
- **verificada con correcciones**: igual, pero el registro candidato tenía errores (autores, DOI, unidades, títulos o fechas). Se cita con las correcciones aplicadas.
- **parcial**: la existencia está confirmada, pero algún dato o afirmación no. Se cita el registro corregido y solo las afirmaciones confirmadas; el resto va a Pendientes.
- **no verificada**: no se cita. Va a Pendientes.

Si dos identificadores describen la misma obra, la entrada los reúne y muestra el estado de cada uno.

### Cómo se comprobó

- **Existencia**: DOI en Crossref; PMID en PubMed y Europe PMC. Para normas: texto del BOE (XML y versión consolidada), PDF oficial de la UIT, RFC Editor, página de la WMA y páginas de NICE.
- **Afirmaciones**: contraste con el resumen registrado (PubMed; OpenAlex cuando PubMed no tiene resumen) o con el texto oficial de la norma. Salvo que se indique otra cosa, la comprobación se hizo sobre resumen o registro, no sobre el texto completo.
- **Accesos no disponibles** (consulta del 2-nov-2026, salvo indicación): IEEE Xplore sin contenido, con HTTP 202 para el DOI de Valin et al. 2010 ([audio-04], [audio-05]); Cochrane Library HTTP 419 y Wiley HTTP 403 con desafío de navegador ([B1], [clinica-01]); Taylor & Francis HTTP 403 ([B4]); Elsevier/ScienceDirect devuelve solo una página de redirección sin texto ([escalas-02], [clinica-05]); Oxford Academic HTTP 403 ([escalas-04]); EUR-Lex HTTP 202 en la verificación anterior ([legal-01]); página de la AES bloqueada (Feiten et al. 2009). Cambridge Core sí responde con la página del artículo ([clinica-03]). PubMed Central no devuelve el texto completo de la revisión de Cochrane de 2025.
- **Semillas**: las referencias de partida que no se pudieron comprobar no se usan. La semilla BOE-A-2007-12639 no es la Ley 14/2007 (es una resolución sobre un convenio del Ministerio de Agricultura, Pesca y Alimentación): se descarta y se cita BOE-A-2007-12945 ([legal-03]). Las semillas sin versión (BS.1534, BS.1770) se citan con la versión vigente ([audio-01], [audio-02]).
- **Pistas**: las referencias verificadas que aparecen dentro de un registro, sin identificador propio, se describen en la entrada que las menciona, con la etiqueta «pista».

### Documentos de uso

ALZHEIMER_RESEARCH.md, METHODOLOGY.md y SECURITY.md existen en el worktree (sin commit). En «Uso» de cada entrada constan el documento y la sección donde aparece el identificador, según la comprobación del 2 de noviembre de 2026. El uso en docs/audio-processing/COMPRESSION.md, fuera de esta revisión, se indica con su línea.

## Clínica

### 1. [clinica-01] [B1-2025]: Cochrane 2025, actualización de la revisión sobre música en demencia

- **Cita:** van der Steen JT, van der Wouden JC, Methley AM, Smaling HJA, Vink AC, Bruinsma MS. Music-based therapeutic interventions for people with dementia. Cochrane Database of Systematic Reviews 2025, Issue 3, CD003477. DOI 10.1002/14651858.CD003477.pub5 (PMID 40049590; publicado el 7-mar-2025).
- **Estado:** [clinica-01] parcial; [B1-2025] verificada con correcciones. Con las correcciones, la cita queda completa.
- **Correcciones aplicadas:** se elimina la frase «PubMed muestra por error el DOI terminado en .pub2». PubMed y Crossref dan .pub5; el .pub2 solo aparece en la lista de referencias del XML.
- **Datos (resumen de PubMed; 30 estudios, 1.720 participantes):** frente a cuidado habitual, síntomas depresivos DME −0,23 (certeza moderada) y agitación o agresión DME −0,05 (certeza moderada; probablemente no mejora). Frente a otras actividades, depresión DME −0,14 y agitación DME 0,01 (certeza baja, sin efecto). Frente a cuidado habitual no hay mejora demostrada del bienestar emocional (DME 0,14), la ansiedad (DME −0,15) ni la cognición (DME 0,19; certeza baja o muy baja). La versión de 2018 sí señalaba mejoras de bienestar y ansiedad, con calidad baja.
- **Pista (sin identificador propio):** Gaviola MA, Inder KJ, Dilworth S, Holliday EG, Higgins I. Impact of individualised music listening intervention on persons with dementia: A systematic review of randomised controlled trials. Australas J Ageing 2020; 39(1): 10–20. DOI 10.1111/ajag.12642 (PMID 30912616; PubMed, marzo de 2020; Crossref, publicación en línea el 26-mar-2019). Revisión de 4 ensayos de escucha individualizada, con efecto positivo sobre síntomas conductuales y psicológicos y evidencia limitada en otros resultados. Autores según PubMed (consulta del 2-nov-2026).
- **Uso:** RESEARCH.md (resumen; §1.1; §1.4; §1.5; §2, H1; §3; §4.1; §7); ALZHEIMER_RESEARCH.md (§2.4; §3.1; §3.3; §5.2; §5.3; §6); METHODOLOGY.md (§0; §1.2; §1.4; §9); SECURITY.md (§0). «Citar la versión» en RESEARCH.md está sustituido por esta cita.
- **Hipótesis:** H1 (en contra para la agitación y en general; el resumen de PubMed, consultado el 2-nov-2026, no separa la música personal de la genérica, y el texto completo no es accesible; ver Pendientes, 28); H3 (marco).

### 2. [B1]: Cochrane 2018

- **Cita:** van der Steen JT, Smaling HJA, van der Wouden JC, Bruinsma MS, Scholten RJPM, Vink AC. Music-based therapeutic interventions for people with dementia. Cochrane Database of Systematic Reviews 2018, Issue 7, CD003477. DOI 10.1002/14651858.CD003477.pub4 (PMID 30033623; publicado en línea el 23-jul-2018).
- **Estado:** verificada con correcciones.
- **Correcciones:** la entrada es correcta; mantener el DOI pub4 para citar los datos de 2018. Las iniciales «HJA» y «RJPM» coinciden con Crossref (consulta del 2-nov-2026); PubMed las abrevia («HJ» y «RJ»). Aplicado en RESEARCH.md (§1.1): dos viñetas. En cognición: «evidencia de baja calidad de poco o ningún efecto sobre la cognición (2018)». En emoción: la actualización de 2025 no confirma la mejora del bienestar ni de la ansiedad que la revisión de 2018 señalaba con calidad baja.
- **Datos de 2018 (frente a atención habitual u otras actividades, al final del tratamiento):** cognición DME 0,15 (IC95% −0,06 a 0,36; 7 estudios, 350 participantes), calidad baja; bienestar emocional DME 0,32 y ansiedad DME −0,43, calidad baja; síntomas depresivos DME −0,27 y problemas conductuales globales DME −0,23, certeza moderada; agitación o agresión DME −0,07, sin reducción.
- **Uso:** RESEARCH.md (§1.1; §1.5; §3; §4.1; §7); ALZHEIMER_RESEARCH.md (§3.1; §6); METHODOLOGY.md (§0; §1.2; §8; §9). La frase de RESEARCH.md que estaba incompleta («evidencia de baja calidad sobre la cognición») está corregida.
- **Hipótesis:** H1 (contexto de la revisión anterior).

### 3. [clinica-02]: Kaiser y Berntsen 2023, revisión sobre recuerdos evocados por música

- **Cita:** Kaiser AP, Berntsen D. The cognitive characteristics of music-evoked autobiographical memories: Evidence from a systematic review of clinical investigations. WIREs Cognitive Science 2023; 14(3): e1627. DOI 10.1002/wcs.1627 (PMID 36223919; publicado en línea el 12-oct-2022).
- **Estado:** verificada. Sin correcciones.
- **Datos:** revisión de 15 estudios clínicos (Alzheimer, demencia frontotemporal conductual, daño cerebral adquirido y depresión). La música evoca recuerdos autobiográficos en estas poblaciones, con más probabilidad si la música es familiar. En Alzheimer, los recuerdos evocados por música tienen una ventaja relativa frente a los evocados por fotografías (comparado con controles). Conclusión de los autores: están «relatively well preserved, especially in AD».
- **Pistas (sin identificador propio):** Baird A, Brancatisano O, Gelding R, Thompson WF. Characterization of Music and Photograph Evoked Autobiographical Memories in People with Alzheimer's Disease. J Alzheimers Dis 2018; 66(2): 693–706. DOI 10.3233/JAD-180627 (PMID 30320586; DOI confirmado en Crossref y PubMed, consulta del 2-nov-2026): 10 pacientes con Alzheimer y 10 controles; en Alzheimer no difiere la frecuencia de recuerdos evocados por música y por fotos. Garrido S, Stevens CJ, Chang E, Dunne L, Perz J. Music and Dementia: Individual Differences in Response to Personalized Playlists. J Alzheimers Dis 2018; 64(3): 933–941. DOI 10.3233/JAD-180084 (PMID 29966193; DOI confirmado en Crossref y PubMed, consulta del 2-nov-2026): 99 personas con demencia escuchan tres listas basadas en preferencias personales. El resumen comunica resultados sobre la depresión (con depresión alta y síntomas de tipo Alzheimer, más tristeza al escuchar), sobre la apatía (con depresión baja y apatía alta, más placer conductual, que disminuye con la gravedad del deterioro cognitivo) y sobre el deterioro cognitivo. No comunica ningún resultado sobre la ansiedad, aunque esta figura entre los factores del diseño: no debe citarse como resultado. No consta verificado si separa familiaridad de preferencia; el resumen no lo menciona (ver Pendientes, 29).
- **Uso:** RESEARCH.md (resumen; §1.2; §1.5; §2, H1–H4; §4.1; §6; §7); ALZHEIMER_RESEARCH.md (Niveles; §1.1; §1.5; §5.3; §6); METHODOLOGY.md (§0; §1.3; §1.4; §1.5; §8; §9).
- **Hipótesis:** H2 (directo: evocación con música familiar y asociada); H3 (la familiaridad facilita la evocación; no mide respuesta emocional); H4 (indirecto; en contra de que la fotografía supere a la música en Alzheimer).

### 4. [clinica-03] [B6]: El Haj et al. 2015, memorias autodefinitorias con música

- **Cita:** El Haj M, Antoine P, Nandrino JL, Gély-Nargeot MC, Raffard S. Self-defining memories during exposure to music in Alzheimer's disease. International Psychogeriatrics 2015; 27(10): 1719–1730. DOI 10.1017/S1041610215000812 (PMID 26018841; publicación en línea el 28-may-2015).
- **Estado:** [clinica-03] verificada con correcciones; [B6] verificada con correcciones.
- **Correcciones:** autores: cinco. Se quita «Brodaty H»: la página del artículo en la revista (Cambridge Core, consultada el 2-nov-2026), PubMed y Europe PMC listan cinco autores (El Haj M, Antoine P, Nandrino JL, Gély-Nargeot MC, Raffard S); Crossref añade a Henry Brodaty, que no figura en la página de la revista (ver Pendientes, 9).
- **Diseño y datos (resumen de PubMed):** 22 pacientes con Alzheimer leve y 24 controles; tres condiciones (silencio, música del investigador y música elegida por el paciente). En Alzheimer, mejor recuerdo autobiográfico y más memorias autodefinitorias con música elegida; los controles no muestran ese beneficio. Mide recuerdo, no respuesta emocional.
- **Uso:** RESEARCH.md (resumen; §1.2; §1.5; §2, H1–H3; §4.1; §6; §7); ALZHEIMER_RESEARCH.md (Niveles; §1.4; §1.5; §5.2; §6); METHODOLOGY.md (§0; §1.3; §5.7; §7.2; §8; §9). Corrección aplicada: «Réplica en 2015» pasa a «Estudio de 2015 (22 pacientes con Alzheimer leve y 24 controles)», con memorias autodefinitorias. No es una réplica directa de [B4]: tiene otro resultado, otra muestra y grupo control.
- **Hipótesis** (valoración del candidato, no del artículo): H1 (directo, con matiz: mide recuerdo, no respuesta emocional); H2 (música propia frente a silencio); H3 (no separa familiaridad de elección).

### 5. [B4]: El Haj, Postal y Allain 2012, música y memoria autobiográfica

- **Cita:** El Haj M, Postal V, Allain P. Music enhances autobiographical memory in mild Alzheimer's disease. Educational Gerontology 2012; 38(1): 30–41. DOI 10.1080/03601277.2010.515897 (publicación en línea el 17-nov-2011 y edición impresa de enero de 2012, según Crossref; no aparece en PubMed ni en Europe PMC).
- **Estado:** verificada (según verificadas-existentes), con discrepancia abierta. Crossref confirma título, autores (El Haj M, Postal V, Allain P), volumen 38(1) y páginas 30–41 (consulta del 2-nov-2026); el n = 12 y el diseño siguen procediendo solo de OpenAlex.
- **Datos (resumen de OpenAlex):** medidas repetidas con 12 pacientes con Alzheimer leve; recuerdo autobiográfico en silencio, tras The Four Seasons de Vivaldi (música fija) y tras música elegida por el propio paciente. Más recuerdo con música elegida que con The Four Seasons, y más con ambas que en silencio.
- **Discrepancia abierta:** [clinica-03] indica que no hay resumen accesible, que el n = 12 y el diseño no se pudieron comprobar y que el diseño no debe atribuirse a [B4] sin leer el texto. Ver Pendientes.
- **Correcciones (aplicadas en RESEARCH.md, §1.2 y §2):** «música del investigador» se sustituye por «The Four Seasons de Vivaldi (música fija)», que es el comparador real del estudio.
- **Uso:** RESEARCH.md (resumen; §1.2; §2, H1–H2; §3; §4.1; §6; §7); ALZHEIMER_RESEARCH.md (Niveles; §1.4; §1.5; §5.2; §6); METHODOLOGY.md (§0; §1.3; §5.7; §7.2; §8; §9).
- **Hipótesis:** H2 (memoria autobiográfica frente a silencio y frente a música fija). Comparar música elegida con música fija se relaciona con H1 solo de forma indirecta, porque mide recuerdo y no respuesta emocional.

### 6. [B5]: Irish et al. 2006, efecto de la música sobre el recuerdo autobiográfico

- **Cita:** Irish M, Cunningham CJ, Walsh JB, Coakley D, Lawlor BA, Robertson IH, Coen RF. Investigating the enhancing effect of music on autobiographical memory in mild Alzheimer's disease. Dementia and Geriatric Cognitive Disorders 2006; 22(1): 108–120. DOI 10.1159/000093487 (PMID 16717466; publicación en línea el 23-may-2006).
- **Estado:** verificada con correcciones.
- **Correcciones:** se añade el DOI 10.1159/000093487 (antes solo figuraba PubMed 16717466). Tamaño muestral según el resumen: 10 pacientes con Alzheimer leve (MMSE > 17/30) y 10 controles sanos emparejados. Queda resuelta la nota de «tamaño indirecto».
- **Datos (resumen de PubMed):** medidas repetidas; condición de música (el movimiento «Primavera» de Las cuatro estaciones de Vivaldi) frente a silencio. Mejora notable del recuerdo autobiográfico con música en los pacientes (interacción condición × grupo, p < 0,005) y reducción de la ansiedad estado con música (p < 0,001). Sin diferencias en respuesta galvánica de la piel ni en errores atencionales.
- **Confirmación cruzada:** [clinica-03] confirma los mismos datos del resumen (10 pacientes y 10 controles; mejor recuerdo con música en Alzheimer).
- **Uso:** RESEARCH.md (resumen; §1.2; §1.5; §2, H2; §3; §7); ALZHEIMER_RESEARCH.md (Niveles; §1.1; §6); METHODOLOGY.md (§0; §1.2; §1.3; §5.7; §8; §9). Corrección aplicada: la música fue un único fragmento de Vivaldi, no música elegida por el paciente.
- **Hipótesis:** H2 (música frente a silencio; no compara música propia).

### 7. [clinica-04]: McCreedy et al. 2022, ensayo pragmático de música personalizada en residencias

- **Cita:** McCreedy EM, Sisti A, Gutman R, Dionne L, Rudolph JL, Baier R, Thomas KS, Olson MB, Zediker EE, Uth R, Shield RR, Mor V. Pragmatic Trial of Personalized Music for Agitation and Antipsychotic Use in Nursing Home Residents With Dementia. Journal of the American Medical Directors Association 2022; 23(7): 1171–1177. DOI 10.1016/j.jamda.2021.12.030 (PMID 35038407). Doce autores, según PubMed (consulta del 2-nov-2026).
- **Estado:** parcial (falta el título completo del NICE NG97 en la pista; ver Pendientes, 20).
- **Correcciones:** se elimina «PubMed indica otro DOI por error». PubMed muestra el mismo DOI en ArticleIdList y en ELocationID.
- **Diseño y datos (resumen de PubMed):** ensayo controlado aleatorizado por conglomerados y pragmático; 54 residencias (27 y 27) y 976 residentes con demencia (483 y 493). La música personalizada no redujo de forma significativa la agitación medida con el CMAI frente al cuidado habitual (AME 1,33; IC95% −1,37 a 4,03), ni el uso de psicótropos. El cuidado habitual podía incluir música ambiental o grupal.
- **Conclusión de los autores (resumen de PubMed, consulta del 2-nov-2026):** «Personalized music was not significantly effective in reducing agitated behaviors or psychotropic drug use among long-stay residents with dementia»; entre las barreras de implantación, «engaging frontline nursing staff and identifying resident's preferred music». **Inferencia del candidato (no es un resultado del ensayo):** que la música elegida por el paciente no mejora la agitación fuera del ensayo. No se cita como hallazgo.
- **Pistas (sin identificador propio):** Cheung DSK, Tse HYJ, Lee PH, Ho KHM, Bai X, Lai CKY. Individualized Music Playlist Based on Iso-Principle for De-Escalating Agitation of People With Dementia: A Randomized Controlled Feasibility Study. Int J Geriatr Psychiatry 2025; 40(4): e70070. DOI 10.1002/gps.70070 (PMID 40148224; consulta del 2-nov-2026). Estudio aleatorizado de viabilidad con 24 participantes reclutados; la playlist individualizada no fue más eficaz que un audio de lectura de libro como control, ni para la agitación ni para otros síntomas conductuales. Hillebrand MC, Weise L, Wilz G. Immediate effects of individualized music listening on behavioral and psychological symptoms of dementia: A randomized controlled trial. Int J Geriatr Psychiatry 2023; 38(3): e5893. DOI 10.1002/gps.5893. 90 residentes con demencia (44 y 46); menos síntomas conductuales solo durante la sesión (Crossref, consulta del 2-nov-2026). Raglio A, Bellandi D, Baiardi P, Gianotti M, Ubezio MC, Zanacchi E, Granieri E, Imbriani M, Stramba-Badiale M. Effect of Active Music Therapy and Individualized Listening to Music on Dementia: A Multicenter Randomized Controlled Trial. J Am Geriatr Soc 2015; 63(8): 1534–1539. DOI 10.1111/jgs.13558. 120 participantes; sin diferencias significativas entre grupos en la evaluación conductual (resumen de Crossref, consulta del 2-nov-2026). Thompson Z, Vieira Sousa T, Vidas D, Tamplin J, Waycott J, Stretton-Smith P, McMahon K, Carrasco R, Woodward-Kron R, Flynn L, Lampit A, Lamb KE, Braat S, Lautenschlager NT, Baker FA. Music attuned technology care via eHealth (MATCH): A proof-of-concept study for community-dwelling people living with dementia and caregivers. Digit Health 2025; 11. DOI 10.1177/20552076251379768 (PMID 41041461). 13 diadas en un estudio pre-post sin grupo control; SUS mediana 73,5 (usabilidad). NICE NG97 (publicada el 20-jun-2018): recomendación 1.7.2, «offer psychosocial and environmental interventions to reduce distress in people living with dementia»; la página de recomendaciones no contiene la palabra «music» (comprobado el 2-nov-2026).
- **Uso:** RESEARCH.md (resumen; §1.4; §1.5; §2, H1 y H5; §4.1; §6; §7); ALZHEIMER_RESEARCH.md (Niveles; §2.3; §2.4; §5.2; §5.3; §6); METHODOLOGY.md (§0; §1.2; §1.6; §5.7; §7.2; §9).
- **Hipótesis:** H1 (en contra para la agitación: no respalda la superioridad de la música personal frente al cuidado habitual; mide agitación, no respuesta emocional); H5 (indirecto; la frase del propio ensayo sobre barreras, implicar al personal de enfermería e identificar la música preferida, consta en el resumen de PubMed, consultado el 2-nov-2026).

### 8. [clinica-05] [P2]: Simmons-Stern, Budson y Ally 2010, música y codificación de letras

- **Cita:** Simmons-Stern NR, Budson AE, Ally BA. Music as a memory enhancer in patients with Alzheimer's disease. Neuropsychologia 2010; 48(10): 3164–3167. DOI 10.1016/j.neuropsychologia.2010.04.033 (PMID 20452365; publicación en línea el 7-may-2010).
- **Estado:** [clinica-05] verificada; [P2] verificada con correcciones.
- **Correcciones:** si se cita, precisar que mide reconocimiento de letras, no recuerdo autobiográfico.
- **Datos (resumen):** letras de canciones infantiles desconocidas, presentadas con estímulos visuales y acompañadas de grabación cantada o hablada. En Alzheimer, el reconocimiento es mejor con las letras cantadas; en los controles no hay diferencia. El resumen no indica el tamaño muestral. El manuscrito aceptado en PMC (PMC2914108; consulta del 2-nov-2026) indica 13 pacientes con Alzheimer y 14 controles reclutados; se excluyeron un paciente y dos controles, así que se analizaron 12 y 12. La versión publicada no se ha consultado (ver Pendientes, 10).
- **Alcance:** codificación de información verbal, no memoria autobiográfica. No respalda directamente H2.
- **Pistas (sin identificador propio):** Simmons-Stern NR, Deason RG, Brandler BJ, Frustace BS, O'Connor MK, Ally BA, Budson AE. Music-based memory enhancement in Alzheimer's disease: promise and limitations. Neuropsychologia 2012; 50(14): 3295–3303. DOI 10.1016/j.neuropsychologia.2012.09.019 (PMID 23000133; consulta del 2-nov-2026): letras relacionadas con actividades instrumentales de la vida diaria; en el conjunto de participantes (pacientes con Alzheimer y adultos sanos), el canto mejora solo el contenido general, no el específico. Moreira SV, Justi FRDR, Moreira M. Can musical intervention improve memory in Alzheimer's patients? Evidence from a systematic review. Dement Neuropsychol 2018; 12(2): 133–142. DOI 10.1590/1980-57642018dn12-020005 (PMID 29988347; DOI confirmado en Crossref y PubMed, consulta del 2-nov-2026): revisión de cuatro ensayos con 179 pacientes con Alzheimer; evidencia inconsistente. El resumen dice «memory» sin precisar el tipo de memoria. Moreira SV, Justi FRDR, Gomes CFA, Moreira M. Music Therapy Enhances Episodic Memory in Alzheimer's and Mixed Dementia: A Double-Blind Randomized Controlled Trial. Healthcare 2023; 11(22): 2912. DOI 10.3390/healthcare11222912 (PMID 37998404; DOI confirmado en Crossref y PubMed, consulta del 2-nov-2026): ensayo doble ciego con 43 adultos mayores (25 con Alzheimer o demencia mixta y 18 sanos). Mejora del recuerdo diferido en medidas de memoria episódica (en el Speech and Sing Memory Test, solo en el grupo con Alzheimer o demencia mixta) y ningún efecto en las medidas secundarias. Moltrasio J, Rubinstein W. The soundtrack of memory: the effect of music on emotional memory in Alzheimer's disease and older adults. Memory 2025; 33(10): 1266–1280. DOI 10.1080/09658211.2025.2573267 (PMID 41105815; consulta del 2-nov-2026): 93 pacientes con Alzheimer y 93 adultos mayores de baja escolaridad; tras ver imágenes positivas, negativas y neutras, tres minutos de música estimulante, relajante o ruido blanco. La música estimulante reduce los falsos reconocimientos diferidos en Alzheimer.
- **Uso:** RESEARCH.md (§1.2; §1.5; §2, H2; §6; §7); ALZHEIMER_RESEARCH.md (Niveles; §1.1; §5.3; §6); METHODOLOGY.md (§0; §1.3; §7.2; §9).
- **Hipótesis:** H2 (antecedente indirecto: música en la codificación, no evocación autobiográfica).

### 9. [clinica-06] [B2]: Jacobsen et al. 2015, preservación de la memoria musical en Alzheimer avanzado

- **Cita:** Jacobsen JH, Stelzer J, Fritz TH, Chételat G, La Joie R, Turner R. Why musical memory can be preserved in advanced Alzheimer's disease. Brain 2015; 138(8): 2438–2450. DOI 10.1093/brain/awv135 (PMID 26041611).
- **Estado:** [clinica-06] verificada; [B2] verificada con correcciones. Las correcciones de [B2] afectan a RESEARCH.md, no a la cita.
- **Datos (resumen de PubMed):** fMRI a 7 T en 32 adultos jóvenes sanos; el cingulado anterior caudal y el área presuplementaria motora ventral codifican la memoria musical a largo plazo. En 20 pacientes con Alzheimer y 34 controles, esas regiones muestran menos atrofia cortical (RM) y menos hipometabolismo (FDG-PET) que el resto del cerebro, pero el depósito de amiloide-β no es sustancialmente menor. Los autores escriben que los hallazgos «may thus explain» la preservación.
- **Terminología:** «área presuplementaria motora ventral» (pre-supplementary motor area en el original), no «área premotora suplementaria».
- **Correcciones (aplicadas en RESEARCH.md, §1.3):** «hay una explicación anatómica» pasa a «podría explicarse por», y se añade que el depósito de amiloide-β no era sustancialmente menor que en el resto del cerebro.
- **Uso:** RESEARCH.md (resumen; «Cómo leer»; §1.3; §1.5; §3; §7); ALZHEIMER_RESEARCH.md (Antecedentes; Niveles; §1.3; §6); METHODOLOGY.md (§0; §1.3; §8; §9).
- **Hipótesis:** marco para H2 (memoria musical preservada; explicación anatómica). Es un hallazgo de neuroimagen, no una intervención.

### 10. [B3]: Baird y Samson 2009, reconocimiento de la música en Alzheimer

- **Cita:** Baird A, Samson S. Memory for music in Alzheimer's disease: unforgettable? Neuropsychology Review 2009; 19(1): 85–101. DOI 10.1007/s11065-009-9085-2 (PMID 19214750).
- **Estado:** verificada. Sin correcciones. Tipo: revisión narrativa.
- **Datos (resumen):** la memoria musical explícita (reconocimiento de melodías familiares o desconocidas) suele estar alterada en Alzheimer; la memoria procedimental (tocar un instrumento) puede conservarse en algunos músicos. Los autores concluyen que la idea de que la música es inolvidable no se sostiene del todo.
- **Uso:** RESEARCH.md (resumen; §1.3; §1.5; §7); ALZHEIMER_RESEARCH.md (Niveles; §1.2; §1.5; §6); METHODOLOGY.md (§0; §1.3; §1.4; §9).
- **Hipótesis:** marco (reconocimiento musical); no contrasta H1-H5 directamente.

### 11. [P1]: Cuddy y Duffin 2005, hipótesis sobre el reconocimiento musical en demencia

- **Cita:** Cuddy LL, Duffin J. Music, memory, and Alzheimer's disease: is music recognition spared in dementia, and how can it be assessed? Medical Hypotheses 2005; 64(2): 229–235. DOI 10.1016/j.mehy.2004.09.005 (PMID 15607545). Crossref confirma los mismos datos en la comprobación de [clinica-06].
- **Estado:** verificada con correcciones.
- **Naturaleza:** artículo de hipótesis, no un estudio con muestra. Presenta un caso único con Alzheimer grave, evaluado con tres pruebas de reconocimiento musical adaptadas a observación conductual.
- **Correcciones:** la entrada anterior estaba incompleta (faltaban el subtítulo y la revista). Citar como hipótesis y caso único, nunca como evidencia.
- **Uso:** RESEARCH.md (§1.3; §7); ALZHEIMER_RESEARCH.md (Niveles; §1.2; §6); METHODOLOGY.md (§0; §9).
- **Hipótesis:** marco; solo como hipótesis sobre si el reconocimiento musical se conserva en la demencia.

### 12. [P3]: Matziorinis y Koelsch 2022, revisión sobre musicoterapia en Alzheimer

- **Cita:** Matziorinis AM, Koelsch S. The promise of music therapy for Alzheimer's disease: a review. Annals of the New York Academy of Sciences 2022; 1516(1): 11–17. DOI 10.1111/nyas.14864 (PMID 35851957; publicación en línea el 18-jul-2022). Crossref confirma los mismos datos en la comprobación de [clinica-06].
- **Estado:** verificada con correcciones.
- **Naturaleza:** revisión narrativa. Describe la memoria musical en Alzheimer, los efectos de la musicoterapia (ánimo, memoria autobiográfica, fluidez verbal, cognición) y, como argumento, un posible efecto de retraso en personas con riesgo. Sus afirmaciones de efecto son síntesis de estudios previos, no ensayos nuevos.
- **Correcciones:** citar como revisión, no como prueba de efecto.
- **Uso:** RESEARCH.md (§1.3; §7); ALZHEIMER_RESEARCH.md (Niveles; §1.1; §3.2; §3.3; §6); METHODOLOGY.md (§0; §9).
- **Hipótesis:** marco (contexto de la musicoterapia en Alzheimer).

## Escalas

### 13. [escalas-01]: Arjol et al. 2026, MoCA en España (metaanálisis y metarregresión)

- **Cita:** Arjol D, Unzueta-Arce J, Mora-Simón S, Ferasati M, Rodríguez-Sánchez E, Gómez-Marcos MA, García-Ortiz L, Maderuelo-Fernández JA, Lugones-Sánchez C. Use and Psychometric Properties of the MoCA in Spain: a Systematic Review With Meta-Analysis and Meta-Regression. Neuropsychology Review, publicación anticipada en línea el 1-jul-2026. DOI 10.1007/s11065-026-09703-y (PMID 42380691). Nueve autores, según PubMed y Crossref (consulta del 2-nov-2026). Volumen y páginas: pendientes (publicación anticipada; ver Pendientes, 12).
- **Estado:** verificada, con las precisiones de la corrección aplicadas.
- **Datos (resumen):** 80 estudios; 78 en el metaanálisis (n = 7.457); media 22,85; I² = 99,3 %. La metarregresión explica el 62 % de la variabilidad, con edad (β = −0,19 por año) y educación (β = 1,28 por año) como predictores principales. α 0,76–0,90; AUC 0,78–0,96. Conclusión: a favor de normas ajustadas frente a un punto de corte único.
- **Pistas (sin identificador propio):** Nasreddine ZS, Phillips NA, Bédirian V, Charbonneau S, Whitehead V, Collin I, Cummings JL, Chertkow H. The Montreal Cognitive Assessment, MoCA: a brief screening tool for mild cognitive impairment. J Am Geriatr Soc 2005; 53(4): 695–699 (PMID 15817019; DOI 10.1111/j.1532-5415.2005.53221.x): con punto de corte 26, el MoCA detecta el 90 % de los casos de deterioro cognitivo leve (especificidad 87 %). Arjol D, Mora-Simón S, Rodríguez-Sánchez E, Gómez-Marcos MA, García-Ortiz L, Maderuelo-Fernández JA, Lugones-Sánchez C, Unzueta-Arce J. Psicothema 2026; 38(3): 161–172 (PMID 42528410; «Psychometric Properties of the Montreal Cognitive Assessment (MoCA) in Spanish Adults»): estudio de estructura interna en 1.767 adultos de 18 a 89 años sin deterioro cognitivo, de muestra comunitaria evaluada en centros de atención primaria (resumen de PubMed, consulta del 2-nov-2026); no es un estudio de precisión diagnóstica. El DOI, 10.70478/psicothema.2026.38.15, consta en Crossref y PubMed (consulta del 2-nov-2026).
- **Uso:** RESEARCH.md (§2, H5; §4.2; §5; §6; §7); ALZHEIMER_RESEARCH.md (Niveles; §4.1; §4.2; §4.6; §5.2; §6); METHODOLOGY.md (§0; §2; §7.2; §9).
- **Hipótesis:** marco (cribado cognitivo para criterios de inclusión y estratificación); no corresponde a H1-H5.

### 14. [escalas-02]: Lobo et al. 1999, MEC-30 (versión española del MMSE)

- **Cita:** Lobo A, Saz P, Marcos G, Día JL, de la Cámara C, Ventura T, Morales Asín F, Fernando Pascual L, Montañés JA, Aznar S. Revalidation and standardization of the cognition mini-exam (first Spanish version of the Mini-Mental Status Examination) in the general geriatric population. Medicina Clínica (Barcelona) 1999; 112(20): 767–774. PMID 10422057. El título es la traducción al inglés que consta en PubMed; el artículo está en español. Diez autores, según PubMed; el registro solo da iniciales (consulta del 2-nov-2026).
- **Estado:** verificada, con la corrección de precisión aplicada.
- **Correcciones:** el kappa test-retest de 0,637 es kappa ponderado (weighted kappa).
- **Datos (resumen):** estudio de Zaragoza, N = 1.080, con MEC-30; punto de corte 23/24: sensibilidad 89,8 %, especificidad 75,1 %, AUC 0,920; kappa ponderado test-retest 0,637.
- **Pista (sin identificador propio):** Folstein MF, Folstein SE, McHugh PR (1975). «Mini-mental state». A practical method for grading the cognitive state of patients for the clinician. J Psychiatr Res 12(3): 189–198. DOI 10.1016/0022-3956(75)90026-6 (PMID 1202204). Se confirma que es el artículo del MMSE; PubMed no tiene resumen, así que su contenido no está comprobado.
- **Uso:** RESEARCH.md (§2, H5; §4.2; §5; §6; §7); ALZHEIMER_RESEARCH.md (§4.3; §4.6; §5.2; §6); METHODOLOGY.md (§2; §7.2; §9).
- **Hipótesis:** marco (cribado cognitivo para criterios de inclusión y estratificación).

### 15. [escalas-03]: Cummings et al. 1994, Neuropsychiatric Inventory (NPI)

- **Cita:** Cummings JL, Mega M, Gray K, Rosenberg-Thompson S, Carusi DA, Gornbein J. The Neuropsychiatric Inventory: comprehensive assessment of psychopathology in dementia. Neurology 1994; 44(12): 2308–2314. DOI 10.1212/wnl.44.12.2308 (PMID 7991117).
- **Estado:** verificada. Sin correcciones.
- **Datos (resumen):** evalúa 10 alteraciones conductuales y emocionales en demencia, con información de un cuidador, frecuencia y gravedad. El resumen confirma su validez y fiabilidad.
- **Pistas (sin identificador propio):** Boada M, Cejudo JC, Tàrraga L, López OL, Kaufer D (2002; versión breve NPI-Q; Neurologia 17(6): 317–323; PMID 12084358): 120 pacientes con Alzheimer; test-retest r = 0,89 (escala total) y 0,90 (malestar). Boada M, Tárraga L, Modinos G, López OL, Cummings JL (2005; NPI-NH, para residencias; Neurologia 20(10): 665–673; PMID 16317587): validación con 80 residentes. Autores según PubMed (consulta del 2-nov-2026); el registro solo da iniciales.
- **Uso:** RESEARCH.md (§4.2; §6; §7); ALZHEIMER_RESEARCH.md (§2.2; §6); METHODOLOGY.md (§0; §2; §7.2; §9).
- **Hipótesis:** marco (síntomas neuropsiquiátricos como resultado secundario, relacionado con H1).

### 16. [escalas-04]: Cohen-Mansfield et al. 1989, escala de agitación (CMAI)

- **Cita:** Cohen-Mansfield J, Marx MS, Rosenthal AS. A description of agitation in a nursing home. Journal of Gerontology 1989; 44(3): M77–M84. DOI 10.1093/geronj/44.3.M77 (PMID 2715584).
- **Estado:** verificada. Sin correcciones.
- **Datos (resumen):** 29 conductas agitadas valoradas por enfermeras con una escala de frecuencia de 7 puntos, en 408 residentes; tres síndromes en el análisis factorial.
- **Atribución al CMAI:** el resumen no nombra el instrumento. La atribución se respalda con el manual del CMAI (sección «Citing the CMAI»), que indica esta referencia. El texto completo no se ha consultado.
- **Pista (sin identificador propio):** Cohen-Mansfield J (1986). «Agitated Behaviors in the Elderly: II. Preliminary Results in the Cognitively Deteriorated». J Am Geriatr Soc 34(10): 722–727; DOI 10.1111/j.1532-5415.1986.tb04303.x. Autor único; 66 residentes; estudio preliminar.
- **Uso:** RESEARCH.md (§4.2; §6; §7); ALZHEIMER_RESEARCH.md (§2.1; §5.2; §6); METHODOLOGY.md (§2; §7.2; §9).
- **Hipótesis:** H1 (agitación como resultado conductual).

### 17. [escalas-05]: Logsdon et al. 2002, QoL-AD (calidad de vida en deterioro cognitivo)

- **Cita:** Logsdon RG, Gibbons LE, McCurry SM, Teri L. Assessing quality of life in older adults with cognitive impairment. Psychosomatic Medicine 2002; 64(3): 510–519. DOI 10.1097/00006842-200205000-00016 (PMID 12021425).
- **Estado:** parcial.
- **Correcciones:** «solo es fiable y válido para pacientes con MMSE mayor de 10» se sustituye por «los autores concluyen que parece fiable y válido para pacientes con MMSE mayor de 10 (los no completores tenían MMSE de 10 o menos)». La palabra «solo» no figura en el resumen.
- **Datos (resumen):** 177 díadas paciente-cuidador; α 0,83–0,90; validez frente a depresión, funcionalidad y acontecimientos placenteros.
- **Pendiente de esta entrada:** la cita de 1999 (J Ment Health Aging 5: 21–32) no se usa hasta verificarla; la búsqueda del 2-nov-2026 no la localiza en PubMed, Europe PMC ni Crossref (ver Pendientes).
- **Uso:** RESEARCH.md (§4.2; §5; §7); ALZHEIMER_RESEARCH.md (§4.4; §4.6; §5.2; §6); METHODOLOGY.md (§2; §7.2; §9).
- **Hipótesis:** marco (calidad de vida como resultado; relacionado con H1).

### 18. [escalas-06]: León-Salas et al. 2011, QoL-AD en español con pacientes institucionalizados

- **Cita:** León-Salas B, Logsdon RG, Olazarán J, Martínez-Martín P, The MSU-ADRU. Psychometric properties of the Spanish QoL-AD with institutionalized dementia patients and their family caregivers in Spain. Aging & Mental Health 2011; 15(6): 775–783. DOI 10.1080/13607863.2011.562183 (PMID 21547751).
- **Estado:** verificada, con la corrección de precisión aplicada.
- **Datos (resumen):** 101 pacientes institucionalizados (82 con Alzheimer y 19 con demencia mixta) y sus cuidadores; α 0,90 (paciente) y 0,86 (cuidador); ICC 0,83 (paciente) y 0,51 (cuidador); MMSE medio 7,2 ± 6,1; la versión del paciente tiene menor validez de constructo.
- **Pista (sin identificador propio):** Gómez-Gallego M, Gómez-Amor J, Gómez-García J (2012; el registro solo da iniciales). Neurologia 27(1): 4–10 (PMID 21570161; título original: «Validación de la versión española de la escala QoL-AD en pacientes con enfermedad de Alzheimer, cuidadores y profesionales sanitarios»). En centros de día se reclutaron 102 pacientes con Alzheimer, sus cuidadores y 25 profesionales, con deterioro cognitivo leve a moderado. El DOI, 10.1016/j.nrl.2011.03.006, consta en Crossref y PubMed (consulta del 2-nov-2026).
- **Uso:** RESEARCH.md (§4.2; §6; §7); ALZHEIMER_RESEARCH.md (§4.5; §4.6; §6); METHODOLOGY.md (§2; §7.2; §9).
- **Hipótesis:** marco (calidad de vida como resultado; relacionado con H1).

## Audio y codificación

### 19. [audio-01] [P4]: UIT-R BS.1534-3, método MUSHRA

- **Cita:** UIT-R. Recomendación BS.1534-3 (10/2015). Method for the subjective assessment of intermediate quality level of audio systems (MUlti Stimulus test with Hidden Reference and Anchor, MUSHRA). Aprobada el 14-oct-2015; en vigor. PDF oficial: https://www.itu.int/dms_pubrec/itu-r/rec/bs/R-REC-BS.1534-3-201510-I!!PDF-E.pdf. Ficha: https://www.itu.int/rec/R-REC-BS.1534-3-201510-I/en.
- **Estado:** [audio-01] verificada; [P4] verificada con correcciones.
- **Correcciones:** citar «BS.1534-3 (10/2015)», no «BS.1534» sin versión. El título oficial no menciona el método; para llamar MUSHRA a una prueba hay que describirla con referencia oculta y anclas.
- **Datos (PDF oficial, 36 páginas):** referencia oculta; anclas ocultas (paso bajo de 3,5 kHz como ancla estándar y de 7 kHz como ancla de calidad media); escala continua de 0 a 100; máximo recomendado de 12 señales por prueba. El PDF advierte que el nombre MUSHRA se usa a menudo indebidamente para pruebas sin referencia oculta ni anclas.
- **Pista (sin identificador propio):** Schoeffler M, Bartoschek S, Stöter F-R, Roess M, Westphal S, Edler B, Herre J (2018). webMUSHRA. Journal of Open Research Software 6(1): art. 8. DOI 10.5334/jors.187 (publicado el 5-feb-2018).
- **Uso:** RESEARCH.md (§4.3; §7); METHODOLOGY.md (§0; §3.1; §9); docs/audio-processing/COMPRESSION.md, líneas 3, 237 y 264 (fuera de esta revisión). La línea 264 enlaza a https://www.itu.int/rec/R-REC-BS.1534 sin versión; debe actualizarse a BS.1534-3.
- **Hipótesis:** marco (compresión perceptual; el experimento de escucha no está iniciado; no contrasta H1-H5).

### 20. [audio-02]: UIT-R BS.1770-5, medición de sonoridad

- **Cita:** UIT-R. Recomendación BS.1770-5 (11/2023). Algorithms to measure audio programme loudness and true-peak audio level. En vigor; sustituye a BS.1770-4 (10/2015). PDF oficial: https://www.itu.int/dms_pubrec/itu-r/rec/bs/R-REC-BS.1770-5-202311-I!!PDF-E.pdf.
- **Estado:** verificada, con la corrección de unidades aplicada.
- **Correcciones:** la puerta relativa se cita en dB, como indica BS.1770-5 (−10 dB respecto al nivel tras la puerta absoluta). LU es el término de EBU R 128.
- **Datos (PDF oficial):** filtro K de dos etapas; bloques de gating de 400 ms con 75 % de solapamiento; puerta absoluta de −70 LKFS; puerta relativa de −10 dB; anexo de medición de true-peak.
- **Pista (sin identificador propio):** EBU R 128 (versión 5, noviembre de 2023; PDF oficial): objetivo de −23,0 LUFS; tolerancia de ±1,0 LU cuando no se alcanza el objetivo (p. ej., directos) y de ±0,2 LU en control de calidad; el medidor debe cumplir BS.1770. Título y editor completos: pendientes.
- **Uso:** RESEARCH.md (§4.3; §5; §7); METHODOLOGY.md (§0; §3.2; §7.2; §9).
- **Hipótesis:** marco (control de sonoridad para que el volumen no sea un factor de confusión entre condiciones; H1-H4).

### 21. [audio-03]: RFC 6716 (Opus) y RFC 8251

- **Cita:** Valin J-M, Vos K, Terriberry T. Definition of the Opus Audio Codec. RFC 6716. IETF, septiembre de 2012; Standards Track. DOI 10.17487/RFC6716. URL: https://www.rfc-editor.org/rfc/rfc6716.txt. El DOI resuelve en rfc-editor.org/info/rfc6716 (DataCite no lo registra).
- **Cita complementaria (corrección):** Valin J-M, Vos K. Updates to the Opus Audio Codec. RFC 8251. IETF, octubre de 2017; Standards Track; actualiza la RFC 6716 («Updates: 6716»).
- **Estado:** verificada, con la corrección aplicada (citar también la RFC 8251 para fijar la versión del códec).
- **Datos (texto oficial):** códec que va de voz de banda estrecha a 6 kbit/s a música estéreo a 510 kbit/s; combina predicción lineal (LP) y MDCT. No contiene resultados de escucha.
- **Uso:** RESEARCH.md (§4.3; §7); METHODOLOGY.md (§3.3; §8; §9); docs/audio-processing/COMPRESSION.md, línea 265 (fuera de esta revisión): figura «Proposed Standard», que no coincide con el registro (Standards Track); la cita debe incluir la RFC 8251.
- **Hipótesis:** marco (versión y tasa del códec bajo prueba; sin datos perceptuales).

### 22. [audio-04]: Valin et al. 2010, códec CELT con escucha MUSHRA

- **Cita:** Valin J-M, Terriberry TB, Montgomery C, Maxwell G. A High-Quality Speech and Audio Codec With Less Than 10-ms Delay. IEEE Transactions on Audio, Speech, and Language Processing 2010; 18(1): 58–67. DOI 10.1109/TASL.2009.2023186.
- **Estado:** parcial. El registro está confirmado en Crossref. La versión publicada no se pudo leer (IEEE Xplore no devolvió contenido).
- **Datos (comprobados en el preprint arXiv:1602.05526, que tiene el mismo título, autores y DOI en sus metadatos; no en la versión publicada):** 15 oyentes no entrenados; MUSHRA; pruebas a 48 y 64 kbit/s. CELT (base de la capa musical de Opus) frente a G.722.1C, MP3 (LAME en CBR, con paso bajo de 20 kHz y sin reservorio de bits) y AAC-LD (implementación de Apple). A 48 kbit/s, CELT supera a todos los demás códecs con más del 95 % de confianza; a 64 kbit/s supera a todos menos a AAC-LD. El ancla de 7 kHz solo tiene resultados de 5 oyentes, por un error de generación.
- **Segundo estudio (texto verificado):** Valin J-M, Maxwell G, Terriberry TB, Vos K. High-Quality, Low-Delay Music Coding in the Opus Codec. arXiv:1602.04845; 135.ª Convención de la AES, Nueva York, 17–20 de octubre de 2013. 13 oyentes; 30 muestras evaluadas con BS.1116-1; Opus a 64 kb/s VBR frente a Apple HE-AAC, Nero HE-AAC y Ogg Vorbis. El MP3 solo aparece en un análisis objetivo PEAQ de codificación en cascada. Los oyentes fueron voluntarios del foro HydrogenAudio con auriculares, no un panel de laboratorio.
- **Límite:** es precedente de escucha con MP3 y AAC, no evidencia sobre la RFC 6716.
- **Uso:** RESEARCH.md (§4.3; §6; §7); METHODOLOGY.md (§3.4; §7.2; §9). No se cita como dato.
- **Hipótesis:** marco (precedente de diseño de pruebas de escucha).

### 23. [audio-05]: Hu y Loizou 2008, medidas objetivas frente a escucha

- **Cita:** Hu Y, Loizou PC. Evaluation of Objective Quality Measures for Speech Enhancement. IEEE Transactions on Audio, Speech, and Language Processing 2008; 16(1): 229–238. DOI 10.1109/TASL.2007.911054.
- **Versión de 2006:** Hu Y, Loizou PC. «Evaluation of objective measures for speech enhancement». Proc. Interspeech 2006. DOI 10.21437/Interspeech.2006-84. Identificador de artículo: 2007-Tue3FoP.10, tal como figura en el campo de página de Crossref («paper 2007-Tue3FoP.10-0»; publicado en línea el 17-sep-2006; consulta del 2-nov-2026). ISCA Archive no se ha consultado.
- **Estado:** parcial. El resumen de 2008 se recuperó vía OpenAlex, porque IEEE Xplore no devolvió contenido. El texto del artículo no se ha leído.
- **Confirmado (resumen de 2008 y versión de 2006):** compara medidas objetivas con las valoraciones subjetivas de la metodología ITU-T P.835 (distorsión de la señal, del ruido y calidad global) y propone medidas compuestas que combinan las individuales con regresión paramétrica y no paramétrica. La versión de 2006 reporta mejoras de PESQ y nuevas medidas compuestas.
- **No verificado en fuente primaria** (solo aparece en la tesis arXiv:1409.6554, Taher Shahbazi Mirzahasanloo, 2014, sección 6.1.1): que la SNR segmental temporal no sea adecuada para voz mejorada, que PESQ correlacione mejor y que las medidas compuestas mejoren la predicción. La misma sección indica que la SNR segmental ponderada en frecuencia está entre las medidas más fiables, y que la SNR segmental se diseñó para codificación de voz, citando a Quackenbush, Barnwell y Clements (1988), libro no verificado. LSD no aparece en lo verificado.
- **Forma de citar hasta leer el artículo:** «según Hu y Loizou (2008), citados en arXiv:1409.6554».
- **Uso:** RESEARCH.md (§4.3; §6; §7); METHODOLOGY.md (§3.5; §7.2; §9).
- **Hipótesis:** marco (validez de la SNR como métrica frente a escucha; los datos citados son de voz, no de música).

### 24. [audio-06]: Gray y Markel 1976, distancias espectrales para el habla

- **Cita:** Gray AH Jr, Markel JD. Distance measures for speech processing. IEEE Transactions on Acoustics, Speech, and Signal Processing 1976; 24(5): 380–391. DOI 10.1109/TASSP.1976.1162849 (octubre de 1976). Crossref registra «A. Gray» y «J. Markel»; el registro de verificación usa los nombres completos que constan en OpenAlex.
- **Estado:** verificada en cuanto al registro y al resumen. El texto no se ha leído.
- **Datos (resumen vía OpenAlex):** analiza cuatro medidas de distancia en procesamiento del habla, entre ellas la «root mean square (rms) log spectral distance», y considera su relación con la percepción (en voz).
- **No verificado:** la fórmula exacta del artículo de 1976 y su validez para música. La atribución a Markel y Gray de la distancia RMS sobre espectros LPC procede de la documentación de libtsp de McGill (fuente secundaria). Wikipedia atribuye la LSD también a Rabiner y Juang (1993), no verificado.
- **Uso:** RESEARCH.md (§4.3; §6; §7); METHODOLOGY.md (§3.5; §7.2; §8; §9); docs/audio-processing/COMPRESSION.md, línea 274 (fuera de esta revisión): la nota dice que no se han confirmado título, autores ni año, y el registro ya está verificado. La definición del LSD de ese documento sigue el script, no la fórmula de 1976.
- **Hipótesis:** marco (métrica objetiva de fidelidad, LSD, en compresión; no validada para música).

## Marco legal

### 25. [legal-01]: Reglamento (UE) 2016/679 (RGPD)

- **Cita:** Reglamento (UE) 2016/679 del Parlamento Europeo y del Consejo, de 27 de abril de 2016, relativo a la protección de las personas físicas en lo que respecta al tratamiento de datos personales y a la libre circulación de estos datos y por el que se deroga la Directiva 95/46/CE (Reglamento general de protección de datos, RGPD). DOUE L 119, de 4.5.2016, pp. 1–88. Copia del BOE: https://www.boe.es/buscar/doc.php?id=DOUE-L-2016-80807.
- **Estado:** parcial.
- **Correcciones:** título completo, con la cláusula «y por el que se deroga la Directiva 95/46/CE».
- **Confirmado (texto del BOE):** art. 4.5 (seudonimización) y 4.15 (datos relativos a la salud); art. 5.1.b y 5.1.e (uso ulterior y conservación con fines de investigación científica); art. 9.1 (prohibición general), con las excepciones del art. 9.2.a (consentimiento explícito), del art. 9.2.j (investigación científica con base en el Derecho de la Unión o nacional) y del art. 9.4 (condiciones adicionales de los Estados); art. 89.1-89.2 (minimización, seudonimización y excepciones a los arts. 15, 16, 18 y 21 cuando imposibiliten u obstaculicen gravemente el fin científico y sean necesarias).
- **Pendiente:** el texto se contrastó con la copia del BOE; EUR-Lex no se pudo consultar (ver Pendientes).
- **Uso:** RESEARCH.md (§4.3; §6; §7); METHODOLOGY.md (§6.2; §6.4; §9); SECURITY.md (§0; §1.1; §1.2). CHANGELOG.md y ROADMAP.md mencionan el RGPD de forma genérica.
- **Hipótesis:** marco (H1-H4: datos de los participantes).

### 26. [legal-02]: LOPDGDD, disposición adicional decimoséptima

- **Cita:** Ley Orgánica 3/2018, de 5 de diciembre, de Protección de Datos Personales y garantía de los derechos digitales (LOPDGDD). BOE de 6.12.2018, BOE-A-2018-16673. Disposición adicional decimoséptima.
- **Estado:** verificada con correcciones. Las correcciones se contrastaron con el texto consolidado del BOE (BOE-A-2018-16673) el 2-nov-2026; queda el dictamen sobre el ámbito del apartado 1 (ver Pendientes, 23).
- **Correcciones:**
  - Apartado 1: los tratamientos regulados por las leyes listadas (letra f: Ley 14/2007) se amparan en las letras g), h), i) y j) del art. 9.2 RGPD.
  - Apartado 2, letra c: exige informe previo favorable del comité de ética para la reutilización con fines de investigación.
  - Apartado 2, letra g: exige «informe previo del comité de ética de la investigación», sin el adjetivo «favorable».
  - Apartado 2, letra f, 1.º: la evaluación de impacto es exigible en los supuestos del art. 35 RGPD o en los que fije la autoridad de control, no con carácter general.
- **Confirmado:** letra d (separación técnica y funcional y acceso restringido a los datos seudonimizados); letra e (excepciones a los arts. 15, 16, 18 y 21 según el art. 89.2 RGPD). El art. 89 de la LOPDGDD no sirve de base para la investigación: regula la videovigilancia y la grabación de sonidos en el lugar de trabajo.
- **Uso:** RESEARCH.md (§4.3; §6; §7); METHODOLOGY.md (§6.2; §9); SECURITY.md (§1.1; §1.3; §5).
- **Hipótesis:** marco (H1-H4: tratamiento de datos de salud para investigación).

### 27. [legal-03]: Ley 14/2007, de Investigación biomédica

- **Cita:** Ley 14/2007, de 3 de julio, de Investigación biomédica. BOE de 4.7.2007, BOE-A-2007-12945.
- **Estado:** verificada. Sin correcciones en el registro; la advertencia de terminología queda en Pendientes.
- **Semilla descartada:** BOE-A-2007-12639 no es esta ley; corresponde a una Resolución de 1 de junio de 2007 sobre un convenio del Ministerio de Agricultura, Pesca y Alimentación.
- **Artículos confirmados:** 1.1.a (investigaciones con procedimientos invasivos); 1.3 (incluye la investigación clínica y excluye los ensayos clínicos con medicamentos y productos sanitarios); 2.e (informe favorable previo y preceptivo del comité de ética); 3.t (procedimiento invasivo: intervención con riesgo físico o psíquico); 4.1 (consentimiento expreso y escrito); 4.2 (consentimiento por representación y participación según capacidades); 5.5 (publicar resultados identificables solo con consentimiento previo y expreso); 20.1.a y 20.2 (en personas que no pueden consentir: beneficio directo o, de forma excepcional, riesgo y carga mínimos, con comunicación al Ministerio Fiscal según el art. 20.2.c).
- **Nota:** el art. 5.1 cita la LO 15/1999, derogada por la LOPDGDD (disposición derogatoria única, apartado 1).
- **Terminología:** los arts. 4.2 y 20 hablan de «incapacitada legalmente» e «incapacitación». En el texto consolidado (BOE-A-2007-12945, consulta del 2-nov-2026) siguen igual, sin versiones posteriores a 2007. La Ley 8/2021 (BOE-A-2021-9233, «Ley 8/2021, de 2 de junio, por la que se reforma la legislación civil y procesal para el apoyo a las personas con discapacidad en el ejercicio de su capacidad jurídica») no cita la Ley 14/2007; su preámbulo describe el cambio de la incapacitación por medidas de apoyo. Ver Pendientes, 27.
- **Uso:** RESEARCH.md (§4.3; §6; §7); METHODOLOGY.md (§6.2; §9); SECURITY.md (§1.1; §1.4; §5).
- **Hipótesis:** marco (H1, H2 y H4 si hay intervención en personas con deterioro cognitivo; alcance para H5 por valorar).

### 28. [legal-04]: Declaración de Helsinki de la WMA (2024)

- **Cita:** World Medical Association. World Medical Association Declaration of Helsinki: Ethical Principles for Medical Research Involving Human Participants. JAMA 2025; 333(1): 71. DOI 10.1001/jama.2024.21972 (publicada el 7-ene-2025). Aprobada en la 75.ª Asamblea General de Helsinki, octubre de 2024; la página de la WMA está fechada el 19.10.2024.
- **Estado:** verificada en la versión inglesa. La traducción al español no está verificada.
- **Confirmado (texto en inglés):** consentimiento libre e informado documentado (sección «Free and Informed Consent»); aprobación previa del comité de ética (sección «Research Ethics Committees»); en personas incapaces de consentir, consentimiento del representante legal que considere las preferencias y valores de la persona, asentimiento cuando pueda darlo y respeto a su disidencia; inclusión solo si el estudio puede beneficiarla personalmente o implica riesgo y carga mínimos; uso secundario de datos almacenados sin consentimiento solo con aprobación del comité cuando el consentimiento es imposible o impracticable.
- **Uso:** RESEARCH.md (§4.3; §6; §7); METHODOLOGY.md (§0; §6.2; §9); SECURITY.md (§1.1; §1.5; §5).
- **Hipótesis:** marco (H1-H4: consentimiento, representación legal y asentimiento).

### 29. [legal-05]: TRLPI, arts. 112 y 114-119 (plazos de las grabaciones), con la Ley 21/2014 y la Directiva 2011/77/UE

- **Cita:** Real Decreto Legislativo 1/1996, de 12 de abril, por el que se aprueba el texto refundido de la Ley de Propiedad Intelectual, regularizando, aclarando y armonizando las disposiciones legales vigentes sobre la materia (TRLPI). BOE de 22.4.1996, BOE-A-1996-8930. Versión consolidada: https://www.boe.es/eli/es/rdlg/1996/04/12/1/con. Usar esta versión: el XML del BOE devuelve los artículos sin la reforma.
- **Reforma:** Ley 21/2014, de 4 de noviembre (BOE de 5.11.2014, BOE-A-2014-11404): apartado Ocho (art. 112, párrafo 2) y apartado Nueve (art. 119, párrafo 1). Su disposición final tercera incorpora la Directiva 2011/77/UE (confirmado en el BOE, BOE-A-2014-11404, el 2-nov-2026). La disposición transitoria vigésima primera, apartado 3, aplica los arts. 110 bis, 112 y 119 también a grabaciones y fonogramas protegidos a 1 de noviembre de 2013 (confirmado en el texto consolidado del TRLPI).
- **Directiva 2011/77/UE**, de 27 de septiembre de 2011 (DOUE L 265, 11.10.2011, pp. 1–5; copia en WIPO Lex): art. 1(2) amplía a 70 años los plazos de los fonogramas; art. 2(1) fija la transposición antes del 1 de noviembre de 2013.
- **Estado:** verificada con correcciones. El texto consolidado del BOE (BOE-A-1996-8930) se consultó el 2-nov-2026; el dictamen jurídico queda en Pendientes (24).
- **Correcciones (2-nov-2026):** el art. 112 regula los derechos de los artistas intérpretes o ejecutantes, y el art. 119, los de los productores de fonogramas; el art. 112 no regula los derechos de los productores.
- **Texto corregido (según la consolidación):**
  - Art. 112, párrafo 1: 50 años desde el 1 de enero del año siguiente a la interpretación.
  - Art. 112, párrafo 2: si dentro de ese período la grabación se publica o comunica lícitamente por medio distinto al fonograma, 50 años desde el 1 de enero del año siguiente a la primera publicación o comunicación; si es en fonograma, 70 años con el mismo cómputo.
  - Art. 119, párrafo 1: 50 años desde la grabación; si hay publicación lícita dentro de ese plazo, 70 años desde la primera publicación lícita, o, sin publicación lícita, 70 años desde la primera comunicación lícita al público.
  - Art. 119, párrafo 2: todos los plazos se computan desde el 1 de enero del año siguiente al momento de la grabación, publicación o comunicación.
- **Confirmado:** art. 26 (vida del autor más 70 años), que es un plazo distinto del de las grabaciones.
- **Uso:** RESEARCH.md (§4.3; §6; §7); METHODOLOGY.md (§6.2; §9); SECURITY.md (§1.1; §1.6; §4; §5).
- **Hipótesis:** marco (H1, H2 y H4: grabaciones usadas como estímulo y reproducidas en la plataforma). Calcular plazos concretos requiere dictamen jurídico (ver Pendientes).

### 30. [legal-06]: Directiva (UE) 2019/790, minería de textos y datos

- **Cita:** Directiva (UE) 2019/790 del Parlamento Europeo y del Consejo, de 17 de abril de 2019, sobre los derechos de autor y derechos afines en el mercado único digital y por la que se modifican las Directivas 96/9/CE y 2001/29/CE. DOUE L 130, de 17.5.2019, pp. 92–125. Copia en PDF del BOE: https://boe.es/doue/2019/130/L00092-00125.pdf.
- **Transposición:** Real Decreto-ley 24/2021, de 2 de noviembre (BOE de 3.11.2021, BOE-A-2021-17910). Su Libro cuarto (arts. 65 a 80) transpone también la Directiva (UE) 2019/789; la minería de textos y datos está en el art. 67 (apartados 1, 3 y 4). El TRLPI consolidado no contiene la minería de textos.
- **Estado:** parcial. El título de la Directiva 2019/790 y el Libro cuarto (arts. 65 a 80) se confirman en el BOE (RDL 24/2021, consulta del 2-nov-2026); sigue sin confirmarse la cita en el DOUE original (ver Pendientes, 25).
- **Correcciones:** título oficial completo (faltaba la cláusula «y por la que se modifican las Directivas 96/9/CE y 2001/29/CE»). El Libro cuarto comprende los arts. 65 a 80, no 65 a 70.
- **Confirmado:** art. 2.1 (organismo de investigación: sin ánimo de lucro o reinvirtiendo todos los beneficios, o con misión de interés público reconocida; sin acceso preferente de empresas con influencia decisiva); art. 2.2 (definición de minería de textos y datos); art. 3.1 (excepción para organismos de investigación e instituciones del patrimonio cultural, con fines de investigación científica sobre obras de acceso lícito); art. 4.1 y 4.3 (excepción general para obras de acceso lícito; reserva expresa «como medios de lectura mecánica en el caso del contenido puesto a la disposición del público en línea»).
- **Interpretación, no verificada como hecho:** una empresa que no sea organismo de investigación según el art. 2.1 dependería del art. 4, no del art. 3. Requiere dictamen jurídico.
- **Uso:** METHODOLOGY.md (§6.2; §9); SECURITY.md (§0; §1.1; §1.7; §5). Metodología de minería de textos en revisiones sistemáticas.
- **Hipótesis:** marco (metodología).

## Referencias existentes que ya estaban en el proyecto

Concordancia de los identificadores B1-B6 y P1-P4 (los que usa RESEARCH.md y los que tenía la versión anterior de este fichero) con las entradas de este documento:

| Identificador | Entrada | Estado | Documentos que lo citan (detalle en cada entrada) |
|---|---|---|---|
| B1 | 2. [B1] | verificada con correcciones | RESEARCH.md, ALZHEIMER_RESEARCH.md, METHODOLOGY.md |
| B1-2025 | 1. [clinica-01] [B1-2025] | [clinica-01] parcial; [B1-2025] verificada con correcciones | RESEARCH.md, ALZHEIMER_RESEARCH.md, METHODOLOGY.md, SECURITY.md |
| B2 | 9. [clinica-06] [B2] | [clinica-06] verificada; [B2] verificada con correcciones | RESEARCH.md, ALZHEIMER_RESEARCH.md, METHODOLOGY.md |
| B3 | 10. [B3] | verificada | RESEARCH.md, ALZHEIMER_RESEARCH.md, METHODOLOGY.md |
| B4 | 5. [B4] | verificada, con discrepancia abierta | RESEARCH.md, ALZHEIMER_RESEARCH.md, METHODOLOGY.md |
| B5 | 6. [B5] | verificada con correcciones | RESEARCH.md, ALZHEIMER_RESEARCH.md, METHODOLOGY.md |
| B6 | 4. [clinica-03] [B6] | [clinica-03] parcial; [B6] verificada con correcciones | RESEARCH.md, ALZHEIMER_RESEARCH.md, METHODOLOGY.md |
| P1 | 11. [P1] | verificada con correcciones | RESEARCH.md, ALZHEIMER_RESEARCH.md, METHODOLOGY.md |
| P2 | 8. [clinica-05] [P2] | [clinica-05] verificada; [P2] verificada con correcciones | RESEARCH.md, ALZHEIMER_RESEARCH.md, METHODOLOGY.md |
| P3 | 12. [P3] | verificada con correcciones | RESEARCH.md, ALZHEIMER_RESEARCH.md, METHODOLOGY.md |
| P4 | 19. [audio-01] [P4] | [audio-01] verificada; [P4] verificada con correcciones | RESEARCH.md, METHODOLOGY.md; docs/audio-processing/COMPRESSION.md (fuera de esta revisión) |

**Cambios aplicados en RESEARCH.md (revisión del 2 de noviembre de 2026):**

- Sección 1.1 ([B1] y [B1-2025]): dos viñetas. En cognición, «evidencia de baja calidad de poco o ningún efecto sobre la cognición (2018)». La versión de 2025 no confirma la mejora del bienestar ni de la ansiedad que la de 2018 señalaba. Cita completa de 2025 [clinica-01] [B1-2025].
- Sección 1.3 ([B2]): «podría explicarse por», y el depósito de amiloide-β no era sustancialmente menor que en el resto del cerebro [clinica-06] [B2].
- Sección 1.2 ([B4]): «The Four Seasons de Vivaldi (música fija)». El n = 12 queda sujeto a la discrepancia abierta.
- Sección 1.2 ([B5]): la música fue un único fragmento de Vivaldi, no música elegida por el paciente.
- Sección 1.2 ([clinica-03] [B6]): «Estudio de 2015 (22 pacientes con Alzheimer leve y 24 controles)», con memorias autodefinitorias.

## Pendientes

Lista de afirmaciones no verificadas o parciales, y de datos que faltan para citarlas. Ninguno de estos puntos se cita hasta resolverse. Revisión del 2-nov-2026: los puntos marcados «Resuelto» conservan la evidencia; los demás siguen abiertos y se indica el motivo.

### Afirmaciones no verificadas o parciales

1. **[audio-04] Valin et al. 2010.** Leer la versión publicada en IEEE Xplore (no devolvió contenido). Hasta entonces, las cifras se atribuyen al preprint arXiv:1602.05526. Feiten et al. 2009 (AES 126; MUSHRA frente a ACR con AAC, HE-AAC, MP2 y MP3): no verificado y página bloqueada; no citar. Consulta del 2-nov-2026: el DOI devuelve HTTP 202 sin contenido. Sigue abierto por falta de acceso al texto publicado.
2. **[audio-05] Hu y Loizou 2008.** Leer el artículo original y confirmar que la SNR segmental temporal no es adecuada para voz mejorada, que PESQ correlaciona mejor y que las medidas compuestas mejoran la predicción. Quackenbush, Barnwell y Clements (1988): no verificado. LSD: no aparece en lo verificado. El identificador del Interspeech 2006 queda confirmado en Crossref (ver punto 22); ISCA Archive no se ha consultado. Sigue abierto el texto de 2008.
3. **[audio-06] Gray y Markel 1976.** Leer el texto para confirmar la fórmula de la RMS log spectral distance. La validez para música no está verificada: no usar para música. Rabiner y Juang (1993), citado por Wikipedia: no verificado; no citar. Consulta del 2-nov-2026: sin texto accesible en fuentes permitidas (IEEE, ver punto 1); sigue abierto.
4. **[audio-02] EBU R 128 (V5).** Transcribir el título y el editor desde el PDF oficial. Hoy solo consta la verificación de sus cifras. EBU no figura entre las fuentes permitidas en esta revisión; sigue abierto.
5. **[escalas-02] Folstein et al. 1975 (PMID 1202204).** PubMed no tiene resumen. Leer el texto antes de citar cifras o contenido del instrumento; hoy solo se cita como el artículo del MMSE. Consulta del 2-nov-2026: ScienceDirect devuelve una página de redirección sin texto; sigue abierto.
6. **[escalas-04] Cervilla et al. 1995** (validación del IAACM, versión española del CMAI): no aparece en PubMed y no está verificado; no citar. Leer el texto completo de Cohen-Mansfield et al. 1989 (hoy la atribución al CMAI se respalda con el manual del instrumento). Consulta del 2-nov-2026: Cervilla et al. 1995 no aparece en Crossref (búsqueda bibliográfica), PubMed ni Europe PMC; Oxford Academic devuelve HTTP 403 para el artículo de 1989. Sigue abierto.
7. **[escalas-05] Logsdon et al. 1999** (J Ment Health Aging 5: 21–32; «Quality of life in Alzheimer's disease: patient and caregiver reports»): no está en PubMed ni en Crossref. Solo aparece en la lista de referencias de PMC10846188, y el registro PsycTests (DOI 10.1037/t03352-000) confirma autores y año. No citar hasta verificar la fuente primaria. Consulta del 2-nov-2026: la búsqueda por título y por autor y año no devuelve la cita en Europe PMC ni en Crossref. Sigue abierto.
8. **[B4] El Haj, Postal y Allain 2012.** El n = 12 y el diseño proceden del resumen de OpenAlex ([verificadas-existentes]), pero [clinica-03] afirma que no hay resumen accesible y que el diseño no debe atribuirse sin leer el texto. Leer el texto completo (no consta en PubMed) y resolver la discrepancia antes de mantener el n = 12 en RESEARCH.md. Consulta del 2-nov-2026: Taylor & Francis devuelve HTTP 403; Europe PMC no indexa el DOI; Crossref no tiene resumen. Sigue abierto: hace falta el texto del artículo o su resumen en una fuente permitida.
9. **[clinica-03] [B6], sexto autor. Resuelto (2-nov-2026).** La página del artículo en Cambridge Core (International Psychogeriatrics) lista cinco autores, igual que PubMed y Europe PMC. Crossref añade a «Henry Brodaty», que no figura en la página de la revista; no se cita.
10. **[clinica-05] [P2]. Resuelto con reservas (2-nov-2026).** El manuscrito aceptado en PMC (PMC2914108) indica 13 pacientes con Alzheimer y 14 controles reclutados, y 12 y 12 analizados. La versión publicada (Elsevier) no se ha leído: ScienceDirect devuelve solo una página de redirección.
11. **[clinica-04] McCreedy et al. 2022. Resuelto (2-nov-2026).** La conclusión de los autores consta en el resumen de PubMed y ya se cita. La inferencia sobre la práctica fuera del ensayo no es verificable con ninguna fuente y no se cita como resultado.
12. **[escalas-01] Arjol et al. 2026. DOI resuelto (2-nov-2026):** Crossref y PubMed (PMID 42528410) confirman 10.70478/psicothema.2026.38.15. Sigue abierto solo el volumen y las páginas del metaanálisis (PMID 42380691): PubMed y Crossref lo registran como publicación anticipada, sin volumen ni páginas; hace falta la publicación definitiva.
13. **[escalas-06] Gómez-Gallego et al. 2012. Resuelto (2-nov-2026):** Crossref y PubMed (PMID 21570161) confirman el DOI 10.1016/j.nrl.2011.03.006.

### Autores y datos de identificación sin transcribir

14. **[escalas-01]. Resuelto (2-nov-2026):** nueve autores de Arjol et al. 2026 (PMID 42380691), ocho de Nasreddine et al. 2005 (PMID 15817019) y ocho de Arjol et al. 2026 en Psicothema (PMID 42528410), según PubMed y Crossref.
15. **[escalas-02]. Resuelto (2-nov-2026):** PubMed da los diez autores de Lobo et al. 1999 (PMID 10422057), solo con iniciales; se transcriben así.
16. **[clinica-04]. Resuelto (2-nov-2026):** PubMed da los doce autores de McCreedy et al. 2022 (PMID 35038407).
17. **[escalas-03]. Resuelto (2-nov-2026):** PubMed da cinco autores en cada caso (PMID 12084358 y 16317587), solo con iniciales.
18. **[escalas-06]. Resuelto (2-nov-2026):** PubMed y Crossref dan tres autores, solo con iniciales (M. Gómez-Gallego, J. Gómez-Amor, J. Gómez-García).
19. **Pistas sin autores completos. Resuelto (2-nov-2026)** desde PubMed o Crossref, en las entradas [clinica-01], [clinica-02], [clinica-04] y [clinica-05]. Lista original: Gaviola et al. 2020 (PMID 30912616); Baird et al. 2018 (PMID 30320586); Garrido et al. 2018 (PMID 29966193); Simmons-Stern et al. 2012 (PMID 23000133); Moreira et al. 2018 (PMID 29988347) y 2023 (PMID 37998404); Moltrasio y Rubinstein 2025 (PMID 41105815); Cheung et al. 2025 (PMID 40148224); Hillebrand et al. 2023 (doi 10.1002/gps.5893); Raglio et al. 2015 (doi 10.1111/jgs.13558); MATCH 2025 (PMID 41041461).
20. **NICE NG97:** transcribir el título completo desde la página de NICE; el registro no lo contiene. Consulta del 2-nov-2026: NICE no figura entre las fuentes permitidas en esta revisión, y Europe PMC no lo contiene en la búsqueda del 2-nov-2026. Sigue abierto.
21. **[legal-04]:** la traducción al español de la Declaración de Helsinki no está verificada. Citar la versión inglesa o verificar una traducción oficial. Sigue abierto: la WMA no figura entre las fuentes permitidas; la cita usa la versión inglesa.
22. **[audio-05]. Resuelto en Crossref (2-nov-2026):** el campo de página del registro del DOI 10.21437/Interspeech.2006-84 es «paper 2007-Tue3FoP.10-0». ISCA Archive no se ha consultado.

### Dictamen jurídico (no son fallos de verificación)

23. **[legal-02] LOPDGDD, disposición adicional decimoséptima.** Las cuatro correcciones de la entrada 26 se han aplicado y verificado en el texto consolidado del BOE (2-nov-2026). Queda abierto solo el dictamen jurídico: decidir si el estudio entra en el ámbito del apartado 1 (leyes listadas, entre ellas la Ley 14/2007).
24. **[legal-05] TRLPI, arts. 112 y 114-119.** Los textos de estos puntos están verificados en el BOE consolidado (2-nov-2026). Queda abierto el dictamen jurídico antes de calcular cualquier plazo de grabación. Puntos para el dictamen: el cómputo desde el 1 de enero del año siguiente (art. 119, párrafo 2); la exigencia de publicación o comunicación lícita dentro del plazo (art. 112, párrafo 2); y la aplicación de la disposición transitoria vigésima primera, apartado 3, a grabaciones protegidas a 1 de noviembre de 2013.
25. **[legal-06] Cita completa de la Directiva (UE) 2019/790.** El título oficial corregido procede de la copia del BOE del DOUE L 130; EUR-Lex no se consultó. Confirmar la cita en el DOUE original (EUR-Lex no es fuente permitida en esta revisión). El título de la Directiva y el Libro cuarto (arts. 65 a 80) se confirman en el RDL 24/2021 (BOE-A-2021-17910, consulta del 2-nov-2026). La inferencia sobre empresas (art. 2.1 frente a los arts. 3 y 4) requiere dictamen.
26. **[legal-01] RGPD.** Consultar el DOUE L 119 en EUR-Lex (HTTP 202 en la verificación). Hasta entonces se usa la copia del BOE. Sigue abierto: EUR-Lex no figura entre las fuentes permitidas en esta revisión.
27. **[legal-03] Ley 14/2007.** Dictamen sobre la terminología («incapacitación», arts. 4.2 y 20). La Ley 8/2021 queda confirmada en el BOE: BOE-A-2021-9233, «Ley 8/2021, de 2 de junio, por la que se reforma la legislación civil y procesal para el apoyo a las personas con discapacidad en el ejercicio de su capacidad jurídica» (publicada el 3-jun-2021; vigencia el 3-sep-2021; consulta del 2-nov-2026). Queda abierto solo el dictamen sobre la terminología.

### Revisión del 2 de noviembre de 2026

28. **[clinica-01] Separación de música personal y genérica.** No consta verificado si la revisión Cochrane de 2025 separa la música personalizada de la genérica. Es la comparación que necesita H1. Confirmar en el texto completo. Consulta del 2-nov-2026: el resumen de PubMed (PMID 40049590) compara con «usual care» y con «other activities, with or without music»; no menciona música personalizada ni genérica (no aparecen los términos personal, individualised, preferred ni familiar; «individual» se refiere al formato, con siete estudios individuales). El texto completo no es accesible: Cochrane Library devuelve HTTP 419, Wiley HTTP 403 con desafío de navegador, PubMed Central no devuelve el texto y Europe PMC no lo tiene en acceso abierto. Sigue abierto: leer CD003477.pub5 completo.
29. **[clinica-02] DOI de Baird et al. 2018 y Garrido et al. 2018.** Los DOI se confirmaron el 2-nov-2026 en Crossref y PubMed (10.3233/JAD-180627 y 10.3233/JAD-180084). Sigue abierto: el resumen de Garrido et al. describe listas basadas en preferencias personales y no menciona la familiaridad; no se puede afirmar si separa familiaridad y preferencia sin el texto completo.
30. **[clinica-04] Cheung et al. 2025.** Resuelto (2-nov-2026): PubMed (PMID 40148224) da el título «A Randomized Controlled Feasibility Study»; se cita como estudio aleatorizado de viabilidad, con 24 reclutados y el resultado del resumen.
31. **[clinica-04] Frase sobre barreras del ensayo.** Resuelto (2-nov-2026): el resumen de PubMed de McCreedy et al. 2022 (PMID 35038407), en «Conclusions and implications», dice: «Barriers to full implementation included engaging frontline nursing staff and identifying resident's preferred music».
32. **[clinica-05] Moreira et al. 2018 y 2023.** Resuelto (2-nov-2026): Crossref y PubMed confirman los DOI 10.1590/1980-57642018dn12-020005 y 10.3390/healthcare11222912; el título y el resumen de 2023 describen un ensayo doble ciego. El resumen de 2018 habla de «memory» sin precisar el tipo, y la entrada no lo especifica.
33. **[clinica-05] Moltrasio y Rubinstein 2025.** Resuelto (2-nov-2026): el resumen de PubMed (PMID 41105815) dice «They viewed positive, negative and neutral pictures», es decir, imágenes; la música se aplica después de esa fase.
34. **[escalas-01] Alcance de la muestra de Arjol et al. 2026 (Psicothema).** Resuelto (2-nov-2026): el resumen de PubMed (PMID 42528410) dice «cognitive impairment-free Spanish community sample» y «assessed in primary care centers»; las dos descripciones son compatibles.
35. **[B1] Iniciales de los autores.** La comprobación da «Smaling HJ» y «Scholten RJ»; el registro de existentes da «HJA» y «RJPM». Resuelto (2-nov-2026): Crossref (10.1002/14651858.CD003477.pub4) da «Hanneke JA Smaling» y «Rob JPM Scholten», la forma que usa la entrada; PubMed las abrevia («HJ» y «RJ»).

## Desviaciones

- **Fusión de identificadores:** B1-2025 con [clinica-01]; B2 con [clinica-06]; B6 con [clinica-03]; P2 con [clinica-05]; P4 con [audio-01]. Cada obra tiene una sola entrada con sus alias. B1 (2018) es otra obra y tiene entrada propia.
- **Estados combinados:** cuando dos identificadores describen la misma obra con estados distintos, la entrada muestra ambos. No se ha cambiado ningún estado de los registros de verificación.
- **B4:** se mantiene como verificada según verificadas-existentes. La discrepancia con [clinica-03] queda abierta en Pendientes y no se ha resuelto.
- **Pistas:** las referencias verificadas sin identificador propio se describen dentro de la entrada que las menciona. No tienen entrada propia ni alias.
- **Autores:** cuando el registro de verificación no transcribe todos los autores, la entrada usa «et al.» y el caso va a Pendientes. No se han tomado autores ni datos de los ficheros brutos del scratchpad; solo se usan los cinco registros de verificación.
- **Documentos:** ALZHEIMER_RESEARCH.md, METHODOLOGY.md y SECURITY.md existen en el worktree (sin commit). El uso de cada identificador consta por documento y sección en su entrada; el de docs/audio-processing/COMPRESSION.md, fuera de esta revisión, con su línea.
- **Eliminado de la versión anterior:** la «nota de prensa» de B2 (no figura en el registro de verificación); el DOI pendiente de B6 (resuelto); la nota de «tamaño indirecto» de B5 (resuelta con el resumen de PubMed).
- **Cambios en otros documentos:** RESEARCH.md está corregido (ver «Cambios aplicados en RESEARCH.md» más arriba). docs/audio-processing/COMPRESSION.md: línea 264 (BS.1534 sin versión), línea 265 (RFC 6716 como «Proposed Standard», cuando consta Standards Track) y línea 274 (la nota sobre Gray y Markel dice que el registro no está confirmado, y ya lo está). CHANGELOG.md y ROADMAP.md mencionan el RGPD de forma genérica.
- **Legal-05:** la disposición transitoria vigésima primera, apartado 3, procede de la corrección del registro; en la comprobación consta como omitida y no como texto verificado en el BOE.
- **Hipótesis:** el mapeo H1-H5 procede de los registros de verificación y de PROJECT_MASTER.md. Cuando el registro dice «marco», no se asigna ninguna hipótesis. Las valoraciones del candidato (p. ej., la de [clinica-03]) se indican como tales y no como hallazgos del artículo.
- **Fecha:** la verificación se hizo el 2026-11-02, y el fichero sustituye a la versión del 2026-10-31.
- **Discrepancias en otros documentos (no modificados en esta revisión):** (a) La pista de Garrido et al. 2018 atribuye al resumen un resultado sobre la ansiedad que el resumen no comunica: RESEARCH.md, líneas 45, 83 y 97; METHODOLOGY.md, línea 90. (b) Afirmaciones que esta revisión deja desactualizadas: RESEARCH.md, líneas 174 a 180, 184, 185 y 189; ALZHEIMER_RESEARCH.md, líneas 111, 129, 147 (la página de Cambridge sí se consultó y lista cinco autores), 155, 162 a 166, 192 y 203; METHODOLOGY.md, líneas 45, 410, 415, 417, 420, 421, 423 y la fila de [clinica-03] de la tabla (línea 452); SECURITY.md, líneas 62 y 82 (la Ley 8/2021 y la disposición transitoria vigésima primera, apartado 3, ya constan en el BOE).








