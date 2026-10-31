import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/app_settings.dart';
import 'package:reminiscencia/layout.dart';
import 'package:reminiscencia/song.dart';
import 'package:reminiscencia/ui/player_views.dart';
import 'package:reminiscencia/ui/song_tile.dart';

import 'support/fakes.dart';

void main() {
  const patient = AppSettings(patientMode: true);
  final songs = [fakeSong('s1', folderId: 'f1'), fakeSong('s2')];
  final folders = [const Folder(id: 'f1', name: 'Jazz', parentId: null)];

  testWidgets('los botones de reproducción miden al menos 64 dp', (
    tester,
  ) async {
    setWindow(tester, const Size(400, 800));
    final t = buildTestServices(
      songs: songs,
      folders: folders,
      settings: patient,
    );
    await pumpApp(tester, t.services);

    for (final key in const [
      Key('transport-previous'),
      Key('transport-play'),
      Key('transport-next'),
    ]) {
      final size = tester.getSize(find.byKey(key));
      expect(
        size.width,
        greaterThanOrEqualTo(kPatientTargetSize),
        reason: '$key ancho',
      );
      expect(
        size.height,
        greaterThanOrEqualTo(kPatientTargetSize),
        reason: '$key alto',
      );
    }
  });

  testWidgets(
    'sin carpetas, sin descarga, sin actualizar y sin acciones secundarias',
    (tester) async {
      setWindow(tester, const Size(400, 800));
      final t = buildTestServices(
        songs: songs,
        folders: folders,
        settings: patient,
      );
      await pumpApp(tester, t.services);

      expect(find.byType(ChoiceChip), findsNothing);
      expect(
        find.byTooltip('Guardar para escuchar sin conexión'),
        findsNothing,
      );
      expect(find.byTooltip('Actualizar biblioteca'), findsNothing);
      expect(find.byTooltip('Añadir a favoritos'), findsNothing);
      expect(find.byTooltip('Añadir a una lista'), findsNothing);
      expect(find.byType(SongTile), findsNWidgets(2));
    },
  );

  testWidgets('la navegación solo ofrece Escuchar y Ajustes', (tester) async {
    setWindow(tester, const Size(400, 800));
    final t = buildTestServices(
      songs: songs,
      folders: folders,
      settings: patient,
    );
    await pumpApp(tester, t.services);

    final bar = tester.widget<NavigationBar>(find.byType(NavigationBar));
    expect(bar.destinations, hasLength(2));
    expect(find.text('Favoritos'), findsNothing);
    expect(find.text('Listas'), findsNothing);
  });

  testWidgets(
    'reproductor grande con el título de la canción y un icono de portada',
    (tester) async {
      setWindow(tester, const Size(400, 800));
      final t = buildTestServices(
        songs: songs,
        folders: folders,
        settings: patient,
      );
      await pumpApp(tester, t.services);

      final player = find.byType(PatientPlayer);
      expect(player, findsOneWidget);
      expect(
        find.descendant(of: player, matching: find.text('Canción s1')),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: player,
          matching: find.byIcon(Icons.music_note_rounded),
        ),
        findsOneWidget,
      );
      expect(find.byType(MiniPlayerBar), findsNothing);
    },
  );

  testWidgets(
    'los tres botones llaman a anterior, reproducir o pausar y siguiente',
    (tester) async {
      setWindow(tester, const Size(400, 800));
      final t = buildTestServices(
        songs: songs,
        folders: folders,
        settings: patient,
      );
      await pumpApp(tester, t.services);

      await tester.tap(find.byKey(const Key('transport-play')));
      await settle(tester);
      await tester.tap(find.byKey(const Key('transport-next')));
      await settle(tester);
      await tester.tap(find.byKey(const Key('transport-previous')));
      await settle(tester);

      expect(
        t.playback.log,
        containsAllInOrder(['toggle', 'next', 'previous']),
      );
    },
  );

  testWidgets(
    'activar el modo paciente desde Ajustes reduce la navegación y oculta las carpetas',
    (tester) async {
      setWindow(tester, const Size(400, 800));
      final t = buildTestServices(songs: songs, folders: folders);
      await pumpApp(tester, t.services);

      expect(find.byType(ChoiceChip), findsWidgets);
      expect(
        tester.widget<NavigationBar>(find.byType(NavigationBar)).destinations,
        hasLength(4),
      );

      await t.services.settings.update(patient);
      await settle(tester);

      expect(find.byType(ChoiceChip), findsNothing);
      expect(
        tester.widget<NavigationBar>(find.byType(NavigationBar)).destinations,
        hasLength(2),
      );
      expect(find.byType(PatientPlayer), findsOneWidget);
    },
  );
}
