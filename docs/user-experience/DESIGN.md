# Reminiscencia: especificación de diseño

**Versión:** 1.0, cierre de diseño (31-oct-2026)
**Base:** propuesta A, la mejor valorada (66,5 de 75 puntos sumados por los tres jueces). Se incorporan los aportes de B (61,5) y C (65,5) que mejoran accesibilidad, tableta o funciones.
**Ubicación prevista:** `docs/user-experience/DESIGN.md`

> **Pendiente de rediseño (2026-11-02):** replicar la estructura de Apple Music web, decisión del propietario. Hasta el rediseño, las secciones de identidad visual y de estado visual se dejan como estaban.

---

## 1. Objetivo y alcance

Reminiscencia es una escucha de música para personas con deterioro cognitivo (Alzheimer) y para sus cuidadores. La interfaz debe permitir evaluar tres hipótesis del proyecto doctoral: la familiaridad de la canción, los recuerdos autobiográficos y el efecto de la fotografía asociada.

Alcance de esta fase:

- Aplicación web progresiva (PWA) en HTML, CSS y JavaScript sin framework, que funciona sin conexión. La app Android empaqueta las mismas pantallas.
- Dos modos: **paciente** (escucha) y **cuidador** (configuración, registro y revisión).
- Perfiles, fotografías, recuerdos, observaciones e historial se guardan solo en el navegador del cuidador.
- Sin administración, cuentas, sincronización en la nube, publicidad ni scripts de terceros.
- Fuera de alcance: importar audio desde el dispositivo (las canciones vienen del catálogo del proyecto) y extraer audio de plataformas de streaming.

## 2. Principios

1. **Escuchar sin decidir.** El paciente tiene pocos controles, siempre visibles, con etiqueta visible y sin gestos ocultos.
2. **Disposición estable.** Portada, fotografía y recuerdo ocupan la misma posición y el mismo tamaño en todas las condiciones del estudio.
3. **Proporción.** Grande donde trabaja el paciente (portada, controles, texto del recuerdo). Compacto donde trabaja el cuidador (tablas de 40 px, paneles de 320 px).
4. **Un acento de acción y una señal semántica.** El verde azulado marca la acción y el estado activo. El cálido «Recuerdo» aparece solo en recuerdos y fotografías, siempre con la palabra.
5. **Ningún dato depende solo del color, del puntero o de un gesto.**
6. **Lenguaje claro.** Los botones usan verbos. En el modo paciente, las frases tienen hasta 15 palabras y no usan pronombres.
7. **Estructura de app de música, identidad propia.** Navegación lateral o inferior, secciones con «Ver todas», reproductor persistente y panel «Ahora suena». No se usa ningún logotipo, icono de marca, imagen, texto ni hoja de estilo de ninguna web. Las referencias externas se consultaron de forma parcial, y el diseño no depende de ellas.

## 3. Mapa de pantallas y navegación

### 3.1 Modo paciente

Cuatro destinos fijos: **Escuchar** (inicio), **Listas**, **Carpetas** y **Buscar**. Por debajo de 768 px, la navegación es una barra inferior de 72 px; desde 768 px, es un raíl izquierdo de 112 px. La cabecera mide 64 px: título de la pantalla (H1) a la izquierda y botón **Cuidador** a la derecha.

| ID | Pantalla | Contenido y reglas |
|---|---|---|
| P1 | Escuchar | Pantalla inicial. Portada, título, artista, progreso, controles con etiqueta, volumen, zona de fotografía y zona de recuerdo. Al abrir la app no suena nada. Si el perfil tiene una última pista, aparece en pausa. |
| P1b | Recuerdo ampliado | Se abre al pulsar la fotografía o «Leer todo». Fotografía a ancho completo con «+» y «−» de 56 px, texto completo y «Cerrar» de 56 px. Al cerrar, el foco vuelve al disparador. |
| P2 | Listas | «Seguir escuchando» (últimas 6 listas), «Mis listas» (cuadrícula; «Ver todas» desde la séptima) y «Para [alias]» (canciones con preferencia «Le gusta», hasta 6 y «Ver todas»; se oculta si está vacía). |
| P2b | Lista | Nombre, número de canciones, «Reproducir lista» (64 px) y filas de 88 px. |
| P3 | Carpetas | Cuadrícula de todas las carpetas de la biblioteca. Una carpeta vacía muestra «Vacía» y no se abre. |
| P3b | Carpeta | «Reproducir carpeta» (64 px) y filas de 88 px. Si está vacía: «No hay canciones en esta carpeta todavía.» |
| P4 | Buscar | Campo con etiqueta visible «Buscar», botón «Buscar» de 64 px y categorías grandes: «Por artista», «Por década», «Por carpeta», «Por lista». Los resultados aparecen al pulsar «Buscar» o Intro, nunca mientras se escribe. Sin resultados: «No hay canciones con «[texto]». Prueba con el nombre de un artista.» |
| P5 | Volver al modo cuidador | Con PIN: teclado de PIN. Sin PIN: diálogo de confirmación. Acción principal «Seguir escuchando»; secundaria «Volver al modo cuidador». Escape equivale a «Seguir escuchando». «Olvidé el PIN» quita solo el PIN, tras confirmación. |
| P6 | Aviso de apagado | Diálogo 30 s antes del apagado programado: «La música se para en 30 segundos.», con «Seguir 15 minutos más» (64 px) y «Parar ahora». Sin respuesta, la música se pausa; la app no se cierra. |

**Mini reproductor.** En P2, P2b, P3, P3b y P4 aparece una barra de 72 px con el título (un toque abre P1) y el botón reproducir/pausar de 56 px. Va encima de la barra inferior en teléfono y en la base del contenido en tableta y escritorio.

### 3.2 Modo cuidador

Cuatro destinos: **Inicio**, **Biblioteca**, **Perfiles** y **Ajustes**. El acceso al modo paciente es el botón **Abrir modo paciente**, en Inicio y, en escritorio, en la barra lateral.

| ID | Pantalla | Contenido y reglas |
|---|---|---|
| C1 | Inicio | Perfil activo y «Abrir modo paciente». Pendientes (canciones sin familiaridad, recuerdos sin fotografía, listas vacías) con enlace. Última sesión y resumen del día. Avisos: copia con más de 14 días, almacenamiento por encima del 80 %, almacenamiento persistente no concedido, registro del estudio activo, app no instalada en iOS. |
| C2 | Biblioteca | Tabla de canciones del catálogo, con búsqueda (Ctrl/Cmd+K), filtros (Todas, Sin familiaridad, Con recuerdo, Sin conexión) y selección múltiple con barra de acciones. Las carpetas están en la barra lateral (escritorio) o en un menú (resto). El catálogo es de solo lectura. |
| C2b | Panel de canción | Ficha de la canción seleccionada o, sin selección, de la que suena (C-20). |
| C3 | Perfiles | Tarjetas con alias, código de participante opcional, canciones asociadas, recuerdos y última sesión. «Nuevo perfil» abre C3e. |
| C3a | Perfil | Alias editable, código, «Opciones del paciente» (C3f) y cinco pestañas. **Canciones**: familiaridad, preferencia y presentación de cada canción, con «Asociar canciones». **Recuerdos**: lista y «Nuevo recuerdo». **Listas**: listas del perfil y «Nueva lista». **Observaciones**: cronológicas, con «Nueva observación». **Historial**: escuchas agrupadas por día con resumen diario; filtros por fechas, sesión y presentación; «Exportar CSV». |
| C3b | Editor de lista | Nombre (obligatorio, 60 caracteres), canciones con «Subir» y «Bajar», «Quitar» con «Deshacer» y «Guardar sin conexión». |
| C3c | Editor de recuerdo | Título (obligatorio, 80 caracteres), texto (1000, con contador), año (cuatro cifras o «Año aproximado»), personas (alias), canciones, fotografías (máximo 10, cada una con descripción) y «Ver como lo ve el paciente» (no registra). Borrador automático cada 5 s. Pie fijo con «Guardar recuerdo». |
| C3d | Nueva observación (hoja) | Fecha y hora (por defecto, ahora), canción opcional (vinculada a la reproducción en curso si la hay), ocho etiquetas cerradas (8.5) y nota libre de 500 caracteres. |
| C3e | Asistente de primer perfil | Tres pasos: 1) alias y código; 2) canciones iniciales (opcional); 3) PIN, recomendado y activado por defecto. «Ahora no» muestra el aviso: «Sin PIN, el paciente puede volver al modo cuidador sin código.» |
| C3f | Opciones del paciente (hoja) | Por perfil: límite de volumen (50–100 %, 100 % por defecto), «Repetir lista» (Sí), «Reanudar al abrir» (No), «Saltar al tocar la barra» (No). |
| C4 | Empezar sesión (hoja) | Perfil (por defecto, el activo); punto de inicio opcional (lista o carpeta); condición «Según cada canción» (por defecto) o «Solo audio»; apagado automático «No» (por defecto), 15, 30 o 60 minutos; botón «Empezar». |
| C5 | Ajustes | Apariencia y accesibilidad, arranque del dispositivo, PIN local, copia cifrada, almacenamiento y sin conexión, registro del estudio y ayuda. |

**Vista previa.** Desde Biblioteca y Perfiles (en teléfono, dentro del menú de la cabecera), «Vista previa» muestra el modo paciente con una barra «Vista previa como paciente» y «Volver al modo cuidador», sin PIN. No crea sesión ni registra eventos.

### 3.3 Cambios de modo y arranque

- **Cuidador a paciente:** «Abrir modo paciente», después C4 y P1. No pide PIN. Sin perfil, aparece «Crea un perfil antes de abrir el modo paciente.»
- **Paciente a cuidador:** «Cuidador», después P5. Con PIN, teclado; sin PIN, confirmación. Al salir se cierra la sesión de escucha en el registro, pero la reproducción no se detiene.
- **Arranque:** el primer uso ofrece «Modo cuidador» (asistente C3e) o «Modo paciente» (solo si ya hay un perfil). Después, la app abre en el último modo. El ajuste del dispositivo «Abrir siempre en modo paciente» (No por defecto) lo fuerza en tabletas compartidas.

## 4. Puntos de ruptura

