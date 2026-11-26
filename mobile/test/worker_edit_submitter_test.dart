import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:reminiscencia/api_config.dart';
import 'package:reminiscencia/auth_store.dart';
import 'package:reminiscencia/edit_remote.dart';
import 'package:reminiscencia/library_requests.dart';
import 'package:reminiscencia/worker_catalog_client.dart';
import 'package:reminiscencia/worker_edit_submitter.dart';
import 'package:shared_preferences/shared_preferences.dart';

final ApiRoutes _fakeRoutes = ApiRoutes(base: 'https://worker.test');

AuthStore _authStoreWith(String? secret) {
  SharedPreferences.setMockInitialValues(<String, Object>{
    if (secret != null && secret.isNotEmpty) kAuthPreferenceKey: secret,
  });
  return SharedPreferencesAuthStore();
}

const String _songId = 'S1111111111111111';
const String _folderId = 'F2222222222222222';

void main() {
  test('edit_song (título y artista) va a set_song_fields en un POST', () async {
    final calls = <Map<String, Object?>>[];
    final client = MockClient((request) async {
      if (request.method == 'GET' && request.url.path == '/api/catalogo/latest') {
        return http.Response(
          jsonEncode({'version': 3, 'folders': [], 'songs': []}),
          200,
          headers: {'etag': 'W/"v3"'},
        );
      }
      final body = jsonDecode(request.body) as Map<String, Object?>;
      calls.add(body);
      return http.Response(
        jsonEncode({'ok': true, 'version': 4, 'event': {}}),
        200,
        headers: {'content-type': 'application/json'},
      );
    });
    final worker = WorkerCatalogClient(
      auth: _authStoreWith('secreto'),
      client: client,
      routes: _fakeRoutes,
    );
    final adapter = WorkerBackedEditSubmitter(
      worker: worker,
      fallback: (_) async => fail('no debía caer en legacy'),
    );
    final receipt = await adapter.submit(
      LibraryRequest.editSong(
        songId: _songId,
        title: 'Nuevo título',
        artist: 'Nuevo artista',
      ),
    );
    expect(receipt.message, isNotEmpty);
    expect(calls, hasLength(1));
    expect(calls.single['action'], 'set_song_fields');
    expect(calls.single['if_match'], 3);
    final params = calls.single['params'] as Map;
    expect(params['song_id'], _songId);
    final fields = params['fields'] as Map;
    expect(fields['title'], 'Nuevo título');
    expect(fields['artist'], 'Nuevo artista');
  });

  test('moveSong manda move_song y encadena if_match tras set_song_fields', () async {
    final posts = <Map<String, Object?>>[];
    final client = MockClient((request) async {
      if (request.method == 'GET' && request.url.path == '/api/catalogo/latest') {
        return http.Response(
          jsonEncode({'version': 10, 'folders': [], 'songs': []}),
          200,
          headers: {'etag': 'W/"v10"'},
        );
      }
      final body = jsonDecode(request.body) as Map<String, Object?>;
      posts.add(body);
      final next = (body['if_match'] as int) + 1;
      return http.Response(
        jsonEncode({'ok': true, 'version': next, 'event': {}}),
        200,
        headers: {'content-type': 'application/json'},
      );
    });
    final worker = WorkerCatalogClient(
      auth: _authStoreWith('secreto'),
      client: client,
      routes: _fakeRoutes,
    );
    final adapter = WorkerBackedEditSubmitter(
      worker: worker,
      fallback: (_) async => fail('no debía caer en legacy'),
    );
    await adapter.submit(
      LibraryRequest.moveSong(songId: _songId, folderId: _folderId),
    );
    expect(posts, hasLength(1));
    expect(posts[0]['action'], 'move_song');
    expect(posts[0]['if_match'], 10);
    final params = posts[0]['params'] as Map;
    expect(params['song_id'], _songId);
    expect(params['folder_id'], _folderId);
  });

  test('order_album se traduce a reorder_folder con order', () async {
    Map<String, Object?>? edit;
    final client = MockClient((request) async {
      if (request.method == 'GET') {
        return http.Response(
          jsonEncode({'version': 1, 'folders': [], 'songs': []}),
          200,
          headers: {'etag': 'W/"v1"'},
        );
      }
      edit = jsonDecode(request.body) as Map<String, Object?>;
      return http.Response(
        jsonEncode({'ok': true, 'version': 2, 'event': {}}),
        200,
      );
    });
    final worker = WorkerCatalogClient(
      auth: _authStoreWith('s'),
      client: client,
      routes: _fakeRoutes,
    );
    final adapter = WorkerBackedEditSubmitter(
      worker: worker,
      fallback: (_) async => fail('no legacy'),
    );
    await adapter.submit(LibraryRequest.orderAlbum(
      folderId: _folderId,
      songIds: [_songId, 'S3333333333333333'],
    ));
    expect(edit!['action'], 'reorder_folder');
    final params = edit!['params'] as Map;
    expect(params['folder_id'], _folderId);
    expect(params['order'], [_songId, 'S3333333333333333']);
  });

  test('unpublish_song cae al submitter antiguo (no soportado en Worker)', () async {
    var legacyCalled = false;
    final client = MockClient((_) async => fail('no debería llamar al Worker'));
    final worker = WorkerCatalogClient(
      auth: _authStoreWith('s'),
      client: client,
      routes: _fakeRoutes,
    );
    final adapter = WorkerBackedEditSubmitter(
      worker: worker,
      fallback: (request) async {
        legacyCalled = true;
        expect(request.payload['op'], 'unpublish_song');
        return const EditReceipt(message: 'legacy ok');
      },
    );
    final receipt = await adapter.submit(
      LibraryRequest.unpublishSong(songId: _songId),
    );
    expect(legacyCalled, isTrue);
    expect(receipt.message, 'legacy ok');
  });

  test('create_folder con artist cae a legacy; sin artist va al Worker', () async {
    final clientHits = <String>[];
    final client = MockClient((request) async {
      if (request.method == 'GET') {
        return http.Response(
          jsonEncode({'version': 1, 'folders': [], 'songs': []}),
          200,
          headers: {'etag': 'W/"v1"'},
        );
      }
      clientHits.add(request.url.path);
      return http.Response(
        jsonEncode({'ok': true, 'version': 2, 'event': {}}),
        200,
      );
    });
    final worker = WorkerCatalogClient(
      auth: _authStoreWith('s'),
      client: client,
      routes: _fakeRoutes,
    );
    var legacyHits = 0;
    final adapter = WorkerBackedEditSubmitter(
      worker: worker,
      fallback: (_) async {
        legacyHits++;
        return const EditReceipt(message: 'legacy');
      },
    );
    // Con artista → legacy
    await adapter.submit(
      LibraryRequest.createAlbum(name: 'Álbum', artist: 'Pepe'),
    );
    expect(legacyHits, 1);
    expect(clientHits, isEmpty);
    // Sin artista → Worker
    await adapter.submit(
      LibraryRequest.createAlbum(name: 'Otro', artist: ''),
    );
    expect(legacyHits, 1); // sigue siendo 1
    expect(clientHits, ['/api/catalogo/edit']);
  });

  test('401 del Worker propaga AuthRequiredException', () async {
    final client = MockClient((request) async {
      if (request.method == 'GET') {
        return http.Response(
          jsonEncode({'version': 0, 'folders': [], 'songs': []}),
          200,
          headers: {'etag': 'W/"v0"'},
        );
      }
      return http.Response(
        jsonEncode({'ok': false, 'error': 'Falta X-Auth.'}),
        401,
        headers: {'content-type': 'application/json'},
      );
    });
    final worker = WorkerCatalogClient(
      auth: _authStoreWith('malpass'),
      client: client,
      routes: _fakeRoutes,
    );
    final adapter = WorkerBackedEditSubmitter(
      worker: worker,
      fallback: (_) async => fail('no debía caer en legacy'),
    );
    await expectLater(
      adapter.submit(LibraryRequest.editSong(
        songId: _songId,
        title: 'x',
        artist: 'y',
      )),
      throwsA(isA<AuthRequiredException>()),
    );
  });
}
