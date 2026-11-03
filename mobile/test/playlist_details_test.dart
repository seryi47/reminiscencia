import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:reminiscencia/app_error.dart';
import 'package:reminiscencia/collections.dart';
import 'package:reminiscencia/collections_controller.dart';
import 'package:reminiscencia/playlist_covers.dart';

import 'support/fakes.dart';

Uint8List photo(int width, int height) =>
    img.encodeJpg(img.Image(width: width, height: height));

void main() {
  group('descripción y portada de las listas', () {
    test(
      'editar cambia nombre y descripción; la descripción admite saltos y se limita a 300',
      () {
        final data = Collections();
        data.createPlaylist(id: 'a', name: 'Tardes');
        data.editPlaylist(
          'a',
          name: '  Tardes   de  domingo ',
          description: '  Para merendar.\n\n\n\nCon café ',
        );
        final list = data.playlistOrNull('a')!;
        expect(list.name, 'Tardes de domingo');
        expect(list.description, 'Para merendar.\n\nCon café');
        expect(
          () => data.editPlaylist('a', name: 'x', description: 'd' * 301),
          throwsA(isA<AppException>()),
        );
        expect(
          () => data.editPlaylist('a', name: ' ', description: ''),
          throwsA(isA<AppException>()),
        );
        expect(
          data.playlistOrNull('a')!.name,
          'Tardes de domingo',
          reason: 'un fallo no cambia nada',
        );
      },
    );

    test(
      'se guardan y se leen la descripción y la portada; una portada rara se descarta',
      () {
        final data = Collections();
        data.createPlaylist(id: 'a', name: 'Tardes');
        data.editPlaylist('a', name: 'Tardes', description: 'Con café');
        data.setPlaylistCover('a', 'a-1.jpg');
        final back = Collections.fromJson(data.toJson());
        expect(back.playlistOrNull('a')!.description, 'Con café');
        expect(back.playlistOrNull('a')!.coverFile, 'a-1.jpg');

        final odd = Collections.fromJson({
          'playlists': [
            {'id': 'b', 'name': 'B', 'cover': '../../etc/passwd', 'songs': []},
          ],
        });
        expect(odd.playlistOrNull('b')!.coverFile, isNull);
        expect(
          () => data.setPlaylistCover('a', '../x.jpg'),
          throwsArgumentError,
        );
      },
    );

    test(
      'las listas guardadas antes (sin descripción ni portada) se siguen leyendo',
      () {
        final old = Collections.fromJson({
          'version': 1,
          'favorites': ['s1'],
          'playlists': [
            {
              'id': 'a',
              'name': 'Vieja',
              'songs': ['s1'],
            },
          ],
        });
        final list = old.playlistOrNull('a')!;
        expect(list.description, '');
        expect(list.coverFile, isNull);
        expect(list.toJson(), {
          'id': 'a',
          'name': 'Vieja',
          'songs': ['s1'],
        });
      },
    );

    test(
      'el controlador guarda la portada, borra la anterior y la borra con la lista',
      () async {
        final store = MemoryPlaylistCoverStore();
        final controller = CollectionsController(
          repository: MemoryCollectionsRepository(),
          covers: store,
          newId: () => 'a',
        );
        await controller.load();
        await controller.createPlaylist('Tardes');

        await controller.setPlaylistCover('a', photo(10, 10));
        final first = controller.data.playlistOrNull('a')!.coverFile!;
        await controller.setPlaylistCover('a', photo(10, 10));
        final second = controller.data.playlistOrNull('a')!.coverFile!;
        expect(second, isNot(first));
        expect(store.deleted, [first]);
        expect(
          controller.coverFileOf(controller.data.playlistOrNull('a')!)!.path,
          endsWith(second),
        );

        await controller.removePlaylistCover('a');
        expect(controller.data.playlistOrNull('a')!.coverFile, isNull);
        expect(store.deleted, [first, second]);

        await controller.setPlaylistCover('a', photo(10, 10));
        final third = controller.data.playlistOrNull('a')!.coverFile!;
        await controller.deletePlaylist('a');
        expect(store.deleted.last, third);
      },
    );

    test(
      'sin poder leer las listas guardadas no se guarda ninguna portada',
      () async {
        final repository = MemoryCollectionsRepository()
          ..readError = const FormatException('roto');
        final store = MemoryPlaylistCoverStore();
        final controller = CollectionsController(
          repository: repository,
          covers: store,
        );
        await controller.load();
        await expectLater(
          controller.setPlaylistCover('a', photo(4, 4)),
          throwsA(isA<AppException>()),
        );
        expect(store.files, isEmpty);
      },
    );
  });

  group('reducción a 640 px', () {
    test(
      'una foto grande se recorta al centro en cuadrado y queda en 640×640 JPEG',
      () {
        final out = resizeCoverImage(photo(1600, 1200));
        final decoded = img.decodeJpg(out)!;
        expect(decoded.width, 640);
        expect(decoded.height, 640);
      },
    );

    test('una imagen pequeña no se amplía', () {
      final decoded = img.decodeJpg(resizeCoverImage(photo(300, 200)))!;
      expect(decoded.width, 200);
      expect(decoded.height, 200);
    });

    test('lo que no es una imagen se rechaza con un motivo', () {
      expect(
        () => resizeCoverImage(Uint8List.fromList([1, 2, 3])),
        throwsA(isA<AppException>()),
      );
    });

    test(
      'se guarda solo en el teléfono, en listas-portadas, y se puede borrar',
      () async {
        final root = await Directory.systemTemp.createTemp(
          'reminiscencia_portadas_',
        );
        addTearDown(() => root.delete(recursive: true));
        final store = FilePlaylistCoverStore(
          root: () async => Directory('${root.path}/$kPlaylistCoverDirName'),
        );
        await store.init();
        final name = await store.save('lista1', photo(1000, 800));
        expect(kPlaylistCoverFileName.hasMatch(name), isTrue);
        final file = store.fileFor(name)!;
        expect(file.path, contains('/listas-portadas/'));
        expect(img.decodeJpg(file.readAsBytesSync())!.width, 640);
        await store.delete(name);
        expect(file.existsSync(), isFalse);
      },
    );
  });
}
