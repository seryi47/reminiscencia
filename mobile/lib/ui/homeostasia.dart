import 'package:flutter/material.dart';

import '../app_error.dart';
import '../local_audio.dart';
import '../services.dart';
import '../shared_upload.dart';
import '../theme.dart';
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
      color: palette.card,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        key: const Key('homeostasia'),
        borderRadius: BorderRadius.circular(20),
        onTap: () => openHomeostasiaSheet(context, services),
        child: Ink(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            gradient: LinearGradient(
              colors: [palette.accent.withValues(alpha: 0.16), palette.card],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            border: Border.all(color: palette.outline.withValues(alpha: 0.5)),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: palette.accent,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Icon(
                  Icons.graphic_eq_rounded,
                  color: palette.onAccent,
                  size: 26,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Homeostasia', style: theme.textTheme.titleMedium),
                    const SizedBox(height: 3),
                    Text(
                      'Añade música desde tu dispositivo o YouTube',
                      style: theme.textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
              Icon(
                Icons.arrow_forward_ios_rounded,
                color: palette.inkMuted,
                size: 17,
              ),
            ],
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

  Future<void> _send() async {
    if (_working) return;
    final library = widget.services.library;
    if (!await library.canUpload()) {
      _show(kOfflineMessage);
      return;
    }
    final List<PickedAudioFile> files;
    try {
      files = await widget.services.pickAudio();
    } catch (error) {
      _show('No se pudieron elegir los archivos: ${describeError(error)}');
      return;
    }
    if (files.isEmpty || !mounted) return;
    setState(() => _working = true);
    setState(() {
      _status = files.length == 1
          ? 'Añadiendo «${files.first.name}»…'
          : 'Añadiendo ${files.length} archivos…';
    });
    try {
      await library.uploadShared(files);
    } catch (error) {
      _show(
        error is AppException
            ? error.message
            : 'No se pudo enviar: ${describeError(error)}',
      );
    } finally {
      if (mounted) setState(() => _working = false);
    }
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
      imported = await importer.importPlaylist(
        youtubeUrl,
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
          PickedAudioFile(name: audio.name, path: audio.path),
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
                          'Añade música a tu biblioteca',
                          style: theme.textTheme.bodySmall,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 24),
              Text('Desde tu dispositivo', style: theme.textTheme.titleMedium),
              const SizedBox(height: 10),
              FilledButton.icon(
                key: const Key('homeostasia-pick'),
                onPressed: _working ? null : _send,
                icon: const Icon(Icons.library_add_rounded),
                label: const Text('Seleccionar archivos'),
              ),
              const SizedBox(height: 24),
              Row(
                children: [
                  Expanded(child: Divider(color: paletteOf(context).outline)),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    child: Text(
                      'O desde YouTube',
                      style: theme.textTheme.bodySmall,
                    ),
                  ),
                  Expanded(child: Divider(color: paletteOf(context).outline)),
                ],
              ),
              const SizedBox(height: 16),
              TextField(
                key: const Key('homeostasia-youtube-url'),
                controller: _playlistController,
                enabled: !_working,
                keyboardType: TextInputType.url,
                textInputAction: TextInputAction.done,
                decoration: const InputDecoration(
                  labelText: 'Playlist o vídeo de YouTube',
                  hintText: 'https://www.youtube.com/playlist?list=…',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  key: const Key('homeostasia-youtube-import'),
                  onPressed: _working ? null : _importYoutube,
                  icon: const Icon(Icons.music_video_rounded),
                  label: const Text('Importar música'),
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
