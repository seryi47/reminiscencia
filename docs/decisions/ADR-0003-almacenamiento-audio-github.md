# ADR-0003: Almacenamiento del audio dentro del ecosistema GitHub

- Estado: aceptada (fase 1). Límites y preparación de publicación implementados; subida real pendiente de tu confirmación.
- Fecha: 2026-10-31

## Contexto

El proyecto quiere que GitHub sea el centro de control. Pero una biblioteca musical no cabe bien en git:

| Mecanismo | Límite verificado (docs.github.com, 2026-10-31) | Encaje con audio |
|---|---|---|
| Git normal | Bloquea ficheros > 100 MiB; avisa > 50 MiB; repo ideal < 1 GB, recomendado < 5 GB | Malo para audio. Sólo para código, índices y metadatos |
| Git LFS | Tamaño por fichero: 2 GB (Free/Pro), 4 GB (Team). Cuotas de almacenamiento y ancho de banda: no publicadas en la página consultada | Razonable, pero el coste depende de cuotas que hay que confirmar |
| Releases | Cada asset < 2 GiB; hasta 1000 assets por release; sin límite total ni de ancho de banda indicado | Muy adecuado para ficheros de audio ya transcodificados |

## Decisión

1. **Repositorio:** contiene código, documentación, índices JSON, metadatos y pruebas. Nunca audio.
2. **Audio de reproducción:** se publica como assets de GitHub Releases, agrupados por lote de importación. Cada asset va acompañado de su SHA-256.
3. **Índice:** `audio-library/indexes/songs.json` (versionado) relaciona cada `song_id` con su hash y con su asset de release.
4. **Originales:** no se suben. Sólo se conserva la huella y la licencia.
5. **Condición:** sólo se publica audio cuya licencia esté registrada (ver ADR-0002).

Git LFS queda como alternativa si se necesita versionar binarios que cambian. Un almacenamiento externo (por ejemplo, un bucket de objetos) sólo se considerará si Releases resulta insuficiente. Cualquier servicio externo deberá justificarse y tener un coste menor que la alternativa.

## Consecuencias

- Todo lo que el usuario ve (código, índice, releases) vive en GitHub.
- Hay que confirmar que el uso de Releases como almacenamiento de audio cumple las políticas de uso aceptable de GitHub. Pendiente de verificar antes de subir ningún audio real.
- La API de GitHub (gh CLI) permite subir y descargar assets desde un script o desde GitHub Actions.
- El índice no contiene rutas locales ni datos personales (verificado por prueba: `test_export_index_has_no_local_paths`).

## Pendiente

- Verificar en las políticas de GitHub si el almacenamiento de audio en Releases está permitido para el tipo de contenido.
- Confirmar las cuotas de LFS si en el futuro se usa.