| Intervalo | Modo paciente | Modo cuidador |
|---|---|---|
| 360–767 px | Barra inferior de 72 px. Escuchar en una columna. Mosaicos de 2 columnas. | Barra inferior de 64 px. Tarjetas de 72 px. Hojas inferiores. |
| 768–1023 px | Raíl de 112 px. Escuchar en dos columnas (300 px y resto). Mosaicos de 3 columnas. | Raíl de 88 px (desde 600 px). Tabla sin preferencia ni presentación (van en el panel). Panel superpuesto de 320 px. |
| 1024–1279 px | Raíl de 112 px. Escuchar en dos columnas (280 px y resto). Mosaicos de 4 columnas. | Raíl de 88 px. Tabla completa. Panel superpuesto de 320 px. |
| ≥1280 px | Raíl de 112 px. Escuchar centrado en 1120 px (360 px y resto). Mosaicos de 4 columnas. | Barra lateral de 232 px con carpetas. Panel superpuesto de 320 px entre 1280 y 1439 px; persistente desde 1440 px. |

**Referencias de aceptación:** 390×844 (teléfono), 820×1180 (tableta vertical), 1024×768 (tableta horizontal) y 1440×900 (escritorio). Los dos primeros anchos caen en el intervalo de teléfono y de tableta vertical respectivamente; los dos últimos, en tableta horizontal y escritorio.

**Presupuesto de altura de Escuchar (paciente).** Cabecera 64 + relleno 16 + portada + 16 + título 72 + artista 28 + 16 + progreso 56 + 8 + transporte 120 + 16 + volumen 56 + relleno 16 = 482 px + portada. La portada es 232 px en 390 px de ancho (786 px con la barra inferior, de 844), 300 px en 820 px (782 px de 1180), 280 px en 1024 px (762 px de 768) y entre 240 px y 360 px en escritorio (en 1440×900, 360 px: 842 px de 900).

## 5. Tokens

### 5.1 Color

Valores hexadecimales sRGB. Contraste calculado con luminancia relativa WCAG (5.2).

| Token | Claro | Oscuro | Alto contraste claro | Alto contraste oscuro | Uso |
|---|---|---|---|---|---|
| fondo | #F6F4EE | #121512 | #FFFFFF | #000000 | Página |
| superficie-1 | #ECE9E0 | #1A1E1B | #F0F0F0 | #0A0D0A | Cabecera, raíl, barras inferiores |
| superficie-2 | #FFFFFF | #232824 | #FFFFFF | #101410 | Tarjetas, campos, zona de fotografía |
| superficie-3 | #E2DFD4 | #2D332E | #E6E6E6 | #1C221D | Fila activa, pulsado, pista de progreso |
| borde-control | #6B7268 | #8C9689 | #4A5148 | #BFC7BC | Bordes de campos y botones secundarios |
| borde-suave | #D6D0C2 | #343B35 | #B0B0B0 | #4D4D4D | Separadores decorativos (nunca transmiten información) |
| texto | #1A1D1A | #F3EFE6 | #000000 | #FFFFFF | Texto principal |
| texto-2 | #3F463F | #C9CEC4 | #1A1A1A | #E6E6E6 | Texto secundario |
| texto-3 | #545B53 | #A9B1A6 | #1A1A1A | #E6E6E6 | Metadatos |
| deshabilitado | #8A9187 | #6F786D | #6E746C | #8F968D | Controles inactivos (exentos de contraste) |
| acento | #0B6B57 | #7ED8BC | #004D3F | #A6F5DC | Acción principal, progreso, estado activo |
| acento-fuerte | #084F41 | #5CC7A6 | #003A30 | #8FEBD0 | Pulsado |
| sobre-acento | #FFFFFF | #0B120E | #FFFFFF | #000000 | Texto e icono sobre acento |
| acento-suave | #D5EDE6 | #1F3B33 | #D5EDE6 | #0F2A22 | Fila activa, chip seleccionado |
| recuerdo | #9A3F25 | #F2A07F | #6E2A18 | #FFC2AD | Solo recuerdos y fotografías, siempre con la palabra «Recuerdo» |
| foco | #9A4D00 | #FFD25A | #7A3E00 | #FFE066 | Anillo de enfoque |
| peligro | #A8321E | #FF9B8A | #8A1F10 | #FFB4A8 | Errores y borrados |
| sobre-peligro | #FFFFFF | #2A0E0B | #FFFFFF | #000000 | Texto sobre peligro |

**Modo por defecto:** paciente en claro; cuidador en automático (sigue el sistema). El ajuste «Contraste: Alto» usa la columna de alto contraste; también se activa con `prefers-contrast: more` si el sistema lo pide.

### 5.2 Contraste medido (WCAG 2.2)

- **Claro:** texto/fondo 15,47:1; texto/superficie-3 12,75:1; texto-2/superficie-3 7,29:1; texto-3/fondo 6,37:1; texto-3/superficie-3 5,25:1; acento/fondo 5,87:1; acento/superficie-2 6,45:1; sobre-acento/acento 6,45:1; sobre-acento/acento-fuerte 9,52:1; foco/fondo 5,56:1; borde-control/superficie-2 4,96:1; peligro/superficie-2 6,69:1; recuerdo/superficie-2 6,75:1; acento (pulgar)/superficie-3 4,84:1; deshabilitado/superficie-2 3,24:1 (exento).
- **Oscuro:** texto/fondo 16,03:1; texto/superficie-3 11,26:1; texto-2/superficie-3 8,07:1; texto-3/superficie-2 6,80:1; acento/fondo 10,89:1; acento/superficie-2 8,88:1; sobre-acento/acento 11,23:1; foco/superficie-2 10,44:1; borde-control/superficie-2 4,88:1; peligro/superficie-2 7,36:1; recuerdo/superficie-2 7,22:1; acento (pulgar)/superficie-3 7,65:1; deshabilitado/superficie-2 3,27:1 (exento).
- **Alto contraste claro:** texto/fondo 21,00:1; texto-2/superficie-3 13,94:1; acento/fondo 9,84:1; sobre-acento/acento 9,84:1; foco/fondo 8,34:1; borde-control/fondo 8,20:1; recuerdo/fondo 10,46:1; peligro/fondo 9,19:1.
- **Alto contraste oscuro:** texto/fondo 21,00:1; texto-2/superficie-2 14,90:1; acento/fondo 16,72:1; sobre-acento/acento 16,72:1; foco/fondo 16,11:1; borde-control/fondo 12,11:1; recuerdo/fondo 13,57:1; peligro/fondo 12,35:1.

### 5.3 Tipografía

**Familia:** Atkinson Hyperlegible Next (SIL OFL 1.1), pesos 400, 600 y 700, autoalojada en WOFF2, con subconjunto latino (ñ, acentos, ¿, ¡). La precachea el service worker. Respaldo: system-ui, Arial, sans-serif. Cifras tabulares en tiempos, contadores y valores. Sin mayúsculas sostenidas ni cursiva en texto corrido.

**Escala de texto** (multiplicador `--escala`): Normal 1,00 (por defecto), Grande 1,25, Muy grande 1,50 y Máximo 1,75. Por encima de 1,50, las listas y «Escuchar» pasan a una columna. Las alturas mínimas de los controles crecen con el texto (en em).

**Paciente (base 22 px):**

| Rol | px / interlínea | Peso |
|---|---|---|
| H1 de la cabecera | 28/36 (menos de 768 px); 32/40 (desde 768 px) | 700 |
| Título de canción (H2 en Escuchar) | 28/36; 32/40 desde 768 px | 700 |
| Sección (H2) | 28/36 | 700 |
| Fila, tarjeta y título de recuerdo (H3) | 22/30 en filas y tarjetas; 28/36 en el título del recuerdo | 700 |
| Texto del recuerdo | 24/36, máximo 60 caracteres por línea | 400 |
| Etiqueta de control (botones, chips, transporte) | 20/28 | 700 |
| Artista en Escuchar | 20/28 | 400 |
| Metadatos y tiempos | 18/26 (tiempos, 20/28 tabulares) | 400 |
| Campo de búsqueda | 24/32 | 400 |
| Mínimo absoluto | 18 px | |

**Cuidador (base 15 px):**

| Rol | px / interlínea | Peso |
|---|---|---|
| H1 de pantalla | 24/30 | 700 |
| Sección (H2) | 18/24 | 700 |
| Título de fila, tarjeta y panel | 15/22 | 600 |
| Cuerpo | 15/22 | 400 |
| Etiqueta (botones, segmentos, pestañas) | 14/20 | 600 |
| Metadatos y ayudas | 13/18 | 400 |
| Cabecera de tabla | 12/16 | 600 |
| Mínimo absoluto | 13 px (12 px solo en cabeceras de tabla) | |

### 5.4 Tamaños, espaciado, radios, sombras, movimiento y foco

**Tokens de tamaño (px):**

| Token | Valor |
|---|---|
| Cabecera del paciente | 64 |
| Cabecera del cuidador | 56 |
| Barra inferior del paciente (menos de 768 px) | 72 (más área segura) |
| Barra inferior del cuidador (menos de 600 px) | 64 |
| Raíl del paciente (desde 768 px) | 112 |
| Raíl del cuidador (600–1279 px) | 88 |
| Barra lateral del cuidador (desde 1280 px) | 232 |
| Panel de canción | 320 |
| Reproductor del cuidador | 72 (mini de 64 en teléfono) |
| Fila de tabla del cuidador | 40 (desde 1024 px); 48 (600–1023 px); tarjeta de 72 (menos de 600 px) |
| Cabecera de tabla | 32 |
| Portada del paciente | 232 (teléfono; 216 a 360 px); 300 (768–1023 px); 280 (1024–1279 px); entre 240 y 360 (desde 1280 px, según la altura) |
| Fotografía (4:3) | 358×268 en 390 px (tras desplazar); 328×246 en 820 px; 395×296 en 1024–1279 px; altura máxima de 360 en escritorio |
| Objetivo táctil del paciente | 48 mínimo; controles principales de 56 a 96 |
| Objetivo del cuidador | 40 con puntero; 44 táctil; 24 mínimo legal (2.5.8) |

