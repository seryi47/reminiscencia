import 'package:flutter/material.dart';

import '../services.dart';
import '../theme.dart';
import '../upload_tracker.dart';
import 'common.dart';

/// Estado de las subidas en «Tu biblioteca»: un resumen («2 de 3 publicadas») y una fila por archivo
/// con su nombre, el paso en el que está, una barra de progreso y, si toca, «Reproducir» o «Reintentar».
/// Las canciones de un ZIP van agrupadas bajo «Álbum.zip: 12 canciones», con lo que se ignoró o el error.
class UploadsPanel extends StatelessWidget {
  const UploadsPanel({super.key, required this.services});

  final AppServices services;

  @override
  Widget build(BuildContext context) {
    final uploads = services.library.uploads;
    final entries = uploads.entries;
    final sections = uploads.sections;
    if (sections.isEmpty) return const SizedBox.shrink();
    final theme = Theme.of(context);
    final anyPublished = entries.any(
      (e) => e.stage == UploadStage.published && e.opusPath == null,
    );
    return Padding(
      key: const Key('uploads-panel'),
      padding: const EdgeInsets.fromLTRB(16, 8, 8, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Semantics(
                  liveRegion: true,
                  label: 'Subidas: ${uploads.summary}',
                  excludeSemantics: true,
                  child: Text(
                    uploads.summary,
                    key: const Key('uploads-summary'),
                    style: theme.textTheme.titleSmall,
                  ),
                ),
              ),
              if (anyPublished)
                _ActionButton(
                  label: 'Quitar publicadas',
                  semanticsLabel: 'Quitar de la lista las subidas publicadas',
                  onPressed: uploads.clearPublished,
                ),
            ],
          ),
          for (final section in sections)
            if (section.group case final group?)
              _ZipGroup(
                services: services,
                group: group,
                entries: section.entries,
              )
            else
              _UploadRow(services: services, entry: section.entries.single),
        ],
      ),
    );
  }
}

/// Un ZIP: su cabecera y una fila por canción, con sangría.
class _ZipGroup extends StatelessWidget {
  const _ZipGroup({
    required this.services,
    required this.group,
    required this.entries,
  });

  final AppServices services;
  final UploadGroup group;
  final List<UploadEntry> entries;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final ignored = group.ignoredText;
    final error = group.error;
    final label = [group.headline, ?error, ?ignored].join('. ');
    return Padding(
      key: Key('upload-group-${group.key}'),
      padding: const EdgeInsets.only(top: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            container: true,
            liveRegion: true,
            label: label,
            excludeSemantics: true,
            child: Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    group.headline,
                    key: Key('upload-group-title-${group.key}'),
                    style: theme.textTheme.titleSmall,
                  ),
                  if (error != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(
                        'Error: $error',
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.error,
                        ),
                      ),
                    ),
                  if (ignored != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(ignored, style: theme.textTheme.bodySmall),
                    ),
                ],
              ),
            ),
          ),
          for (final entry in entries)
            Padding(
              padding: const EdgeInsets.only(left: 12),
              child: _UploadRow(services: services, entry: entry),
            ),
        ],
      ),
    );
  }
}

class _UploadRow extends StatelessWidget {
  const _UploadRow({required this.services, required this.entry});

  final AppServices services;
  final UploadEntry entry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = paletteOf(context);
    final library = services.library;
    final status = entry.statusText;
    final failed = entry.stage == UploadStage.failed;
    final playable = entry.stage == UploadStage.published
        ? entry.publishedId != null
        : entry.opusPath != null;
    final busy = library.importing;
    return Padding(
      key: Key('upload-row-${entry.key}'),
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            container: true,
            liveRegion: true,
            label: '${entry.name}: $status',
            excludeSemantics: true,
            child: Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    entry.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodyLarge?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    status,
                    key: Key('upload-status-${entry.key}'),
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: failed ? theme.colorScheme.error : null,
                    ),
                  ),
                  const SizedBox(height: 6),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(2),
                    child: LinearProgressIndicator(
                      value: entry.progress,
                      minHeight: 4,
                      color: failed ? theme.colorScheme.error : palette.accent,
                      backgroundColor: palette.cardPressed,
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (playable || failed)
            Wrap(
              spacing: 4,
              children: [
                if (playable)
                  _ActionButton(
                    label: 'Reproducir',
                    semanticsLabel: 'Reproducir «${entry.title}»',
                    onPressed: () => runWithNotice(
                      context,
                      () => library.playUpload(entry.key),
                      failurePrefix: 'No se pudo reproducir «${entry.title}»',
                    ),
                  ),
                if (failed)
                  _ActionButton(
                    label: 'Reintentar',
                    semanticsLabel: 'Reintentar la subida de «${entry.title}»',
                    onPressed: busy
                        ? null
                        : () => runWithNotice(
                            context,
                            () => library.retryUpload(entry.key),
                            failurePrefix: 'No se pudo reintentar',
                          ),
                  ),
              ],
            ),
        ],
      ),
    );
  }
}

/// Botón de texto de al menos 48 × 48 dp.
class _ActionButton extends StatelessWidget {
  const _ActionButton({
    required this.label,
    required this.semanticsLabel,
    required this.onPressed,
  });

  final String label;
  final String semanticsLabel;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      enabled: onPressed != null,
      label: semanticsLabel,
      onTap: onPressed,
      excludeSemantics: true,
      child: TextButton(
        onPressed: onPressed,
        style: TextButton.styleFrom(
          minimumSize: const Size(48, 48),
          tapTargetSize: MaterialTapTargetSize.padded,
        ),
        child: Text(label),
      ),
    );
  }
}
