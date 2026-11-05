import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:reminiscencia/youtube_audio_source.dart';

void main() {
  final uri = Uri.parse(
    'https://x.googlevideo.com/videoplayback?mime=audio%2Fwebm&id=1',
  );

  test(
    'pide un trozo acotado con el User-Agent y devuelve longitud total y offset',
    () async {
      late http.BaseRequest seen;
      final client = MockClient.streaming((r, _) async {
        seen = r;
        return http.StreamedResponse(
          Stream.value(utf8.encode('abcde')),
          206,
          contentLength: 5,
          headers: {'content-range': 'bytes 10-14/1000'},
        );
      });
      final source = YoutubeAudioSource(
        uri: uri,
        headers: {'User-Agent': 'ua'},
        client: client,
        chunkBytes: 5,
      );
      final response = await source.request(10, null);
      expect(seen.headers['Range'], 'bytes=10-14');
      expect(seen.headers['User-Agent'], 'ua');
      expect(response.sourceLength, 1000);
      expect(response.contentLength, 5);
      expect(response.offset, 10);
      expect(response.contentType, 'audio/webm');
    },
  );

  test('un rechazo de YouTube lanza un error en vez de colgarse', () async {
    final client = MockClient.streaming(
      (_, _) async => http.StreamedResponse(const Stream.empty(), 403),
    );
    final source = YoutubeAudioSource(uri: uri, client: client);
    await expectLater(source.request(), throwsA(isA<http.ClientException>()));
  });
}
