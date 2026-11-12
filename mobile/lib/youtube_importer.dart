import 'dart:async';
import 'dart:convert';
import 'dart:developer' as developer;
import 'dart:io';
import 'dart:math';

import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app_error.dart';
import 'library_store.dart';

const int kYoutubeMaxPlaylistItems = 200;
const int kYoutubeMaxWavBytes = 256 * 1024 * 1024;
const int kYoutubeMaxTitleRunes = 120;
const int kYoutubeConcurrency = 4;
const int kYoutubeConvertCreateAttempts = 6;
const int kYoutubeStatusErrorRetries = 5;
const Duration kYoutubeConvertCreateGap = Duration(seconds: 2);
const Duration kYoutubePollInterval = Duration(seconds: 3);
const Duration kYoutubeJobTimeout = Duration(minutes: 10);
const Duration kYoutubeRequestTimeout = Duration(seconds: 45);
const Duration kYoutubeDownloadTimeout = Duration(minutes: 3);

/// Conversor yttowav. La APK habla DIRECTAMENTE con él (no por el Worker) en convert/status/download: así cada teléfono
/// usa su propia IP, con su propio cupo diario (40/día por IP), en vez de compartir la única IP del Worker con toda la
/// web (que es lo que agotaba el cupo). La lista de la playlist y la búsqueda siguen yendo por el Worker, porque
/// necesitan yt-dlp y no se pueden hacer desde el teléfono. ADR-0045.
const String kConverterApi = 'https://api.yttowav.org';

/// Canción que devuelve el proxy de playlists.
class YoutubeTrack {
  const YoutubeTrack({
    required this.url,
    required this.title,
    this.artist = '',
    this.playlistId,
    this.playlistTitle,
  });

  final String url;
  final String title;
  final String artist;
  final String? playlistId;
  final String? playlistTitle;
}

String _artistText(Object? value) {
  if (value is! String) return '';
  return String.fromCharCodes(value.trim().runes.take(200));
}

/// WAV descargado y listo para entrar en la cola normal de subidas.
class YoutubeImportedAudio {
  const YoutubeImportedAudio({
    required this.name,
    required this.path,
    required this.track,
  });

  final String name;
  final String path;
  final YoutubeTrack track;
}

class YoutubeImportProgress {
  const YoutubeImportProgress({
    required this.index,
    required this.total,
    required this.title,
    required this.phase,
    this.queuePosition,
    this.queueLength,
    this.progress,
  });

  final int index;
  final int total;
  final String title;
  final String phase;
  final int? queuePosition;
  final int? queueLength;
  final double? progress;

  String get message => '${index + 1} de $total: $phase «$title»';
}

typedef YoutubeImportProgressCallback =
    void Function(YoutubeImportProgress progress);

class YoutubeHttpException extends AppException {
  const YoutubeHttpException(
    super.message, {
    required this.statusCode,
    this.retryAfter,
  });

  final int statusCode;
  final String? retryAfter;
}

/// Tope DIARIO del conversor (yttowav gratuito: 40/día). No se arregla hoy: corta la tanda y se avisa.
class YoutubeDailyLimitException extends AppException {
  const YoutubeDailyLimitException([
    super.message = 'Límite diario del conversor alcanzado (40/día). Vuelve mañana.',
  ]);
}

bool _isDailyLimit(Object error) {
  final message = error is AppException ? error.message : error.toString();
  return RegExp(
    r'daily conversion limit|per day|come back tomorrow|l[ií]mite diario',
    caseSensitive: false,
  ).hasMatch(message);
}

class YoutubeImportCancellation {
  final Completer<void> _cancelled = Completer<void>();

  bool get isCancelled => _cancelled.isCompleted;

  Future<void> get whenCancelled => _cancelled.future;

  void cancel() {
    if (!isCancelled) _cancelled.complete();
  }

  void throwIfCancelled() {
    if (isCancelled) {
      throw const AppException('Se detuvo el seguimiento de la conversión.');
    }
  }
}

class _PendingYoutubeJob {
  const _PendingYoutubeJob({required this.jobId, required this.traceId});

  final String jobId;
  final String traceId;
}

/// Cliente Android del importador de YouTube.
///
/// La lista de la playlist y la búsqueda las pide al Worker (necesitan yt-dlp). La conversión a WAV (convert, status y
/// download) va DIRECTA a yttowav desde el teléfono (ADR-0045): así cada móvil usa su propia IP, con su cupo diario
/// propio, en vez de compartir la única IP del Worker con toda la web. Los WAV se descargan a una carpeta temporal para
/// que `homeostasia.dart` los entregue a `LibraryController.uploadShared`.
/// Resultado de buscar en YouTube desde el buscador (ADR-0021).
class YoutubeSearchResult {
  const YoutubeSearchResult({
    required this.id,
    required this.url,
    required this.title,
    this.artist = '',
    this.durationS = 0,
  });

  final String id;
  final String url;
  final String title;
  final String artist;
  final int durationS;
}

final RegExp _videoIdPattern = RegExp(r'^[A-Za-z0-9_-]{11}$');

