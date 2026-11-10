import 'dart:async';

import 'package:flutter/material.dart';

import '../app_error.dart';
import '../local_audio.dart';
import '../services.dart';
import '../shared_upload.dart';
import '../theme.dart';
import '../youtube_embed.dart';
import '../youtube_importer.dart';
import '../youtube_imports_store.dart';
import 'common.dart';

enum YoutubeDownloadState { idle, running, queued, error }

class YoutubeDownload {
  const YoutubeDownload(this.state, [this.message = '']);

  final YoutubeDownloadState state;
  final String message;
}

/// Estado de la tarjeta tras enviar la canción: «En cola» solo si algo llegó a la web; si no, el motivo real.
YoutubeDownload downloadAfterUpload(SharedUploadResult sent) {
  if (sent.uploaded == 0 && sent.items.isNotEmpty) {
    final failed = sent.items.first;
    return YoutubeDownload(
      YoutubeDownloadState.error,
      'No se pudo subir la canción: ${failed.message}',
    );
  }
  return YoutubeDownload(
    YoutubeDownloadState.queued,
    describeUploadResult(sent),
  );
}

/// Descargas iniciadas desde el buscador. Viven fuera de la pantalla para seguir si se repinta o se cambia de pestaña,
/// y se guardan en disco ([YoutubeImportsStore]) para **reanudarse al abrir la app** si el sistema la cerró a media
/// descarga: la mitad de «importar» ya no se pierde «como si nunca hubiera pasado» (la de «subir» ya era persistente).
class YoutubeDownloads extends ChangeNotifier {
  YoutubeDownloads({YoutubeImportsStore? store})
    : _store = store ?? YoutubeImportsStore();

  final YoutubeImportsStore _store;
  final Map<String, YoutubeDownload> _byId = {};
  // Importaciones en curso (aún no entregadas a la cola de subidas): lo que se persiste para poder reanudarlo.
  final Map<String, PendingYoutubeImport> _pending = {};
  bool _restored = false;

  YoutubeDownload of(String id) =>
      _byId[id] ?? const YoutubeDownload(YoutubeDownloadState.idle);

  void _set(String id, YoutubeDownload value) {
    _byId[id] = value;
    notifyListeners();
  }

  /// Guarda en disco las importaciones en curso. Es «best-effort»: si falla (p. ej. sin `path_provider` en pruebas),
  /// la descarga sigue igual; solo no se podría reanudar tras un cierre.
  Future<void> _savePending() async {
    try {
      await _store.write(_pending.values.toList(growable: false));
    } catch (_) {
      // Sin persistencia la descarga continúa; solo se pierde la reanudación automática.
    }
  }

  /// Reanuda las importaciones que quedaron a medias cuando el sistema cerró la app. Se llama una vez al abrir
  /// (y es idempotente): [start] no duplica si la importación ya está en curso.
  Future<void> restore(AppServices services) async {
    if (_restored) return;
    _restored = true;
    List<PendingYoutubeImport> pending;
    try {
      pending = await _store.read();
    } catch (_) {
      return;
    }
    // Se cargan todas en memoria antes de reanudar: así, si una termina y reescribe el índice, no borra las demás.
    for (final entry in pending) {
      _pending[entry.id] = entry;
    }
    for (final entry in pending) {
      unawaited(start(services, entry.toResult()));
    }
  }

  /// Misma descarga que pegar la URL en Homeostasia: el proxy lee título y artista, se convierte a WAV y se envía por
  /// la cola de subidas, que lo publica en la biblioteca.
  Future<void> start(AppServices services, YoutubeSearchResult result) async {
    final current = of(result.id).state;
    if (current == YoutubeDownloadState.running ||
        current == YoutubeDownloadState.queued) {
      return;
    }
    final importer = services.youtube;
    if (importer == null) {
      _set(
        result.id,
        const YoutubeDownload(
          YoutubeDownloadState.error,
          'La descarga de YouTube no está disponible en esta versión.',
        ),
      );
      if (_pending.remove(result.id) != null) unawaited(_savePending());
      return;
    }
    _set(
      result.id,
      const YoutubeDownload(
        YoutubeDownloadState.running,
        'Preparando la descarga…',
      ),
    );
    // Se guarda la intención ANTES del trabajo largo: si el sistema cierra la app a media descarga, al volver se reanuda.
    // Sin bloquear el inicio de la importación (la escritura es de milisegundos y la cola serial del store ordena los cambios).
    _pending[result.id] = PendingYoutubeImport.fromResult(result);
    unawaited(_savePending());
    List<YoutubeImportedAudio>? imported;
    try {
      if (!await services.library.canUpload()) {
        throw const AppException(kOfflineMessage);
      }
      imported = await importer.importPlaylist(
        result.url,
        onProgress: (progress) {
          if (of(result.id).state == YoutubeDownloadState.running) {
            _set(
              result.id,
              YoutubeDownload(YoutubeDownloadState.running, progress.message),
            );
          }
        },
      );
      final sent = await services.library.uploadShared([
        for (final audio in imported)
          PickedAudioFile(
            name: audio.name,
            path: audio.path,
            artist: audio.track.artist.isEmpty
                ? result.artist
                : audio.track.artist,
            youtubePlaylistId: audio.track.playlistId,
            youtubePlaylistName: audio.track.playlistTitle,
          ),
      ]);
      // Entregada a la cola de subidas, que SÍ es persistente y se reanuda sola: ya no hace falta recordarla aquí.
      _pending.remove(result.id);
      unawaited(_savePending());
      _set(result.id, downloadAfterUpload(sent));
    } catch (error) {
      _pending.remove(result.id);
      unawaited(_savePending());
      _set(
        result.id,
        YoutubeDownload(
          YoutubeDownloadState.error,
          error is AppException
              ? error.message
              : 'No se pudo descargar la canción: ${describeError(error)}',
        ),
      );
    } finally {
      if (imported != null) await importer.cleanup(imported);
    }
  }
}

