import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

import 'app_error.dart';
import 'library_store.dart';

const int kYoutubeMaxPlaylistItems = 200;
const int kYoutubeMaxWavBytes = 256 * 1024 * 1024;
const int kYoutubeMaxTitleRunes = 120;
const int kYoutubeConcurrency = 4;
const Duration kYoutubePollInterval = Duration(seconds: 3);
const Duration kYoutubeJobTimeout = Duration(minutes: 10);
const Duration kYoutubeRequestTimeout = Duration(seconds: 45);
const Duration kYoutubeDownloadTimeout = Duration(minutes: 3);

/// Canción que devuelve el proxy de playlists.
class YoutubeTrack {
  const YoutubeTrack({required this.url, required this.title});

  final String url;
  final String title;
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
  });

  final int index;
  final int total;
  final String title;
  final String phase;

  String get message => '${index + 1} de $total: $phase «$title»';
}

typedef YoutubeImportProgressCallback =
    void Function(YoutubeImportProgress progress);

/// Cliente Android de los proxies de YouTube de la web.
///
/// El cliente nunca habla directamente con yt-dlp ni con yttowav: obtiene la
/// playlist, crea los trabajos y descarga los WAV a una carpeta temporal para
/// que `homeostasia.dart` los entregue a `LibraryController.uploadShared`.
class YoutubeImporter {
  YoutubeImporter({
    required this.client,
    Uri? base,
    Future<Directory> Function()? tempDir,
  }) : base = base ?? Uri.parse(kLibraryBase),
       _tempDir = tempDir ?? getTemporaryDirectory;

  final http.Client client;
  final Uri base;
  final Future<Directory> Function() _tempDir;
  final Random _random = Random.secure();

