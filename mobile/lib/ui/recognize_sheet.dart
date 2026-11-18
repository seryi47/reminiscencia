import 'dart:async';

import 'package:flutter/material.dart';

import 'dart:math' as math;

import '../local_audio.dart';
import '../mic_capture.dart';
import '../music_recognition.dart';
import '../recognition_history.dart';
import '../services.dart';
import '../youtube_importer.dart';

/// Hoja «Reconocer canción» (ADR-0048): botón central grande, animación de escucha y resultado con portada/título. No
/// bloquea: el micrófono solo se activa al pulsar y se cierra en cuanto termina o el usuario cancela.

Future<void> openRecognizeSheet(BuildContext context, AppServices services) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    useRootNavigator: true,
    builder: (_) => _RecognizeSheet(services: services),
  );
}

class _RecognizeSheet extends StatefulWidget {
  const _RecognizeSheet({required this.services});
  final AppServices services;
  @override
  State<_RecognizeSheet> createState() => _RecognizeSheetState();
}

class _RecognizeSheetState extends State<_RecognizeSheet> {
  final MusicRecognizer _recognizer = MusicRecognizer();
  final RecognitionHistory _history = RecognitionHistory();
  Completer<void>? _cancel;
  RecognitionProgress _progress = const RecognitionProgress(RecognitionStatus.idle, message: 'Pulsa para reconocer la canción que suena a tu alrededor.');
  String? _currentHistoryId;

  List<RecognitionHistoryEntry> _initialHistory = const [];

  @override
  void initState() {
    super.initState();
    // Carga inmediata: evitamos la carrera «StreamBuilder se suscribe DESPUÉS de que el stream ya emitió».
    _history.load().then((entries) {
      if (!mounted) return;
      setState(() => _initialHistory = entries);
    });
  }

  @override
  void dispose() {
    // Si el usuario cierra la hoja (drag-down del bottom sheet) mientras hay una captura en marcha, completar el
    // Completer de cancel ANTES de dispose del recognizer evita el mensaje «recorder already stopped» de record 5.1.2
    // (porque el mic_capture para y dispone en orden).
    if (_cancel != null && !_cancel!.isCompleted) _cancel!.complete();
    _recognizer.dispose();
    _history.dispose();
    super.dispose();
  }

  Future<void> _start() async {
    if (_isBusy(_progress.status)) return;
    _cancel = Completer<void>();
    _currentHistoryId = null; // olvidar la id del reconocimiento anterior antes de empezar otro
    final result = await _recognizer.recognize(
      cancel: _cancel!.future,
      onProgress: (p) {
        if (mounted) setState(() => _progress = p);
      },
    );
    // El completer queda sin resolver si el camino fue feliz (no se tocó «stop»): cerrarlo ahora evita fugas de listeners
    // que lo escucharan.
    if (_cancel != null && !_cancel!.isCompleted) _cancel!.complete();
    _cancel = null;
    // Guardar en historial (solo si no fue cancelado antes del resultado).
    final status = _progress.status;
    if (status == RecognitionStatus.matched || status == RecognitionStatus.notMatched) {
      _currentHistoryId = 'r${DateTime.now().microsecondsSinceEpoch}_${math.Random().nextInt(1 << 20)}';
      await _history.add(RecognitionHistoryEntry(
        id: _currentHistoryId!,
        at: DateTime.now(),
        status: result.matched
            ? (result.songId != null ? RecognitionHistoryStatus.inLibrary : RecognitionHistoryStatus.pendingImport)
            : RecognitionHistoryStatus.notMatched,
        title: result.title ?? '',
        artist: result.artist ?? '',
        songId: result.songId,
        source: result.source,
        confidence: result.confidence,
      ));
    }
  }

  void _stop() {
    final c = _cancel;
    if (c != null && !c.isCompleted) c.complete();
  }