/// Texto que se manda a YouTube (entre 3 y 100 letras, sin espacios de más) o null si no sirve.
String? youtubeSearchQuery(String raw) {
  final text = raw.trim().replaceAll(RegExp(r'\s+'), ' ');
  final length = text.runes.length;
  return length >= 3 && length <= 100 ? text : null;
}

/// Segundos a «3:45» o «1:02:03».
String formatYoutubeDuration(int seconds) {
  final total = seconds > 0 ? seconds : 0;
  final h = total ~/ 3600;
  final m = (total % 3600) ~/ 60;
  final s = (total % 60).toString().padLeft(2, '0');
  return h > 0 ? '$h:${m.toString().padLeft(2, '0')}:$s' : '$m:$s';
}

/// Lee la respuesta de `/api/youtube/search`; descarta lo que no tiene la forma esperada.
List<YoutubeSearchResult> parseYoutubeSearch(Object? json) {
  final items = json is Map ? json['items'] : null;
  if (items is! List) {
    throw const AppException('La respuesta de la búsqueda no es válida.');
  }
  final seen = <String>{};
  final results = <YoutubeSearchResult>[];
  for (final raw in items) {
    if (raw is! Map) continue;
    final id = raw['id'];
    final title = raw['title'];
    if (id is! String || !_videoIdPattern.hasMatch(id) || !seen.add(id)) {
      continue;
    }
    if (title is! String || title.trim().isEmpty) continue;
    final duration = raw['durationS'];
    results.add(
      YoutubeSearchResult(
        id: id,
        url: 'https://www.youtube.com/watch?v=$id',
        title: title.trim(),
        artist: _artistText(raw['artist']),
        durationS: duration is num ? duration.round() : 0,
      ),
    );
  }
  return results;
}

class YoutubeImporter {
  YoutubeImporter({
    required this.client,
    Uri? base,
    Uri? converterBase,
    Future<Directory> Function()? tempDir,
    Future<void> Function(Duration)? wait,
    DateTime Function()? clock,
  }) : base = base ?? Uri.parse(kLibraryBase),
       converterBase = converterBase ?? Uri.parse('$kConverterApi/'),
       _tempDir = tempDir ?? getTemporaryDirectory,
       _wait = wait ?? Future<void>.delayed,
       _clock = clock ?? DateTime.now;

  final http.Client client;
  final Uri base;

  /// Conversor yttowav (ADR-0045): convert/status/download van aquí, directos desde el teléfono.
  final Uri converterBase;
  final Future<Directory> Function() _tempDir;
  final Future<void> Function(Duration) _wait;
  final DateTime Function() _clock;
  final Random _random = Random.secure();
  DateTime? _nextConvertCreateAt;

  Future<List<YoutubeImportedAudio>> importPlaylist(
    String playlistUrl, {
    YoutubeImportProgressCallback? onProgress,
    YoutubeImportCancellation? cancellation,
  }) async {
    cancellation?.throwIfCancelled();
    final tracks = await listPlaylist(playlistUrl, cancellation: cancellation);
    cancellation?.throwIfCancelled();
    return importTracks(tracks, onProgress: onProgress, cancellation: cancellation);
  }

  /// Convierte una lista de pistas ya conocidas (p. ej. coincidencias de Spotify ya resueltas a YouTube; ADR-0044) sin
  /// volver a leer YouTube: cada [YoutubeTrack] ya trae su URL, título y artista. Mismo camino que una playlist.
  /// Id de vídeo de una URL de YouTube (público, para la guardia anti-duplicados del auto-reanudar).
  static String? videoIdOf(String value) => _videoId(value);

  Future<List<YoutubeImportedAudio>> importTracks(
    List<YoutubeTrack> tracks, {
    YoutubeImportProgressCallback? onProgress,
    YoutubeImportCancellation? cancellation,
    Set<String>? skipVideoIds,
    void Function()? onDailyLimit,
  }) async {
    cancellation?.throwIfCancelled();
    final root = await _tempDir();
    final importDir = Directory(
      '${root.path}/youtube-import-${DateTime.now().microsecondsSinceEpoch}-${_random.nextInt(1 << 20)}',
    );
    await importDir.create(recursive: true);

    // En un LOTE (varias pistas) el fallo de una no debe tirar las demás ni borrar lo ya descargado; en una importación de
    // UNA sola pista sí se propaga el error, para que la interfaz lo muestre tal cual (p. ej. «la conversión ya no está
    // disponible, inicia de nuevo»).
    final tolerateFailures = tracks.length > 1;
    final output = List<YoutubeImportedAudio?>.filled(tracks.length, null);
    var next = 0;
    var dailyLimit = false; // tope diario del conversor: para los workers y devuelve lo ya convertido
    Future<void> worker() async {
      while (true) {
        if (dailyLimit) return; // otro worker topó con el límite diario: no se sigue
        final index = next;
        next += 1;
        if (index >= tracks.length) return;
        final track = tracks[index];
        // Guardia anti-duplicados: si este vídeo ya se importó (en un ciclo anterior del auto-reanudar), se salta: ni se
        // reconvierte ni se vuelve a subir. No cuenta como fallo.
        if (skipVideoIds != null) {
          final vid = _videoId(track.url);
          if (vid != null && skipVideoIds.contains(vid)) continue;
        }
        try {
          output[index] = await _convertAndDownload(
            track,
            index: index,
            total: tracks.length,
            directory: importDir,
            onProgress: onProgress,
            cancellation: cancellation,
          );
        } on YoutubeDailyLimitException {
          // Tope diario: se para la tanda (sin tirar lo ya descargado) y se avisa una vez.
          if (!dailyLimit) { dailyLimit = true; onDailyLimit?.call(); }
          return;
        } catch (_) {
          // Una cancelación aborta siempre; el fallo puntual de una pista de un lote (p. ej. el conversor la rechazó con
          // 503) se omite y se sigue con las demás.
          if (!tolerateFailures || (cancellation?.isCancelled ?? false)) rethrow;
        }
      }
    }

    try {
      await Future.wait([
        for (var i = 0; i < min(kYoutubeConcurrency, tracks.length); i += 1)
          worker(),
      ]);
      return output.whereType<YoutubeImportedAudio>().toList();
    } catch (_) {
      await _deleteQuietly(importDir);
      rethrow;
    }
  }

