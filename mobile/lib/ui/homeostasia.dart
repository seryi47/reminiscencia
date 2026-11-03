import 'package:flutter/material.dart';

import '../app_error.dart';
import '../local_audio.dart';
import '../services.dart';
import '../shared_upload.dart';
import '../youtube_importer.dart';
import 'common.dart';

/// «Homeostasia»: toda la lógica del botón vive en este archivo (como `js/views/homeostasia.js` en la web).
/// Lo que se elige aquí va a GitHub por el mismo camino que «Subir canciones» (ADR-0017): la cola de subidas de la
/// app lo convierte a Opus en el teléfono, lo envía por trozos a /api/subir y el workflow buzon lo cataloga y lo
/// publica. Un ZIP se descomprime en el teléfono y sube cada canción; el ZIP no se sube.
class HomeostasiaButton extends StatelessWidget {
  const HomeostasiaButton({super.key, required this.services});

  final AppServices services;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton.icon(
      key: const Key('homeostasia'),
      onPressed: () => openHomeostasiaSheet(context, services),
      icon: const Icon(Icons.music_note_rounded),
      label: const Text('Homeostasia'),
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
  late final TextEditingController _playlistController;

  @override
  void initState() {
    super.initState();
    _playlistController = TextEditingController();
    widget.services.library.uploads.addListener(_onUploads);
  }

  @override
  void dispose() {
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
          ? 'Enviando «${files.first.name}» a GitHub…'
          : 'Enviando ${files.length} archivos a GitHub…';
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
    final playlistUrl = _playlistController.text.trim();
    if (playlistUrl.isEmpty) {
      _show('Pega una URL de playlist de YouTube.');
      return;
    }
    setState(() {
      _working = true;
      _status = 'Leyendo la playlist de YouTube…';
    });
    List<YoutubeImportedAudio>? imported;
    try {
      imported = await importer.importPlaylist(
        playlistUrl,
        onProgress: (progress) {
          if (mounted) _show(progress.message);
        },
      );
      if (!mounted) return;
      final audios = imported;
      setState(() => _status = 'Enviando ${audios.length} canciones a GitHub…');
      final result = await widget.services.library.uploadShared([
        for (final audio in audios)
          PickedAudioFile(name: audio.name, path: audio.path),
      ]);
      if (mounted) _show(describeUploadResult(result));
    } catch (error) {
      _show(
        error is AppException
            ? error.message
            : 'No se pudo importar la playlist: ${describeError(error)}',
      );
    } finally {
      if (imported != null) await importer.cleanup(imported);
      if (mounted) setState(() => _working = false);
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
              Text('Homeostasia', style: theme.textTheme.headlineSmall),
              const SizedBox(height: 12),
              const Text(
                'Elige archivos de audio (WAV, MP3, M4A, FLAC, OGG u OPUS) o ZIP con canciones. '
                'Se envían a GitHub y la biblioteca los publica para todos, con el nombre del archivo como título.',
              ),
              const SizedBox(height: 8),
              Text(kUploadRightsNotice, style: theme.textTheme.bodySmall),
              const SizedBox(height: 16),
              FilledButton.icon(
                key: const Key('homeostasia-pick'),
                onPressed: _working ? null : _send,
                icon: const Icon(Icons.upload_rounded),
                label: const Text('Enviar a GitHub'),
              ),
              const SizedBox(height: 20),
              Text(
                'Importar playlist de YouTube',
                style: theme.textTheme.titleMedium,
              ),
              const SizedBox(height: 8),
              const Text(
                'Se convierten sus canciones a WAV y después se envían por la misma cola de GitHub.',
              ),
              const SizedBox(height: 8),
              TextField(
                key: const Key('homeostasia-youtube-url'),
                controller: _playlistController,
                enabled: !_working,
                keyboardType: TextInputType.url,
                textInputAction: TextInputAction.done,
                decoration: const InputDecoration(
                  labelText: 'URL de la playlist',
                  hintText: 'https://www.youtube.com/playlist?list=…',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 8),
              FilledButton.tonalIcon(
                key: const Key('homeostasia-youtube-import'),
                onPressed: _working ? null : _importYoutube,
                icon: const Icon(Icons.playlist_add_rounded),
                label: const Text('Importar playlist'),
              ),
              if (_status != null) ...[
                const SizedBox(height: 12),
                Text(
                  _status!,
                  key: const Key('homeostasia-status'),
                  style: theme.textTheme.bodyMedium,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
