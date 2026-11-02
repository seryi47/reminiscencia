# ROADMAP

Cada fase tiene un criterio de cierre. Una fase sólo se marca como terminada cuando sus pruebas pasan y la documentación está al día. La investigación y el desarrollo avanzan en paralelo.

## Fase 0: investigación (en curso)
- [x] Búsqueda de referencias clave y verificación de existencia (BIBLIOGRAPHY.md).
- [ ] Revisión sistemática completa.
- [ ] Revisión de aplicaciones existentes de recuerdos musicales.
- [ ] Dictamen legal sobre audio (ADR-0002).
- **Cierre:** lista de referencias verificadas y dictamen recibido.

## Fase 1: base del proyecto
- [x] Estructura de carpetas y control de versiones.
- [x] Decisiones de stack documentadas (ADR-0001 a 0003).
- [x] Núcleo de biblioteca, importación y transcodificación con pruebas.
- [x] Repositorio privado en GitHub y primer push (github.com/seryi47/doctorado-reminiscencia, privado).
- [x] Verificación de la integración continua en GitHub Actions (Python 3.12 y 3.13, verde en el commit 891149c).
- **Cierre:** pruebas en verde en local y en GitHub Actions.

## Fase 2: motor de audio
- [ ] Experimento de compresión con audio de licencia abierta (COMPRESSION.md).
- [ ] Publicación de variantes como assets de GitHub Releases (ADR-0003).
- [ ] Detección de silencios, picos y calidad de señal.
- **Cierre:** tabla de resultados medidos y script de publicación probado.

## Plan v2 (en curso desde 2026-10-31)

Se trabaja en paralelo, cada frente en su propia rama, y se integra en `main` por fases. La administración en Vercel queda **retirada** (ADR-0008): la biblioteca se gestiona con incidencias de GitHub y no hay `ADMIN_PASSWORD` que configurar.

| Frente | Qué entrega | Estado |
|---|---|---|
| Auditoría del brief | Matriz de requisitos con evidencia y verificación adversarial de lo marcado como hecho | En curso |
| Panel de diseño | Especificación de diseño (docs/user-experience/DESIGN.md) por tres propuestas, jurado y síntesis | En curso |
| Web de escucha (modo paciente) | Interfaz nueva según el diseño, fotos y recuerdos del perfil activo, uso sin conexión (PWA) | Pendiente |
| Datos locales del cuidador | Perfiles, fotos, recuerdos, listas, observaciones e historial en IndexedDB; copia cifrada con contraseña | Pendiente |
| Panel del cuidador (`/cuidar/`) | Interfaz para gestionar todo lo anterior, con PIN local de ajustes | Pendiente |
| App Android | Listas, modo paciente con botones grandes, icono propio, tableta, ajustes persistentes, pruebas | Pendiente |
| Compresión | Experimento reproducible con ffmpeg y métricas objetivas (sin pruebas perceptuales con personas) | Pendiente |
| Investigación | Referencias verificadas por DOI y estado del arte; metodología del piloto; seguridad y RGPD | Pendiente |
| Documentación técnica | ARCHITECTURE, DATABASE (modelo entidad-relación), PLAYER, AUDIO_ENGINE, GITHUB_STORAGE | Pendiente |
| Pruebas de extremo a extremo | Navegador: escucha, cuidador, copia cifrada, uso sin conexión | Pendiente |
| Compilación de APK en GitHub Actions | Artefactos de depuración y producción, carpetas releases/android/debug y production | Pendiente |

## Fase 3: servicio y administración
- [x] Catálogo versionado en el repositorio como fuente de verdad (ADR-0007).
- [x] Importación por URL en GitHub Actions, probada con ítems reales de Internet Archive.
- [x] Publicar, despublicar, carpetas y edición de metadatos vía workflow, probados en GitHub.
- [x] Funciones de Vercel con contraseña, validación y falla cerrada (retiradas después, en ADR-0008).
- [x] Administración retirada en favor de incidencias de GitHub (ADR-0008): no hay `ADMIN_PASSWORD` que configurar.
- [ ] Probar una incidencia real con la etiqueta `biblioteca` (importar y organizar) y su respuesta automática.
- [ ] Borrado de canciones (hoy solo se despublican).
- **Cierre:** una importación y una publicación probadas con incidencias reales.

## Fase 4: web pública
- [x] Escucha por carpetas, búsqueda, reproductor y vista a pantalla completa en el teléfono.
- [x] Desplegada en https://reminiscencia.vercel.app (Git integration, Root Directory `frontend/web`).
- [x] Probada en escritorio y teléfono contra la URL pública.
- [ ] Panel de cuidador: perfiles, fotos y recuerdos (depende de la fase 6).
- **Cierre:** panel de cuidador con perfiles.

## Fase 5: Android
- [x] ADR-0004 (Flutter), app que lee la biblioteca de la web.
- [x] Listas, favoritos, ajustes persistentes, modo paciente, diseño de tableta e icono propio (integrado el 2026-10-31).
- [x] Compilación de APK automatizada por etiquetas y carpetas de releases (pendiente de primera ejecución en GitHub Actions).
- [x] Reproducción en streaming y en segundo plano, notificación y auriculares (emulador Android 15).
- [x] Copia para escuchar sin conexión, probada con la red apagada.
- [x] APK 1.1.0 firmada para producción (clave de subida propia).
- [ ] Pruebas en dispositivo físico: llamadas, Bluetooth, TalkBack, tabletas.
- [ ] Copia de seguridad de la clave de firma fuera de este equipo.
- **Cierre:** probada en dispositivo real.

## Fase 6: investigación de campo
- [ ] Protocolo y aprobación ética.
- [ ] Estudio piloto.
- **Cierre:** análisis y resultados con sus limitaciones.