  /// Borra los WAV temporales después de que la cola normal haya terminado.
  Future<void> cleanup(Iterable<YoutubeImportedAudio> audios) async {
    final directories = <String>{
      for (final audio in audios) File(audio.path).parent.path,
    };
    for (final path in directories) {
      await _deleteQuietly(Directory(path));
    }
  }

  Future<List<YoutubeTrack>> listPlaylist(
    String value, {
    YoutubeImportCancellation? cancellation,
  }) async {
    final url = _youtubeImportUrl(value.trim());
    if (url == null) {
      throw const AppException('La URL de YouTube no es válida.');
    }
    final response = await _get(
      _endpoint(
        'api/youtube/playlist',
      ).replace(queryParameters: {'url': value.trim()}),
      cancellation: cancellation,
    );
    final data = _json(response);
    final rawItems = data['items'];
    if (rawItems is! List) {
      throw const AppException(
        'La respuesta no contiene una lista válida de canciones.',
      );
    }
    final playlistId = url.queryParameters['list'];
    String? playlistTitle;
    if (playlistId != null) {
      final playlist = data['playlist'];
      if (playlist is! Map ||
          playlist['id'] != playlistId ||
          playlist['title'] is! String ||
          (playlist['title'] as String).trim().isEmpty) {
        throw const AppException(
          'YouTube no ha devuelto el nombre de la playlist; no se iniciará una importación sin álbum.',
        );
      }
      playlistTitle = (playlist['title'] as String).trim();
    }
    final seen = <String>{};
    final tracks = <YoutubeTrack>[];
    for (final raw in rawItems) {
      if (raw is! Map) continue;
      final itemUrl = raw['url'];
      if (itemUrl is! String) continue;
      final id = _videoId(itemUrl);
      if (id == null || !seen.add(id)) continue;
      final title =
          raw['title'] is String && (raw['title'] as String).trim().isNotEmpty
          ? (raw['title'] as String).trim()
          : 'audio';
      tracks.add(
        YoutubeTrack(
          url: itemUrl,
          title: title,
          artist: _artistText(raw['artist']),
          playlistId: playlistId,
          playlistTitle: playlistTitle,
        ),
      );
      if (tracks.length >= kYoutubeMaxPlaylistItems) break;
    }
    if (tracks.isEmpty) {
      throw const AppException(
        'No se han encontrado canciones en la playlist.',
      );
    }
    return tracks;
  }

