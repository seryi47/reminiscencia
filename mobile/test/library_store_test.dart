import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:reminiscencia/api_config.dart';
import 'package:reminiscencia/auth_store.dart';
import 'package:reminiscencia/library_store.dart';
import 'package:reminiscencia/worker_catalog_client.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Comprueba que [LibraryStore.load] usa el nuevo flujo del Worker (ADR-0052) y, si hay ETag, puede recibir 304.

final ApiRoutes _fakeRoutes = ApiRoutes(base: 'https://worker.test');

Directory _tempRoot(Directory base) {
  final root = Directory('${base.path}/biblioteca');
  root.createSync(recursive: true);
  return root;
}

void main() {
  late Directory tmp;

  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    tmp = Directory.systemTemp.createTempSync('reminiscencia-library-test-');
  });
  tearDown(() {
    if (tmp.existsSync()) tmp.deleteSync(recursive: true);
  });

  test('load lee /api/catalogo/latest del Worker y expone la versión', () async {
    final client = MockClient((request) async {
      expect(request.url.path, '/api/catalogo/latest');
      return http.Response(
        jsonEncode({
          'version': 3,
          'updated_at': '2026-11-26T00:00:00Z',
          'folders': [
            {'id': 'F1', 'name': 'Álbum 1', 'parent_id': null},
          ],
          'songs': [
            {
              'id': 'S1',
              'title': 'Canción 1',
              'artist': 'Artista',
              'year': 1925,
              'tags': ['jazz'],
              'folder_id': 'F1',
              'duration_s': 100.0,
              'license': 'PD',
              'audio': 'audio/S1.opus',
            },
          ],
        }),
        200,
        headers: {
          'content-type': 'application/json',
          'etag': 'W/"v3"',
        },
      );
    });
    final store = LibraryStore(
      root: () async => _tempRoot(tmp),
      client: client,
      catalogClient: WorkerCatalogClient(
        auth: SharedPreferencesAuthStore(),
        client: client,
        routes: _fakeRoutes,
      ),
    );
    final data = await store.load();
    expect(data.version, 3);
    expect(data.fromNetwork, isTrue);
    expect(data.songs.single.id, 'S1');
    expect(data.folders.single.name, 'Álbum 1');
    // Guardó la copia local.
    final cached = File('${tmp.path}/biblioteca/catalog.json');
    expect(await cached.exists(), isTrue);
  });

  test('304 reusa la copia local persistida entre llamadas', () async {
    var calls = 0;
    final client = MockClient((request) async {
      calls++;
      if (calls == 1) {
        return http.Response(
          jsonEncode({
            'version': 5,
            'updated_at': 'x',
            'folders': [],
            'songs': [
              {
                'id': 'S2',
                'title': 'Otra',
                'artist': '',
                'year': null,
                'tags': [],
                'folder_id': null,
                'duration_s': 10.0,
                'license': 'PD',
                'audio': 'audio/S2.opus',
              },
            ],
          }),
          200,
          headers: {
            'content-type': 'application/json',
            'etag': 'W/"v5"',
          },
        );
      }
      expect(request.headers['If-None-Match'], 'W/"v5"');
      return http.Response('', 304);
    });
    final storeOne = LibraryStore(
      root: () async => _tempRoot(tmp),
      client: client,
      catalogClient: WorkerCatalogClient(
        auth: SharedPreferencesAuthStore(),
        client: client,
        routes: _fakeRoutes,
      ),
    );
    final first = await storeOne.load();
    expect(first.version, 5);
    expect(first.songs.length, 1);

    // Segundo arranque: nueva instancia reusa la copia local (ETag persistido).
    final storeTwo = LibraryStore(
      root: () async => _tempRoot(tmp),
      client: client,
      catalogClient: WorkerCatalogClient(
        auth: SharedPreferencesAuthStore(),
        client: client,
        routes: _fakeRoutes,
      ),
    );
    final second = await storeTwo.load();
    expect(second.version, 5);
    expect(second.songs.length, 1);
    expect(calls, 2);
  });

  test('si el Worker da 503, cae al flujo antiguo con data/songs.json', () async {
    var step = 0;
    final client = MockClient((request) async {
      step++;
      final path = request.url.path;
      if (path == '/api/catalogo/latest') {
        return http.Response(
          jsonEncode({'ok': false}),
          503,
          headers: {'content-type': 'application/json'},
        );
      }
      if (path.endsWith('/data/songs.json')) {
        return http.Response(
          jsonEncode([
            {
              'id': 'S9',
              'title': 'Antiguo',
              'artist': '',
              'year': null,
              'tags': [],
              'folder_id': null,
              'duration_s': 42.0,
              'license': 'PD',
              'audio': 'audio/S9.opus',
            },
          ]),
          200,
          headers: {'content-type': 'application/json'},
        );
      }
      if (path.endsWith('/data/folders.json')) {
        return http.Response('[]', 200);
      }
      if (path.endsWith('/portadas.json') || path.endsWith('/portadas/index.json')) {
        return http.Response('{}', 404);
      }
      return http.Response('no', 404);
    });
    final store = LibraryStore(
      root: () async => _tempRoot(tmp),
      client: client,
      catalogClient: WorkerCatalogClient(
        auth: SharedPreferencesAuthStore(),
        client: client,
        routes: _fakeRoutes,
      ),
    );
    final data = await store.load();
    // Vino del flujo antiguo → versión 0.
    expect(data.version, 0);
    expect(data.songs.single.id, 'S9');
    expect(step, greaterThan(1));
  });

  test('loadSaved prefiere catalog.json si ya existe', () async {
    final root = _tempRoot(tmp);
    await File('${root.path}/catalog.json').writeAsString(jsonEncode({
      'version': 11,
      'folders': [],
      'songs': [
        {
          'id': 'S11',
          'title': 'Guardada',
          'artist': '',
          'year': null,
          'tags': [],
          'folder_id': null,
          'duration_s': 60.0,
          'license': 'PD',
          'audio': 'audio/S11.opus',
        },
      ],
    }));
    final store = LibraryStore(
      root: () async => root,
      client: MockClient((_) async => http.Response('no', 500)),
      catalogClient: WorkerCatalogClient(
        auth: SharedPreferencesAuthStore(),
        client: MockClient((_) async => http.Response('no', 500)),
        routes: _fakeRoutes,
      ),
    );
    final saved = await store.loadSaved();
    expect(saved, isNotNull);
    expect(saved!.version, 11);
    expect(saved.fromNetwork, isFalse);
    expect(saved.songs.single.title, 'Guardada');
  });
}