  bool _isBusy(RecognitionStatus s) =>
      s == RecognitionStatus.requestingPermission ||
      s == RecognitionStatus.listening ||
      s == RecognitionStatus.analyzing ||
      s == RecognitionStatus.querying;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final status = _progress.status;
    final busy = _isBusy(status);

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text('Reconocer canción', style: theme.textTheme.titleLarge),
            ),
            const SizedBox(height: 12),
            SizedBox(
              height: 220,
              child: Center(
                child: _ListenButton(busy: busy, status: status, onTap: busy ? _stop : _start),
              ),
            ),
            const SizedBox(height: 12),
            Text(
              _progress.message,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyLarge,
            ),
            const SizedBox(height: 24),
            if (status == RecognitionStatus.matched)
              _MatchResult(
                progress: _progress,
                services: widget.services,
                onOpen: _openSong,
                onImport: _importFromYoutube,
              ),
            if (status == RecognitionStatus.notMatched) _NotFoundHint(onRetry: _start, reason: _progress.reason),
            if (status == RecognitionStatus.error)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    if (_progress.reason == 'mic_permanently_denied') ...[
                      OutlinedButton.icon(
                        onPressed: () => openMicSettings(),
                        icon: const Icon(Icons.settings),
                        label: const Text('Abrir Ajustes'),
                      ),
                      const SizedBox(width: 12),
                    ],
                    FilledButton(onPressed: _start, child: const Text('Volver a intentar')),
                  ],
                ),
              ),
            const SizedBox(height: 24),
            _HistorySection(
              history: _history,
              initial: _initialHistory,
              onOpenLibrary: _openSongById,
              onRetryImport: _retryImportFromHistory,
            ),
          ],
        ),
      ),
    );
  }

  void _openSongById(String songId, String title) {
    _playSongById(songId, title);
  }

  Future<void> _retryImportFromHistory(RecognitionHistoryEntry entry) async {
    if (entry.title.isEmpty) return;
    setState(() => _progress = RecognitionProgress(
      RecognitionStatus.querying,
      message: 'Reintentando «${entry.title}»…',
      title: entry.title,
      artist: entry.artist,
    ));
    _currentHistoryId = entry.id;
    await _history.updateStatus(entry.id, RecognitionHistoryStatus.pendingImport);
    await _importFromYoutube();
  }

  Future<void> _openSong() async {
    final id = _progress.songId;
    if (id == null) return;
    await _playSongById(id, _progress.title ?? '');
  }

  /// Busca la canción por id en la biblioteca y la reproduce de verdad. Si la biblioteca aún no está cargada, la pide
  /// (`ensureLoaded`) antes de buscar, para no decir «no disponible» cuando de verdad SÍ lo está.
  Future<void> _playSongById(String songId, String title) async {
    final library = widget.services.library;
    try {
      if (library.songs.isEmpty) await library.ensureLoaded();
      final song = library.songs.firstWhere(
        (s) => s.id == songId,
        orElse: () => throw StateError('no_song'),
      );
      if (!mounted) return;
      Navigator.of(context).pop();
      await library.playSong(song);
    } catch (_) {
      if (!mounted) return;
      final msg = title.isNotEmpty ? 'No se pudo abrir «$title»' : 'La canción ya no está disponible.';
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
    }
  }

  /// Vía 2 (letras): la canción no está en la biblioteca, pero sabemos título y artista. Busca en YouTube, descarga y la
  /// mete en la biblioteca por el mismo camino que «Transferir música»/«Homeostasia». Progreso en el propio diálogo.
  Future<void> _importFromYoutube() async {
    final title = _progress.title ?? '';
    final artist = _progress.artist ?? '';
    // SNAPSHOT local de la id del historial: si el usuario pulsa «Reconocer» otra vez a mitad de descarga, _start
    // nulifica `_currentHistoryId`; sin este snapshot el update de estado (imported/importFailed) caería en null y
    // la fila del historial de ESTA importación se quedaría eternamente como `pendingImport`.
    final historyId = _currentHistoryId;
    if (title.isEmpty) return;
    final importer = widget.services.youtube;
    if (importer == null) {
      _toast('La conexión con YouTube no está disponible.');
      return;
    }
    setState(() => _progress = const RecognitionProgress(
      RecognitionStatus.querying, message: 'Buscando en YouTube…',
    ));
    try {
      final query = artist.isNotEmpty ? '$title $artist' : title;
      final candidates = await importer.search(query);
      if (candidates.isEmpty) {
        setState(() => _progress = RecognitionProgress(
          RecognitionStatus.error,
          message: 'No se encontró «$title» en YouTube.',
          title: title, artist: artist,
        ));
        return;
      }
      final top = candidates.first;
      setState(() => _progress = RecognitionProgress(
        RecognitionStatus.querying,
        message: 'Descargando «${top.title}»…',
        title: title, artist: artist,
      ));
      final imported = await importer.importTracks([
        YoutubeTrack(url: top.url, title: top.title, artist: artist),
      ]);
      if (imported.isEmpty) {
        setState(() => _progress = RecognitionProgress(
          RecognitionStatus.error,
          message: 'No se pudo descargar la canción.',
          title: title, artist: artist,
        ));
        return;
      }
      await widget.services.library.uploadShared([
        for (final a in imported)
          PickedAudioFile(name: a.name, path: a.path, artist: a.track.artist),
      ]);
      await importer.cleanup(imported);
      if (historyId != null) {
        await _history.updateStatus(historyId, RecognitionHistoryStatus.imported);
      }
      if (!mounted) return;
      Navigator.of(context).pop();
      _toast('«$title» añadida a tu biblioteca. Se publicará en un momento.');
    } catch (error) {
      if (historyId != null) {
        await _history.updateStatus(historyId, RecognitionHistoryStatus.importFailed);
      }
      if (!mounted) return;
      setState(() => _progress = RecognitionProgress(
        RecognitionStatus.error,
        message: 'Fallo al importar: $error',
        title: title, artist: artist,
      ));
    }
  }

  void _toast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }
}