  Future<YoutubeImportedAudio> _convertAndDownload(
    YoutubeTrack track, {
    required int index,
    required int total,
    required Directory directory,
    YoutubeImportProgressCallback? onProgress,
    YoutubeImportCancellation? cancellation,
  }) async {
    cancellation?.throwIfCancelled();
    final videoId = _videoId(track.url);
    if (videoId == null) {
      throw const AppException(
        'El enlace de YouTube no contiene un vídeo válido.',
      );
    }
    final pending = await _readPendingJob(videoId);
    final traceId = pending?.traceId ?? _newTraceId();
    final deadline = _clock().add(kYoutubeJobTimeout);
    onProgress?.call(
      YoutubeImportProgress(
        index: index,
        total: total,
        title: track.title,
        phase: 'convirtiendo',
      ),
    );
    final jobId =
        pending?.jobId ??
        await _createJob(
          track,
          deadline: deadline,
          traceId: traceId,
          index: index,
          total: total,
          onProgress: onProgress,
          cancellation: cancellation,
        );
    if (pending == null) {
      await _savePendingJob(
        videoId,
        _PendingYoutubeJob(jobId: jobId, traceId: traceId),
      );
    }
    var poll = 0;
    var statusErrors = 0;
    String? previousState;
    String? downloadCandidate;
    while (true) {
      cancellation?.throwIfCancelled();
      poll++;
      late Map<String, dynamic> status;
      try {
        status = _json(
          await _get(
            _converterEndpoint(
              'api/status',
            ).replace(queryParameters: {'jobId': jobId}),
            headers: {
              'X-Homeostasia-Trace': traceId,
              'X-Homeostasia-Poll': '$poll',
              ..._converterHeaders(),
            },
            cancellation: cancellation,
          ),
        );
        statusErrors = 0;
      } on Object catch (error) {
        if (error is YoutubeHttpException && error.statusCode == 404) {
          await _removePendingJob(videoId);
          throw const AppException(
            'La conversión ya no está disponible. Inicia de nuevo para crear otro trabajo.',
          );
        }
        final retryable = error is YoutubeHttpException
            ? error.statusCode == 408 ||
                  error.statusCode == 429 ||
                  error.statusCode >= 500
            : error is AppException;
        if (!retryable) rethrow;
        statusErrors++;
        if (statusErrors >= kYoutubeStatusErrorRetries) {
          throw AppException(
            'No se pudo consultar el estado de «${track.title}» tras '
            '$statusErrors intentos: '
            '${error is AppException ? error.message : 'error desconocido'}',
          );
        }
        onProgress?.call(
          YoutubeImportProgress(
            index: index,
            total: total,
            title: track.title,
            phase:
                'no se pudo consultar el estado; reintento '
                '$statusErrors/$kYoutubeStatusErrorRetries en 3 s'
                '${error is AppException ? ': ${error.message}' : ''}',
          ),
        );
        await _waitCancellable(kYoutubePollInterval, cancellation);
        cancellation?.throwIfCancelled();
        continue;
      }
      final state = status['status'] is String
          ? (status['status'] as String).toLowerCase()
          : 'processing';
      final queuePosition = _safeInteger(status['queuePosition']);
      final queueLength = _safeInteger(status['queueLength']);
      final progress = _safeProgress(status['progress']);
      final phase = _statusPhase(
        state,
        queuePosition: queuePosition,
        queueLength: queueLength,
        progress: progress,
      );
      onProgress?.call(
        YoutubeImportProgress(
          index: index,
          total: total,
          title: track.title,
          phase: phase,
          queuePosition: queuePosition,
          queueLength: queueLength,
          progress: progress,
        ),
      );
      if (poll == 1 || poll % 10 == 0 || state != previousState) {
        developer.log(
          'Traza $traceId; estado de conversión: $state; consulta $poll'
          '${queuePosition == null ? '' : '; posición $queuePosition'}'
          '${progress == null ? '' : '; progreso ${progress.round()} %'}',
          name: 'Homeostasia',
        );
      }
      previousState = state;
      if (state == 'error' || state == 'failed') {
        await _removePendingJob(videoId);
        throw AppException(
          _firstString([
                status['error'],
                status['errorText'],
                status['message'],
              ]) ??
              'La conversión de «${track.title}» falló.',
        );
      }
      // yttowav anuncia a veces el final solo con la URL de descarga, sin estado «completed».
      downloadCandidate = _firstString([
        status['downloadUrl'],
        status['downloadPath'],
        status['url'],
      ]);
      if (state == 'completed' || state == 'done' || downloadCandidate != null) {
        break;
      }
      if (DateTime.now().isAfter(deadline)) {
        throw AppException(
          'La conversión de «${track.title}» tardó demasiado.',
        );
      }
      await _waitCancellable(kYoutubePollInterval, cancellation);
    }

    cancellation?.throwIfCancelled();
    onProgress?.call(
      YoutubeImportProgress(
        index: index,
        total: total,
        title: track.title,
        phase: 'descargando WAV',
      ),
    );
    final safeTitle = _safeTitle(track.title);
    final output = File('${directory.path}/$index-$safeTitle.wav');
    // La descarga es reanudable: si el WAV (grande) se corta en móvil, _downloadWav pide el resto con Range.
    await _downloadWav(
      _resolveDownload(downloadCandidate, jobId),
      output,
      headers: _converterHeaders(),
      cancellation: cancellation,
    );
    await _removePendingJob(videoId);
    return YoutubeImportedAudio(
      name: '$safeTitle.wav',
      path: output.path,
      track: track,
    );
  }

