import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/song.dart';
import 'package:reminiscencia/ui/common.dart';
import 'package:reminiscencia/ui/song_row.dart';

import 'support/fakes.dart';

// Ediciones pendientes en la APK (ADR-0027), como en la web: el cambio se ve al momento con «Pendiente», se confirma
// cuando llega al catálogo y, si el servidor dice que falló, se deshace y se avisa con «Reintentar».

const songId = 'S5aac103b6eb2ecf4';
const otherId = 'S0000000000000001';
const albumId = 'F0123456789abcdef';

Song charleston({String title = 'Charleston'}) => Song(
  id: songId,
  title: title,
  artist: 'Orquesta',
  year: 1925,
  tags: const [],
  folderId: albumId,
  durationS: 185,
  license: 'Dominio público',
  audio: 'audio/$songId.opus',
);

final folders = [
  const Folder(id: albumId, name: 'Jazz', parentId: null, artist: 'Varios'),
];

Finder get badge => find.byKey(const Key('pending-edit-badge'));

Future<void> openAllSongs(WidgetTester tester) async {
  await tester.tap(find.text('Tu biblioteca'));
  await settle(tester);
  await tester.tap(find.text('Todas las canciones'));
  await tester.pumpAndSettle();
}

Future<void> renameCharleston(WidgetTester tester, String title) async {
  await tester.tap(find.byTooltip('Más opciones de «Charleston»'));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Editar detalles'));
  await tester.pumpAndSettle();
  await tester.enterText(find.byKey(const Key('request-field-0')), title);
  await tester.tap(find.text('Guardar'));
  await tester.pumpAndSettle();
}

