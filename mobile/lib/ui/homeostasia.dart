import 'package:flutter/material.dart';

import '../app_error.dart';
import '../local_audio.dart';
import '../services.dart';
import '../shared_upload.dart';
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

  @override
  void initState() {
    super.initState();
    widget.services.library.uploads.addListener(_onUploads);
  }

  @override
  void dispose() {
    widget.services.library.uploads.removeListener(_onUploads);
    super.dispose();
  }

  // Resumen de la cola de subidas («1 de 2 publicadas»), el mismo que muestra «Tu biblioteca».
  void _onUploads() {
    if (!mounted || _status == null) return;
    final summary = widget.services.library.uploads.summary;
    if (summary.isNotEmpty) setState(() => _status = summary);
  }

  Future<void> _send() async {
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
                onPressed: _send,
                icon: const Icon(Icons.upload_rounded),
                label: const Text('Enviar a GitHub'),
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
