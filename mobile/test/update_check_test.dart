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
    {'name': 'reminiscencia-1.3.5-universal.apk', 'browser_download_url': 'https://x/universal.apk'},
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
    test('release más nueva → UpdateInfo con el APK UNIVERSAL (ADR-0047: nunca rompe sobre un APK universal instalado)',
        () async {
      final info = await checkForUpdate(client: _client(_release()), currentVersion: '1.3.4');
      expect(info, isNotNull);
      expect(info!.version, '1.3.5');
      expect(info.url, 'https://x/universal.apk');
      // Las notas ya no vienen del body de la release; son un refrán romántico aleatorio (2026-11-21).
      expect(info.notes, isNotEmpty);
    });

    test('sin universal → se cae a arm64-v8a (ni al navegador ni a la página de la release)', () async {
      final info = await checkForUpdate(
        client: _client(_release(assets: const [
          {'name': 'reminiscencia-1.3.5-arm64-v8a.apk', 'browser_download_url': 'https://x/arm64.apk'},
          {'name': 'reminiscencia-1.3.5-armeabi-v7a.apk', 'browser_download_url': 'https://x/v7a.apk'},
        ])),
        currentVersion: '1.3.4',
      );
      expect(info, isNotNull);
      expect(info!.url, 'https://x/arm64.apk');
    });

    test('sin APK aceptable (solo .txt) → null (no se baja nada ni se abre nada)', () async {
      final info = await checkForUpdate(
        client: _client(_release(assets: const [
          {'name': 'otra-cosa.txt', 'browser_download_url': 'https://x/otra.txt'},
        ])),
        currentVersion: '1.3.4',
      );
      expect(info, isNull);
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

    test('las notas son un verso de poesía con autor, nunca el body técnico de la release (2026-11-21)', () async {
      final info = await checkForUpdate(
        client: _client(_release(body: 'xxx CAMBIOS TÉCNICOS xxx')),
        currentVersion: '1.3.4',
      );
      expect(info, isNotNull);
      expect(info!.notes, isNot(contains('CAMBIOS TÉCNICOS')));
      expect(info.notes, isNot(contains('xxx')));
      // El formato es «Verso. — Autor»: debe contener un guion largo como separador de atribución.
      expect(info.notes, contains('—'));
      expect(info.notes.length, lessThanOrEqualTo(400));
    });
  });
}