  Future<String> _createJob(
    YoutubeTrack track, {
    required DateTime deadline,
    required String traceId,
    required int index,
    required int total,
    YoutubeImportProgressCallback? onProgress,
    YoutubeImportCancellation? cancellation,
  }) async {
    final videoId = _videoId(track.url);
    if (videoId == null) {
      throw const AppException(
        'El enlace de YouTube no contiene un vídeo válido.',
      );
    }
    final canonicalUrl = _canonicalVideoUrl(videoId);
    final title = String.fromCharCodes(track.title.runes.take(200));
    for (var attempt = 1; attempt <= kYoutubeConvertCreateAttempts; attempt++) {
      cancellation?.throwIfCancelled();
      await _waitForCreateTurn(deadline);
      cancellation?.throwIfCancelled();
      late Map<String, dynamic> converted;
      try {
        converted = _json(
          await _post(
            _converterEndpoint('api/convert'),
            {
              'url': canonicalUrl,
              'title': title,
              'format': 'wav',
              'quality': 'original',
            },
            headers: {'X-Homeostasia-Trace': traceId, ..._converterHeaders()},
            cancellation: cancellation,
          ),
        );
      } on Object catch (error) {
        // Tope DIARIO del conversor: no se arregla reintentando hoy, así que se corta la tanda (lo capta importTracks).
        if (_isDailyLimit(error)) {
          throw YoutubeDailyLimitException(error is AppException ? error.message : 'Límite diario del conversor (40/día).');
        }
        final retryable = error is YoutubeHttpException
            ? const {408, 425, 429, 503, 504}.contains(error.statusCode)
            : error is AppException;
        if (!retryable || attempt == kYoutubeConvertCreateAttempts) {
          rethrow;
        }
        final delay = _retryDelay(error, attempt);
        if (_clock().add(delay).isAfter(deadline)) {
          throw const AppException(
            'Se agotó el tiempo de espera al crear la conversión.',
          );
        }
        final retryInSeconds = (delay.inMilliseconds / 1000).ceil();
        onProgress?.call(
          YoutubeImportProgress(
            index: index,
            total: total,
            title: track.title,
            phase:
                'yttowav está saturado; reintento '
                '${attempt + 1}/$kYoutubeConvertCreateAttempts en '
                '$retryInSeconds s'
                '${error is AppException ? ': ${error.message}' : ''}',
          ),
        );
        developer.log(
          'Traza $traceId; rechazo temporal al crear el trabajo; intento ${attempt + 1}/'
          '$kYoutubeConvertCreateAttempts en ${retryInSeconds}s'
          '${error is YoutubeHttpException ? '; HTTP ${error.statusCode}' : ''}',
          name: 'Homeostasia',
          level: 900,
        );
        await _waitCancellable(delay, cancellation);
        continue;
      }

      final jobId = _jobIdFrom(converted);
      if (jobId == null) {
        throw const AppException('El conversor no devolvió un trabajo válido.');
      }
      return jobId;
    }
    throw const AppException('No se pudo crear el trabajo de conversión.');
  }

  Future<_PendingYoutubeJob?> _readPendingJob(String videoId) async {
    final preferences = await SharedPreferences.getInstance();
    final raw = preferences.getString(_pendingJobKey(videoId));
    if (raw == null) return null;
    try {
      final data = jsonDecode(raw);
      if (data is Map && data['jobId'] is String && data['traceId'] is String) {
        return _PendingYoutubeJob(
          jobId: data['jobId'] as String,
          traceId: data['traceId'] as String,
        );
      }
    } on FormatException catch (error) {
      throw AppException('No se pudo leer el seguimiento guardado: $error');
    }
    throw const AppException(
      'El seguimiento guardado de YouTube no es válido.',
    );
  }

  Future<void> _savePendingJob(String videoId, _PendingYoutubeJob job) async {
    final preferences = await SharedPreferences.getInstance();
    final saved = await preferences.setString(
      _pendingJobKey(videoId),
      jsonEncode({'jobId': job.jobId, 'traceId': job.traceId}),
    );
    if (!saved) {
      throw const AppException(
        'La conversión ya se creó, pero no se pudo guardar su seguimiento. No la reintentes ahora.',
      );
    }
  }

  Future<void> _removePendingJob(String videoId) async {
    final preferences = await SharedPreferences.getInstance();
    await preferences.remove(_pendingJobKey(videoId));
  }

  String _pendingJobKey(String videoId) => 'homeostasia.youtube.job.$videoId';

  Future<void> _waitCancellable(
    Duration duration,
    YoutubeImportCancellation? cancellation,
  ) async {
    cancellation?.throwIfCancelled();
    if (cancellation == null) {
      await _wait(duration);
      return;
    }
    await Future.any<void>([_wait(duration), cancellation.whenCancelled]);
    cancellation.throwIfCancelled();
  }

  Future<void> _waitForCreateTurn(DateTime deadline) async {
    final now = _clock();
    final scheduledAt =
        _nextConvertCreateAt == null || _nextConvertCreateAt!.isBefore(now)
        ? now
        : _nextConvertCreateAt!;
    if (!scheduledAt.isBefore(deadline)) {
      throw const AppException(
        'Se agotó el tiempo de espera al crear la conversión.',
      );
    }
    _nextConvertCreateAt = scheduledAt.add(kYoutubeConvertCreateGap);
    final delay = scheduledAt.difference(now);
    if (delay > Duration.zero) await _wait(delay);
  }

  Duration _retryDelay(Object error, int attempt) {
    if (error is YoutubeHttpException && error.retryAfter != null) {
      final seconds = num.tryParse(error.retryAfter!.trim());
      final serverDelay = seconds != null
          ? Duration(milliseconds: (seconds * 1000).round())
          : _httpDateDelay(error.retryAfter!);
      if (serverDelay != null) {
        final milliseconds = serverDelay.inMilliseconds
            .clamp(0, 300000)
            .toInt();
        final jitter = milliseconds == 0
            ? 0
            : _random.nextInt(min(3000, max(500, milliseconds ~/ 10)) + 1);
        return Duration(milliseconds: milliseconds + jitter);
      }
    }
    final baseMs = min(10000 * (1 << (attempt - 1)), 90000);
    final jitter = _random.nextInt(min(3000, max(500, baseMs ~/ 10)) + 1);
    return Duration(milliseconds: baseMs + jitter);
  }