  Future<List<YoutubeImportedAudio>> importPlaylist(
    String playlistUrl, {
    YoutubeImportProgressCallback? onProgress,
  }) async {
    final tracks = await listPlaylist(playlistUrl);
    final root = await _tempDir();
    final importDir = Directory(
      '${root.path}/youtube-import-${DateTime.now().microsecondsSinceEpoch}-${_random.nextInt(1 << 20)}',
    );
    await importDir.create(recursive: true);

    final output = List<YoutubeImportedAudio?>.filled(tracks.length, null);
    var next = 0;
    Future<void> worker() async {
      while (true) {
        final index = next;
        next += 1;
        if (index >= tracks.length) return;
        final track = tracks[index];
        output[index] = await _convertAndDownload(
          track,
          index: index,
          total: tracks.length,
          directory: importDir,
          onProgress: onProgress,
        );
      }
    }

    try {
      await Future.wait([
        for (var i = 0; i < min(kYoutubeConcurrency, tracks.length); i += 1)
          worker(),
      ]);
      return output.cast<YoutubeImportedAudio>();
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

  Future<List<YoutubeTrack>> listPlaylist(String value) async {
    final url = _youtubeImportUrl(value.trim());
    if (url == null) {
      throw const AppException(
        'La URL de YouTube no es válida.',
      );
    }
    final response = await _get(
      _endpoint(
        'api/youtube/playlist',
      ).replace(queryParameters: {'url': value.trim()}),
    );
    final data = _json(response);
    final rawItems = data['items'];
    if (rawItems is! List) {
      throw const AppException(
        'La respuesta no contiene una lista válida de canciones.',
      );
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
      tracks.add(YoutubeTrack(url: itemUrl, title: title));
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
  }) async {
    onProgress?.call(
      YoutubeImportProgress(
        index: index,
        total: total,
        title: track.title,
        phase: 'convirtiendo',
      ),
    );
    final converted = _json(
      await _post(_endpoint('api/youtube/convert'), {
        'url': track.url,
        'title': track.title,
      }),
    );
    final jobId = converted['jobId'];
    if (jobId is! String || jobId.trim().isEmpty) {
      throw const AppException('El conversor no devolvió un trabajo válido.');
    }

    final deadline = DateTime.now().add(kYoutubeJobTimeout);
    while (true) {
      final status = _json(
        await _get(
          _endpoint(
            'api/youtube/status',
          ).replace(queryParameters: {'jobId': jobId}),
        ),
      );
      final state = status['status'] is String
          ? (status['status'] as String).toLowerCase()
          : 'processing';
      if (state == 'error' || state == 'failed') {
        throw AppException(
          status['error'] is String
              ? status['error'] as String
              : 'La conversión de «${track.title}» falló.',
        );
      }
      if (state == 'completed' || state == 'done') break;
      if (DateTime.now().isAfter(deadline)) {
        throw AppException(
          'La conversión de «${track.title}» tardó demasiado.',
        );
      }
      await Future<void>.delayed(kYoutubePollInterval);
    }

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
    await _downloadWav(
      _endpoint(
        'api/youtube/download',
      ).replace(queryParameters: {'jobId': jobId}),
      output,
    );
    return YoutubeImportedAudio(
      name: '$safeTitle.wav',
      path: output.path,
      track: track,
    );
  }

  Future<http.Response> _get(Uri uri) async {
    try {
      final response = await client
          .get(uri, headers: const {'Accept': 'application/json'})
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

  Future<http.Response> _post(Uri uri, Map<String, String> body) async {
    try {
      final response = await client
          .post(
            uri,
            headers: const {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
            },
            body: jsonEncode(body),
          )
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
      if (data is Map && data['error'] is String) {
        throw AppException(data['error'] as String);
      }
    } on FormatException {
      // Se usa el mensaje genérico de abajo.
    }
    throw AppException(
      'La web respondió con el código ${response.statusCode}.',
    );
  }

  Future<void> _downloadWav(Uri uri, File output) async {
    http.StreamedResponse response;
    try {
      response = await client
          .send(http.Request('GET', uri)..headers['Accept'] = 'audio/wav')
          .timeout(kYoutubeDownloadTimeout);
    } on TimeoutException {
      throw const AppException('La descarga del WAV tardó demasiado.');
    } on SocketException {
      throw const AppException('No hay conexión con la web.');
    } on http.ClientException {
      throw const AppException('No hay conexión con la web.');
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final body = await response.stream.bytesToString();
      try {
        final data = jsonDecode(body);
        if (data is Map && data['error'] is String) {
          throw AppException(data['error'] as String);
        }
      } on FormatException {
        // Se usa el mensaje genérico de abajo.
      }
      throw AppException(
        'No se pudo descargar el WAV (código ${response.statusCode}).',
      );
    }
    final declared = response.contentLength;
    if (declared != null &&
        (declared <= 44 || declared > kYoutubeMaxWavBytes)) {
      throw const AppException('El WAV descargado no tiene un tamaño válido.');
    }
    final sink = output.openWrite();
    final prefix = <int>[];
    var bytes = 0;
    try {
      try {
        await for (final chunk in response.stream.timeout(
          kYoutubeDownloadTimeout,
        )) {
          bytes += chunk.length;
          if (bytes > kYoutubeMaxWavBytes) {
            throw const AppException(
              'El WAV supera el tamaño máximo permitido.',
            );
          }
          if (prefix.length < 12) {
            prefix.addAll(chunk.take(12 - prefix.length));
          }
          sink.add(chunk);
        }
      } on TimeoutException {
        throw const AppException('La descarga del WAV tardó demasiado.');
      }
      await sink.flush();
    } finally {
      await sink.close();
    }
    if (bytes <= 44 || !_validWavPrefix(prefix)) {
      await _deleteQuietly(output);
      throw const AppException('El conversor no devolvió un WAV válido.');
    }
  }

  Uri _endpoint(String path) => base.resolve(path);

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
    if (uri == null ||
        uri.scheme != 'https' ||
        uri.userInfo.isNotEmpty) {
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
        (uri.pathSegments.first == 'shorts' || uri.pathSegments.first == 'embed') &&
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