final YoutubeDownloads youtubeDownloads = YoutubeDownloads();

/// Sección «En YouTube» del buscador (ADR-0021). Sola si la biblioteca no tiene la canción; si la tiene, tras pulsar
/// «Buscar en YouTube».
class YoutubeSearchSection extends StatefulWidget {
  const YoutubeSearchSection({
    super.key,
    required this.services,
    required this.query,
    required this.automatic,
    this.debounce = const Duration(milliseconds: 700),
  });

  final AppServices services;
  final String query;
  final bool automatic;
  final Duration debounce;

  @override
  State<YoutubeSearchSection> createState() => _YoutubeSearchSectionState();
}

class _YoutubeSearchSectionState extends State<YoutubeSearchSection> {
  static final Map<String, List<YoutubeSearchResult>> _cache = {};

  Timer? _timer;
  YoutubeImportCancellation? _cancellation;
  List<YoutubeSearchResult>? _results;
  String? _error;
  bool _loading = false;
  String? _listeningId;

  String? get _text => youtubeSearchQuery(widget.query);

  @override
  void initState() {
    super.initState();
    youtubeDownloads.addListener(_onDownloads);
    youtubeEmbed.addListener(_onDownloads);
    _plan();
  }

  @override
  void didUpdateWidget(YoutubeSearchSection old) {
    super.didUpdateWidget(old);
    if (old.query != widget.query || old.automatic != widget.automatic) {
      _plan();
    }
  }

  @override
  void dispose() {
    youtubeDownloads.removeListener(_onDownloads);
    youtubeEmbed.removeListener(_onDownloads);
    _timer?.cancel();
    _cancellation?.cancel();
    super.dispose();
  }

  void _onDownloads() {
    if (mounted) setState(() {});
  }

  void _plan() {
    _timer?.cancel();
    _cancellation?.cancel();
    _cancellation = null;
    _error = null;
    _loading = false;
    final text = _text;
    _results = text == null ? null : _cache[text];
    if (text == null || _results != null) return;
    if (widget.automatic && widget.services.youtube != null) {
      _loading = true;
      _timer = Timer(widget.debounce, _search);
    }
  }

