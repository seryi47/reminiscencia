// CatalogWatcher: long-poll al Worker para repintar la APK en tiempo real (ADR-0052).

import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:reminiscencia/api_config.dart';
import 'package:reminiscencia/auth_store.dart';
import 'package:reminiscencia/worker_catalog_client.dart';

class _MemoryAuth implements AuthStore {
  _MemoryAuth(this._value);
  String _value;
  @override
  Future<String> read() async => _value;
  @override
  Future<void> write(String value) async { _value = value.trim(); }
  @override
  Future<void> clear() async { _value = ''; }
  @override
  Future<Map<String, String>> withAuth([Map<String, String>? headers]) async {
    final out = <String, String>{...?headers, 'X-Actor': 'test'};
    if (_value.isNotEmpty) out['X-Auth'] = _value;
    return out;
  }
}

class _MockClient implements http.Client {
  _MockClient(this._handler);
  final Future<http.StreamedResponse> Function(http.BaseRequest) _handler;
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) => _handler(request);
  @override
  void close() {}
  @override
  Future<http.Response> head(Uri url, {Map<String, String>? headers}) =>
      throw UnimplementedError();
  @override
  Future<http.Response> get(Uri url, {Map<String, String>? headers}) =>
      throw UnimplementedError();
  @override
  Future<http.Response> post(Uri url, {Map<String, String>? headers, Object? body, Encoding? encoding}) =>
      throw UnimplementedError();
  @override
  Future<http.Response> put(Uri url, {Map<String, String>? headers, Object? body, Encoding? encoding}) =>
      throw UnimplementedError();
  @override
  Future<http.Response> patch(Uri url, {Map<String, String>? headers, Object? body, Encoding? encoding}) =>
      throw UnimplementedError();
  @override
  Future<http.Response> delete(Uri url, {Map<String, String>? headers, Object? body, Encoding? encoding}) =>
      throw UnimplementedError();
  @override
  Future<String> read(Uri url, {Map<String, String>? headers}) =>
      throw UnimplementedError();
  @override
  Future<Uint8List> readBytes(Uri url, {Map<String, String>? headers}) =>
      throw UnimplementedError();
}

http.StreamedResponse _json(int status, Map<String, Object?> body) {
  final bytes = utf8.encode(jsonEncode(body));
  return http.StreamedResponse(
    Stream.value(bytes),
    status,
    headers: {'content-type': 'application/json', if (status == 200) 'etag': 'W/"v${body['version']}"'},
  );
}

http.StreamedResponse _empty(int status) {
  return http.StreamedResponse(const Stream.empty(), status);
}

void main() {
  final routes = ApiRoutes(base: 'https://reminiscencia-api.test/');

  test('CatalogWatcher llama onUpdate con el catálogo nuevo cuando el Worker responde 200', () async {
    var calls = 0;
    final mock = _MockClient((request) async {
      calls++;
      if (calls == 1) {
        return _json(200, {
          'version': 8,
          'folders': <Map<String, Object?>>[],
          'songs': [
            {'id': 'S1', 'title': 'Nueva', 'folder_id': null},
          ],
        });
      }
      // Después: 204 para dejar quieto el bucle y poder parar.
      return _empty(204);
    });
    final client = WorkerCatalogClient(auth: _MemoryAuth(''), client: mock, routes: routes);
    final updates = <CatalogLatest>[];
    var currentVersion = 0;
    final watcher = CatalogWatcher(
      client: client,
      getVersion: () => currentVersion,
      onUpdate: (c) async { updates.add(c); currentVersion = c.version; },
      waitTimeoutSeconds: 1,
      sleep: (_) async {},
    )..start();
    await Future<void>.delayed(const Duration(milliseconds: 100));
    await watcher.stop();
    expect(updates, isNotEmpty);
    expect(updates.first.version, 8);
  });

  test('CatalogWatcher no llama onUpdate si el Worker responde 204', () async {
    final mock = _MockClient((_) async => _empty(204));
    final client = WorkerCatalogClient(auth: _MemoryAuth(''), client: mock, routes: routes);
    var updates = 0;
    final watcher = CatalogWatcher(
      client: client,
      getVersion: () => 5,
      onUpdate: (_) async { updates++; },
      waitTimeoutSeconds: 1,
      sleep: (_) async {},
    )..start();
    await Future<void>.delayed(const Duration(milliseconds: 60));
    await watcher.stop();
    expect(updates, 0);
  });

  test('CatalogWatcher hace backoff tras errores y notifica onError', () async {
    var calls = 0;
    final errors = <Object>[];
    final sleeps = <Duration>[];
    final mock = _MockClient((_) async {
      calls++;
      throw Exception('boom $calls');
    });
    final client = WorkerCatalogClient(auth: _MemoryAuth(''), client: mock, routes: routes);
    final watcher = CatalogWatcher(
      client: client,
      getVersion: () => 0,
      onUpdate: (_) async {},
      onError: errors.add,
      waitTimeoutSeconds: 1,
      sleep: (d) async { sleeps.add(d); },
    )..start();
    await Future<void>.delayed(const Duration(milliseconds: 80));
    await watcher.stop();
    expect(errors.length, greaterThanOrEqualTo(1));
    expect(sleeps.length, greaterThanOrEqualTo(1));
    expect(sleeps.first.inSeconds, greaterThanOrEqualTo(1));
  });

  test('CatalogWatcher se detiene al llamar stop() incluso si está en espera', () async {
    final mock = _MockClient((_) async => _empty(204));
    final client = WorkerCatalogClient(auth: _MemoryAuth(''), client: mock, routes: routes);
    final watcher = CatalogWatcher(
      client: client,
      getVersion: () => 0,
      onUpdate: (_) async {},
      waitTimeoutSeconds: 1,
      sleep: (_) async {},
    )..start();
    await Future<void>.delayed(const Duration(milliseconds: 30));
    await watcher.stop();
    // Si stop() es correcto, el test no cuelga.
    expect(true, isTrue);
  });

  test('CatalogWatcher pausa y reanuda', () async {
    var calls = 0;
    final mock = _MockClient((_) async { calls++; return _empty(204); });
    final client = WorkerCatalogClient(auth: _MemoryAuth(''), client: mock, routes: routes);
    final watcher = CatalogWatcher(
      client: client,
      getVersion: () => 0,
      onUpdate: (_) async {},
      waitTimeoutSeconds: 1,
      sleep: (_) async {},
    )..start();
    await Future<void>.delayed(const Duration(milliseconds: 30));
    final countBeforePause = calls;
    watcher.pause();
    await Future<void>.delayed(const Duration(milliseconds: 30));
    final countAfterPause = calls;
    watcher.resume();
    await Future<void>.delayed(const Duration(milliseconds: 30));
    await watcher.stop();
    expect(countAfterPause, lessThanOrEqualTo(countBeforePause + 1), reason: 'durante pause no debería seguir llamando');
    expect(calls, greaterThan(countAfterPause), reason: 'tras resume debe reanudar');
  });
}