**Espaciado:** escala de 4, 8, 12, 16, 24, 32, 48 y 64 px. Paciente: márgenes de 16 px (teléfono) y 24 px (tableta y escritorio); separación entre controles táctiles de 16 px mínimo; entre bloques, 32 px. Cuidador: márgenes de 16 y 24 px; separación entre controles de 8 px; entre campos, 16 px; entre secciones, 24 px.

**Radios.** Cuidador: 6 (chips y miniaturas de tabla), 8 (botones y campos), 12 (tarjetas), 16 (hojas y diálogos). Paciente: 16 (botones rectangulares), 20 (tarjetas de recuerdo y mosaicos), 24 (portada y fotografía), 999 (transporte, chips y reproducir).

**Sombras.** Cuidador, claro: sh-1 `0 1px 2px rgba(26,29,26,0.10)` (tarjetas); sh-2 `0 6px 16px rgba(26,29,26,0.12)` (avisos y menús); sh-3 `0 16px 40px rgba(26,29,26,0.18)` (hojas y diálogos). Cuidador, oscuro: tarjetas sin sombra, con borde de 1 px `#343B35`; sh-2 `0 8px 24px rgba(0,0,0,0.45)`; sh-3 `0 16px 48px rgba(0,0,0,0.55)`. Paciente: sin sombras; la portada se separa del fondo por contraste de superficie.

**Movimiento.** Micro 120 ms (color, pulsado, foco); estándar 200 ms (paneles, hojas, avisos); énfasis 280 ms (hojas a pantalla completa); fundido de fotografía de 300 ms (solo opacidad, una vez por pista). Curva `cubic-bezier(0.2, 0, 0, 1)`. Con reducir movimiento activo: todas las duraciones a 0 ms, sin desplazamientos ni escalas, y el fundido de fotografía pasa a corte. No hay animaciones en bucle; la carga muestra «Cargando…» sobre un bloque fijo. Ningún elemento supera 3 destellos por segundo.

**Anillo de enfoque.** Paciente: 4 px sólidos de `foco`, separados 3 px con el color de superficie. Cuidador: 2 px sólidos de `foco`, separados 2 px. El anillo mantiene 3:1 sobre cualquier superficie.

**Iconos.** Trazo de 2 px; 20–24 px en el cuidador y 28–40 px en el paciente. Conjunto propio. No se usan iconos de marcas ni conjuntos con licencia incompatible.

## 6. Componentes

### 6.1 Modo paciente

- **P-1 Cabecera (64 px).** Fondo superficie-1 y borde inferior de 1 px borde-suave. H1 a la izquierda. Botón **Cuidador**: alto de 56 px, ancho mínimo de 120 px, icono de candado de 24 px (solo con PIN) y texto 18/24 700. Estados: normal (superficie-2 con borde de 2 px borde-control), enfoque (anillo de 4 px) y pulsado (superficie-3).
- **P-2 Barra inferior (menos de 768 px).** 72 px más área segura. Cuatro destinos iguales (mínimo 90 px), icono de 28 px y etiqueta 18/24 700. Activo: indicador superior de 4 px en acento, fondo acento-suave y `aria-current="page"`.
- **P-3 Raíl (desde 768 px).** 112 px de ancho; destinos de 96 px de alto; icono de 36 px; etiqueta 18/24 700. Activo: fondo acento-suave y barra lateral de 6 px en acento.
- **P-4 Portada.** Cuadrada, radio 24 px, sin sombra (tamaños en 5.4). Sin portada: superficie-3 con la inicial en 96 px, peso 700 y color texto-2. No es interactiva. Texto alternativo «Portada de [álbum], [artista]»; vacío si el título ya aparece junto a ella.
- **P-5 Título y artista.** Título en H2 (máximo dos líneas; se reservan 72 px). Artista en una línea, con puntos suspensivos si no cabe. Sin reproducción: «No suena nada. Elige una lista o una carpeta.», con «Ir a Listas» e «Ir a Carpetas» de 56 px.
- **P-6 Progreso.** Zona de 56 px. Pista de 12 px (relleno en acento; resto en superficie-3 con borde de 1 px borde-control). Pulgar de 32 px (acento con borde de 2 px superficie-2). Tiempos 20/28 tabulares a los lados. Por defecto es informativo; si el cuidador activa «Saltar al tocar la barra» (C3f), un toque salta a ese punto y el arrastre queda como opción con alternativa de toque. Rol `slider` y `aria-valuetext` («1 minuto 12 segundos de 3 minutos 45 segundos»). Sin pista: deshabilitado en 0:00.
- **P-7 Transporte.** Fila de 272 px: Anterior (72 px), Reproducir/Pausar (96 px) y Siguiente (72 px), separados 16 px. Etiquetas visibles debajo (20/24 700). Reproducir: fondo acento e icono de 40 px en sobre-acento; pulsado en acento-fuerte; durante la reproducción dice «Pausar». Anterior y Siguiente: superficie-2 con borde de 2 px borde-control e icono de 32 px; pulsados, superficie-3. Sin pista: `aria-disabled="true"`. Anterior siempre va a la pista anterior, sin reiniciar la actual.
- **P-8 Volumen.** Fila de 264 px: «Bajar volumen» (56 px), diez segmentos de 10×24 px separados 4 px (decorativos, `aria-hidden`, rellenos hasta el nivel actual) y «Subir volumen» (56 px). Paso del 10 %. No supera el límite del perfil. Al cambiar, `aria-live="polite"` anuncia «Volumen 6 de 10». Los botones se deshabilitan en el mínimo y en el límite.
- **P-9 Fotografía.** Relación 4:3, radio 24 px, superficie-2 con borde de 1 px borde-suave. Sin fotografía: icono de 48 px (decorativo) y «Sin fotografía» 18/26 en texto-2. Varias fotografías: fila de 56 px bajo la imagen, con «Foto anterior», «1 de 3» y «Foto siguiente»; sin pase automático. Tocar la fotografía abre P1b y registra «fotografía ampliada». Cambio de foto: fundido de 300 ms. Texto alternativo: la descripción del cuidador; si falta, «Fotografía del recuerdo «[título]»».
- **P-10 Tarjeta de recuerdo.** Fondo superficie-2, radio 20 px, relleno de 24 px (16 en teléfono) y franja izquierda de 6 px en `recuerdo`. En orden: etiqueta «Recuerdo» 20/28 600 en `recuerdo`; título (H3, 28/36 700); año y personas 18/26; texto 24/36 con cuatro líneas visibles (si es más largo, el área se desplaza con `tabindex="0"` y nombre «Texto del recuerdo»); «Leer todo» de 56 px (abre P1b) y «Otro recuerdo» de 56 px si hay más de uno (registra el evento). Sin recuerdo: «Sin recuerdo guardado» 18/26 en el lugar del título y del texto. La altura de la tarjeta es igual en todas las condiciones (354 px en tableta y escritorio con título de una línea).
- **P-11 Mosaico de lista o carpeta.** Portada cuadrada de radio 20 px con el ancho de la columna; título 22/30 700 (máximo dos líneas); metadato 18/26 («12 canciones»). Columnas: 2 (menos de 768 px), 3 (768–1023 px) y 4 (desde 1024 px); separación de 16 o 24 px. Con escala de texto de 1,50 o más, una columna. Toda la tarjeta es el botón. Vacía: «Vacía» y no se abre. Pulsado: acento-suave. Enfoque: anillo de 4 px.
- **P-12 Fila de canción.** Alto de 88 px; relleno horizontal de 16 px (teléfono) o 24 px. Portada de 64 px (teléfono) o 72 px (tableta), radio 12. Título 22/30 700 (máximo dos líneas); artista 18/26. Botón de reproducir de 48×48 a la derecha. Activa: fondo acento-suave, barra izquierda de 6 px en acento y subtítulo «Suena: [artista]». Sin copia sin conexión: «No disponible sin internet» en texto-2 con icono; fila con `aria-disabled`.
- **P-13 Botones de acción.** Primario (Reproducir lista, Reproducir carpeta, Buscar): alto de 64 px, fondo acento y texto sobre-acento. Secundario (Ver todas, Leer todo, Otro recuerdo, Cerrar, Ir a Listas): alto de 56 px, superficie-2 y borde de 2 px borde-control. Etiqueta 20/28 700, relleno horizontal de 24 px, radio 16. Pulsado: acento-fuerte (primario) o superficie-3 (secundario). Enfoque: anillo de 4 px.
- **P-14 Chips de categoría (Buscar).** Alto de 64 px, radio 999, ancho mínimo de 160 px (dos columnas en teléfono), etiqueta 22/28 600. Pulsado: acento-suave.
- **P-15 Búsqueda.** Etiqueta visible «Buscar» 20/28 700 encima del campo. Campo de 64 px, texto 24/32, borde de 2 px borde-control y radio 16. Ayuda 18/26 «Escribe un título o un artista» en texto-2. Botón «Buscar» (P-13) debajo en teléfono y a la derecha desde 768 px. «Borrar búsqueda» de 56 px al escribir. `enterkeyhint="search"`; autocorrección, mayúsculas y autocompletado desactivados. Los resultados aparecen en P4 al pulsar Buscar o Intro.
- **P-16 Teclado de PIN.** Indicadores de 20 px (4 o 6, según el PIN). Teclas de 72×72 px (teléfono) o 80×80 px (desde 768 px), separadas 16 px; dígitos 32/40 600. «Borrar» del mismo tamaño. «Mostrar PIN» y «Olvidé el PIN» de 48 px. Admite pegar. Tras cinco fallos: teclas deshabilitadas y «Vuelve a intentarlo en 45 s» 20/28, con cuenta atrás. No hay pruebas de memoria.
- **P-17 Diálogo de salida (P5).** Dos botones de 64 px a ancho completo (teléfono) o de 280 px (escritorio). Primario «Seguir escuchando» (foco inicial); secundario «Volver al modo cuidador».
- **P-18 Mini reproductor.** 72 px. Título 20/28 600 en una línea (un toque abre P1). Botón reproducir/pausar de 56 px. Sin volumen.
- **P-19 Banda sin conexión.** Banda de 48 px bajo la cabecera, con icono y «Sin internet: se escuchan las canciones guardadas» (18/26). Aparece solo sin conexión.

