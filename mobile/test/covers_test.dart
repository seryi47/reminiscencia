import 'dart:io';

import 'package:flutter/painting.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:reminiscencia/covers.dart';
import 'package:reminiscencia/library_controller.dart';
import 'package:reminiscencia/offline_choice.dart';
import 'package:reminiscencia/song.dart';

import 'support/fakes.dart';

class _Offline implements OfflineChoice {
  _Offline(this.value);
  bool value;
  @override
  Future<bool> read() async => value;
  @override
  Future<void> write(bool value) async => this.value = value;
}

/// Espera a que terminen las descargas lanzadas en segundo plano por imageFor.
Future<void> _drain() async {
  for (var i = 0; i < 20; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

void main() {
  group('rutas de portada', () {
    test('acepta covers/<id>.jpg y rechaza todo lo demás', () {
      expect(
        cleanCoverPath('covers/S5aac103b6eb2ecf4.jpg'),
        'covers/S5aac103b6eb2ecf4.jpg',
      );
      expect(cleanCoverPath('covers/0123456789.jpg'), 'covers/0123456789.jpg');
      expect(cleanCoverPath(' covers/a.png '), 'covers/a.png');
      for (final bad in [
        null,
        42,
        '',
        'covers/',
        'covers/../data/songs.json',
        'covers/a/b.jpg',
        'https://evil.example/covers/a.jpg',
        '/covers/a.jpg',
        'audio/S1.jpg',
        'covers/a.jpg?x=1',
        'covers/a.gif',
        'covers/a b.jpg',
      ]) {
        expect(cleanCoverPath(bad), isNull, reason: '$bad');
      }
    });

    test(
      'la canción y el álbum leen la portada y el artista (todo opcional)',
      () {
        final song = Song.fromJson({
          'id': 'S5aac103b6eb2ecf4',
          'title': 'Charleston',
          'duration_s': 200,
          'audio': 'audio/S5aac103b6eb2ecf4.opus',
          'cover': 'covers/S5aac103b6eb2ecf4.jpg',
        });
        expect(song.cover, 'covers/S5aac103b6eb2ecf4.jpg');
        final noCover = Song.fromJson({
          'id': 'S1',
          'title': 'x',
          'duration_s': 1,
          'audio': 'audio/S1.opus',
          'cover': '../secreto.jpg',
        });
        expect(noCover.cover, isNull);

        final album = Folder.fromJson({
          'id': '0123456789',
          'name': 'Jazz de los años 20',
          'parent_id': null,
          'artist': ' Bessie Smith ',
          'cover': 'covers/0123456789.jpg',
        });
        expect(album.artist, 'Bessie Smith');
        expect(album.cover, 'covers/0123456789.jpg');
        final plain = Folder.fromJson({
          'id': 'f1',
          'name': 'Jazz',
          'parent_id': null,
        });
        expect(plain.artist, '');
        expect(plain.cover, isNull);
      },
    );

    test('prunableCovers deja solo las que el catálogo ya no usa', () {
      expect(
        prunableCovers(
          cached: ['covers/a.jpg', 'covers/b.jpg'],
          keep: {'covers/a.jpg'},
        ),
        {'covers/b.jpg'},
      );
    });
  });

  group('caché en disco', () {
    late Directory temp;
    late List<http.Request> requests;
    late int status;
    late List<int> body;
    late Map<String, String> headers;

    setUp(() async {
      temp = await Directory.systemTemp.createTemp('portadas');
      requests = [];
      status = 200;
      body = kTinyPng;
      headers = {'etag': '"v1"', 'content-type': 'image/png'};
    });
    tearDown(() async => temp.delete(recursive: true));

    CoverCache cache({http.Client? client}) => CoverCache(
      root: () async => temp,
      base: 'https://web.test/',
      client:
          client ??
          MockClient((request) async {
            requests.add(request);
            return http.Response.bytes(body, status, headers: headers);
          }),
    );

    test('descarga una vez, avisa al terminar y no repite', () async {
      final covers = cache();
      await covers.init();
      var notified = 0;
      covers.addListener(() => notified++);

      expect(covers.imageFor('covers/S1.jpg'), isNull);
      expect(covers.imageFor('covers/S1.jpg'), isNull);
      // ensure comparte la descarga que ya lanzó imageFor: no hace otra petición.
      expect(await covers.ensure('covers/S1.jpg'), isTrue);
      expect(requests, hasLength(1));
      expect(requests.single.url.toString(), 'https://web.test/covers/S1.jpg');
      expect(notified, 1);
      final image = covers.imageFor('covers/S1.jpg');
      expect(image, isA<FileImage>());
      expect(await (image! as FileImage).file.readAsBytes(), kTinyPng);
      expect(requests, hasLength(1));
    });

    test(
      'se ve sin red en la siguiente apertura: el índice se guarda en disco',
      () async {
        final first = cache();
        await first.init();
        expect(await first.ensure('covers/S1.jpg'), isTrue);

        final offline = cache(
          client: MockClient(
            (_) async => throw const SocketException('sin red'),
          ),
        );
        await offline.init();
        expect(offline.imageFor('covers/S1.jpg'), isA<FileImage>());
        expect(offline.fileFor('covers/S1.jpg')!.existsSync(), isTrue);
      },
    );

    test(
      'un fallo no se reintenta en bucle: espera a la próxima sincronización',
      () async {
        status = 404;
        final covers = cache();
        await covers.init();
        expect(covers.imageFor('covers/S1.jpg'), isNull);
        expect(await covers.ensure('covers/S1.jpg'), isFalse);
        expect(covers.imageFor('covers/S1.jpg'), isNull);
        expect(await covers.ensure('covers/S1.jpg'), isFalse);
        await _drain();
        expect(requests, hasLength(1));

        status = 200;
        covers.resetFailures();
        expect(await covers.ensure('covers/S1.jpg'), isTrue);
        expect(requests, hasLength(2));
      },
    );

    test('rechaza una respuesta vacía o demasiado grande', () async {
      body = const [];
      final covers = cache();
      await covers.init();
      expect(await covers.ensure('covers/S1.jpg'), isFalse);
      covers.resetFailures();
      body = List<int>.filled(kMaxCoverBytes + 1, 0);
      expect(await covers.ensure('covers/S1.jpg'), isFalse);
      expect(covers.cachedPaths, isEmpty);
    });

    test('no pide rutas que no son portadas', () async {
      final covers = cache();
      await covers.init();
      expect(covers.imageFor('https://evil.example/x.jpg'), isNull);
      expect(await covers.ensure('covers/../x.jpg'), isFalse);
      await _drain();
      expect(requests, isEmpty);
    });

    test(
      'refrescar pregunta con If-None-Match: 304 conserva el fichero; 200 lo cambia por uno nuevo',
      () async {
        final covers = cache();
        await covers.init();
        await covers.ensure('covers/S1.jpg');
        final before = covers.fileFor('covers/S1.jpg')!;

        status = 304;
        body = const [];
        await covers.revalidate(['covers/S1.jpg', 'covers/sin-guardar.jpg']);
        expect(requests, hasLength(2), reason: 'solo se revalida la guardada');
        expect(requests.last.headers['If-None-Match'], '"v1"');
        expect(covers.fileFor('covers/S1.jpg')!.path, before.path);

        status = 200;
        body = [...kTinyPng, 0];
        headers = {'etag': '"v2"'};
        await covers.revalidate(['covers/S1.jpg']);
        final after = covers.fileFor('covers/S1.jpg')!;
        expect(
          after.path,
          isNot(before.path),
          reason: 'nombre nuevo: la imagen en memoria no queda vieja',
        );
        expect(before.existsSync(), isFalse);
        expect(after.readAsBytesSync(), body);
      },
    );

    test('un fallo al revalidar conserva la portada guardada', () async {
      final covers = cache();
      await covers.init();
      await covers.ensure('covers/S1.jpg');
      status = 500;
      await covers.revalidate(['covers/S1.jpg']);
      expect(covers.fileFor('covers/S1.jpg')!.existsSync(), isTrue);
    });

    test(
      'downloadAll descarga lo que falta y prune borra lo retirado',
      () async {
        final covers = cache();
        await covers.init();
        expect(
          await covers.downloadAll([
            'covers/a.jpg',
            'covers/b.jpg',
            'covers/a.jpg',
          ]),
          2,
        );
        expect(await covers.downloadAll(['covers/a.jpg']), 0);
        final b = covers.fileFor('covers/b.jpg')!;
        await covers.prune({'covers/a.jpg'});
        expect(covers.cachedPaths, {'covers/a.jpg'});
        expect(b.existsSync(), isFalse);
      },
    );
  });

  group('sincronización y portadas', () {
    final songs = [fakeSong('s1', cover: 'covers/s1.jpg'), fakeSong('s2')];
    final folders = [
      const Folder(
        id: 'f1',
        name: 'Jazz',
        parentId: null,
        cover: 'covers/f1.jpg',
      ),
    ];

    test(
      'con red: reintenta lo fallido y borra las portadas retiradas, sin descargar nada',
      () async {
        final t = buildTestServices(songs: songs, folders: folders);
        await t.services.library.load();
        expect(t.coverStore.log, ['reset', 'prune']);
        expect(t.coverStore.lastKeep, {'covers/s1.jpg', 'covers/f1.jpg'});
      },
    );

    test('con la copia guardada (sin red) no toca las portadas', () async {
      final t = buildTestServices(songs: songs, folders: folders);
      t.source.fromNetwork = false;
      await t.services.library.load();
      expect(t.coverStore.log, isEmpty);
    });

    test(
      '«sin conexión» descarga también las portadas, con cualquier conexión',
      () async {
        final source = FakeLibrarySource(songs: songs, folders: folders);
        final store = FakeCoverStore();
        final library = LibraryController(
          source: source,
          playback: FakePlaybackPort(),
          offline: _Offline(true),
          covers: store,
        );
        await library.load();
        expect(store.log.last, 'download');
        expect(store.lastDownload, ['covers/f1.jpg', 'covers/s1.jpg']);
      },
    );

    test('guardar sin conexión a mano descarga audio y portadas', () async {
      final t = buildTestServices(songs: songs, folders: folders);
      await t.services.library.load();
      await t.services.library.downloadForOffline();
      expect(t.source.downloadCalls, hasLength(1));
      expect(t.coverStore.lastDownload, ['covers/f1.jpg', 'covers/s1.jpg']);
    });

    test('refrescar a mano revalida las portadas; abrir la app no', () async {
      final t = buildTestServices(songs: songs, folders: folders);
      await t.services.library.ensureLoaded();
      expect(t.coverStore.log, isNot(contains('revalidate')));
      await t.services.library.refresh();
      expect(t.coverStore.log.last, 'revalidate');
      expect(t.coverStore.lastRevalidate, ['covers/f1.jpg', 'covers/s1.jpg']);
    });

    test('songOrNull encuentra la canción que suena', () async {
      final t = buildTestServices(songs: songs);
      await t.services.library.load();
      expect(t.services.library.songOrNull('s1')?.cover, 'covers/s1.jpg');
      expect(t.services.library.songOrNull('nada'), isNull);
      expect(t.services.library.songOrNull(null), isNull);
    });
  });
}
