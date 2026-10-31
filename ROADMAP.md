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
- [ ] Repositorio privado en GitHub y primer push.
- [ ] Verificación de la integración continua en GitHub Actions.
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
- [ ] Next.js con reproductor accesible.
- [ ] Panel de cuidador: perfiles, listas, fotografías y recuerdos.
- [ ] Despliegue en Vercel (requiere tu cuenta conectada).
- **Cierre:** URL pública verificada desde Internet.

## Fase 5: Android
- [ ] ADR de tecnología (propuesta: Flutter).
- [ ] Reproducción en segundo plano y controles del sistema.
- [ ] APK instalable probado en dispositivo o emulador.
- **Cierre:** APK instalado y reproduciendo, verificado.

## Fase 6: investigación de campo
- [ ] Protocolo y aprobación ética.
- [ ] Estudio piloto.
- **Cierre:** análisis y resultados con sus limitaciones.
