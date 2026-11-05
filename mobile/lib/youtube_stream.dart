import 'package:http/http.dart' as http;
import 'package:youtube_explode_dart/youtube_explode_dart.dart';

import 'app_error.dart';

/// Audio de un vídeo de YouTube listo para reproducir ahora mismo (ADR-0021).
class YoutubeStream {
  const YoutubeStream({required this.uri, this.duration, this.headers});

  final Uri uri;

  /// Cabeceras que pide la URL: debe verse el mismo User-Agent del cliente que la generó, o responde 403.
  final Map<String, String>? headers;
  final Duration? duration;
}

/// Averigua una dirección de audio reproducible. Se hace en el teléfono, con su propia conexión.
abstract interface class YoutubeStreamResolver {
  Future<YoutubeStream> resolve(String videoId);
}

class ExplodeStreamResolver implements YoutubeStreamResolver {
  ExplodeStreamResolver({YoutubeExplode? explode, http.Client? client})
    : _explode = explode ?? YoutubeExplode(),
      _client = client ?? http.Client();

  final YoutubeExplode _explode;
  final http.Client _client;

  /// Con algunos vídeos YouTube solo sirve el primer ~1 MB sin un token de integridad (responde 403 más allá):
  /// la canción se cortaría al minuto. Se comprueba pidiendo el final del archivo.
  Future<bool> _readableToTheEnd(
    Uri uri,
    Map<String, String>? headers,
    int total,
  ) async {
    if (total <= 1024 * 1024) return true;
    try {
      final request = http.Request('GET', uri)
        ..headers.addAll({
          ...?headers,
          'Range': 'bytes=${total - 1024}-${total - 1}',
        });
      final response = await _client
          .send(request)
          .timeout(const Duration(seconds: 15));
      await response.stream.drain<void>();
      return response.statusCode == 200 || response.statusCode == 206;
    } catch (_) {
      return false;
    }
  }

  @override
  Future<YoutubeStream> resolve(String videoId) async {
    // YouTube bloquea a ratos algún cliente («confirma que no eres un bot»), así que se prueban varios en orden.
    const clients = [
      YoutubeApiClient.android,
      YoutubeApiClient.androidVr,
      YoutubeApiClient.mweb,
    ];
    for (final client in clients) {
      try {
        final manifest = await _explode.videos.streamsClient
            .getManifest(videoId, ytClients: [client])
            .timeout(const Duration(seconds: 15));
        final audio = manifest.audioOnly;
        if (audio.isEmpty) continue;
        final agent = client.payload['context']?['client']?['userAgent'];
        final best = audio.withHighestBitrate();
        final headers = agent is String ? {'User-Agent': agent} : null;
        if (!await _readableToTheEnd(best.url, headers, best.size.totalBytes)) {
          continue;
        }
        return YoutubeStream(uri: best.url, headers: headers);
      } catch (_) {
        continue;
      }
    }
    throw const AppException(
      'YouTube no permite sacar el audio de este vídeo directamente.',
    );
  }

  void close() {
    _explode.close();
    _client.close();
  }
}
