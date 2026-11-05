import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

import '../theme.dart';
import '../youtube_embed.dart';

/// Construye la vista del vídeo. Las pruebas la sustituyen: no hay WebView fuera de un dispositivo.
typedef EmbedViewBuilder =
    Widget Function(BuildContext context, String videoId);

Widget _webViewBuilder(BuildContext context, String videoId) =>
    _EmbedWebView(key: ValueKey(videoId), videoId: videoId);

/// Constructor de la vista que usa el panel; las pruebas lo cambian por uno sin WebView.
EmbedViewBuilder youtubeEmbedViewBuilder = _webViewBuilder;

/// Panel fijo sobre el minirreproductor con el vídeo de YouTube que se está escuchando.
class YoutubeEmbedDock extends StatelessWidget {
  const YoutubeEmbedDock({super.key, this.controller, this.viewBuilder});

  final YoutubeEmbedController? controller;
  final EmbedViewBuilder? viewBuilder;

  @override
  Widget build(BuildContext context) {
    final embed = controller ?? youtubeEmbed;
    return ListenableBuilder(
      listenable: embed,
      builder: (context, _) {
        final current = embed.current;
        if (current == null) return const SizedBox.shrink();
        final palette = paletteOf(context);
        return Padding(
          padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
          child: DecoratedBox(
            key: const Key('youtube-embed'),
            decoration: BoxDecoration(
              color: palette.card,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 4, 4, 0),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          current.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.labelLarge,
                        ),
                      ),
                      TextButton(
                        key: const Key('youtube-embed-close'),
                        onPressed: embed.close,
                        child: const Text('Cerrar'),
                      ),
                    ],
                  ),
                ),
                ClipRRect(
                  borderRadius: const BorderRadius.vertical(
                    bottom: Radius.circular(8),
                  ),
                  child: AspectRatio(
                    aspectRatio: 16 / 9,
                    child: (viewBuilder ?? youtubeEmbedViewBuilder)(
                      context,
                      current.id,
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _EmbedWebView extends StatefulWidget {
  const _EmbedWebView({super.key, required this.videoId});

  final String videoId;

  @override
  State<_EmbedWebView> createState() => _EmbedWebViewState();
}

class _EmbedWebViewState extends State<_EmbedWebView> {
  late final WebViewController _controller;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.black)
      ..setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: (request) {
            final uri = Uri.tryParse(request.url);
            final allowed =
                uri != null &&
                (request.url == 'about:blank' ||
                    (uri.scheme == 'https' && isAllowedEmbedHost(uri.host)));
            return allowed
                ? NavigationDecision.navigate
                : NavigationDecision.prevent;
          },
        ),
      );
    final platform = _controller.platform;
    if (platform is AndroidWebViewController) {
      platform.setMediaPlaybackRequiresUserGesture(false);
    }
    _controller.loadHtmlString(
      youtubeEmbedHtml(widget.videoId),
      baseUrl: kEmbedOrigin,
    );
  }

  @override
  Widget build(BuildContext context) => WebViewWidget(controller: _controller);
}
