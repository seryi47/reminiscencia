import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/layout.dart';
import 'package:reminiscencia/ui/home_page.dart';
import 'package:reminiscencia/ui/player.dart';

import 'support/fakes.dart';

void main() {
  final songs = [fakeSong('s1'), fakeSong('s2')];

  test('el umbral de tableta es 720 dp', () {
    expect(isTabletWidth(719.9), isFalse);
    expect(isTabletWidth(720), isTrue);
  });

  testWidgets(
    'en teléfono hay barra inferior con tres pestañas y el minirreproductor de 56 dp va encima',
    (tester) async {
      setWindow(tester, const Size(400, 800));
      final t = buildTestServices(songs: songs);
      await pumpApp(tester, t.services);
      // El minirreproductor aparece cuando hay una canción cargada (al abrir no hay ninguna).
      t.playback.cue(songs, 0);
      await settle(tester);

      final bar = find.byType(NavigationBar);
      expect(bar, findsOneWidget);
      expect(find.byType(NavigationRail), findsNothing);
      expect(tester.widget<NavigationBar>(bar).destinations, hasLength(3));
      final mini = find.byType(MiniPlayer);
      expect(mini, findsOneWidget);
      expect(
        tester.getSize(find.byKey(const Key('mini-player-open'))).height,
        kMiniPlayerHeight,
      );
      // El minirreproductor queda justo encima de la barra.
      expect(
        tester.getBottomLeft(find.byKey(const Key('mini-player-open'))).dy,
        lessThanOrEqualTo(tester.getTopLeft(bar).dy),
      );
      expect(find.byType(HomePage), findsOneWidget);
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
    'en tableta hay navegación lateral, Inicio con las canciones y el minirreproductor',
    (tester) async {
      setWindow(tester, const Size(1000, 700));
      final t = buildTestServices(songs: songs);
      await pumpApp(tester, t.services);
      t.playback.cue(songs, 0);
      await settle(tester);

      expect(find.byType(NavigationRail), findsOneWidget);
      expect(find.byType(NavigationBar), findsNothing);
      expect(find.byType(MiniPlayer), findsOneWidget);
      expect(find.text('Canción s1'), findsWidgets);
      expect(find.text('Canción s2'), findsWidgets);
    },
  );

  testWidgets('con el texto al 160 % la portada no desborda en teléfono', (
    tester,
  ) async {
    setWindow(tester, const Size(360, 720));
    final t = buildTestServices(songs: songs);
    await t.services.settings.update(
      t.services.settings.value.copyWith(textScale: 1.6),
    );
    final errors = <FlutterErrorDetails>[];
    final previous = FlutterError.onError;
    FlutterError.onError = errors.add;
    await pumpApp(tester, t.services);
    FlutterError.onError = previous;
    for (final e in errors) {
      debugPrint(e.toString());
    }
    expect(errors, isEmpty);
    expect(find.byType(HomePage), findsOneWidget);
  });
}
