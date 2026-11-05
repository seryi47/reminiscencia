import 'package:flutter/foundation.dart';

/// Vídeo de YouTube que suena en el reproductor incrustado, como en la web (ADR-0021).
class YoutubeEmbed {
  const YoutubeEmbed({required this.id, required this.title});

  final String id;
  final String title;
}

/// Origen que se declara al incrustar: YouTube rechaza los reproductores sin referencia (error 153).
const String kEmbedOrigin = 'https://reminiscencia.vercel.app/';

/// Dirección del reproductor incrustado. youtube-nocookie evita las cookies de seguimiento hasta que se pulsa.
Uri youtubeEmbedUri(String videoId) => Uri.https(
  'www.youtube-nocookie.com',
  '/embed/$videoId',
  {'autoplay': '1', 'rel': '0', 'playsinline': '1'},
);

/// Página mínima con el iframe, para cargarla con [kEmbedOrigin] como origen.
String youtubeEmbedHtml(String videoId) => '''
<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:#000}iframe{border:0;width:100%;height:100%}</style></head>
<body><iframe src="${youtubeEmbedUri(videoId)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></body></html>''';

/// Hosts a los que puede navegar el reproductor incrustado.
bool isAllowedEmbedHost(String host) =>
    host == 'youtube-nocookie.com' ||
    host.endsWith('.youtube-nocookie.com') ||
    host == 'youtube.com' ||
    host.endsWith('.youtube.com') ||
    host.endsWith('.googlevideo.com') ||
    host.endsWith('.ytimg.com') ||
    host.endsWith('.gstatic.com') ||
    host.endsWith('.google.com');

/// Estado del reproductor incrustado. Vive fuera de las pantallas: si el buscador se repinta o se cambia de
/// pestaña, el vídeo no se corta (igual que el panel fijo de la web).
class YoutubeEmbedController extends ChangeNotifier {
  YoutubeEmbed? _current;

  YoutubeEmbed? get current => _current;

  void open(String id, String title) {
    _current = YoutubeEmbed(id: id, title: title);
    notifyListeners();
  }

  void close() {
    if (_current == null) return;
    _current = null;
    notifyListeners();
  }
}

final YoutubeEmbedController youtubeEmbed = YoutubeEmbedController();
