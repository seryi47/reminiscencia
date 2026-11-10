import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/collections.dart';
import 'package:reminiscencia/ui/song_row.dart';

import 'support/fakes.dart';

/// Abre el menú de la fila de [title] y toca [action].
Future<void> tapSongMenu(
  WidgetTester tester,
  String title,
  String action,
) async {
  await tester.tap(find.byTooltip('Más opciones de «$title»').first);
  await tester.pumpAndSettle();
  await tester.tap(find.text(action));
  await tester.pumpAndSettle();
}

/// Va a Tu biblioteca y abre la colección [name].
Future<void> openFromLibrary(WidgetTester tester, String name) async {
  await tester.tap(find.text('Tu biblioteca'));
  await settle(tester);
  await tester.tap(find.text(name).last);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'marcar «Me gusta» desde el menú de una fila la muestra en «Canciones que te gustan»',
    (tester) async {
      setWindow(tester, const Size(400, 800));
      final t = buildTestServices(songs: [fakeSong('s1'), fakeSong('s2')]);
      await pumpApp(tester, t.services);

      await openFromLibrary(tester, 'Todas las canciones');
      expect(find.byType(SongRow), findsNWidgets(2));
      await tapSongMenu(tester, 'Canción s1', 'Añadir a Me gusta');
      expect(t.services.collections.isFavorite('s1'), isTrue);
      expect(t.repository.writes, 1);

      await tester.tap(find.byTooltip('Volver'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Canciones que te gustan').last);
      await tester.pumpAndSettle();
      expect(find.byType(SongRow), findsOneWidget);
      expect(
        find.descendant(
          of: find.byType(SongRow),
          matching: find.text('Canción s1'),
        ),
        findsOneWidget,
      );
    },
  );

  testWidgets('el corazón del minirreproductor marca «Me gusta» la que suena', (
    tester,
  ) async {
    setWindow(tester, const Size(400, 800));
    final t = buildTestServices(songs: [fakeSong('s1')]);
    await pumpApp(tester, t.services);
    t.playback.cue(t.services.library.songs, 0);
    await settle(tester);

    await tester.tap(find.byTooltip('Añadir a Me gusta'));
    await settle(tester);
    expect(t.services.collections.isFavorite('s1'), isTrue);
    expect(find.byTooltip('Quitar de Me gusta'), findsOneWidget);
  });

  testWidgets('añadir una canción a una lista desde el menú de la fila', (
    tester,
  ) async {
    setWindow(tester, const Size(400, 800));
    final t = buildTestServices(
      songs: [fakeSong('s1')],
      collections: Collections(
        playlists: [Playlist(id: 'p1', name: 'Domingo')],
      ),
    );
    await pumpApp(tester, t.services);

    await openFromLibrary(tester, 'Todas las canciones');
    await tapSongMenu(tester, 'Canción s1', 'Añadir a una lista');
    await tester.tap(find.text('Domingo'));
    await settle(tester);

    expect(t.services.collections.data.playlistOrNull('p1')!.songIds, ['s1']);
    expect(find.text('Añadida a «Domingo».'), findsOneWidget);
  });

  testWidgets('quitar una canción de una lista desde la página de la lista', (
    tester,
  ) async {
    setWindow(tester, const Size(400, 800));
    final t = buildTestServices(
      songs: [fakeSong('s1'), fakeSong('s2')],
      collections: Collections(
        playlists: [
          Playlist(id: 'p1', name: 'Domingo', songIds: ['s1', 's2']),
        ],
      ),
    );
    await pumpApp(tester, t.services);

    await openFromLibrary(tester, 'Domingo');
    expect(find.byType(SongRow), findsNWidgets(2));
    expect(find.byKey(const Key('collection-play')), findsOneWidget);
    await tapSongMenu(tester, 'Canción s1', 'Quitar de esta lista');

    expect(t.services.collections.data.playlistOrNull('p1')!.songIds, ['s2']);
    expect(find.byType(SongRow), findsOneWidget);
  });

  testWidgets(
    'crear una lista: un nombre vacío muestra el error y uno válido la crea y la abre',
    (tester) async {
      setWindow(tester, const Size(400, 800));
      final t = buildTestServices(songs: [fakeSong('s1')]);
      await pumpApp(tester, t.services);

      await tester.tap(find.text('Tu biblioteca'));
      await settle(tester);
      await tester.tap(find.byTooltip('Crear')); // menú «Crear» (lista / transferir música)
      await settle(tester);
      await tester.tap(find.text('Crear lista').last);
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
      // Se abre la página de la lista nueva, vacía.
      expect(
        find.text('La lista está vacía. Usa «Añadir canciones».'),
        findsOneWidget,
      );
      expect(find.byTooltip('Añadir canciones'), findsOneWidget);
    },
  );
}
