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
- [x] Repositorio privado en GitHub y primer push (github.com/seryi47/doctorado-sonidos-alzheimer, privado).
- [x] Verificación de la integración continua en GitHub Actions (Python 3.12 y 3.13, verde en el commit 891149c).
- **Cierre:** pruebas en verde en local y en GitHub Actions.

## Fase 2: motor de audio
- [ ] Experimento de compresión con audio de licencia abierta (COMPRESSION.md).
- [ ] Publicación de variantes como assets de GitHub Releases (ADR-0003).
- [ ] Detección de silencios, picos y calidad de señal.
- **Cierre:** tabla de resultados medidos y script de publicación probado.

## Fase 3: API y servicio
- [ ] API FastAPI sobre la biblioteca.
- [ ] Cola de trabajos para procesado pesado.
- **Cierre:** endpoints con pruebas de integración.

## Fase 4: web (paciente y cuidador)
- [x] Reproductor accesible en HTML estático (frontend/web), probado en Chrome a 390 px y 1024 px.
- [x] Desplegado en Vercel (`sonidos-alzheimer`, equipo huelladigital).
- [ ] **Hacer pública la URL:** la protección SSO de Vercel está activa y bloquea el acceso. Desactivarla lo ha bloqueado el sistema de permisos dos veces, incluso con tu autorización; hay que hacerlo desde el panel de Vercel o añadir una regla de permiso para ello.
- [ ] Panel de cuidador: perfiles, listas, fotografías y recuerdos.
- **Cierre:** URL pública verificada desde Internet.

## Fase 5: Android
- [x] ADR-0004 (Flutter).
- [x] Reproducción en segundo plano, notificación y controles de auriculares, probados en emulador Android 15.
- [x] APK de publicación compilada y probada en emulador.
- [ ] Llamadas, desconexión de auriculares y pruebas en dispositivo físico.
- [x] Firma de producción con clave de subida propia (fuera del repositorio); verificada con apksigner.
- [ ] Copia de seguridad de la clave de firma fuera de este equipo.
- **Cierre:** APK firmada para producción y probada en dispositivo real.

## Fase 6: investigación de campo
- [ ] Protocolo y aprobación ética.
- [ ] Estudio piloto.
- **Cierre:** análisis y resultados con sus limitaciones.
