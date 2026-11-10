import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/song.dart';

import 'support/fakes.dart';

// Regresión del bug reportado: al pulsar «Aleatorio» dentro de un álbum, a veces sonaban canciones de OTROS álbumes.
// El botón debe reproducir en aleatorio SOLO las canciones de ese álbum (la cola pasa a ser ese álbum).

const albumId = 'F0123456789abcdef';
const otherAlbumId = 'Ffedcba9876543210';

Song _song(String id, String title, {String? folderId, int? track}) => Song(
  id: id,
  title: title,
  artist: 'Marea',
  year: null,
  tags: const [],
  folderId: folderId,
  durationS: 201,
  license: 'CC0',
  audio: 'audio/$id.opus',
  track: track,
);

void main() {
  testWidgets('el aleatorio de un álbum reproduce solo las canciones de ese álbum', (tester) async {
    setWindow(tester, const Size(500, 1400));
    final songs = [
      _song('S000000000000001', 'Alfa', folderId: albumId, track: 1),
      _song('S000000000000002', 'Beta', folderId: albumId, track: 2),
      _song('S000000000000003', 'Gamma', folderId: albumId, track: 3),
      // Canciones de OTRO álbum: nunca deben entrar en la cola al barajar «Fiesta».
      _song('S0000000000000a1', 'Otra uno', folderId: otherAlbumId),
      _song('S0000000000000a2', 'Otra dos', folderId: otherAlbumId),
    ];
    const folders = [
      Folder(id: albumId, name: 'Fiesta', parentId: null),
      Folder(id: otherAlbumId, name: 'Buga', parentId: null),
    ];
    final t = buildTestServices(songs: songs, folders: folders);
    await pumpApp(tester, t.services);

    await tester.tap(find.text('Fiesta').last);
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('collection-shuffle')));
    await tester.pumpAndSettle();

    // Reprodujo el álbum y activó el aleatorio.
    expect(t.playback.log, contains('play:0'));
    expect(t.playback.log, contains('shuffle:true'));
    // La cola es EXCLUSIVAMENTE el álbum abierto: ni rastro de las canciones del otro álbum.
    expect(t.playback.queueSongIds, {
      'S000000000000001',
      'S000000000000002',
      'S000000000000003',
    });
  });
}