class _ListenButton extends StatelessWidget {
  const _ListenButton({required this.busy, required this.status, required this.onTap});
  final bool busy;
  final RecognitionStatus status;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final primary = theme.colorScheme.primary;
    return GestureDetector(
      onTap: onTap,
      child: Stack(
        alignment: Alignment.center,
        children: [
          if (busy) _Pulse(color: primary),
          Container(
            width: 148,
            height: 148,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: busy ? primary.withValues(alpha: 0.9) : primary,
              boxShadow: [
                BoxShadow(color: primary.withValues(alpha: 0.35), blurRadius: 24, spreadRadius: 2),
              ],
            ),
            child: Icon(
              busy ? Icons.stop_rounded : Icons.mic_rounded,
              size: 64,
              color: theme.colorScheme.onPrimary,
            ),
          ),
        ],
      ),
    );
  }
}

class _Pulse extends StatefulWidget {
  const _Pulse({required this.color});
  final Color color;
  @override
  State<_Pulse> createState() => _PulseState();
}

class _PulseState extends State<_Pulse> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1500))..repeat();
  @override
  void dispose() { _c.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (_, _) {
        final t = _c.value;
        return Stack(
          alignment: Alignment.center,
          children: List.generate(3, (i) {
            final phase = ((t + i / 3) % 1.0);
            final size = 148 + 120 * phase;
            final opacity = (1.0 - phase) * 0.35;
            return Container(
              width: size,
              height: size,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: widget.color.withValues(alpha: opacity), width: 2),
              ),
            );
          }),
        );
      },
    );
  }
}

class _MatchResult extends StatelessWidget {
  const _MatchResult({
    required this.progress,
    required this.services,
    required this.onOpen,
    required this.onImport,
  });
  final RecognitionProgress progress;
  final AppServices services;
  final VoidCallback onOpen;
  final VoidCallback onImport;
  @override
  Widget build(BuildContext context) {
    // La vía biblioteca trae `songId`; la vía letras no. Según eso cambiamos el CTA.
    final inLibrary = progress.songId != null;
    return Column(
      children: [
        Text(progress.title ?? '', style: Theme.of(context).textTheme.titleMedium, textAlign: TextAlign.center),
        if ((progress.artist ?? '').isNotEmpty) ...[
          const SizedBox(height: 4),
          Text(progress.artist!, style: Theme.of(context).textTheme.bodyMedium, textAlign: TextAlign.center),
        ],
        if (!inLibrary) ...[
          const SizedBox(height: 8),
          Text(
            'No está en tu biblioteca. Puedes buscarla en YouTube e importarla ya.',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
        const SizedBox(height: 16),
        if (inLibrary)
          FilledButton.icon(
            onPressed: onOpen,
            icon: const Icon(Icons.play_arrow_rounded),
            label: const Text('Abrir en Reminiscencia'),
          )
        else
          FilledButton.icon(
            onPressed: onImport,
            icon: const Icon(Icons.library_add_rounded),
            label: const Text('Añadir a mi biblioteca'),
          ),
      ],
    );
  }
}

class _NotFoundHint extends StatelessWidget {
  const _NotFoundHint({required this.onRetry, this.reason});
  final VoidCallback onRetry;
  final String? reason;

  String _hintFor(String? reason) {
    switch (reason) {
      case 'db_not_ready':
        return 'La base de huellas aún no está lista en el servidor. Prueba otra vez en unos minutos.';
      case 'db_query_failed':
      case 'db_rate_limited':
        // El servidor se quedó sin cuota de consultas (plan gratuito de Cloudflare D1); se reinicia a medianoche UTC.
        return 'Ahora mismo no puedo consultar la biblioteca (demasiadas consultas hoy). Vuelve a intentarlo en un rato.';
      default:
        return 'No la tenemos en tu biblioteca. Si sabes el nombre y el artista, impórtala desde «Transferir música» o «Homeostasia».';
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Text(
            _hintFor(reason),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        ),
        const SizedBox(height: 12),
        OutlinedButton(onPressed: onRetry, child: const Text('Volver a intentar')),
      ],
    );
  }
}

/// Lista de reconocimientos pasados; permite reintentar una importación que falló (ADR-0048).
class _HistorySection extends StatelessWidget {
  const _HistorySection({
    required this.history,
    required this.initial,
    required this.onOpenLibrary,
    required this.onRetryImport,
  });
  final RecognitionHistory history;
  final List<RecognitionHistoryEntry> initial;
  final void Function(String songId, String title) onOpenLibrary;
  final void Function(RecognitionHistoryEntry entry) onRetryImport;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<List<RecognitionHistoryEntry>>(
      stream: history.stream,
      initialData: initial,
      builder: (context, snapshot) {
        final entries = (snapshot.data ?? const <RecognitionHistoryEntry>[]).take(12).toList();
        if (entries.isEmpty) return const SizedBox.shrink();
        final theme = Theme.of(context);
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.only(bottom: 8, left: 4, right: 4),
              child: Row(
                children: [
                  Text('Historial', style: theme.textTheme.titleSmall),
                  const Spacer(),
                  TextButton.icon(
                    onPressed: () async {
                      final go = await showDialog<bool>(
                        context: context,
                        builder: (dc) => AlertDialog(
                          title: const Text('¿Limpiar el historial?'),
                          content: const Text('Se borran los reconocimientos guardados en este teléfono. No afecta a la biblioteca.'),
                          actions: [
                            TextButton(onPressed: () => Navigator.of(dc).pop(false), child: const Text('Cancelar')),
                            FilledButton(onPressed: () => Navigator.of(dc).pop(true), child: const Text('Limpiar')),
                          ],
                        ),
                      );
                      if (go == true) await history.clear();
                    },
                    icon: const Icon(Icons.delete_outline, size: 16),
                    label: const Text('Limpiar'),
                  ),
                ],
              ),
            ),
            for (final e in entries) _HistoryRow(entry: e, onOpenLibrary: onOpenLibrary, onRetryImport: onRetryImport),
          ],
        );
      },
    );
  }
}

