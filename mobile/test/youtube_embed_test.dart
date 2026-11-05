import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/youtube_embed.dart';

void main() {
  test(
    'la dirección del reproductor es youtube-nocookie con reproducción automática',
    () {
      final uri = youtubeEmbedUri('dQw4w9WgXcQ');
      expect(uri.host, 'www.youtube-nocookie.com');
      expect(uri.path, '/embed/dQw4w9WgXcQ');
      expect(uri.queryParameters['autoplay'], '1');
      expect(youtubeEmbedHtml('dQw4w9WgXcQ'), contains(uri.toString()));
    },
  );

  test('solo se navega a hosts de YouTube y Google', () {
    expect(isAllowedEmbedHost('www.youtube-nocookie.com'), isTrue);
    expect(isAllowedEmbedHost('www.youtube.com'), isTrue);
    expect(isAllowedEmbedHost('rr1---sn-x.googlevideo.com'), isTrue);
    expect(isAllowedEmbedHost('evil.com'), isFalse);
    expect(isAllowedEmbedHost('youtube.com.evil.com'), isFalse);
  });

  test('el controlador abre, sustituye y cierra el vídeo', () {
    final controller = YoutubeEmbedController();
    var changes = 0;
    controller.addListener(() => changes++);
    controller.open('a', 'Uno');
    controller.open('b', 'Dos');
    expect(controller.current?.id, 'b');
    controller.close();
    controller.close();
    expect(controller.current, isNull);
    expect(changes, 3);
  });
}
