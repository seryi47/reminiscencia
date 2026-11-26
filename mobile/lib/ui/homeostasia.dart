import 'package:flutter/material.dart';

import '../app_error.dart';
import '../local_audio.dart';
import '../services.dart';
import '../shared_upload.dart';
import '../theme.dart';
import '../youtube_dedup.dart';
import '../youtube_importer.dart';
import 'common.dart';

class HomeostasiaButton extends StatelessWidget {
  const HomeostasiaButton({super.key, required this.services});

  final AppServices services;

  @override
  Widget build(BuildContext context) {
    final palette = paletteOf(context);
    final theme = Theme.of(context);
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(24),
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(24),
          boxShadow: [
            BoxShadow(
              color: palette.accent.withValues(alpha: 0.08),
              blurRadius: 22,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: InkWell(
          key: const Key('homeostasia'),
          borderRadius: BorderRadius.circular(24),
          onTap: () => openHomeostasiaSheet(context, services),
          child: Ink(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(24),
              gradient: LinearGradient(
                colors: [palette.accent.withValues(alpha: 0.2), palette.card],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              border: Border.all(color: palette.accent.withValues(alpha: 0.24)),
            ),
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 17),
            child: Row(
              children: [
                Container(
                  width: 52,
                  height: 52,
                  decoration: BoxDecoration(
                    color: palette.accent,
                    borderRadius: BorderRadius.circular(18),
                  ),
                  child: Icon(
                    Icons.music_video_rounded,
                    color: palette.onAccent,
                    size: 27,
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Homeostasia',
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Importa música desde YouTube',
                        style: theme.textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: palette.cardPressed.withValues(alpha: 0.8),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    Icons.arrow_forward_rounded,
                    color: palette.ink,
                    size: 19,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Abre la hoja «Homeostasia».
Future<void> openHomeostasiaSheet(BuildContext context, AppServices services) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    useRootNavigator: true,
    builder: (_) => _HomeostasiaSheet(services: services),
  );
}

class _HomeostasiaSheet extends StatefulWidget {
  const _HomeostasiaSheet({required this.services});

  final AppServices services;

  @override
  State<_HomeostasiaSheet> createState() => _HomeostasiaSheetState();
}

class _HomeostasiaSheetState extends State<_HomeostasiaSheet> {
  String? _status;
  bool _working = false;
  YoutubeImportCancellation? _youtubeCancellation;
  late final TextEditingController _playlistController;

  @override
  void initState() {
    super.initState();
    _playlistController = TextEditingController();
    widget.services.library.uploads.addListener(_onUploads);
  }

  @override
  void dispose() {
    _youtubeCancellation?.cancel();
    widget.services.library.uploads.removeListener(_onUploads);
    _playlistController.dispose();
    super.dispose();
  }

  // Resumen de la cola de subidas («1 de 2 publicadas»), el mismo que muestra «Tu biblioteca».
  void _onUploads() {
    if (!mounted || _status == null) return;
    final summary = widget.services.library.uploads.summary;
    if (summary.isNotEmpty) setState(() => _status = summary);
  }

  Future<void> _importYoutube() async {
    if (_working) return;
    final importer = widget.services.youtube;
    if (importer == null) {
      _show('La importación de YouTube no está disponible en esta versión.');
      return;
    }
    if (!await widget.services.library.canUpload()) {
      _show(kOfflineMessage);
      return;
    }
    final youtubeUrl = _playlistController.text.trim();
    if (youtubeUrl.isEmpty) {
      _show('Pega una URL de YouTube.');
      return;
    }
    final cancellation = YoutubeImportCancellation();
    setState(() {
      _working = true;
      _youtubeCancellation = cancellation;
      _status = 'Leyendo YouTube…';
    });
    List<YoutubeImportedAudio>? imported;
    try {
      // Dedup con la biblioteca ANTES de convertir: al proxy de playlist le pedimos la lista, cruzamos con lo que ya
      // tienes por `library_match` (ADR-0046) y, si hay solape, preguntamos qué quieres descargar. Ahorra tiempo,
      // tráfico y cupo diario del conversor (ADR-0045).
      final listed = await importer.listPlaylist(youtubeUrl, cancellation: cancellation);
      cancellation.throwIfCancelled();
      if (!mounted) return;
      final dedup = filterYoutubePlaylist(listed, widget.services.library.catalogSongs);
      List<YoutubeTrack> selected = dedup.toDownload;
      if (dedup.alreadyCount > 0 && dedup.newCount < dedup.total) {
        final choice = await _askPlaylistDedupChoice(dedup);
        if (choice == null) {
          _show('Importación cancelada.');
          return;
        }
        selected = choice == _PlaylistChoice.downloadAll ? dedup.all : dedup.toDownload;
      }
      if (selected.isEmpty) {
        _show('Nada nuevo que descargar: la playlist ya está en tu biblioteca.');
        return;
      }
      setState(() => _status = 'Convirtiendo ${selected.length} canciones…');
      imported = await importer.importTracks(
        selected,
        cancellation: cancellation,
        onProgress: (progress) {
          if (mounted && !cancellation.isCancelled) _show(progress.message);
        },
      );
      if (!mounted) return;
      final audios = imported;
      setState(() {
        _youtubeCancellation = null;
        _status = 'Añadiendo ${audios.length} canciones…';
      });
      final result = await widget.services.library.uploadShared([
        for (final audio in audios)
          PickedAudioFile(
            name: audio.name,
            path: audio.path,
            artist: audio.track.artist,
            youtubePlaylistId: audio.track.playlistId,
            youtubePlaylistName: audio.track.playlistTitle,
          ),
      ]);
      if (mounted) _show(describeUploadResult(result));
    } catch (error) {
      if (cancellation.isCancelled) {
        _show(
          'Seguimiento detenido. La conversión externa puede continuar; '
          'al volver a importarla se retomará el mismo trabajo.',
        );
      } else {
        _show(
          error is AppException
              ? error.message
              : 'No se pudo importar desde YouTube: ${describeError(error)}',
        );
      }
    } finally {
      if (imported != null) await importer.cleanup(imported);
      if (mounted) {
        setState(() {
          _youtubeCancellation = null;
          _working = false;
        });
      }
    }
  }

  void _show(String message) {
    if (!mounted) return;
    setState(() => _status = message);
  }

  /// Pregunta al usuario si quiere saltar las canciones de la playlist que ya están en su biblioteca.
  Future<_PlaylistChoice?> _askPlaylistDedupChoice(YoutubeDedupResult dedup) async {
    final palette = paletteOf(context);
    return showDialog<_PlaylistChoice>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Esta playlist se solapa con tu biblioteca'),
        content: Text(
          '${dedup.total} canciones en la playlist · '
          '${dedup.alreadyCount} ya las tienes · '
          '${dedup.newCount} nuevas por descargar.\n\n'
          'Puedes ahorrarte descargar las que ya tienes, o bajarlas igual si quieres otra versión.',
        ),
        actions: [
          TextButton(
            key: const Key('playlist-dedup-cancel'),
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancelar'),
          ),
          TextButton(
            key: const Key('playlist-dedup-all'),
            onPressed: () => Navigator.of(dialogContext).pop(_PlaylistChoice.downloadAll),
            child: const Text('Descargar todas de todos modos'),
          ),
          FilledButton(
            key: const Key('playlist-dedup-new'),
            onPressed: () => Navigator.of(dialogContext).pop(_PlaylistChoice.downloadNew),
            style: FilledButton.styleFrom(backgroundColor: palette.accent),
            child: Text('Descargar solo nuevas (${dedup.newCount})'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SafeArea(
      child: SingleChildScrollView(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
          child: Column(
            key: const Key('homeostasia-sheet'),
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: paletteOf(context).accent,
                      borderRadius: BorderRadius.circular(15),
                    ),
                    child: Icon(
                      Icons.graphic_eq_rounded,
                      color: paletteOf(context).onAccent,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Homeostasia',
                          style: theme.textTheme.headlineSmall,
                        ),
                        Text(
                          'Importa música desde YouTube',
                          style: theme.textTheme.bodySmall,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 24),
              Container(
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  color: paletteOf(context).card,
                  borderRadius: BorderRadius.circular(22),
                  border: Border.all(
                    color: paletteOf(context).outline.withValues(alpha: 0.65),
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      'Añade un vídeo o una playlist',
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Pega el enlace y prepararemos las canciones para la biblioteca.',
                      style: theme.textTheme.bodySmall,
                    ),
                    const SizedBox(height: 18),
                    TextField(
                      key: const Key('homeostasia-youtube-url'),
                      controller: _playlistController,
                      enabled: !_working,
                      keyboardType: TextInputType.url,
                      textInputAction: TextInputAction.done,
                      decoration: const InputDecoration(
                        labelText: 'Vídeo o playlist de YouTube',
                        hintText: 'https://youtu.be/…',
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.all(Radius.circular(16)),
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        key: const Key('homeostasia-youtube-import'),
                        onPressed: _working ? null : _importYoutube,
                        icon: const Icon(Icons.music_video_rounded),
                        label: const Text('Importar música'),
                      ),
                    ),
                  ],
                ),
              ),
              if (_youtubeCancellation != null) ...[
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.center,
                  child: TextButton.icon(
                    onPressed: () {
                      _youtubeCancellation?.cancel();
                      _show(
                        'Deteniendo consultas… La conversión externa puede continuar.',
                      );
                    },
                    icon: const Icon(Icons.pause_circle_outline_rounded),
                    label: const Text('Detener seguimiento'),
                  ),
                ),
              ],
              if (_status != null) ...[
                const SizedBox(height: 12),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: paletteOf(context).elevated,
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(
                        _working
                            ? Icons.sync_rounded
                            : Icons.info_outline_rounded,
                        size: 19,
                        color: paletteOf(context).accent,
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          _status!,
                          key: const Key('homeostasia-status'),
                          style: theme.textTheme.bodyMedium,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Elección del usuario en el diálogo de dedup de playlist YouTube.
enum _PlaylistChoice { downloadNew, downloadAll }
