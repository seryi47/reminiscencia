// Tests para PresignedUploader (ADR-0052 ampliación 2026-11-26).

import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:reminiscencia/auth_store.dart';
import 'package:reminiscencia/presigned_upload.dart';

class _FakeAuthStore implements AuthStore {
  _FakeAuthStore(this._password);
  final String _password;
  @override Future<void> clear() async {}
  @override Future<String> read() async => _password;
  @override Future<void> write(String value) async {}
  @override Future<Map<String, String>> withAuth([Map<String, String>? headers]) async {
    final result = <String, String>{...?headers, 'X-Actor': 'apk'};
    if (_password.isNotEmpty) result['X-Auth'] = _password;
    return result;
  }
}

void main() {
  final baseUrl = Uri.parse('https://reminiscencia.cometia.es');
  final bytes = Uint8List.fromList(List<int>.generate(1024, (i) => i % 256));
  final expectedSha = sha256.convert(bytes).toString();

  test('happy path simple: presign → PUT → complete', () async {
    final calls = <String>[];
    final mock = MockClient((request) async {
      calls.add('${request.method} ${request.url.path}');
      if (request.url.path == '/api/upload/presign') {
        return http.Response(jsonEncode({
          'ok': true,
          'mode': 'simple',
          'uploadId': 'uuid-1',
          'r2Key': 'entrada/uuid-1/cancion.opus',
          'uploadUrl': 'https://abc.r2.cloudflarestorage.com/presigned?X-Amz-Signature=xx',
          'expiresAt': DateTime.now().millisecondsSinceEpoch ~/ 1000 + 900,
        }), 200, headers: {'content-type': 'application/json'});
      }
      if (request.url.host == 'abc.r2.cloudflarestorage.com') {
        return http.Response('', 200);
      }
      if (request.url.path == '/api/upload/complete') {
        return http.Response(jsonEncode({'ok': true, 'r2Key': 'entrada/uuid-1/cancion.opus'}), 200, headers: {'content-type': 'application/json'});
      }
      return http.Response('no', 404);
    });
    final uploader = PresignedUploader(baseUrl: baseUrl, authStore: _FakeAuthStore('pass'), httpClient: mock);
    final result = await uploader.uploadBytes(bytes, fileName: 'cancion.opus');
    expect(result.sha256, equals(expectedSha));
    expect(result.sizeBytes, equals(bytes.length));
    expect(result.r2Key, equals('entrada/uuid-1/cancion.opus'));
    expect(calls, contains('POST /api/upload/presign'));
    expect(calls, contains('POST /api/upload/complete'));
    uploader.close();
  });

  test('presign 503 lanza con phase presign-503 para que el caller caiga a legacy', () async {
    final mock = MockClient((request) async =>
        http.Response(jsonEncode({'ok': false, 'error': 'no configurada'}), 503, headers: {'content-type': 'application/json'}));
    final uploader = PresignedUploader(baseUrl: baseUrl, authStore: _FakeAuthStore('pass'), httpClient: mock);
    expect(
      () => uploader.uploadBytes(bytes, fileName: 'x.opus'),
      throwsA(isA<PresignedUploadException>().having((e) => e.phase, 'phase', 'presign-503')),
    );
    uploader.close();
  });

  test('presign 401 lanza presign-auth', () async {
    final mock = MockClient((request) async => http.Response('{}', 401));
    final uploader = PresignedUploader(baseUrl: baseUrl, authStore: _FakeAuthStore(''), httpClient: mock);
    expect(
      () => uploader.uploadBytes(bytes, fileName: 'x.opus'),
      throwsA(isA<PresignedUploadException>().having((e) => e.phase, 'phase', 'presign-auth')),
    );
    uploader.close();
  });
}