### 6.2 Modo cuidador

- **C-1 Cabecera (56 px).** H1 24/30 700. Selector de perfil activo (chip de 36 px; alias truncado a 24 caracteres). «Vista previa» (secundario de 40 px) en Biblioteca y Perfiles. Búsqueda de 320 px en Biblioteca (Ctrl/Cmd+K).
- **C-2 Navegación.** Barra lateral de 232 px (desde 1280 px): nombre de la app en texto (16/24 600, sin logotipo), destinos de 40 px (icono de 20 px y etiqueta 14/20 600), lista colapsable de carpetas (filas de 28 px con recuento) y «Abrir modo paciente» (40 px, primario) al pie. Raíl de 88 px (600–1279 px): cuatro destinos de 64 px (icono de 24 px, etiqueta 13/18 600). Barra inferior de 64 px (menos de 600 px): cuatro destinos iguales.
- **C-3 Barra de reproducción.** 72 px (desde 600 px) o mini de 64 px encima de la barra inferior (menos de 600 px). Portada de 48 px; título 14/20 600 y artista 13/18 en una línea. Anterior y siguiente de 40 px (44 en teléfono); reproducir de 44 px (48 en teléfono); progreso con pista de 4 px dentro de una zona de 24 px; volumen de 120 px (desde 1024 px; actúa sobre el GainNode, sección 8). «Ahora suena» abre el panel (desde 1440 px, lo enfoca). Enfoque: anillo de 2 px. Sin pista: controles deshabilitados y fuera del orden de tabulación.
- **C-4 Fila de canción (tabla).** Alto de 40 px (desde 1024 px), 48 px (600–1023 px) o tarjeta de 72 px (menos de 600 px). Columnas desde 1024 px, en este orden: casilla de 24 px; título y artista (flexible, mínimo 220 px; artista en texto-2 en la misma línea); duración (56 px, a la derecha); familiaridad (156 px); preferencia (120 px); presentación (120 px) y menú (40 px). Separación de 12 px. Entre 600 y 1023 px: título y artista, familiaridad y menú. En teléfono, tarjeta con título, artista, familiaridad («3 de 5») y botón «Ficha» (44 px). Cabecera de tabla de 32 px (12/16 600). Estados: normal; hover solo con puntero (superficie-2 a superficie-3); enfoque (anillo interior de 2 px); seleccionada (acento-suave, casilla con comprobación y texto «Seleccionada» para lectores de pantalla); sonando (icono de altavoz y «Suena»); sin conexión («No descargada», 13/18 en texto-2).
- **C-5 Familiaridad (1 a 5).** Cinco botones cuadrados con el número visible: 28 px en la tabla (excepción documentada: cumple 2.5.8 con separación de 4 px), 36 px en el panel y 44 px en teléfono. Patrón `radiogroup` con flechas. Seleccionado: fondo acento, número en sobre-acento y comprobación. No seleccionado: superficie-2 con borde de 1 px borde-control. Leyenda 13/18: «1 No la reconoce · 2 Le suena poco · 3 Le suena algo · 4 La reconoce · 5 La reconoce bien».
- **C-6 Preferencia.** Segmentado de tres: «No le gusta» (−1), «Le da igual» (0) y «Le gusta» (+1). Alto de 36 px (panel y ficha) o 44 px (teléfono); mínimo de 96 px por segmento; etiqueta 14/20 600. Seleccionado: acento-suave, borde de 2 px en acento y comprobación. En la tabla (120 px), botón de 32 px que abre un menú con las tres opciones.
- **C-7 Presentación.** Segmentado de tres: «Solo canción» (C0), «Canción y recuerdo» (C1) y «Canción, foto y recuerdo» (C2). Alto de 56 px en el panel (dos líneas de 13/18) y de 36 px en ficha y teléfono. Valor inicial de cada asociación nueva: C0. En la tabla, botón de 32 px con las etiquetas cortas «Solo canción», «Recuerdo» o «Foto y recuerdo».
- **C-8 Chip de filtro.** Alto de 28 px (escritorio) o 36 px (teléfono); radio 6; relleno horizontal de 10 px; etiqueta 13/18 600; contador entre paréntesis. Seleccionado: acento-suave y comprobación de 12 px.
- **C-9 Botones.** Primario: alto de 40 px (puntero), 44 px (táctil) o 48 px (teléfono); relleno horizontal de 16 px; radio 8; etiqueta 14/20 600; fondo acento y texto sobre-acento. Pulsado: acento-fuerte. Secundario: mismas medidas, superficie-2 y borde de 1 px borde-control. Peligro: texto en peligro y borde de 1 px en peligro; solo tras un diálogo de confirmación. Deshabilitado: superficie-3 con texto deshabilitado. Enfoque: anillo de 2 px con separación de 2 px.
- **C-10 Botón de icono.** 40 px (puntero) o 44 px (táctil); icono de 20 px; nombre accesible obligatorio. Tooltip al recibir el foco o el puntero; Escape lo cierra; permanece mientras el puntero esté sobre él o el foco siga en el control.
- **C-11 Campo de texto.** Alto de 40 px (escritorio) o 48 px (teléfono); radio 8; borde de 1 px borde-control; etiqueta visible 14/20 600 encima (margen de 4 px); ayuda 13/18 en texto-3. Error: borde de 2 px en peligro, icono y texto 13/18 en peligro que indica la corrección («Falta el título»), enlazado con `aria-describedby`. Enfoque: borde de 2 px en acento y anillo de 2 px en foco.
- **C-12 Área de texto.** Alto mínimo de 120 px y máximo de 320 px. Contador 13/18 («812 de 1000»); desde el 90 % del límite muestra «Quedan 100 caracteres».
- **C-13 Interruptor.** Pista de 44×24 px, pulgar de 20 px y área táctil de 48 px de alto. Etiqueta a la izquierda y estado escrito («Activado» o «Desactivado»). Enfoque: anillo de 2 px.
- **C-14 Pestañas del perfil.** Alto de 40 px; indicador inferior de 2 px en acento; etiqueta 14/20 600. En teléfono, desplazables con áreas de 48 px.
- **C-15 Tarjeta de perfil.** 264×132 px (tres columnas en escritorio) o ancho completo (teléfono). Avatar de 56 px con la inicial sobre superficie-3; alias 18/24 600; metadatos 13/18; botones de 40 px. Activo: borde de 2 px en acento y texto «En uso».
- **C-16 Diálogo y hoja.** Diálogo de 480 px (escritorio) o ancho completo menos 32 px (teléfono); radio 16; relleno de 24 px; sh-3; título 18/24 600; cuerpo 15/22; botones de 40 px a la derecha (en teléfono, a ancho completo y apilados). El foco inicial va a la acción segura; Escape cierra y devuelve el foco. Hoja inferior (teléfono y tableta vertical): radio de 16 px arriba, asa de 40×4 px, altura máxima del 90 % y botón «Cerrar» siempre visible.
- **C-17 Aviso.** Ancho de 360 px (esquina inferior izquierda en escritorio; encima de la barra en teléfono); alto mínimo de 48 px; radio 8; sh-2; texto 14/20; «Deshacer» de 40 px; visible 10 s y en pausa mientras tiene foco o puntero. `role="status"`. Los errores (`role="alert"`) no se cierran solos. El paciente no tiene avisos flotantes.
- **C-18 Barra de selección múltiple.** Alto de 56 px, fija sobre la tabla: «3 seleccionadas» y acciones de 40 px (familiaridad y preferencia en lote, añadir a lista, quitar del perfil). Ctrl/Cmd+A selecciona las filas visibles.
- **C-19 Ordenar.** «Subir» y «Bajar» de 44 px (teléfono) o 40 px (escritorio); en escritorio, Alt+↑ y Alt+↓. Arrastrar es opcional, nunca la única vía.
- **C-20 Panel de canción («Ahora suena» o ficha).** Ancho de 320 px; relleno de 16 px. En orden: portada de 160 px; título 15/22 600 (máximo dos líneas); artista 13/18; familiaridad (C-5, con leyenda); preferencia (C-6); presentación (C-7); recuerdos vinculados (hasta dos miniaturas de 40 px); «Ver como lo ve el paciente» y «Registrar observación» (40 px); fuente y licencia (13/18). Sin selección ni reproducción: «No suena nada. Elige una canción en la biblioteca.» Desde 1440 px es persistente; entre 600 y 1439 px se superpone, sin mover el contenido, y se cierra con Escape o con un botón de 40 px. Presupuesto en 1440×900: 726 px de contenido sobre 772 disponibles (900 − 56 − 72).
- **C-21 Editor de recuerdo.** Desde 1280 px: dos columnas (formulario de 560 px y columna de 320 px con fotografías y canciones), sin panel lateral. Entre 600 y 1279 px: una columna. En teléfono: una columna y pie fijo de 72 px con «Cancelar» y «Guardar recuerdo» (48 px). Borrador automático cada 5 s en IndexedDB. Si se sale con cambios sin guardar, un diálogo pregunta. Error de título: «Escribe un título para guardar el recuerdo.»
- **C-22 Carga de fotografías.** Zona de arrastre de 160 px de alto (escritorio), con borde punteado de 2 px en borde-control. El botón «Elegir fotografías» de 40 px es obligatorio como alternativa. Miniaturas de 96 px (escritorio) o 80 px (teléfono), con campo de descripción de 40 px. Límites: 10 por recuerdo; hasta 10 MB por archivo; JPEG, PNG o WebP. Se reducen a 1600 px en el lado mayor (JPEG al 85 %) y se eliminan los metadatos EXIF, incluida la ubicación. Arrastrando sobre la zona: borde de 3 px en acento y «Suelta las fotografías aquí».
- **C-23 Observaciones.** Lista cronológica: fecha y hora, etiquetas, canción (si la hay) y nota. Hoja «Nueva observación» (C3d): etiquetas como casillas de 44 px (teléfono) o 40 px (escritorio).
- **C-24 Historial.** Agrupado por día, con encabezado 16/24 600 y resumen («14 escuchas · 42 minutos · 3 saltadas»). Filas de 40 px: hora, canción, escuchado (%), final (completa o saltada), fotografía (sí/no), recuerdo (sí/no), presentación, origen (lista, carpeta, búsqueda o continua) y sesión (identificador corto). Filtros por rango de fechas, sesión y presentación; «Exportar CSV».
- **C-25 Hoja «Empezar sesión» (C4).** Campos con etiqueta visible; «Empezar» (48 px en teléfono, 40 px en escritorio) y «Cancelar». Radio 16 y sh-3.
- **C-26 Asistente de primer perfil (C3e).** Indicador «Paso 1 de 3» 14/20 600. Campos de 48 px. «Atrás» y «Siguiente» de 48 px. En el paso del PIN, el campo es visible y «Ahora no» aparece como opción.