  Duration? _httpDateDelay(String value) {
    try {
      final until = HttpDate.parse(value).difference(_clock());
      return until.isNegative ? Duration.zero : until;
    } on FormatException {
      return null;
    }
  }

  /// Busca [query] en YouTube con el proxy de la web. Lanza AppException si falla.
  Future<List<YoutubeSearchResult>> search(
    String query, {
    YoutubeImportCancellation? cancellation,
  }) async {
    final text = youtubeSearchQuery(query);
    if (text == null) {
      throw const AppException(
        'Escribe al menos tres letras para buscar en YouTube.',
      );
    }
    final response = await _get(
      _endpoint('api/youtube/search').replace(queryParameters: {'q': text}),
      cancellation: cancellation,
    );
    try {
      return parseYoutubeSearch(jsonDecode(utf8.decode(response.bodyBytes)));
    } on FormatException {
      throw const AppException('La respuesta de la búsqueda no es válida.');
    }
  }

  Future<http.Response> _get(
    Uri uri, {
    Map<String, String> headers = const {},
    YoutubeImportCancellation? cancellation,
  }) async {
    try {
      final request = http.AbortableRequest(
        'GET',
        uri,
        abortTrigger: cancellation?.whenCancelled,
      )..headers.addAll({'Accept': 'application/json', ...headers});
      final response = await client
          .send(request)
          .then(http.Response.fromStream)
          .timeout(kYoutubeRequestTimeout);
      return _check(response);
    } on TimeoutException {
      throw const AppException('La web tardó demasiado en responder.');
    } on SocketException {
      throw const AppException('No hay conexión con la web.');
    } on http.ClientException {
      throw const AppException('No hay conexión con la web.');
    }
  }

  Future<http.Response> _post(
    Uri uri,
    Map<String, String> body, {
    Map<String, String> headers = const {},
    YoutubeImportCancellation? cancellation,
  }) async {
    try {
      final request =
          http.AbortableRequest(
              'POST',
              uri,
              abortTrigger: cancellation?.whenCancelled,
            )
            ..headers.addAll({
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              ...headers,
            })
            ..body = jsonEncode(body);
      final response = await client
          .send(request)
          .then(http.Response.fromStream)
          .timeout(kYoutubeRequestTimeout);
      return _check(response);
    } on TimeoutException {
      throw const AppException('La web tardó demasiado en responder.');
    } on SocketException {
      throw const AppException('No hay conexión con la web.');
    } on http.ClientException {
      throw const AppException('No hay conexión con la web.');
    }
  }

