import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:reminiscencia/api_config.dart';
import 'package:reminiscencia/app_error.dart';
import 'package:reminiscencia/auth_store.dart';
import 'package:reminiscencia/worker_catalog_client.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Rutas apuntando a un dominio ficticio, no al Worker real (ADR-0029).
final ApiRoutes _fakeRoutes = ApiRoutes(base: 'https://worker.test');

AuthStore _authStoreWith(String? secret) {
  SharedPreferences.setMockInitialValues(<String, Object>{
    if (secret != null && secret.isNotEmpty)
      kAuthPreferenceKey: secret,
  });
  return SharedPreferencesAuthStore();
}

void main() {
  test('edit 200 devuelve CatalogWriteResult con versión y evento', () async {
    final client = MockClient((request) async {
      expect(request.method, 'POST');
      expect(request.url.path, '/api/catalogo/edit');
      expect(request.headers['X-Auth'], 'secreto');
      expect(request.headers['X-Actor'], 'apk');
      final body = jsonDecode(request.body);
      expect(body['action'], 'rename_song');
      expect(body['if_match'], 1);
      return http.Response(
        jsonEncode({
          'ok': true,
          'version': 2,
          'event': {'action': 'rename_song', 'version_after': 2},
        }),
        200,
        headers: {'content-type': 'application/json'},
      );
    });
    final catalog = WorkerCatalogClient(
      auth: _authStoreWith('secreto'),
      client: client,
      routes: _fakeRoutes,
    );
    final result = await catalog.edit(
      action: 'rename_song',
      params: {'id': 'S1', 'title': 'Nuevo'},
      ifMatch: 1,
    );
    expect(result.version, 2);
    expect(result.event['action'], 'rename_song');
  });

  test('edit 412 refetcha versión y reintenta una vez con la nueva', () async {
    var call = 0;
    final client = MockClient((request) async {
      call++;
      if (call == 1) {
        expect(jsonDecode(request.body)['if_match'], 1);
        return http.Response(
          jsonEncode({
            'ok': false,
            'error': 'if_match no coincide',
            'current_version': 5,
          }),
          412,
          headers: {'content-type': 'application/json'},
        );
      }
      expect(jsonDecode(request.body)['if_match'], 5);
      return http.Response(
        jsonEncode({'ok': true, 'version': 6, 'event': {}}),
        200,
        headers: {'content-type': 'application/json'},
      );
    });
    final catalog = WorkerCatalogClient(
      auth: _authStoreWith('secreto'),
      client: client,
      routes: _fakeRoutes,
    );
    final result = await catalog.edit(
      action: 'move_song',
      params: {'id': 'S1', 'folder_id': 'F1'},
      ifMatch: 1,
    );
    expect(result.version, 6);
    expect(call, 2);
  });

  test('edit 412 dos veces seguidas lanza AppException (no bucle)', () async {
    final client = MockClient((request) async {
      return http.Response(
        jsonEncode({
          'ok': false,
          'error': 'if_match no coincide',
          'current_version': 9,
        }),
        412,
        headers: {'content-type': 'application/json'},
      );
    });
    final catalog = WorkerCatalogClient(
      auth: _authStoreWith('secreto'),
      client: client,
      routes: _fakeRoutes,
    );
    await expectLater(
      () => catalog.edit(action: 'delete_song', params: {'id': 'S1'}, ifMatch: 1),
      throwsA(isA<AppException>()),
    );
  });

  test('edit 423 Locked espera Retry-After y reintenta hasta éxito', () async {
    final waits = <Duration>[];
    var call = 0;
    final client = MockClient((request) async {
      call++;
      if (call == 1) {
        return http.Response(
          jsonEncode({'ok': false, 'error': 'ocupado'}),
          423,
          headers: {
            'content-type': 'application/json',
            'retry-after': '2',
          },
        );
      }
      return http.Response(
        jsonEncode({'ok': true, 'version': 3, 'event': {}}),
        200,
        headers: {'content-type': 'application/json'},
      );
    });
    final catalog = WorkerCatalogClient(
      auth: _authStoreWith('secreto'),
      client: client,
      routes: _fakeRoutes,
      delay: (d) async => waits.add(d),
      retryJitter: Duration.zero,
    );
    final result = await catalog.edit(
      action: 'set_year',
      params: {'id': 'S1', 'year': 1925},
      ifMatch: 1,
    );
    expect(result.version, 3);
    expect(waits, [const Duration(seconds: 2)]);
  });

  test('edit 401 borra la contraseña y lanza AuthRequiredException', () async {
    final store = _authStoreWith('secreto');
    final client = MockClient((request) async {
      return http.Response(
        jsonEncode({'ok': false, 'error': 'no auth'}),
        401,
        headers: {'content-type': 'application/json'},
      );
    });
    final catalog = WorkerCatalogClient(
      auth: store,
      client: client,
      routes: _fakeRoutes,
    );
    await expectLater(
      () => catalog.edit(action: 'delete_song', params: {'id': 'S1'}, ifMatch: 1),
      throwsA(isA<AuthRequiredException>()),
    );
    expect(await store.read(), '');
  });

  test('buzonPublish 200 devuelve nueva versión', () async {
    final client = MockClient((request) async {
      expect(request.url.path, '/api/buzon/publish');
      final body = jsonDecode(request.body);
      expect((body['songs'] as List).length, 2);
      return http.Response(
        jsonEncode({'ok': true, 'version': 10, 'event': {'kind': 'buzon'}}),
        200,
        headers: {'content-type': 'application/json'},
      );
    });
    final catalog = WorkerCatalogClient(
      auth: _authStoreWith('secreto'),
      client: client,
      routes: _fakeRoutes,
    );
    final result = await catalog.buzonPublish(
      songs: [
        {'title': 'a'},
        {'title': 'b'},
      ],
      ifMatch: 9,
    );
    expect(result.version, 10);
  });

  test('getLatest devuelve datos y ETag; 304 devuelve null', () async {
    var call = 0;
    final client = MockClient((request) async {
      call++;
      if (call == 1) {
        expect(request.url.path, '/api/catalogo/latest');
        return http.Response(
          jsonEncode({'version': 7, 'folders': [], 'songs': [], 'updated_at': 'x'}),
          200,
          headers: {
            'content-type': 'application/json',
            'etag': 'W/"v7"',
          },
        );
      }
      expect(request.headers['If-None-Match'], 'W/"v7"');
      return http.Response('', 304);
    });
    final catalog = WorkerCatalogClient(
      auth: _authStoreWith(null),
      client: client,
      routes: _fakeRoutes,
    );
    final first = await catalog.getLatest();
    expect(first, isNotNull);
    expect(first!.version, 7);
    expect(first.etag, 'W/"v7"');

    final second = await catalog.getLatest(ifNoneMatch: first.etag);
    expect(second, isNull);
  });

  test('historial devuelve lista de eventos', () async {
    final client = MockClient((request) async {
      expect(request.url.queryParameters['limit'], '5');
      return http.Response(
        jsonEncode({
          'ok': true,
          'limit': 5,
          'events': [
            {'action': 'rename_song', 'by': 'apk', 'version_after': 3},
            {'action': 'set_year', 'by': 'web', 'version_after': 4},
          ],
        }),
        200,
        headers: {'content-type': 'application/json'},
      );
    });
    final catalog = WorkerCatalogClient(
      auth: _authStoreWith(null),
      client: client,
      routes: _fakeRoutes,
    );
    final events = await catalog.historial(limit: 5);
    expect(events.length, 2);
    expect(events[0]['action'], 'rename_song');
  });
}
