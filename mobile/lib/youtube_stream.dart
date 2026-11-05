import 'package:youtube_explode_dart/youtube_explode_dart.dart';

import 'app_error.dart';

/// Audio de un vídeo de YouTube listo para reproducir ahora mismo (ADR-0021).
class YoutubeStream {
  const YoutubeStream({required this.uri, this.duration});

  final Uri uri;
  final Duration? duration;
}

/// Averigua una dirección de audio reproducible. Se hace en el teléfono, con su propia conexión.
abstract interface class YoutubeStreamResolver {
  Future<YoutubeStream> resolve(String videoId);
}

class ExplodeStreamResolver implements YoutubeStreamResolver {
  ExplodeStreamResolver({YoutubeExplode? explode})
    : _explode = explode ?? YoutubeExplode();

  final YoutubeExplode _explode;

  @override
  Future<YoutubeStream> resolve(String videoId) async {
    try {
      final manifest = await _explode.videos.streamsClient
          .getManifest(videoId, ytClients: [YoutubeApiClient.androidVr])
          .timeout(const Duration(seconds: 20));
      final audio = manifest.audioOnly;
      if (audio.isEmpty) {
        throw const AppException('YouTube no ofrece audio para este vídeo.');
      }
      final best = audio.withHighestBitrate();
      return YoutubeStream(uri: best.url, duration: null);
    } on AppException {
      rethrow;
    } catch (_) {
      throw const AppException(
        'No se pudo abrir el audio de YouTube. Usa «Descargar» y escúchala cuando esté en la biblioteca.',
      );
    }
  }

  void close() => _explode.close();
}