## 7. Interacción, teclado y gestos

### 7.1 Común a los dos modos

- Activación al soltar; si el puntero sale del control, la acción se cancela (2.5.2).
- Ningún gesto de varios dedos, trazo, pulsación larga, doble toque ni movimiento del dispositivo (2.5.1, 2.5.4). La pinza para ampliar fotografías sigue activa; el zoom del navegador no se bloquea.
- Un segundo toque sobre el mismo control en 400 ms se ignora.
- No hay deslizar para cambiar de pista ni carruseles que se desplacen solos.
- Arrastre con alternativa (2.5.7): reordenar con «Subir» y «Bajar»; progreso con toque (si está activado).
- Sin recarga al tirar hacia abajo (`overscroll-behavior: contain`).
- No aparece nada solo por tener el puntero encima (1.4.13). Excepción: los tooltips del cuidador, que se cierran con Escape.
- Al cambiar de pantalla, el foco pasa al H1 de la nueva (`tabindex="-1"`). Primer foco de la página: «Saltar al contenido». `html lang="es"`.

### 7.2 Paciente

- Orden de foco: cabecera, contenido, mini reproductor y navegación.
- Intro y Espacio activan los botones. Escape cierra P1b, P5 y P6. Ninguna tecla saca al paciente del modo.
- Sin atajos de una tecla.
- Gesto atrás de Android: en P1 no cierra la app; en el resto vuelve una pantalla.
- La interfaz no caduca ni se bloquea; el PIN no caduca.
- Sin sonidos de interfaz ni vibraciones. Respuesta visual de 120 ms.

### 7.3 Cuidador

- Tab y Mayús+Tab siguen el orden visual: salto al contenido, cabecera, navegación, contenido, panel y barra de reproducción.
- Tablas: un único punto de tabulación (`roving tabindex`); ↑ y ↓ entre filas; Inicio y Fin; Intro abre la ficha; Espacio marca la fila; Ctrl/Cmd+A selecciona las visibles.
- Familiaridad: `radiogroup` con flechas.
- Ctrl/Cmd+K abre la búsqueda (combinación, no tecla suelta).
- Escape cierra hojas, diálogos y el panel superpuesto, y devuelve el foco al disparador. Diálogos y hojas atrapan el foco.

### 7.4 Atajos de una tecla (2.1.4)

- Con el foco dentro de la barra de reproducción o del panel: Espacio (reproducir o pausar), ← y → (−5 s y +5 s), ↑ y ↓ (volumen ±5 %).
- Con el foco dentro de la tabla: 1 a 5 (fijan la familiaridad de la fila enfocada, con «Deshacer» de 10 s) y Espacio (marca la fila).
- Nunca actúan dentro de campos de texto.
- Ajustes › Atajos de una tecla: «Activados» (valor inicial) o «Desactivados» (los desactiva todos).

## 8. Reproducción, sesión y registro del estudio

### 8.1 Reglas de reproducción

| Caso | Regla |
|---|---|
| Al abrir la app | No suena nada. Si el perfil tiene una última pista, aparece en pausa con su posición. «Reanudar al abrir» (No por defecto, por perfil) la reproduce. |
| Empezar sesión | No inicia el audio: el paciente pulsa Reproducir. |
| Siguiente | Pasa a la siguiente pista de la lista activa. Reproducción continua. |
| Fin de la lista | «Repetir lista» (Sí por defecto, por perfil). Con No, se detiene con «Fin de la lista». No hay orden aleatorio ni canciones «Le gusta» al final de la lista en esta fase (sección 13). |
| Anterior | En paciente, siempre la pista anterior. En cuidador, vuelve al inicio si la pista lleva más de 3 s. |
| Error de audio | «No se puede reproducir esta canción. Pasamos a la siguiente.» El aviso permanece hasta que empiece la siguiente pista. Con reproducción continua, salta a los 6 s. |
| Sin conexión | Las pistas no guardadas se deshabilitan con «No disponible sin internet». |
| Volumen | Se aplica con Web Audio (GainNode) sobre el elemento de audio, no con su propiedad `volume`, para que funcione en iPadOS e iOS. El volumen físico del dispositivo sigue siendo el principal. Arranque al 60 % con fundido de entrada de 1,5 s en la primera pista de cada sesión. Límite por perfil (50–100 %). |
| Saltar | Con «Saltar al tocar la barra» activo (No por defecto, por perfil), un toque salta a ese punto. |
| Temporizador | Lo fija el cuidador en C4 (No, 15, 30 o 60 minutos). Aviso P6 30 s antes. Sin respuesta, pausa; no cierra la app. |
| Pantalla | Screen Wake Lock mientras suena en modo paciente (ajuste del dispositivo, Sí por defecto). |
| Sistema | Media Session con título, artista y portada; reproducir, pausar, anterior y siguiente en pantalla de bloqueo y auriculares. |
| Cambio de modo | No detiene la reproducción. |

### 8.2 Sesión de escucha

- Se crea en C4 con un identificador. Se cierra al salir del modo paciente, con «Terminar sesión» en el cuidador, o tras 3 horas sin reproducción. La interfaz del paciente no caduca: si vuelve a sonar, se abre una sesión nueva con la misma condición.
- «Según cada canción» (por defecto) usa la presentación de cada asociación. «Solo audio» fuerza C0 en toda la sesión.

### 8.3 Presentaciones (condiciones del estudio)

| Código | Presentación | Portada | Fotografía | Recuerdo |
|---|---|---|---|---|
| C0 | Solo canción | Sí | «Sin fotografía» | «Sin recuerdo guardado» |
| C1 | Canción y recuerdo | Sí | «Sin fotografía» | Tarjeta con texto |
| C2 | Canción, foto y recuerdo | Sí | Fotografía | Tarjeta con texto |

Las zonas nunca cambian de posición ni de tamaño. Los textos de ausencia son los mismos que muestra una canción sin contenido. La vista previa no registra eventos.

### 8.4 Registro del estudio

- Local, en IndexedDB, por eventos con marca de tiempo (ISO 8601 con zona horaria). Cada evento incluye sesión, perfil (identificador interno y código de participante), canción (identificador de catálogo), presentación y condición efectivas, y origen (lista, carpeta, búsqueda o continua).
- Eventos: inicio y fin de sesión; inicio, pausa y reanudación; fin de pista (completa o saltada); recuerdo visto; otro recuerdo; fotografía ampliada; error de audio; observación registrada.
- Resumen por reproducción: segundos escuchados, porcentaje completado, final, fotografía mostrada (sí/no), recuerdo mostrado (sí/no), familiaridad y preferencia vigentes.
- Activable en Ajustes › Registro del estudio. Por defecto: activado, con el texto «Se guardan eventos de escucha en este navegador para el estudio. No se usan nombres reales.» El asistente de primer uso lo muestra.
- Exportable a CSV desde Historial. El paciente no ve ningún dato del registro.

### 8.5 Observaciones

- Ocho etiquetas cerradas: reconoce la canción; canta o tararea; marca el ritmo; pide que se repita; inquietud; tranquilidad; pide cambiar de canción; otra (con texto).
- Canción opcional. Si hay reproducción en curso, «Vincular a la canción que suena» aparece marcada.
- Nota libre de hasta 500 caracteres.

## 9. Datos, PIN, copia y almacenamiento

- **Dónde se guarda.** IndexedDB guarda perfiles, asociaciones, listas, recuerdos, fotografías, observaciones, historial, opciones del paciente y registro del estudio. Cache Storage guarda el audio sin conexión. localStorage guarda solo preferencias de pantalla (tamaño, contraste, apariencia, movimiento y atajos), con try/catch.
- **Persistencia.** Se pide `navigator.storage.persist()` al crear el primer perfil. Si no se concede, aviso en Inicio y en Ajustes. En iOS, si la app no está instalada, Inicio recomienda instalarla en la pantalla de inicio, porque Safari puede borrar los datos de un sitio sin uso.
- **Cuota.** Aviso cuando el uso supera el 80 % de la cuota que informa `navigator.storage.estimate()`. Si el navegador no informa cuota, no se muestra.
- **Fotografías.** Máximo 10 por recuerdo; se reducen a 1600 px en el lado mayor (JPEG al 85 %) y se eliminan los metadatos de ubicación.
- **PIN local.** De 4 a 6 dígitos, guardado como hash PBKDF2-SHA-256 con sal aleatoria de 16 bytes. Evita salidas accidentales; no protege los datos frente a quien tenga el dispositivo desbloqueado. Cinco fallos bloquean 60 s, con cuenta atrás escrita, sin borrar nada. «Olvidé el PIN» quita solo el PIN, tras confirmación; los datos se conservan.
- **Copia cifrada (.rmc).** AES-GCM de 256 bits, con clave derivada de la contraseña mediante PBKDF2-SHA-256 (600 000 iteraciones) y sal de 16 bytes. Contraseña de al menos 10 caracteres. Incluye perfiles, asociaciones, listas, recuerdos, fotografías, observaciones, historial y opciones. No incluye el hash del PIN ni el audio (solo identificadores de catálogo). Sin contraseña no hay recuperación; se avisa antes de exportar.
- **Importar.** Vista previa con recuentos («3 perfiles, 42 recuerdos, 118 fotografías, 1204 eventos») y elección entre «Combinar» (por defecto) y «Sustituir». «Sustituir» exige un diálogo con la casilla «Entiendo que se borrarán los datos actuales».
- **Recordatorio.** Aviso en Inicio si han pasado 14 días desde la última copia.
- **Borrado.** Eliminar un perfil pide confirmación y borra sus datos, no el catálogo. «Borrar todos los datos» (Ajustes) exige un diálogo con casilla.
- **Privacidad.** Sin publicidad, analítica de terceros ni enlaces externos en el modo paciente. Los nombres reales son opcionales: el alias y el código de participante bastan.

