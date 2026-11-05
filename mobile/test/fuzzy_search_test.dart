import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/fuzzy_search.dart';
import 'package:reminiscencia/song.dart';
import 'package:reminiscencia/ui/collection_page.dart';

import 'support/fakes.dart';

Song _song(String id, String title, String artist) => Song(
  id: id,
  title: title,
  artist: artist,
  year: null,
  tags: const [],
  folderId: null,
  durationS: 100,
  license: '',
  audio: 'audio/$id.opus',
);

void main() {
  test('distancia de edición con letras intercambiadas', () {
    expect(editDistance('keo', 'keo'), 0);
    expect(editDistance('kid', 'kidd'), 1);
    expect(editDistance('keo', 'koe'), 1);
  });

  test('«kid keo» encuentra «Kidd Keo» y las erratas se perdonan', () {
    expect(fuzzyMatches('SUPERSTARS Kidd Keo', 'kid keo'), isTrue);
    expect(fuzzyMatches('Charleston Orquesta', 'charlston'), isTrue);
    expect(fuzzyMatches('Charleston Orquesta', 'xyz'), isFalse);
    expect(fuzzyMatches('Kidd Keo', 'kxo'), isFalse);
    expect(fuzzyMatches('Kidd Keo', 'kid pepe'), isFalse);
  });

  test('filterSongsByText conserva el orden y filtra por artista', () {
    final songs = [
      _song('a', 'SUPERSTARS', 'Kidd Keo'),
      _song('b', 'Olvídate', 'Kidd Keo'),
      _song('c', 'Charleston', 'Orquesta'),
    ];
    expect(filterSongsByText(songs, 'kid keo').map((s) => s.id), ['a', 'b']);
    expect(filterSongsByText(songs, 'olvidate').map((s) => s.id), ['b']);
    expect(filterSongsByText(songs, '  '), songs);
    expect(filterSongsByText(songs, 'zzzzzz'), isEmpty);
  });

  test(
    'una sincronización con canción nueva no corta un stream de YouTube',
    () async {
      final t = buildTestServices(
        songs: [_song('S0000000000000001', 'Uno', 'A')],
      );
      await t.services.library.load();
      await t.playback.playStream(
        id: 'abc',
        title: 'Tema',
        artist: 'Canal',
        uri: Uri.parse('https://example.com/a.m4a'),
      );
      t.playback.log.clear();
      t.source.songs = [
        _song('S0000000000000001', 'Uno', 'A'),
        _song('S0000000000000002', 'Dos', 'A'),
      ];
      await t.services.library.refresh();
      expect(t.playback.log.where((e) => e.startsWith('load')), isEmpty);
      expect(t.playback.nowPlaying.value.songId, 'yt-abc');
      expect(t.playback.nowPlaying.value.playing, isTrue);
    },
  );

  group('filtro de colección', () {
    testWidgets('aparece con 6 canciones o más y filtra', (tester) async {
      setWindow(tester, const Size(400, 900));
      final songs = [
        for (var i = 0; i < 7; i++)
          _song(
            'S000000000000000$i',
            i == 3 ? 'Charleston' : 'Tema $i',
            'Kidd Keo',
          ),
      ];
      final t = buildTestServices(songs: songs);
      await pumpApp(tester, t.services);
      await tester.tap(find.text('Tu biblioteca'));
      await settle(tester);
      await tester.tap(find.text('Todas las canciones'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('collection-filter')), findsOneWidget);
      await tester.enterText(
        find.byKey(const Key('collection-filter')),
        'charlston',
      );
      await settle(tester);
      Finder inPage(String text) => find.descendant(
        of: find.byType(CollectionPage),
        matching: find.text(text),
      );
      expect(inPage('Charleston'), findsOneWidget);
      expect(inPage('Tema 0'), findsNothing);
      await tester.enterText(
        find.byKey(const Key('collection-filter')),
        'zzzzzz',
      );
      await settle(tester);
      expect(find.textContaining('Ninguna canción coincide'), findsOneWidget);
    });

    testWidgets('con pocas canciones no hay filtro', (tester) async {
      setWindow(tester, const Size(400, 900));
      final t = buildTestServices(songs: [fakeSong('S0000000000000001')]);
      await pumpApp(tester, t.services);
      await tester.tap(find.text('Tu biblioteca'));
      await settle(tester);
      await tester.tap(find.text('Todas las canciones'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('collection-filter')), findsNothing);
    });
  });
}
