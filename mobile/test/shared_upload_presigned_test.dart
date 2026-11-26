// Tests del cableado presigned-first en SharedUploader (ADR-0052 ampliación 2026-11-26). Verifica que:
// - con authStore con contraseña y Worker respondiendo, el audio va directo a R2 y /api/subir NUNCA se toca;
// - con 503 en presign cae al flujo clásico por trozos sin fallar la subida;
// - sin red en el PUT a R2 también cae al clásico;
// - con AuthStore con auth vacía, salta el presigned y va directo al clásico.

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:reminiscencia/auth_store.dart';
import 'package:reminiscencia/local_audio.dart';
import 'package:reminiscencia/shared_upload.dart';

const _kBase = 'https://reminiscencia.cometia.es/';

/// AuthStore de pruebas en memoria.
class _MemoryAuth implements AuthStore {
  _MemoryAuth(this._value);
  String _value;
  @override
  Future<String> read() async => _value;
  @override
  Future<void> write(String value) async => _value = value.trim();
  @override
  Future<void> clear() async => _value = '';
  @override
  Future<Map<String, String>> withAuth([Map<String, String>? headers]) async {
    final out = <String, String>{...?headers, 'X-Actor': 'apk'};
    if (_value.isNotEmpty) out['X-Auth'] = _value;
    return out;
  }
}

/// Conversor mínimo: escribe un Opus falso de longitud fija.
class _TinyConverter implements AudioConverter {
  _TinyConverter({this.bytes = 20, this.durationS = 7});
  final int bytes;
  final double durationS;
  @override
  Future<ConvertedAudio> convert({
    required String inputPath,
    required String outputPath,
    required String title,
  }) async {
    final file = File(outputPath);
    await file.parent.create(recursive: true);
    await file.writeAsBytes(List<int>.generate(bytes, (i) => i % 251));
    return ConvertedAudio(path: outputPath, bytes: bytes, durationS: durationS);
  }

  @override
  Future<void> cancel() async {}
}

Future<File> _tempOpus(int bytes) async {
  final tmp = await Directory.systemTemp.createTemp('presigned_upload_');
  final file = File('${tmp.path}/x.opus');
  await file.writeAsBytes(Uint8List.fromList(List<int>.generate(bytes, (i) => i % 251)));
  return file;
}

void main() {
  test('con auth y Worker presigned: PUT directo a R2 y /api/subir NO se toca', () async {
    final hits = <String>[];
    final client = MockClient((req) async {
      hits.add('${req.method} ${req.url.path}');
      if (req.url.path == '/api/upload/presign') {
        return http.Response(jsonEncode({
          'ok': true, 'mode': 'simple',
          'uploadUrl': 'https://r2.example/u', 'r2Key': 'entrada/x/y.opus',
        }), 200, headers: {'content-type': 'application/json'});
      }
      if (req.url.toString() == 'https://r2.example/u') {
        expect(req.method, 'PUT');
        return http.Response('', 200);
      }
      if (req.url.path == '/api/upload/complete') {
        return http.Response(jsonEncode({'ok': true}), 200, headers: {'content-type': 'application/json'});
      }
      if (req.url.path == '/api/subir') {
        return http.Response('{"error":"NUNCA SE DEBE LLAMAR"}', 500);
      }
      return http.Response('', 404);
    });
    final uploader = SharedUploader(
      client: client,
      converter: _TinyConverter(),
      hasConnection: () async => true,
      authStore: _MemoryAuth('pa55w0rd-test'),
    );
    final file = await _tempOpus(128);
    final result = await uploader.resend(file, 'y.opus');
    expect(result.outcome, UploadOutcome.uploaded);
    expect(hits.contains('POST /api/upload/presign'), true);
    expect(hits.contains('PUT /u'), true);
    expect(hits.contains('POST /api/upload/complete'), true);
    expect(hits.any((h) => h.endsWith('/api/subir')), false);
  });

  test('503 en presign: fallback al flujo clásico /api/subir sin fallar la subida', () async {
    final hits = <String>[];
    final client = MockClient((req) async {
      hits.add('${req.method} ${req.url.path}');
      if (req.url.path == '/api/upload/presign') {
        return http.Response(jsonEncode({'ok': false, 'error': 'secrets not configured'}), 503,
            headers: {'content-type': 'application/json'});
      }
      if (req.url.path == '/api/subir') {
        return http.Response(jsonEncode({'ok': true, 'mensaje': 'guardado en buzón'}), 200,
            headers: {'content-type': 'application/json'});
      }
      return http.Response('', 404);
    });
    final uploader = SharedUploader(
      client: client,
      converter: _TinyConverter(),
      hasConnection: () async => true,
      authStore: _MemoryAuth('pa55w0rd-test'),
    );
    final file = await _tempOpus(64);
    final result = await uploader.resend(file, 'y.opus');
    expect(result.outcome, UploadOutcome.uploaded);
    expect(hits.contains('POST /api/upload/presign'), true);
    expect(hits.any((h) => h.endsWith('/api/subir')), true,
        reason: 'tras el 503 debe caer al flujo chunked');
  });

  test('PUT a R2 con error de red: también cae al clásico', () async {
    final hits = <String>[];
    final client = MockClient((req) async {
      hits.add('${req.method} ${req.url.path}');
      if (req.url.path == '/api/upload/presign') {
        return http.Response(jsonEncode({
          'ok': true, 'mode': 'simple',
          'uploadUrl': 'https://r2.example/u', 'r2Key': 'entrada/x/y.opus',
        }), 200, headers: {'content-type': 'application/json'});
      }
      if (req.url.toString() == 'https://r2.example/u') {
        return http.Response('{"error":"forbidden (url expired)"}', 403);
      }
      if (req.url.path == '/api/subir') {
        return http.Response(jsonEncode({'ok': true, 'mensaje': 'ok'}), 200,
            headers: {'content-type': 'application/json'});
      }
      return http.Response('', 404);
    });
    final uploader = SharedUploader(
      client: client,
      converter: _TinyConverter(),
      hasConnection: () async => true,
      authStore: _MemoryAuth('pa55w0rd-test'),
    );
    final file = await _tempOpus(64);
    final result = await uploader.resend(file, 'y.opus');
    expect(result.outcome, UploadOutcome.uploaded);
    expect(hits.any((h) => h.endsWith('/api/upload/presign')), true);
    expect(hits.any((h) => h == 'PUT /u'), true);
    expect(hits.any((h) => h.endsWith('/api/subir')), true);
  });

  test('sin auth guardada: salta el presigned y va al clásico', () async {
    final hits = <String>[];
    final client = MockClient((req) async {
      hits.add('${req.method} ${req.url.path}');
      if (req.url.path == '/api/subir') {
        return http.Response(jsonEncode({'ok': true, 'mensaje': 'ok'}), 200,
            headers: {'content-type': 'application/json'});
      }
      return http.Response('', 404);
    });
    final uploader = SharedUploader(
      client: client,
      converter: _TinyConverter(),
      hasConnection: () async => true,
      authStore: _MemoryAuth(''),
    );
    final file = await _tempOpus(64);
    final result = await uploader.resend(file, 'y.opus');
    expect(result.outcome, UploadOutcome.uploaded);
    expect(hits.any((h) => h.endsWith('/api/upload/presign')), false,
        reason: 'sin auth no debe pedir URL firmada');
    expect(hits.any((h) => h.endsWith('/api/subir')), true);
  });
}