## 10. Accesibilidad: lista de comprobación (WCAG 2.2 AA)

- [ ] Texto normal con contraste mínimo de 4,5:1; texto grande y componentes con 3:1 (1.4.3, 1.4.11). Pares medidos en 5.2. El texto deshabilitado está exento (1.4.3).
- [ ] Ningún estado depende solo del color: familiaridad con número, preferencia con texto, «Suena» con texto, errores con icono y texto (1.4.1).
- [ ] Texto escalable hasta 1,75 y zoom del navegador al 200 % sin pérdida (1.4.4). Reflujo a 320 px sin desplazamiento horizontal (1.4.10).
- [ ] Espaciado de texto admitido sin pérdida: interlínea 1,5, párrafos con 2 em, letras 0,12 em, palabras 0,16 em (1.4.12).
- [ ] Ninguna información aparece solo al pasar el puntero (1.4.13).
- [ ] Portadas y fotografías con texto alternativo; las fotografías, con la descripción del cuidador (1.1.1).
- [ ] Ningún audio arranca solo sin control visible de pausa (1.4.2). Ningún destello supera 3 por segundo; ninguna animación se repite en bucle (2.3.1).
- [ ] Reducir movimiento respetado: ajuste propio y `prefers-reduced-motion`; duraciones de 0 ms; sin desplazamientos ni escalas (2.3.3, AAA, cumplido).
- [ ] Todo se opera con teclado, sin trampas de foco (2.1.1, 2.1.2). Orden de foco lógico y enlace de salto (2.4.1, 2.4.3).
- [ ] Atajos de una tecla desactivables, o activos solo con foco en su componente (2.1.4).
- [ ] Foco visible: 4 px en paciente y 2 px en cuidador, separado del fondo y con 3:1 o más (2.4.7, 2.4.11, 2.4.13).
- [ ] Objetivos táctiles: 48 px o más en paciente, separados 16 px o más; 40 px con puntero y 44 px táctiles en cuidador; mínimo de 24 px (2.5.8). Excepción documentada: botones de familiaridad de la tabla (28 px, separados 4 px).
- [ ] Ninguna función depende de trazo, pulsación larga, doble toque ni movimiento del dispositivo (2.5.1, 2.5.4). El arrastre tiene alternativa de un toque o botón (2.5.7). Las acciones se activan al soltar y se cancelan (2.5.2).
- [ ] Sin límite de tiempo que borre datos o cierre la interfaz. El bloqueo del PIN muestra cuenta atrás y no borra datos. La sesión de estudio se cierra en el registro tras 3 horas sin reproducción (2.2.1).
- [ ] Nada se mueve ni se actualiza solo; ningún carrusel rota. La reproducción se detiene con Pausar (2.2.2).
- [ ] `html lang="es"`. Los nombres de canciones y personas no cambian el idioma de la página (3.1.1, 3.1.2). Título de página descriptivo (2.4.2).
- [ ] Errores en texto junto al campo, con la corrección indicada y enlazados con `aria-describedby` (3.3.1, 3.3.3).
- [ ] Etiqueta visible en cada campo; el marcador de posición no sustituye a la etiqueta (1.3.1, 3.3.2).
- [ ] Mismo orden y nombres de destinos en todas las pantallas (3.2.3, 3.2.4). Ayuda en la misma posición (3.2.6).
- [ ] Los datos ya escritos no se vuelven a pedir: el perfil activo se rellena en recuerdos y observaciones (3.3.7).
- [ ] PIN: admite pegar y mostrar u ocultar los dígitos, sin pruebas de memoria (3.3.8).
- [ ] Confirmación antes de borrar, reemplazar o importar con sustitución (3.3.4).
- [ ] Nombre, función y valor de cada control accesibles (4.1.2): roles nativos y `aria-current`, `aria-pressed`, `aria-checked` o `aria-valuetext` cuando hagan falta.
- [ ] Cambio de pista y guardado anunciados con `aria-live="polite"`, una vez por pista. El progreso no se anuncia cada segundo (4.1.3).
- [ ] Encabezados: H1 por pantalla, H2 por sección, H3 por tarjeta. Regiones `header`, `nav`, `main`, `aside` (cuidador) y «Reproductor» (1.3.1, 2.4.6).
- [ ] Pendiente de prueba con personas: VoiceOver (iPadOS y macOS), TalkBack (Android), NVDA (Windows), recorrido solo con teclado y tableta física (sección 16).

## 11. Bocetos ASCII

Esquemas, no a escala.

**A. Paciente, 390×844, Escuchar (teléfono).**

```
+--------------------------------------+
| Escuchar                [ Cuidador ] |  cabecera 64
+--------------------------------------+
|            +-----------+             |
|            |           |             |
|            |  PORTADA  |  232 x 232  |
|            |           |             |
|            +-----------+             |
| Título de la canción                 |
| Artista                              |
| 0:42 [=====o============] 3:12       |  progreso 56
|   ( < )      ( || )      ( > )       |  transporte 96
|  Anterior   Pausar    Siguiente      |
| [-]  ||||||||||||  [+]               |  volumen 56
|--------- desplazar -----------------|
| [ FOTOGRAFÍA 4:3 ]                   |
| Recuerdo                             |
| Título del recuerdo                  |
+--------------------------------------+
| Escuchar | Listas | Carpetas | Buscar |  barra 72
+--------------------------------------+
```

**B. Paciente, 1024×768, Escuchar (tableta horizontal).**

```
+------+---------------------------------------------------------------+
|      | Escuchar                                        [ Cuidador ]  |  64
|      +----------------------------+----------------------------------+
| (>)  |   +--------------------+   |   +----------------------------+ |
|      |   |                    |   |   |                            | |
| Esc  |   |  PORTADA 280x280   |   |   |  FOTOGRAFÍA 4:3 395x296    | |
| Lis  |   |                    |   |   |                            | |
| Car  |   +--------------------+   |   +----------------------------+ |
| Bus  |   Título de la canción     |   Recuerdo                       |
|      |   Artista                  |   Título del recuerdo            |
|      |   0:42 ====o=====  3:12    |   Texto del recuerdo, cuatro     |
|      |   ( < )   ( || )   ( > )   |   líneas visibles.  [Leer todo]  |
|      |   Volumen [-] |||| [+]    |                                  |
+------+----------------------------+----------------------------------+
```

**C. Cuidador, 1440×900, Biblioteca (escritorio).**

```
+--------------+-----------------------------------------+------------------+
| Reminiscencia| Biblioteca   [Buscar Ctrl+K] [Vista prev.]| Ahora suena      |
| Perfil: Cuad.v| [Todas][Sin familiaridad][Con recuerdo] | [ portada 160 ]  |
|--------------|-----------------------------------------| Título           |
| Inicio       | Título - Artista  Dur  Fam.1-5  Pref.   | Artista          |
| Biblioteca   | Presentación  (17 filas de 40 px)       | Familiaridad 1-5 |
| Perfiles     |                                         | Preferencia      |
| Ajustes      |                                         | Presentación     |
| Carpetas     |                                         | Recuerdos        |
|  Años 50  24 |                                         | [Ver como lo ve] |
|  Boleros  18 |                                         | [Registrar obs.] |
| [Abrir modo paciente]                                  |                  |
+--------------+-----------------------------------------+------------------+
| [img] Título · Artista   |<  ( || )  >|  0:42 ====o====  3:12  Volumen [==] |
+----------------------------------------------------------------------------+
```

**D. Cuidador, 390×844, editor de recuerdo (teléfono).**

```
+------------------------------------+
| < Nuevo recuerdo     Borrador 5 s  |  cabecera 56
+------------------------------------+
| Título *                           |
| [ Verano en la playa           ]   |
| Texto                              |
| [ Los domingos íbamos a la playa ] |
|                       812 de 1000  |
| Año     [ 1974 ]   [ ] Año aprox.  |
| Personas (alias)   (Hermana x)     |
| Canciones (2)      [ Elegir > ]    |
| Fotografías (2 de 10)              |
| [ foto 1 ] [ foto 2 ] [ Elegir ]   |
+------------------------------------+
| [ Cancelar ]  [ Guardar recuerdo ] |  pie fijo 72
+------------------------------------+
```

## 12. Reglas específicas por modo

**Modo paciente**

- Muestra solo títulos, artistas, portada, fotografía, recuerdo, listas, carpetas y búsqueda. Nunca muestra familiaridad, preferencia, observaciones, historial, registro ni datos de otros perfiles.
- Una acción principal por zona. Botones con verbos, sin siglas.
- Frases de hasta 15 palabras, sin pronombres. Ejemplo: «Reproducir», «Pausar», «Siguiente».
- Sin formularios, salvo la búsqueda y el PIN. Sin avisos flotantes; los mensajes aparecen dentro de la pantalla.
- Ninguna acción destructiva está al alcance del paciente.
- Sin gestos ni atajos de una tecla.
- El volumen nunca supera el límite fijado por el cuidador.
- Texto base de 22 px; mínimo de 18 px; sin cursiva ni mayúsculas sostenidas.

**Modo cuidador**

- Densidad alta donde se trabaja: tabla de 40 px y 17 filas visibles a 1440×900. Ayudas en tuteo («Escribe un título»); botones en infinitivo («Guardar»).
- Todo se configura aquí. Las acciones destructivas llevan confirmación. Lo reversible lleva «Deshacer» de 10 s.
- Los atajos de una tecla solo actúan con el foco en su componente y se pueden desactivar.
- Las opciones del paciente se fijan por perfil (C3f). El arranque en modo paciente se fija por dispositivo (C5).
- Ningún dato personal sale del navegador.

