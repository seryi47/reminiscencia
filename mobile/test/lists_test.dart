import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/collections.dart';
import 'package:reminiscencia/ui/song_tile.dart';

import 'support/fakes.dart';

void main() {
  testWidgets('marcar una canción como favorita la muestra en Favoritos', (
    tester,
  ) async {
    setWindow(tester, const Size(400, 800));
    final t = buildTestServices(songs: [fakeSong('s1'), fakeSong('s2')]);
    await pumpApp(tester, t.services);

    await tester.tap(find.byTooltip('Añadir a favoritos').first);
    await settle(tester);
    expect(t.services.collections.isFavorite('s1'), isTrue);
    expect(t.repository.writes, 1);

    await tester.tap(find.text('Favoritos'));
    await settle(tester);
    expect(find.byType(SongTile), findsOneWidget);
    expect(
      find.descendant(
        of: find.byType(SongTile),
        matching: find.text('Canción s1'),
      ),
      findsOneWidget,
    );
  });

  testWidgets('añadir una canción a una lista desde Escuchar', (tester) async {
    setWindow(tester, const Size(400, 800));
    final t = buildTestServices(
      songs: [fakeSong('s1')],
      collections: Collections(
        playlists: [Playlist(id: 'p1', name: 'Domingo')],
      ),
    );
    await pumpApp(tester, t.services);

    await tester.tap(find.byTooltip('Añadir a una lista'));
    await settle(tester);
    await tester.tap(find.text('Domingo'));
    await settle(tester);

    expect(t.services.collections.data.playlistOrNull('p1')!.songIds, ['s1']);
    expect(find.text('Añadida a «Domingo».'), findsOneWidget);
  });

  testWidgets(
    'crear una lista: un nombre vacío muestra el error y uno válido la crea',
    (tester) async {
      setWindow(tester, const Size(400, 800));
      final t = buildTestServices(songs: [fakeSong('s1')]);
      await pumpApp(tester, t.services);

      await tester.tap(find.text('Listas'));
      await settle(tester);
      await tester.tap(find.text('Nueva lista'));
      await settle(tester);

      await tester.enterText(find.byType(TextField), '   ');
      await tester.tap(find.text('Crear'));
      await settle(tester);
      expect(find.text('Escribe un nombre para la lista.'), findsOneWidget);

      await tester.enterText(find.byType(TextField), 'Domingo');
      await tester.tap(find.text('Crear'));
      await tester.pumpAndSettle();

      expect(
        t.services.collections.data.playlists.map((playlist) => playlist.name),
        ['Domingo'],
      );
      expect(find.text('Domingo'), findsOneWidget);
    },
  );
}
