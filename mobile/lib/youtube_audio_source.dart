// ignore_for_file: experimental_member_use

import 'package:http/http.dart' as http;
import 'package:just_audio/just_audio.dart';

/// Audio de YouTube servido por Dart en vez de por el reproductor del sistema.
/// Para algunos vídeos YouTube rechaza con 403 las peticiones sin rango o con rangos de más de ~1 MB, que es lo
/// que pide el reproductor nativo y se ve como «Source error». Aquí el audio se descarga en trozos pequeños y se
/// entrega al reproductor en local.
class YoutubeAudioSource extends StreamAudioSource {
  YoutubeAudioSource({
    required this.uri,
    this.headers,
    http.Client? client,
    this.chunkBytes = 512 * 1024,
    super.tag,
  }) : _client = client ?? _sharedClient;

  /// Un solo cliente para todas las fuentes de YouTube: antes cada fuente creaba el suyo y nunca lo cerraba.
  static final http.Client _sharedClient = http.Client();

  final Uri uri;
  final Map<String, String>? headers;
  final int chunkBytes;
  final http.Client _client;

  String get _contentType => uri.queryParameters['mime'] ?? 'audio/mp4';

  @override
  Future<StreamAudioResponse> request([int? start, int? end]) async {
    final from = start ?? 0;
    // YouTube responde 403 a rangos de más de ~1 MB en algunos vídeos (y a las peticiones sin rango): trozos pequeños.
    final to = end == null
        ? from + chunkBytes
        : (end - from > chunkBytes ? from + chunkBytes : end);
    final request = http.Request('GET', uri)
      ..headers.addAll({...?headers, 'Range': 'bytes=$from-${to - 1}'});
    final response = await _client.send(request);
    if (response.statusCode != 200 && response.statusCode != 206) {
      await response.stream.drain<void>();
      throw http.ClientException(
        'YouTube respondió ${response.statusCode} al rango ${request.headers['Range']}',
        uri,
      );
    }
    final total =
        _totalLength(response.headers['content-range']) ??
        (response.statusCode == 200 ? response.contentLength : null);
    return StreamAudioResponse(
      sourceLength: total,
      contentLength: response.contentLength,
      offset: response.statusCode == 206 ? from : 0,
      stream: response.stream,
      contentType: _contentType,
    );
  }

  static int? _totalLength(String? contentRange) {
    final match = RegExp(r'/(\d+)$').firstMatch(contentRange ?? '');
    return match == null ? null : int.tryParse(match.group(1)!);
  }
}