| Aspecto | Paciente | Cuidador |
|---|---|---|
| Objetivo | Escuchar | Configurar, valorar y registrar |
| Navegación | 4 destinos | 4 destinos; 5 pestañas por perfil |
| Objetivo táctil mínimo | 48 px | 40 px con puntero; 44 px táctil |
| Texto base | 22 px | 15 px |
| Gestos | Solo toque | Toque, teclado y arrastre con alternativa |
| Avisos | Dentro de la pantalla | Flotantes de 10 s con «Deshacer» |
| Movimiento | Fundido de fotografía de 300 ms | Transiciones de 120 a 280 ms |
| Datos visibles | Lo que escucha | Todo el perfil, el historial y el registro |

## 13. Decisiones tomadas y motivo

| # | Decisión | Motivo |
|---|---|---|
| D1 | La estructura y los tokens base son los de la propuesta A. | Mejor puntuación (66,5 de 75). Estructura de app de música, tokens con contraste comprobable y viabilidad sin framework. |
| D2 | «Escuchar» es la pantalla inicial del paciente: portada, fotografía, recuerdo y controles juntos. | Crítica de los jueces 1 y 2: la foto y el recuerdo no deben requerir un paso previo. Aporte de C. |
| D3 | Cuatro destinos del paciente: Escuchar, Listas, Carpetas y Buscar. | Cuatro destinos fijos con etiqueta visible. El «Inicio» de A se reparte entre Escuchar y Listas. |
| D4 | Los carruseles se sustituyen por cuadrículas con «Ver todas» (máximo 6 por sección). | En el paciente, el desplazamiento horizontal dejaba contenido fuera de pantalla. |
| D5 | Portada, fotografía y recuerdo mantienen posición y tamaño en C0, C1 y C2. | Aporte de A: las condiciones del estudio no deben alterar la disposición. |
| D6 | Presentación por asociación (C0, C1 o C2; inicial C0) y condición de sesión («Según cada canción» o «Solo audio»). | Aporte de B: aísla el recuerdo y la foto. Se conserva la condición de sesión de A. |
| D7 | Las zonas ausentes muestran los mismos textos que una canción sin contenido. | Evita que el aspecto revele la condición del estudio. |
| D8 | Familiaridad de 1 a 5, con anclas. | Valor numérico para el análisis (aportes de B y C). Sustituye las cuatro opciones de A. |
| D9 | Preferencia en tres niveles (−1, 0, +1). | Menos carga para el cuidador en tabla y teléfono; A y B la usan. Los cinco niveles de C quedan para decisión del investigador. |
| D10 | Salir del modo paciente con el botón visible «Cuidador». | Se descarta el gesto de 3 s de C: está oculto y el paciente no puede descubrirlo. |
| D11 | Sin PIN, la salida pide confirmación; con PIN, teclado. | Aporte de B: evita una salida accidental sin bloquear al cuidador. |
| D12 | PIN de 4 a 6 dígitos; bloqueo de 60 s tras 5 fallos; «Olvidé el PIN» quita solo el PIN. | Aportes de B y C. Restablecer el navegador, como proponía A, destruye datos. |
| D13 | Asistente de primer perfil con el PIN recomendado y activado por defecto. | Evita dejar el PIN sin configurar (aporte de C). |
| D14 | Volumen con GainNode, arranque al 60 % con fundido de 1,5 s y límite por perfil (50–100 %). | iPadOS e iOS no permiten fijar el volumen del audio desde la página (crítica a A y B). |
| D15 | Sin deslizar en la portada: solo botones. | Destreza limitada (aportes de B y C). |
| D16 | Progreso informativo por defecto, con zona de 56 px. Tocar salta solo si el cuidador lo activa. | Evita saltos accidentales (aporte de C). Una sola altura resuelve la crítica de 40 y 56 px de A. |
| D17 | Anterior siempre va a la pista anterior en el paciente. | Aporte de A. El cuidador conserva la regla de 3 s. |
| D18 | Al terminar la lista, se repite. No hay orden aleatorio ni canciones «Le gusta». | Altera el control del experimento; decisión del investigador (sección 16). |
| D19 | El aviso de error permanece hasta la siguiente pista; el salto es a los 6 s. | El aviso de 6 s de B desaparecía antes de leerse. |
| D20 | Reducir movimiento como ajuste propio (Según el sistema, Sí, No). | A solo respetaba el sistema. Aporte de B y C. |
| D21 | Escala de texto 1,00 / 1,25 / 1,50 / 1,75; listas y Escuchar en una columna desde 1,50. | Aporte de B. Cubre el texto escalable sin pérdida. |
| D22 | Buscar muestra resultados al pulsar Buscar o Intro, con categorías grandes. | Aportes de A (no cambiar la lista mientras se escribe) y de C (categorías). |
| D23 | Las carpetas del paciente son todas las de la biblioteca. | El brief distingue las listas por perfil y las carpetas de la biblioteca. |
| D24 | Atajos de una tecla solo con foco en su componente, con valor inicial «Activados». | WCAG 2.1.4. C no fijaba el valor inicial. |
| D25 | «Deshacer» dura 10 s en todos los casos. | Plazo suficiente para revisar. Los 5 s de C se consideran cortos. |
| D26 | Recordatorio de copia cada 14 días; alerta de cuota al 80 %. | Los datos existen solo en el navegador (aporte de B; A tiene el umbral del 80 %). |
| D27 | Persistencia pedida al crear el primer perfil; aviso de instalar la app en iOS. | Purga de datos de Safari (aportes de B y C). |
| D28 | Registro del estudio por eventos con marca de tiempo y origen de reproducción; activado por defecto; exportable a CSV. | Hipótesis del proyecto (aportes de B y C). |
| D29 | Ocho etiquetas cerradas en las observaciones, vinculables a la reproducción. | Análisis comparable (aporte de B). |
| D30 | El cálido «Recuerdo» solo aparece en recuerdos y fotografías, siempre con la palabra. | Señal semántica adicional que no rompe el acento único (aporte de C). |
| D31 | Tipografía única: Atkinson Hyperlegible Next (400, 600 y 700). | Legibilidad. La serif de B daba una apariencia editorial. |
| D32 | Foco de 4 px en paciente y de 2 px en cuidador. | Visibilidad con limitación visual. |
| D33 | Temporizador de apagado en la hoja de sesión, con aviso 30 s antes. | Cumple 2.2.1 sin añadir controles al paciente (aporte de A). |
| D34 | El cuidador tiene cuatro destinos; la sesión se inicia desde «Abrir modo paciente». | Menos destinos y ninguna pantalla de sesión aparte. |
| D35 | Carpetas en la barra lateral del cuidador (desde 1280 px). | Mantiene 17 filas de 40 px a 1440×900 (aporte del jurado 3). |
| D36 | Un solo panel para «Ahora suena» y la ficha. | Una sola zona de detalle. |
| D37 | La vista previa del paciente no crea sesión ni registra eventos. | Los datos del estudio no se contaminan. |
| D38 | Preferencias de pantalla en localStorage; datos personales solo en IndexedDB. | Restricción del brief: los datos personales se guardan solo en el navegador del cuidador. |
| D39 | Sin logotipo: el nombre de la app va en texto. | Originalidad: no se copia ninguna marca. |

## 14. Qué se descartó de cada propuesta y por qué

**Propuesta A**

- Carruseles con desplazamiento horizontal en el paciente: dejaban contenido fuera de pantalla (D4).
- «Ahora suena» como única vía a la fotografía y el recuerdo: obligaba a un paso extra (D2).
- Deslizar la portada para cambiar de pista: destreza limitada y el experimento necesita controles explícitos (D15).
- Familiaridad con cuatro opciones («No la conoce», «Le suena», «La reconoce», «La canta»): se sustituyen por cinco niveles numéricos con anclas. «Canta o tararea» pasa a la observación (D8, D29).
- Recuperación del PIN restableciendo el navegador: borra todos los datos (D12).
- Barra de progreso de 40 px en un punto y 56 px en otro: una sola zona de 56 px (D16).
- Raíl de 264 px en el paciente: ocupaba demasiado en tableta. Raíl de 112 px (P-3).
- Seis filas visibles en la biblioteca a 1440 px: se pasa a 17 filas con las carpetas en la barra lateral (D35).
- Ausencia de control de reducir movimiento y de tratamiento de iPadOS: se añaden (D14, D20).

**Propuesta B**

- Tipografía serif (Literata) en titulares y recuerdos: sensación editorial. Se usa una sola familia (D31).
- Paleta «Papel» con acento marrón: su contraste es válido, pero no encaja con la estructura elegida. Se conserva la paleta de A (D1).
- Importación de audio desde el dispositivo: no está en el brief y se confirmará; queda fuera de esta fase.
- Carpetas del paciente filtradas por perfil por defecto: el brief pide las carpetas de la biblioteca (D23).
- Cuatro destinos de 152 px apilados en tableta vertical (608 px): no caben en el resto de la pantalla. Se usa raíl (P-3).
- Reproducción aleatoria con canciones «Le gusta» al terminar la lista: altera el control del experimento (D18).
- Saltar al tocar la barra por defecto: toques accidentales (D16).
- Aviso de error que desaparece a los 6 s: no da tiempo a leerlo (D19).
- Mini reproductor de 88 px sobre una barra de 80 px en teléfono: se sustituye por 72 px y 72 px, con el mismo resultado de espacio.
- Zonas que cambian de tamaño según la presentación: se fijan las zonas (D5).

**Propuesta C**

- Salida del modo paciente con una pulsación de 3 s sobre el nombre del perfil: gesto oculto (D10).
- Atajos de una tecla globales (Espacio, flechas, M y /): solo con foco en su componente y desactivables (D24).
- Portada de 440 px y tarjeta de recuerdo de 728 px en escritorio: desproporcionadas. La portada se limita a 360 px y la fotografía a 480×360.
- Dock inferior de 290 px en tableta vertical: el reproductor va en dos columnas.
- Cinco niveles de preferencia: se conservan tres (D9). Si el investigador exige cinco, cambia solo el número de segmentos del control.
- «Deshacer» de 5 s y recordatorio de copia cada 30 días: se sustituyen por 10 s y 14 días (D25, D26).
- Indicador de carga «Preparando la imagen…» con icono fijo: se sustituye por «Cargando…» sobre un bloque fijo.

## 15. Criterios de aceptación visuales

Se comprueban con capturas de pantalla a los anchos 390, 820, 1024 y 1440 px, con las alturas indicadas. «±2 px» es la tolerancia de medición.

