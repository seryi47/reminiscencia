import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/song.dart';

void main() {
  test('Song lee el catálogo público de la web', () {
    final song = Song.fromJson({
      'id': 'S5aac103b6eb2ecf4',
      'title': 'Charleston (Fox Trot)',
      'artist': '',
      'year': null,
      'tags': ['jazz'],
      'folder_id': null,
      'duration_s': 242.416,
      'license': 'Dominio público',
      'audio': 'audio/S5aac103b6eb2ecf4.opus',
    });
    expect(song.title, 'Charleston (Fox Trot)');
    expect(song.durationS, closeTo(242.4, 0.1));
    expect(song.tags, ['jazz']);
    expect(song.folderId, isNull);
  });

  test('Song acepta año y carpeta cuando existen', () {
    final song = Song.fromJson({
      'id': 'S1',
      'title': 'Pista',
      'artist': 'Artista',
      'year': 1925,
      'tags': <String>[],
      'folder_id': 'f1',
      'duration_s': 180,
      'license': 'CC0',
      'audio': 'audio/S1.opus',
    });
    expect(song.year, 1925);
    expect(song.folderId, 'f1');
    expect(song.durationS, 180.0);
  });

  test('Folder lee el árbol de carpetas', () {
    final folder = Folder.fromJson({'id': 'f2', 'name': 'Jazz', 'parent_id': 'f1'});
    expect(folder.parentId, 'f1');
  });
}
