import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/layout.dart';
import 'package:reminiscencia/ui/player_views.dart';
import 'package:reminiscencia/ui/song_tile.dart';

import 'support/fakes.dart';

void main() {
  final songs = [fakeSong('s1'), fakeSong('s2')];

  test('el umbral de tableta es 720 dp', () {
    expect(isTabletWidth(719.9), isFalse);
    expect(isTabletWidth(720), isTrue);
  });

  testWidgets(
    'en teléfono la navegación es una barra inferior y el mini reproductor va encima',
    (tester) async {
      setWindow(tester, const Size(400, 800));
      final t = buildTestServices(songs: songs);
      await pumpApp(tester, t.services);

      expect(find.byType(NavigationBar), findsOneWidget);
      expect(find.byType(NavigationRail), findsNothing);
      expect(find.byType(MiniPlayerBar), findsOneWidget);
      expect(find.byType(PlayerPanel), findsNothing);
      expect(find.byType(SongTile), findsNWidgets(2));
    },
  );

  testWidgets('a 719 dp sigue siendo diseño de teléfono', (tester) async {
    setWindow(tester, const Size(719, 800));
    final t = buildTestServices(songs: songs);
    await pumpApp(tester, t.services);

    expect(find.byType(NavigationBar), findsOneWidget);
    expect(find.byType(NavigationRail), findsNothing);
  });

  testWidgets('a 720 dp ya es diseño de tableta', (tester) async {
    setWindow(tester, const Size(720, 800));
    final t = buildTestServices(songs: songs);
    await pumpApp(tester, t.services);

    expect(find.byType(NavigationRail), findsOneWidget);
    expect(find.byType(NavigationBar), findsNothing);
  });

  testWidgets(
    'en tableta hay navegación lateral, lista y reproductor a la vez',
    (tester) async {
      setWindow(tester, const Size(1000, 700));
      final t = buildTestServices(songs: songs);
      await pumpApp(tester, t.services);

      expect(find.byType(NavigationRail), findsOneWidget);
      expect(find.byType(NavigationBar), findsNothing);
      expect(find.byType(PlayerPanel), findsOneWidget);
      expect(find.byType(MiniPlayerBar), findsNothing);
      expect(find.byType(SongTile), findsNWidgets(2));
    },
  );
}