  http.Response _check(http.Response response) {
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return response;
    }
    try {
      final data = jsonDecode(response.body);
      if (data is Map) {
        final message = _firstString([
          data['error'],
          data['errorText'],
          data['message'],
        ]);
        if (message != null) {
          throw YoutubeHttpException(
            message,
            statusCode: response.statusCode,
            retryAfter: response.headers['retry-after'],
          );
        }
      }
    } on FormatException {
      // Se usa el mensaje genérico de abajo.
    }
    throw YoutubeHttpException(
      'La web respondió con el código ${response.statusCode}.',
      statusCode: response.statusCode,
      retryAfter: response.headers['retry-after'],
    );
  }

  String _newTraceId() {
    String hex(int length) => List.generate(
      length,
      (_) => _random.nextInt(16).toRadixString(16),
    ).join();
    return '${hex(8)}-${hex(4)}-4${hex(3)}-'
        '${(8 + _random.nextInt(4)).toRadixString(16)}${hex(3)}-${hex(12)}';
  }

  /// Primer valor que sea una cadena no vacía, recortada; null si no hay ninguno.
  static String? _firstString(List<Object?> values) {
    for (final value in values) {
      if (value is String && value.trim().isNotEmpty) return value.trim();
    }
    return null;
  }

  static final RegExp _jobIdPattern = RegExp(r'^[A-Za-z0-9_-]{1,200}$');

  /// Id de trabajo que devuelve yttowav: `jobId`, o `id`, o `job.id`; validado.
  static String? _jobIdFrom(Map<String, dynamic> data) {
    final job = data['job'];
    final candidates = <Object?>[
      data['jobId'],
      data['id'],
      job is Map ? job['id'] : null,
    ];
    for (final value in candidates) {
      final text = value is String
          ? value
          : (value is num ? value.toString() : null);
      if (text != null && _jobIdPattern.hasMatch(text)) return text;
    }
    return null;
  }

  static int? _safeInteger(Object? value) =>
      value is int && value >= 0 && value <= 1000000 ? value : null;

  static double? _safeProgress(Object? value) =>
      value is num && value.isFinite && value >= 0 && value <= 100
      ? value.toDouble()
      : null;

  static String _statusPhase(
    String state, {
    int? queuePosition,
    int? queueLength,
    double? progress,
  }) {
    if (state == 'queued') {
      final position = queuePosition != null && queueLength != null
          ? ' (posición $queuePosition de $queueLength)'
          : '';
      return 'en cola$position';
    }
    if (state == 'processing' || state == 'downloading') {
      final percent = progress == null ? '' : ' (${progress.round()} %)';
      return 'procesándose$percent';
    }
    if (state == 'completed' || state == 'done') {
      return 'preparando la descarga WAV';
    }
    return state;
  }

  /// Descarga el WAV de forma REANUDABLE (ADR-0045). El WAV «original» de yttowav es enorme (~10 MB/min → una canción
  /// de 4 min ≈ 48 MB) y en móvil la conexión se corta a mitad; si se guardaba el trozo, ffprobe no lo podía leer al
  /// subir. Ahora: se sigue la redirección 302 a R2 (que admite `Range`), y si la descarga se queda corta se pide el
  /// resto con `Range: bytes=<ya>-` hasta completar el tamaño anunciado (Content-Length o la cabecera RIFF).
  Future<void> _downloadWav(
    Uri uri,
    File output, {
    Map<String, String> headers = const {},
    YoutubeImportCancellation? cancellation,
  }) async {
    const maxAttempts = 6;
    var have = 0;
    var lastHave = -1;
    int? expected;
    final prefix = <int>[];
    for (var attempt = 0; attempt < maxAttempts; attempt++) {
      cancellation?.throwIfCancelled();
      final reqHeaders = <String, String>{'Accept': 'audio/wav', ...headers};
      if (have > 0) reqHeaders['Range'] = 'bytes=$have-';
      http.StreamedResponse response;
      try {
        response = await client
            .send(
              http.AbortableRequest(
                'GET',
                uri,
                abortTrigger: cancellation?.whenCancelled,
              )
                ..followRedirects = true
                ..maxRedirects = 5
                ..headers.addAll(reqHeaders),
            )
            .timeout(kYoutubeDownloadTimeout);
      } on TimeoutException {
        if (attempt == maxAttempts - 1) {
          throw const AppException('La descarga del WAV tardó demasiado.');
        }
        await _waitCancellable(kYoutubePollInterval, cancellation);
        continue;
      } on SocketException {
        if (attempt == maxAttempts - 1) {
          throw const AppException('No hay conexión con la web.');
        }
        await _waitCancellable(kYoutubePollInterval, cancellation);
        continue;
      } on http.ClientException {
        if (attempt == maxAttempts - 1) {
          throw const AppException('No hay conexión con la web.');
        }
        await _waitCancellable(kYoutubePollInterval, cancellation);
        continue;
      }

      final status = response.statusCode;
      final fresh = status == 200;
      if (fresh) {
        have = 0; // respuesta completa: se (re)empieza desde cero
        prefix.clear();
        final cl = response.contentLength;
        expected = (cl != null && cl > 0) ? cl : null;
      } else if (status == 206) {
        expected = _rangeTotal(response.headers['content-range']) ?? expected;
      } else {
        final body = await response.stream.bytesToString();
        try {
          final data = jsonDecode(body);
          final msg = data is Map
              ? _firstString([data['error'], data['errorText'], data['message']])
              : null;
          if (msg != null) throw AppException(msg);
        } on FormatException {
          // mensaje genérico de abajo
        }
        throw AppException('No se pudo descargar el WAV (código $status).');
      }
      if (expected != null && expected > kYoutubeMaxWavBytes) {
        throw const AppException('El WAV descargado no tiene un tamaño válido.');
      }

      var timedOut = false;
      final sink = output.openWrite(
        mode: fresh ? FileMode.write : FileMode.writeOnlyAppend,
      );
      try {
        try {
          await for (final chunk in response.stream.timeout(
            kYoutubeDownloadTimeout,
          )) {
            cancellation?.throwIfCancelled();
            if (prefix.length < 12) prefix.addAll(chunk.take(12 - prefix.length));
            sink.add(chunk);
            have += chunk.length;
            if (have > kYoutubeMaxWavBytes) {
              throw const AppException(
                'El WAV supera el tamaño máximo permitido.',
              );
            }
          }
        } on TimeoutException {
          timedOut = true; // corte: se guarda lo recibido y se reanuda
        }
        await sink.flush();
      } finally {
        await sink.close();
      }
      cancellation?.throwIfCancelled();

      final target = expected ?? _riffTotal(prefix);
      final validStart = have > 44 && _validWavPrefix(prefix);
      if (validStart && target != null && have >= target) return; // completo
      // Sin tamaño conocido y la respuesta terminó limpia: se acepta.
      if (validStart && target == null && !timedOut && fresh) return;
      // Sin avance entre intentos: no insistir más.
      if (have <= lastHave) break;
      lastHave = have;
    }
    await _deleteQuietly(output);
    throw AppException(
      'La descarga del WAV quedó incompleta ($have bytes'
      '${expected != null ? ' de $expected' : ''}).',
    );
  }

  /// Tamaño total de una cabecera `Content-Range: bytes X-Y/TOTAL`, o null.
  static int? _rangeTotal(String? header) {
    if (header == null) return null;
    final slash = header.lastIndexOf('/');
    if (slash < 0) return null;
    return int.tryParse(header.substring(slash + 1).trim());
  }

  /// Tamaño total que declara la cabecera RIFF del WAV (bytes 4-7, little-endian, + 8), o null si no es fiable.
  static int? _riffTotal(List<int> prefix) {
    if (prefix.length < 8 ||
        String.fromCharCodes(prefix.sublist(0, 4)) != 'RIFF') {
      return null;
    }
    final size = prefix[4] |
        (prefix[5] << 8) |
        (prefix[6] << 16) |
        (prefix[7] << 24);
    return size > 0 ? size + 8 : null;
  }

  Uri _endpoint(String path) => base.resolve(path);

  /// Ruta del conversor yttowav (convert/status/download), directa desde el teléfono (ADR-0045).
  Uri _converterEndpoint(String path) => converterBase.resolve(path);

  /// Cabeceras con las que la APK se identifica ante yttowav como su cliente web (igual que hacía el Worker). No eluden
  /// el cupo: cada teléfono sigue contando como una IP con su 40/día; solo hacen que la API acepte la petición.
  Map<String, String> _converterHeaders() => const {
    'Origin': 'https://www.yttowav.org',
    'Referer': 'https://www.yttowav.org/',
    'User-Agent': 'reminiscencia-youtube-importer',
  };

  static String _canonicalVideoUrl(String id) =>
      'https://www.youtube.com/watch?v=$id';

  /// URL de descarga del WAV: la que devuelva el estado, o `api/download/?jobId=…` si no la da. Debe quedarse en el
  /// mismo origen que el conversor (no se sigue una redirección a otro host).
  Uri _resolveDownload(String? candidate, String jobId) {
    final path = candidate == null || candidate.trim().isEmpty
        ? 'api/download/?jobId=${Uri.encodeQueryComponent(jobId)}'
        : candidate.trim();
    final uri = _converterEndpoint(path);
    if (uri.origin != converterBase.resolve('/').origin) {
      throw const AppException(
        'El conversor devolvió una dirección de descarga no válida.',
      );
    }
    return uri;
  }

  static Map<String, dynamic> _json(http.Response response) {
    try {
      final data = jsonDecode(response.body);
      if (data is Map<String, dynamic>) return data;
    } on FormatException {
      // Mensaje común para respuestas no JSON.
    }
    throw const AppException('La web devolvió una respuesta inválida.');
  }

  static Uri? _youtubeImportUrl(String value) {
    final uri = Uri.tryParse(value);
    if (uri == null || uri.scheme != 'https' || uri.userInfo.isNotEmpty) {
      return null;
    }
    const hosts = {
      'youtube.com',
      'www.youtube.com',
      'm.youtube.com',
      'music.youtube.com',
    };
    final host = uri.host.toLowerCase();
    if (host == 'youtu.be') {
      final id = uri.pathSegments.isEmpty ? '' : uri.pathSegments.first;
      return _validId(id) ? uri : null;
    }
    if (!hosts.contains(host)) {
      return null;
    }
    final list = uri.queryParameters['list'];
    if (list != null && RegExp(r'^[A-Za-z0-9_-]{1,200}$').hasMatch(list)) {
      return uri;
    }
    if (uri.path == '/watch' && _validId(uri.queryParameters['v'] ?? '')) {
      return uri;
    }
    if (uri.pathSegments.length == 2 &&
        (uri.pathSegments.first == 'shorts' ||
            uri.pathSegments.first == 'embed') &&
        _validId(uri.pathSegments.last)) {
      return uri;
    }
    return null;
  }

  static String? _videoId(String value) {
    final uri = Uri.tryParse(value);
    if (uri == null || uri.scheme != 'https') return null;
    final host = uri.host.toLowerCase();
    if (host == 'youtu.be') {
      final id = uri.pathSegments.isEmpty ? '' : uri.pathSegments.first;
      return _validId(id) ? id : null;
    }
    if (!{
      'youtube.com',
      'www.youtube.com',
      'm.youtube.com',
      'music.youtube.com',
    }.contains(host)) {
      return null;
    }
    final id = uri.path == '/watch'
        ? uri.queryParameters['v']
        : (uri.pathSegments.length == 2 &&
                  (uri.pathSegments.first == 'shorts' ||
                      uri.pathSegments.first == 'embed')
              ? uri.pathSegments.last
              : null);
    return id != null && _validId(id) ? id : null;
  }

  static bool _validId(String id) =>
      RegExp(r'^[A-Za-z0-9_-]{11}$').hasMatch(id);

  static String _safeTitle(String title) {
    final clean = title
        .replaceAll(RegExp(r'[\\/:*?"<>|]+'), ' ')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
    final cut = String.fromCharCodes(
      (clean.isEmpty ? 'audio' : clean).runes.take(kYoutubeMaxTitleRunes),
    ).trim();
    return cut.isEmpty ? 'audio' : cut;
  }

  static bool _validWavPrefix(List<int> prefix) =>
      prefix.length >= 12 &&
      String.fromCharCodes(prefix.sublist(0, 4)) == 'RIFF' &&
      String.fromCharCodes(prefix.sublist(8, 12)) == 'WAVE';

  static Future<void> _deleteQuietly(FileSystemEntity entity) async {
    try {
      if (await entity.exists()) await entity.delete(recursive: true);
    } catch (_) {
      // El directorio temporal puede ser limpiado por Android.
    }
  }
}
