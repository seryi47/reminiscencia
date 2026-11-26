// Helper de subida directa a R2 con URL firmada desde la APK (ADR-0052 ampliación 2026-11-26).
// El audio no pasa por el Worker: el móvil firma la URL en `/api/upload/presign`, sube con PUT directo,
// y confirma en `/api/upload/complete`. Si el Worker responde 503 (secretos R2 no configurados), el
// caller debe caer al flujo clásico de SharedUploader.
//
// Esta clase está preparada pero NO cableada por defecto a `shared_upload.dart`: se activa cambiando
// una línea cuando el administrador añada los secretos R2_* al Worker.

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;

import 'auth_store.dart';

class PresignedUploadException implements Exception {
  PresignedUploadException(this.message, {this.phase = 'unknown', this.statusCode = 0});
  final String message;
  final String phase;
  final int statusCode;
  @override
  String toString() => 'PresignedUpload[$phase/$statusCode]: $message';
}

class PresignedUploadResult {
  PresignedUploadResult({required this.r2Key, required this.sha256, required this.sizeBytes});
  final String r2Key;
  final String sha256;
  final int sizeBytes;
}

class PresignedUploader {
  PresignedUploader({
    required this.baseUrl,
    required this.authStore,
    http.Client? httpClient,
  }) : _http = httpClient ?? http.Client();

  final Uri baseUrl;
  final AuthStore authStore;
  final http.Client _http;

  Future<PresignedUploadResult> upload(File file, {String? fileName}) async {
    final bytes = await file.readAsBytes();
    final name = fileName ?? file.uri.pathSegments.last;
    return uploadBytes(bytes, fileName: name);
  }

  Future<PresignedUploadResult> uploadBytes(Uint8List bytes, {required String fileName}) async {
    final shaHex = sha256.convert(bytes).toString();
    final sizeBytes = bytes.length;
    final auth = await authStore.withAuth();
    final headers = <String, String>{'Content-Type': 'application/json', ...auth};
    final presign = await _postJson(
      path: '/api/upload/presign',
      headers: headers,
      body: {'filename': fileName, 'sizeBytes': sizeBytes, 'contentType': 'audio/ogg'},
      phase: 'presign',
    );
    if (presign['ok'] != true) {
      throw PresignedUploadException(presign['error']?.toString() ?? 'Respuesta sin ok', phase: 'presign-shape');
    }
    final mode = presign['mode'] as String? ?? 'simple';
    final r2Key = presign['r2Key'] as String? ?? '';
    List<Map<String, dynamic>> partsOut = [];
    if (mode == 'simple') {
      final uploadUrl = presign['uploadUrl'] as String;
      final put = await _http.put(Uri.parse(uploadUrl), body: bytes);
      if (put.statusCode < 200 || put.statusCode >= 300) {
        throw PresignedUploadException('PUT simple falló', phase: 'put-simple', statusCode: put.statusCode);
      }
    } else {
      final chunkBytes = (presign['chunkBytes'] as num).toInt();
      final parts = (presign['parts'] as List).cast<Map<String, dynamic>>();
      for (final part in parts) {
        final n = (part['partNumber'] as num).toInt();
        final start = (n - 1) * chunkBytes;
        final end = (start + chunkBytes).clamp(0, bytes.length);
        final slice = bytes.sublist(start, end);
        final put = await _http.put(Uri.parse(part['uploadUrl'] as String), body: slice);
        if (put.statusCode < 200 || put.statusCode >= 300) {
          throw PresignedUploadException('PUT multipart parte $n falló', phase: 'put-multipart', statusCode: put.statusCode);
        }
        final etag = put.headers['etag'] ?? put.headers['ETag'];
        if (etag == null) {
          throw PresignedUploadException('PUT multipart parte $n sin ETag', phase: 'put-multipart-etag');
        }
        partsOut.add({'partNumber': n, 'etag': etag});
      }
    }
    final completeBody = <String, dynamic>{'r2Key': r2Key};
    if (mode == 'multipart') {
      completeBody['s3UploadId'] = presign['s3UploadId'];
      completeBody['parts'] = partsOut;
    }
    await _postJson(path: '/api/upload/complete', headers: headers, body: completeBody, phase: 'complete');
    return PresignedUploadResult(r2Key: r2Key, sha256: shaHex, sizeBytes: sizeBytes);
  }

  Future<Map<String, dynamic>> _postJson({
    required String path,
    required Map<String, String> headers,
    required Map<String, dynamic> body,
    required String phase,
  }) async {
    final uri = baseUrl.replace(path: path);
    http.Response response;
    try {
      response = await _http.post(uri, headers: headers, body: jsonEncode(body));
    } on SocketException catch (e) {
      throw PresignedUploadException('Error de red: ${e.message}', phase: '$phase-network');
    }
    if (response.statusCode == 503) {
      throw PresignedUploadException('Subida directa no configurada en el servidor.', phase: '$phase-503', statusCode: 503);
    }
    if (response.statusCode == 401) {
      throw PresignedUploadException('Falta la contraseña del Worker.', phase: '$phase-auth', statusCode: 401);
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw PresignedUploadException('HTTP ${response.statusCode}', phase: '$phase-http', statusCode: response.statusCode);
    }
    try {
      return (jsonDecode(response.body) as Map).cast<String, dynamic>();
    } catch (_) {
      throw PresignedUploadException('Respuesta no es JSON.', phase: '$phase-parse');
    }
  }

  void close() => _http.close();
}
