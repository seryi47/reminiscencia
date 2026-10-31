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

## Fase 3: servicio y administración
- [x] Catálogo versionado en el repositorio como fuente de verdad (ADR-0007).
- [x] Importación por URL en GitHub Actions, probada con ítems reales de Internet Archive.
- [x] Publicar, despublicar, carpetas y edición de metadatos vía workflow, probados en GitHub.
- [x] Funciones de Vercel con contraseña, validación y falla cerrada.
- [ ] **Configurar `ADMIN_PASSWORD` en Vercel** (Production). Sin ella, `/admin/` no funciona.
- [ ] Probar el panel de administración de extremo a extremo con la contraseña configurada.
- [ ] Borrado de canciones (hoy solo se despublican).
- **Cierre:** panel probado en la web de Vercel con la contraseña real.

## Fase 4: web pública
- [x] Escucha por carpetas, búsqueda, reproductor y vista a pantalla completa en el teléfono.
- [x] Desplegada en https://reminiscencia.vercel.app (Git integration, Root Directory `frontend/web`).
- [x] Probada en escritorio y teléfono contra la URL pública.
- [ ] Panel de cuidador: perfiles, fotos y recuerdos (depende de la fase 6).
- **Cierre:** panel de cuidador con perfiles.

## Fase 5: Android
- [x] ADR-0004 (Flutter), app que lee la biblioteca de la web.
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
