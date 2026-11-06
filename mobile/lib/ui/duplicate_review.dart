import 'package:flutter/material.dart';

import '../duplicates.dart';
import '../local_audio.dart';
import '../services.dart';

/// Aviso de duplicados de «Subir canciones» (ADR-0026). Antes de poner la tanda en la cola, compara cada canción
/// (título del nombre del archivo, artista si lo trae y duración si se puede leer) con la biblioteca común y con los
/// archivos anteriores de la misma tanda. Por cada una que parece repetida pregunta «Subir igualmente» o «Quitar de
/// la cola». Devuelve las posiciones que no se suben. Solo avisa: sin respuesta (atrás), la canción se sube.
Future<Set<int>> reviewUploadDuplicates(
  BuildContext context,
  AppServices services,
  List<PickedAudioFile> songs,
) async {
  final batch = <DuplicateCandidate>[];
  for (final file in songs) {
    double? duration;
    // Las canciones de un ZIP no están en un archivo propio hasta que se sacan: sin duración.
    if (file.zip == null) {
      try {
        duration = await services.probeDuration(file.path);
      } catch (_) {
        duration = null;
      }
    }
    batch.add(
      DuplicateCandidate(
        title: titleFromFileName(file.name),
        artist: file.artist,
        durationS: duration,
      ),
    );
  }
  final library = [
    for (final song in services.library.catalogSongs)
      DuplicateCandidate(
        title: song.title,
        artist: song.artist,
        durationS: song.durationS,
      ),
  ];
  final dropped = <int>{};
  for (final item in findUploadDuplicates(batch, library)) {
    if (!context.mounted) break;
    final keep = await showDuplicateDialog(
      context,
      item,
      fileName: songs[item.index].name,
    );
    if (!keep) dropped.add(item.index);
  }
  return dropped;
}

/// Pregunta por una canción que parece repetida. true: «Subir igualmente»; false: «Quitar de la cola».
Future<bool> showDuplicateDialog(
  BuildContext context,
  UploadDuplicate item, {
  required String fileName,
}) async {
  final keep = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      key: const ValueKey('duplicate-dialog'),
      title: const Text('¿Ya está subida?'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            fileName,
            key: const ValueKey('duplicate-file'),
            style: Theme.of(dialogContext).textTheme.labelLarge,
          ),
          const SizedBox(height: 8),
          Text(item.message, key: const ValueKey('duplicate-message')),
        ],
      ),
      actions: [
        TextButton(
          key: const ValueKey('duplicate-drop'),
          onPressed: () => Navigator.of(dialogContext).pop(false),
          child: const Text('Quitar de la cola'),
        ),
        FilledButton(
          key: const ValueKey('duplicate-keep'),
          onPressed: () => Navigator.of(dialogContext).pop(true),
          child: const Text('Subir igualmente'),
        ),
      ],
    ),
  );
  return keep ?? true;
}