class _HistoryRow extends StatelessWidget {
  const _HistoryRow({required this.entry, required this.onOpenLibrary, required this.onRetryImport});
  final RecognitionHistoryEntry entry;
  final void Function(String songId, String title) onOpenLibrary;
  final void Function(RecognitionHistoryEntry entry) onRetryImport;

  String _subtitle() {
    switch (entry.status) {
      case RecognitionHistoryStatus.inLibrary:
        return 'En tu biblioteca · ${entry.artist}';
      case RecognitionHistoryStatus.pendingImport:
        return 'Identificada por letra · ${entry.artist}';
      case RecognitionHistoryStatus.imported:
        return 'Añadida a tu biblioteca · ${entry.artist}';
      case RecognitionHistoryStatus.importFailed:
        return 'La importación falló · ${entry.artist}';
      case RecognitionHistoryStatus.notMatched:
        return 'No identificada';
    }
  }

  IconData _icon() {
    switch (entry.status) {
      case RecognitionHistoryStatus.inLibrary: return Icons.library_music_rounded;
      case RecognitionHistoryStatus.pendingImport: return Icons.lyrics_rounded;
      case RecognitionHistoryStatus.imported: return Icons.check_circle_rounded;
      case RecognitionHistoryStatus.importFailed: return Icons.error_outline_rounded;
      case RecognitionHistoryStatus.notMatched: return Icons.help_outline_rounded;
    }
  }

  @override
  Widget build(BuildContext context) {
    Widget? trailing;
    VoidCallback? onTap;
    if (entry.status == RecognitionHistoryStatus.inLibrary && entry.songId != null) {
      trailing = const Icon(Icons.play_arrow_rounded);
      onTap = () => onOpenLibrary(entry.songId!, entry.title);
    } else if (entry.status == RecognitionHistoryStatus.importFailed) {
      trailing = TextButton(onPressed: () => onRetryImport(entry), child: const Text('Reintentar'));
    } else if (entry.status == RecognitionHistoryStatus.pendingImport) {
      trailing = TextButton(onPressed: () => onRetryImport(entry), child: const Text('Importar'));
    }
    return ListTile(
      dense: true,
      leading: Icon(_icon()),
      title: Text(entry.title.isEmpty ? 'Sin título' : entry.title, maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: Text(_subtitle(), maxLines: 1, overflow: TextOverflow.ellipsis),
      trailing: trailing,
      onTap: onTap,
    );
  }
}
