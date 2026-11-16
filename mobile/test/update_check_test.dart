import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:reminiscencia/update_check.dart';

http.Client _client(Object body, {int status = 200}) =>
    MockClient((_) async => http.Response(body is String ? body : jsonEncode(body), status));

Map<String, dynamic> _release({
  String tag = 'android-v1.3.5',
  String body = 'Novedades',
  List<Map<String, String>> assets = const [
    {'name': 'reminiscencia-1.3.5-arm64-v8a.apk', 'browser_download_url': 'https://x/arm64.apk'},
    {'name': 'reminiscencia-1.3.5-armeabi-v7a.apk', 'browser_download_url': 'https://x/v7a.apk'},
  ],
}) => {
      'tag_name': tag,
      'html_url': 'https://github.com/seryi47/reminiscencia/releases/tag/$tag',
      'body': body,
      'assets': assets,
    };

void main() {
  group('isNewerVersion', () {
    test('mayor en cualquier campo', () {
      expect(isNewerVersion('1.3.5', '1.3.4'), isTrue);
      expect(isNewerVersion('1.4.0', '1.3.9'), isTrue);
      expect(isNewerVersion('2.0.0', '1.9.9'), isTrue);
    });
    test('igual o menor no es más nueva', () {
      expect(isNewerVersion('1.3.4', '1.3.4'), isFalse);
      expect(isNewerVersion('1.3.3', '1.3.4'), isFalse);
      expect(isNewerVersion('1.2.9', '1.3.0'), isFalse);
    });
    test('tolera prefijos y sufijo de build', () {
      expect(isNewerVersion('android-v1.3.5', '1.3.4'), isTrue);
      expect(isNewerVersion('1.3.5+19', '1.3.4+18'), isTrue);
    });
  });

  group('checkForUpdate', () {
    test('release más nueva → UpdateInfo con el APK arm64', () async {
      final info = await checkForUpdate(client: _client(_release()), currentVersion: '1.3.4');
      expect(info, isNotNull);
      expect(info!.version, '1.3.5');
      expect(info.url, 'https://x/arm64.apk');
      expect(info.notes, 'Novedades');
    });

    test('sin APK arm64 → cae a la página de la release', () async {
      final info = await checkForUpdate(
        client: _client(_release(assets: const [
          {'name': 'otra-cosa.txt', 'browser_download_url': 'https://x/otra.txt'},
        ])),
        currentVersion: '1.3.4',
      );
      expect(info, isNotNull);
      expect(info!.url, contains('/releases/tag/'));
    });

    test('misma versión → no hay actualización', () async {
      final info = await checkForUpdate(client: _client(_release(tag: 'android-v1.3.4')), currentVersion: '1.3.4');
      expect(info, isNull);
    });

    test('versión anterior → no hay actualización', () async {
      final info = await checkForUpdate(client: _client(_release(tag: 'android-v1.3.3')), currentVersion: '1.3.4');
      expect(info, isNull);
    });

    test('respuesta no 200 → null (silencioso)', () async {
      final info = await checkForUpdate(client: _client('{}', status: 404), currentVersion: '1.3.4');
      expect(info, isNull);
    });

    test('cuerpo que no es JSON válido → null', () async {
      final info = await checkForUpdate(client: _client('no es json'), currentVersion: '1.3.4');
      expect(info, isNull);
    });

    test('sin tag_name → null', () async {
      final info = await checkForUpdate(client: _client({'assets': []}), currentVersion: '1.3.4');
      expect(info, isNull);
    });

    test('recorta notas largas', () async {
      final info = await checkForUpdate(
        client: _client(_release(body: 'x' * 500)),
        currentVersion: '1.3.4',
      );
      expect(info!.notes.length, lessThanOrEqualTo(401));
      expect(info.notes.endsWith('…'), isTrue);
    });
  });
}
