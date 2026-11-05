// ignore_for_file: experimental_member_use

import 'package:http/http.dart' as http;
import 'package:just_audio/just_audio.dart';

/// Audio de YouTube servido por Dart en vez de por el reproductor del sistema.
/// La URL de YouTube va firmada con la IP desde la que se pidió; si el reproductor nativo sale por otra
/// (IPv4 frente a IPv6, por ejemplo) YouTube responde 403 y se ve «Source error». Aquí el audio se descarga por
/// la misma conexión de Dart que resolvió la URL y se entrega al reproductor en local.
class YoutubeAudioSource extends StreamAudioSource {
  YoutubeAudioSource({
    required this.uri,
    this.headers,
    http.Client? client,
    this.chunkBytes = 2 * 1024 * 1024,
    super.tag,
  }) : _client = client ?? http.Client();

  final Uri uri;
  final Map<String, String>? headers;
  final int chunkBytes;
  final http.Client _client;

  String get _contentType => uri.queryParameters['mime'] ?? 'audio/mp4';

  @override
  Future<StreamAudioResponse> request([int? start, int? end]) async {
    final from = start ?? 0;
    // YouTube frena las descargas sin límite de rango: se piden trozos acotados.
    final to = end == null
        ? from + chunkBytes
        : (end - from > chunkBytes ? from + chunkBytes : end);
    final request = http.Request('GET', uri)
      ..headers.addAll({...?headers, 'Range': 'bytes=$from-${to - 1}'});
    final response = await _client.send(request);
    if (response.statusCode != 200 && response.statusCode != 206) {
      await response.stream.drain<void>();
      throw http.ClientException(
        'YouTube respondió ${response.statusCode}',
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
