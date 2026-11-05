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
        return YoutubeStream(uri: audio.withHighestBitrate().url, duration: null);
      } catch (_) {
        continue;
      }
    }
    throw const AppException(
      'No se pudo abrir el audio de YouTube. Usa «Descargar» y escúchala cuando esté en la biblioteca.',
    );
  }

  void close() => _explode.close();
}