**390×844 (teléfono)**

- Sin desplazamiento horizontal (`scrollWidth` no supera el ancho).
- Escuchar: cabecera de 64 px; «Cuidador» visible, de 56 px o más de alto.
- Portada de 232×232 px; Anterior 72 px, Reproducir 96 px y Siguiente 72 px, con etiquetas visibles; zona de progreso de 56 px; botones de volumen de 56 px.
- Barra inferior de 72 px con cuatro destinos. La zona de fotografía empieza entre 728 y 736 px y se ve al menos 40 px por encima de la barra.
- Tras desplazar: fotografía de 358×268 px y tarjeta de recuerdo con cuatro líneas visibles.
- Mosaicos de listas de 171 px en dos columnas.
- Cuidador: tarjetas de 72 px; mini reproductor de 64 px encima de la barra inferior de 64 px; editor de recuerdo con pie fijo de 72 px.

**820×1180 (tableta vertical)**

- Raíl de 112 px en el paciente y de 88 px en el cuidador.
- Escuchar en dos columnas: portada de 300×300 px y fotografía de 328×246 px. Todo Escuchar se ve sin desplazamiento.
- Listas en tres columnas de 204 px.
- Cuidador: tabla con filas de 48 px y columnas de título, familiaridad y menú. Panel de 320 px superpuesto. Barra de reproducción de 72 px.

**1024×768 (tableta horizontal)**

- Raíl de 112 px y cabecera de 64 px en el paciente.
- Escuchar: portada de 280×280 px; fotografía de 395×296 px; cuatro líneas del recuerdo visibles. Sin desplazamiento de página.
- Cuidador: raíl de 88 px; filas de 40 px; 14 filas visibles con desplazamiento interno de la tabla; barra de 72 px; sin desplazamiento de página.
- El panel de 320 px se superpone sin mover la tabla.

**1440×900 (escritorio)**

- Paciente: raíl de 112 px; Escuchar centrado en 1120 px; portada de 360×360 px; fotografía de 480×360 px; sin desplazamiento de página.
- Cuidador: barra lateral de 232 px con carpetas; panel persistente de 320 px con 726 px de contenido; tabla con 17 filas de 40 px visibles; barra de 72 px; sin desplazamiento de página.
- Perfiles: tarjetas de 264×132 px en tres columnas.

**Criterios generales (todos los anchos)**

- Contraste: los pares de 5.2 cumplen sus mínimos. El texto deshabilitado está exento.
- Texto: 18 px o más en el paciente; 13 px o más en el cuidador (12 px solo en cabeceras de tabla).
- Áreas táctiles del paciente de 48 px o más, medidas con `getBoundingClientRect`.
- Foco: con Tab, anillo de 4 px en el paciente y de 2 px en el cuidador, con 3:1 o más.
- Escala de texto 1,75 a 390 px: sin solapes; listas y Escuchar en una columna.
- Reducir movimiento activo: transiciones con duración calculada de 0 ms.
- Ningún elemento fijo (barra, reproductor o panel) cubre el elemento enfocado (`scroll-padding`).

## 16. Pendientes de validación

No bloquean el cierre del diseño, pero deben hacerse antes de la fase de estudio.

- Validar con cinco cuidadores y cinco pacientes, con consentimiento y tutor, en sesiones de 15 minutos.
- Probar en tableta física, con VoiceOver (iPadOS y macOS), TalkBack (Android), NVDA (Windows) y recorrido solo con teclado.
- Confirmar con el investigador: los textos de ausencia idénticos en C0 y C1; las carpetas completas para el paciente; repetir la lista y no usar orden aleatorio; la preferencia de tres niveles; el registro activado por defecto y su texto de consentimiento.
- Verificar en iOS e iPadOS: GainNode, Wake Lock, Media Session y persistencia de almacenamiento.
- Confirmar la fuente y la licencia de cada canción del catálogo para la ficha.

## 17. Estado funcional de la implementación (2026-11-02)

Verificado en el código de `feat/ui-publica` (commit 9d4ae8f), que es la interfaz única de [ADR-0009](../decisions/ADR-0009-interfaz-unica-y-datos-locales.md). Esta sección describe solo el comportamiento. El estado visual (identidad, tokens, tipografía, medidas y componentes) no se evalúa aquí y queda pendiente de rediseño.

| ID | Pantalla o función | Estado | Notas |
|---|---|---|---|
| P1 | Escuchar | Implementado | Al abrir no suena nada; la última pista aparece en pausa. |
| P1b | Recuerdo ampliado | Implementado | Al cerrar, el foco vuelve al disparador. |
| P2, P2b | Listas | Implementado | |
| P3, P3b | Carpetas | Implementado | |
| P4 | Buscar | Parcial | Elegir una categoría muestra resultados sin pulsar «Buscar». |
| P5 | Salida del modo paciente | Implementado | Con PIN, pide el PIN; sin PIN, confirma. «Olvidé el PIN» está aquí (discrepancia 6). |
| P6 | Aviso de apagado | Implementado | |
| C1 | Inicio | Implementado | Avisos de copia, cuota, persistencia, registro e iOS. El enlace de canciones sin familiaridad no filtra (discrepancia 1). |
| C2 | Biblioteca | Parcial | Las carpetas no filtran y solo tienen barra lateral desde 1280 px (discrepancias 1 y 3). |
| C2b | Panel de canción | Implementado | Escape lo cierra solo con el foco dentro del panel. |
| C3, C3a | Perfiles y perfil | Implementado | Cinco pestañas; historial con filtros y exportación CSV. |
| C3b | Editor de lista | Implementado | «Guardar sin conexión» copia el audio a la caché del navegador. |
| C3c | Editor de recuerdo | Parcial | El borrador se guarda cada 5 s, pero no se recupera al reabrir (discrepancia 5). Falta el texto de arrastre de fotografías (discrepancia 11). |
| C3d | Nueva observación | Implementado | Ver discrepancia 9 para la longitud de la nota. |
| C3e | Asistente de primer perfil | Implementado | Tres pasos; el PIN viene activado por defecto. |
| C3f | Opciones del paciente | Implementado | |
| C4 | Empezar sesión | Parcial | No hay «Terminar sesión» y la sesión se abre al arrancar (discrepancia 2). |
| C5 | Ajustes | Implementado | |
| — | Arranque y primer uso (§3.3) | Parcial | Con un perfil, la app abre el último modo; sin elegir entre cuidador y paciente en el primer uso (discrepancia 10). |
| — | Vista previa | Implementado | No crea sesión ni registra eventos (D37). |
| — | Copia cifrada (§9) | Implementado | Combinar por defecto; sustituir exige la casilla. |
| — | PIN (§9, D12) | Implementado | De 4 a 6 dígitos; bloqueo tras cinco fallos (discrepancia 4). |
| — | Registro del estudio (§8.4) | Parcial | Ver discrepancia 7. |
| — | Sin conexión (§8.1, §9) | Implementado | Caché del shell `reminiscencia-shell-v2` y del audio `reminiscencia-audio-v1`. |
| — | Atajos de una tecla (§7.4) | Parcial | Ver discrepancia 8. |

**Discrepancias funcionales con esta especificación.** No cambian ninguna decisión; quedan como pendientes en [ROADMAP](../../ROADMAP.md).

1. **Parámetros de ruta de la biblioteca.** `mountLibrary` recibe `params` y no los lee (`frontend/web/js/cuidador/biblioteca.js`, línea 309). El enlace de Inicio a «sin familiaridad» y las carpetas muestran todo el catálogo.
2. **Sesión de escucha (§8.2).** No hay «Terminar sesión» en el modo cuidador. Con perfil y modo paciente, la app abre una sesión al arrancar, sin pasar por C4 (`frontend/web/js/app.js`, líneas 1076 a 1079), con la última condición guardada.
3. **Carpetas del cuidador (§3.2).** La especificación prevé la barra lateral en escritorio y un menú en el resto. Por debajo de 1280 px no hay menú, y el clic en una carpeta no filtra.
4. **Bloqueo del PIN.** P-16 dice «Vuelve a intentarlo en 45 s», mientras que D12 y la sección 9 dicen 60 segundos. El código usa 60 s (`frontend/web/js/store.js`, líneas 49 y 50). La especificación se contradice; hay que fijar un valor.
5. **Borrador del recuerdo.** El borrador se escribe cada 5 s en el almacén `memoryDrafts`, pero nada lo lee al reabrir. La especificación no dice si debe recuperarse.
6. **«Olvidé el PIN».** P5 lo sitúa en la pantalla de salida del paciente, y la sección 12 dice que ninguna acción destructiva está al alcance del paciente. La especificación se contradice; el código sigue P5.
7. **Registro del estudio (§8.4).** El resumen por reproducción no incluye familiaridad ni preferencia, y el evento «observación registrada» no aparece en el código. Además, borrar un perfil borra también sus eventos del registro (`CHILD_STORES` en `store.js`), algo que la sección 9 no precisa.
8. **Atajos de una tecla (§7.4 y §12).** ↑ y ↓ cambian el volumen en pasos de 10 %, no de 5 % (`frontend/web/js/player.js`, línea 44). En el paciente, con «Saltar al tocar la barra» activo, ←/→ mueven el progreso (`frontend/web/js/paciente/escuchar.js`, líneas 825 a 832), y la sección 12 dice que el paciente no tiene atajos de una tecla.
9. **Valores de los campos (D8, D9 y §8.5).** La familiaridad admite 0 («Sin valorar») además de 1 a 5. La preferencia admite de −2 a 2 en el validador, aunque la interfaz ofrece −1, 0 y +1. La nota de observación acepta 1000 caracteres en el validador, pero la interfaz aplica 500 (`frontend/web/js/schema.js`).
10. **Primer uso (§3.3).** La especificación ofrece elegir entre «Modo cuidador» y «Modo paciente». La app lleva directamente al asistente de primer perfil (`frontend/web/js/app.js`, líneas 1081 y 1082).
11. **Arrastre de fotografías (C-22).** Falta el texto «Suelta las fotografías aquí» (`frontend/web/js/cuidador/recuerdo-editor.js`, línea 402).