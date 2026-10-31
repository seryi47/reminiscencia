import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/app_error.dart';
import 'package:reminiscencia/collections.dart';
import 'package:reminiscencia/collections_controller.dart';
import 'package:reminiscencia/collections_store.dart';

import 'support/fakes.dart';

void main() {
  test('los cambios se guardan y se recuperan al volver a abrir', () async {
    final repository = MemoryCollectionsRepository();
    var ids = 0;
    final controller = CollectionsController(
      repository: repository,
      newId: () => 'p${++ids}',
    );
    await controller.load();

    expect(await controller.toggleFavorite('s1'), isTrue);
    final playlist = await controller.createPlaylist('  Domingo  ');
    expect(await controller.addSong(playlist.id, 's1'), isTrue);
    expect(repository.writes, 3);

    final reopened = CollectionsController(repository: repository);
    await reopened.load();
    expect(reopened.data.favorites, ['s1']);
    expect(reopened.data.playlists.single.name, 'Domingo');
    expect(reopened.data.playlists.single.songIds, ['s1']);
  });

  test(
    'si lo guardado no se puede leer, no se permite ningún cambio para no pisar datos',
    () async {
      final repository = MemoryCollectionsRepository()
        ..readError = const FormatException('JSON roto');
      final controller = CollectionsController(repository: repository);
      await controller.load();

      expect(controller.loadError, isNotNull);
      await expectLater(
        controller.toggleFavorite('s1'),
        throwsA(isA<AppException>()),
      );
      expect(repository.writes, 0);
    },
  );

  test('si falla el guardado, el usuario recibe un aviso', () async {
    final repository = MemoryCollectionsRepository()
      ..writeError = const FileSystemException('disco lleno');
    final controller = CollectionsController(
      repository: repository,
      newId: () => 'p1',
    );
    await controller.load();

    await expectLater(
      controller.createPlaylist('Jazz'),
      throwsA(isA<AppException>()),
    );
  });

  test('un nombre no válido no cambia nada y avisa', () async {
    final repository = MemoryCollectionsRepository();
    final controller = CollectionsController(repository: repository);
    await controller.load();

    await expectLater(
      controller.createPlaylist('   '),
      throwsA(isA<AppException>()),
    );
    expect(controller.data.playlists, isEmpty);
    expect(repository.writes, 0);
  });

  test('FileCollectionsRepository guarda y lee un JSON en disco', () async {
    final dir = Directory.systemTemp.createTempSync('listas_test');
    addTearDown(() => dir.deleteSync(recursive: true));
    final file = File('${dir.path}/colecciones.json');
    final repository = FileCollectionsRepository(file: () async => file);

    expect((await repository.read()).favorites, isEmpty);

    await repository.write(
      Collections(
        favorites: ['s1'],
        playlists: [
          Playlist(id: 'p1', name: 'Jazz', songIds: ['s2']),
        ],
      ),
    );
    final back = await repository.read();
    expect(back.favorites, ['s1']);
    expect(back.playlists.single.songIds, ['s2']);
    expect(file.existsSync(), isTrue);
    expect(File('${file.path}.tmp').existsSync(), isFalse);
  });
}