  Future<void> _search() async {
    final text = _text;
    final importer = widget.services.youtube;
    if (text == null || importer == null) return;
    _cancellation?.cancel();
    final cancellation = YoutubeImportCancellation();
    _cancellation = cancellation;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final found = await importer.search(text, cancellation: cancellation);
      _cache[text] = found;
      if (!mounted || cancellation.isCancelled) return;
      setState(() {
        _results = found;
        _loading = false;
      });
    } catch (error) {
      if (!mounted || cancellation.isCancelled) return;
      setState(() {
        _loading = false;
        _error = error is AppException
            ? error.message
            : 'No se pudo buscar en YouTube: ${describeError(error)}';
      });
    }
  }

  Future<void> _listen(YoutubeSearchResult result) async {
    final services = widget.services;
    if (youtubeEmbed.current?.id == result.id) {
      youtubeEmbed.close();
      return;
    }
    setState(() => _listeningId = result.id);
    try {
      var streamed = false;
      final resolver = services.streamResolver;
      if (resolver != null) {
        try {
          final stream = await resolver.resolve(result.id);
          youtubeEmbed.close();
          await services.playback.playStream(
            id: result.id,
            title: result.title,
            artist: result.artist,
            uri: stream.uri,
            headers: stream.headers,
            duration: result.durationS > 0
                ? Duration(seconds: result.durationS)
                : stream.duration,
          );
          streamed = true;
        } catch (_) {
          // YouTube no deja sacar el audio de algunos vídeos: se usa su reproductor incrustado, como la web.
        }
      }
      if (!streamed) {
        if (services.playback.nowPlaying.value.playing) {
          await services.playback.togglePlayPause();
        }
        youtubeEmbed.open(result.id, result.title);
      }
      // La descarga empieza a la vez que suena, como pidió el diseño del buscador.
      unawaited(youtubeDownloads.start(services, result));
    } catch (error) {
      _notify('No se pudo escuchar «${result.title}»: ${describeError(error)}');
    } finally {
      if (mounted) setState(() => _listeningId = null);
    }
  }

  void _notify(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final text = _text;
    final Widget body;
    if (text == null) {
      body = Text(
        'Escribe al menos 3 letras para buscar también en YouTube.',
        style: theme.textTheme.bodyMedium,
      );
    } else if (widget.services.youtube == null) {
      body = Text(
        'La búsqueda en YouTube no está disponible en esta versión.',
        style: theme.textTheme.bodyMedium,
      );
    } else if (_error != null) {
      body = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(_error!, key: const Key('youtube-error')),
          TextButton(
            key: const Key('youtube-retry'),
            onPressed: _search,
            child: const Text('Reintentar'),
          ),
        ],
      );
    } else if (_loading) {
      body = Row(
        children: [
          const SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          const SizedBox(width: 12),
          Text('Buscando en YouTube…', style: theme.textTheme.bodyMedium),
        ],
      );
    } else if (_results == null) {
      body = Align(
        alignment: Alignment.centerLeft,
        child: OutlinedButton.icon(
          key: const Key('youtube-search-button'),
          onPressed: _search,
          icon: const Icon(Icons.search_rounded),
          label: Text('Buscar «$text» en YouTube'),
        ),
      );
    } else if (_results!.isEmpty) {
      body = Text(
        'YouTube no ha encontrado canciones para «$text».',
        key: const Key('youtube-empty'),
        style: theme.textTheme.bodyMedium,
      );
    } else {
      body = Column(
        children: [
          for (final result in _results!)
            _YoutubeResultTile(
              result: result,
              download: youtubeDownloads.of(result.id),
              listening: _listeningId == result.id,
              onListen: () => _listen(result),
              onDownload: () => youtubeDownloads.start(widget.services, result),
            ),
        ],
      );
    }
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
      child: Semantics(
        liveRegion: true,
        child: Column(
          key: const Key('youtube-section'),
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Semantics(
              header: true,
              child: Text('En YouTube', style: theme.textTheme.titleLarge),
            ),
            const SizedBox(height: 8),
            body,
          ],
        ),
      ),
    );
  }
}

class _YoutubeResultTile extends StatelessWidget {
  const _YoutubeResultTile({
    required this.result,
    required this.download,
    required this.listening,
    required this.onListen,
    required this.onDownload,
  });

  final YoutubeSearchResult result;
  final YoutubeDownload download;
  final bool listening;
  final VoidCallback onListen;
  final VoidCallback onDownload;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = paletteOf(context);
    final meta = [
      if (result.artist.isNotEmpty) result.artist,
      if (result.durationS > 0) formatYoutubeDuration(result.durationS),
    ].join(' · ');
    final busy = download.state == YoutubeDownloadState.running;
    final queued = download.state == YoutubeDownloadState.queued;
    return Card(
      key: Key('youtube-result-${result.id}'),
      margin: const EdgeInsets.only(bottom: 8),
      color: palette.elevated,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(result.title, style: theme.textTheme.titleMedium),
            if (meta.isNotEmpty) Text(meta, style: theme.textTheme.bodySmall),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 4,
              children: [
                FilledButton.icon(
                  key: Key('youtube-listen-${result.id}'),
                  onPressed: listening ? null : onListen,
                  icon: listening
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.play_arrow_rounded),
                  label: Text(
                    listening
                        ? 'Abriendo…'
                        : (youtubeEmbed.current?.id == result.id
                              ? 'Cerrar'
                              : 'Escuchar'),
                  ),
                ),
                OutlinedButton.icon(
                  key: Key('youtube-download-${result.id}'),
                  onPressed: busy || queued ? null : onDownload,
                  icon: Icon(
                    queued ? Icons.check_rounded : Icons.download_rounded,
                  ),
                  label: Text(
                    queued
                        ? 'En cola'
                        : busy
                        ? 'Descargando…'
                        : download.state == YoutubeDownloadState.error
                        ? 'Reintentar'
                        : 'Descargar',
                  ),
                ),
              ],
            ),
            if (download.message.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  download.message,
                  key: Key('youtube-status-${result.id}'),
                  style: theme.textTheme.bodySmall,
                ),
              ),
          ],
        ),
      ),
    );
  }
}