/// Dispara la revisión programada de las ediciones y deja que termine.
Future<void> runCheck(WidgetTester tester, FakePollTimer timers) async {
  // Los avisos anteriores («Guardando…», «Guardado.») se quitan para ver el nuevo enseguida.
  ScaffoldMessenger.of(
    tester.element(find.byType(Scaffold).first),
  ).clearSnackBars();
  await tester.pumpAndSettle();
  timers.fire();
  for (var i = 0; i < 10; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

void main() {
  testWidgets(
    'pendiente → confirmada: se ve al momento con «Pendiente» y la marca se va al llegar al catálogo',
    (tester) async {
      setWindow(tester, const Size(400, 1000));
      final t = buildTestServices(
        songs: [charleston(), fakeSong(otherId)],
        folders: folders,
      );
      await pumpApp(tester, t.services);
      await openAllSongs(tester);
      await renameCharleston(tester, 'Charleston nuevo');

      expect(t.submitted.single.payload['title'], 'Charleston nuevo');
      final row = find.ancestor(
        of: find.text('Charleston nuevo'),
        matching: find.byType(SongRow),
      );
      expect(row, findsOneWidget, reason: 'El título nuevo se ve ya.');
      expect(find.descendant(of: row, matching: badge), findsOneWidget);
      expect(find.text('Pendiente'), findsOneWidget);
      expect(
        tester.getSemantics(row.first).label,
        contains('cambio pendiente'),
      );
      expect(t.services.library.catalogSongs.first.title, 'Charleston');
      expect(t.editTimers.active.single.period, const Duration(seconds: 20));

      // Volver a pedir lo mismo no se reenvía.
      await tester.tap(find.byTooltip('Más opciones de «Charleston nuevo»'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Editar detalles'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Guardar'));
      await tester.pumpAndSettle();
      expect(t.submitted, hasLength(1));

      // La lista de cambios de Tu biblioteca lo enseña.
      await tester.tap(find.text('Tu biblioteca'));
      await settle(tester);
      expect(find.text('1 cambio pendiente'), findsOneWidget);

      // El workflow lo aplica: el catálogo nuevo lo refleja.
      t.source.songs = [
        charleston(title: 'Charleston nuevo'),
        fakeSong(otherId),
      ];
      t.editStatus.states[1] = 'cerrada';
      await runCheck(tester, t.editTimers);
      expect(
        find.text('Ya está guardado: «Charleston nuevo».'),
        findsOneWidget,
      );
      expect(find.text('1 cambio pendiente'), findsNothing);
      await tester.tap(find.text('Todas las canciones'));
      await tester.pumpAndSettle();
      expect(find.text('Charleston nuevo'), findsOneWidget);
      expect(badge, findsNothing);
      expect(t.editTimers.active, isEmpty);
    },
  );

  testWidgets(
    'pendiente → error: se deshace, se avisa con «Reintentar» y la lista permite reenviarlo',
    (tester) async {
      setWindow(tester, const Size(400, 1000));
      final t = buildTestServices(
        songs: [charleston(), fakeSong(otherId)],
        folders: folders,
      );
      await pumpApp(tester, t.services);
      await openAllSongs(tester);
      await renameCharleston(tester, 'Charleston nuevo');
      expect(find.text('Charleston nuevo'), findsOneWidget);

      t.editStatus.states[1] = 'error';
      await runCheck(tester, t.editTimers);
      expect(find.text('Charleston nuevo'), findsNothing);
      expect(
        find.descendant(
          of: find.byType(SongRow),
          matching: find.text('Charleston'),
        ),
        findsOneWidget,
      );
      expect(badge, findsNothing);
      expect(
        find.text(
          'No se ha podido guardar «Charleston nuevo». Inténtalo de nuevo.',
        ),
        findsOneWidget,
      );
      expect(find.widgetWithText(SnackBarAction, 'Reintentar'), findsOneWidget);

      await tester.tap(find.text('Tu biblioteca'));
      await settle(tester);
      ScaffoldMessenger.of(
        tester.element(find.text('Tu biblioteca').first),
      ).removeCurrentSnackBar();
      await tester.pumpAndSettle();
      await tester.tap(find.text('No se ha podido guardar 1 cambio'));
      await tester.pumpAndSettle();
      final sheet = find.byKey(const Key('pending-edits-sheet'));
      expect(
        find.descendant(of: sheet, matching: find.text('«Charleston nuevo»')),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: sheet,
          matching: find.text(
            'Detalles de la canción · No se ha podido guardar',
          ),
        ),
        findsOneWidget,
      );
      await tester.tap(
        find.descendant(of: sheet, matching: find.text('Reintentar')),
      );
      await tester.pumpAndSettle();
      expect(t.submitted, hasLength(2));
      expect(t.submitted.last.payload, t.submitted.first.payload);
      expect(
        find.descendant(
          of: sheet,
          matching: find.text('Detalles de la canción · Pendiente'),
        ),
        findsOneWidget,
      );
      expect(t.services.library.edits.items.single.issue, 2);
      Navigator.of(tester.element(sheet)).pop();
      await tester.pumpAndSettle();
      expect(find.text('1 cambio pendiente'), findsOneWidget);
    },
  );

  testWidgets(
    'la portada nueva se ve al momento con la vista previa y «Pendiente»',
    (tester) async {
      setWindow(tester, const Size(400, 1000));
      final t = buildTestServices(
        songs: [charleston(), fakeSong(otherId)],
        folders: folders,
        pickImage: () async => kTinyPng,
      );
      await pumpApp(tester, t.services);
      await openAllSongs(tester);
      await tester.tap(find.byTooltip('Más opciones de «Canción $otherId»'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cambiar portada'));
      await tester.pumpAndSettle();
      expect(t.submittedCovers.single.id, otherId);
      final row = find.ancestor(
        of: find.text('Canción $otherId'),
        matching: find.byType(SongRow),
      );
      expect(find.descendant(of: row, matching: badge), findsOneWidget);
      final art = tester.widget<CoverArt>(
        find.descendant(of: row, matching: find.byType(CoverArt)).first,
      );
      expect(art.image, isA<MemoryImage>());
    },
  );
}
