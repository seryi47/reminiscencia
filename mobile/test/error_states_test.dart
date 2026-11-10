import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/app_error.dart';
import 'package:reminiscencia/ui/cards.dart';

import 'support/fakes.dart';

void main() {
  testWidgets(
    'sin conexión y sin copia: mensaje claro y «Reintentar» que vuelve a cargar',
    (tester) async {
      setWindow(tester, const Size(400, 800));
      final t = buildTestServices(
        libraryError: const SocketException('Failed host lookup'),
      );
      await pumpApp(tester, t.services);

      expect(find.textContaining('No hay conexión'), findsOneWidget);
      expect(find.text('Reintentar'), findsOneWidget);
      expect(t.source.loads, 1);

      t.source
        ..songs = [fakeSong('s1')]
        ..error = null;
      await tester.tap(find.text('Reintentar'));
      await settle(tester);

      expect(t.source.loads, 2);
      expect(find.textContaining('No hay conexión'), findsNothing);
      expect(
        find.descendant(
          of: find.byType(ShelfCard),
          matching: find.text('Canción s1'),
        ),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'arranque en frío: sin minirreproductor ni canción marcada hasta que se toca una; entonces suena',
    (tester) async {
      setWindow(tester, const Size(400, 800));
      final t = buildTestServices(songs: [fakeSong('s1'), fakeSong('s2')]);
      await pumpApp(tester, t.services);

      // Nada se prepara al abrir (DESIGN.md §10): ni cola, ni canción actual, ni minirreproductor.
      expect(t.playback.log, isEmpty);
      expect(t.playback.nowPlaying.value.songId, isNull);
      expect(t.playback.queueSongIds, isEmpty);
      expect(find.byKey(const Key('mini-player-open')), findsNothing);
      expect(
        find.textContaining('No se puede preparar el audio'),
        findsNothing,
      );

      // Una sincronización tampoco carga nada.
      await t.services.library.refresh();
      await settle(tester);
      expect(t.playback.log, isEmpty);
      expect(find.byKey(const Key('mini-player-open')), findsNothing);

      await tester.tap(
        find.descendant(
          of: find.byType(ShelfCard),
          matching: find.text('Canción s2'),
        ),
      );
      await settle(tester);
      expect(t.playback.log, hasLength(1));
      expect(t.playback.log.single, startsWith('play:'));
      expect(t.playback.nowPlaying.value.songId, 's2');
      expect(t.playback.nowPlaying.value.playing, isTrue);
      expect(find.byKey(const Key('mini-player-open')), findsOneWidget);

      // Parar deja el reproductor vacío: el minirreproductor desaparece.
      await t.playback.stop();
      await settle(tester);
      expect(find.byKey(const Key('mini-player-open')), findsNothing);
    },
  );

  testWidgets(
    'un fallo al reproducir una canción se muestra en un aviso, no en silencio',
    (tester) async {
      setWindow(tester, const Size(400, 800));
      final t = buildTestServices(songs: [fakeSong('s1')]);
      await pumpApp(tester, t.services);

      t.playback.playError = const AppException(
        'El audio no está disponible sin conexión.',
      );
      await tester.tap(
        find.descendant(
          of: find.byType(ShelfCard),
          matching: find.text('Canción s1'),
        ),
      );
      await settle(tester);

      expect(find.textContaining('No se pudo reproducir'), findsOneWidget);
      expect(
        find.textContaining('El audio no está disponible sin conexión.'),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'si las listas guardadas no se pueden leer, «Me gusta» lo dice y no finge estar vacía',
    (tester) async {
      setWindow(tester, const Size(400, 800));
      final t = buildTestServices(songs: [fakeSong('s1')]);
      t.repository.readError = const FormatException('JSON roto');
      await pumpApp(tester, t.services);

      await tester.tap(find.text('Tu biblioteca'));
      await settle(tester);
      expect(
        find.textContaining('No se pudieron leer tus listas guardadas'),
        findsOneWidget,
      );
      await tester.tap(find.text('Canciones que te gustan').last);
      await tester.pumpAndSettle();

      expect(
        find.textContaining('No se pudieron leer tus listas guardadas'),
        findsOneWidget,
      );
      expect(find.text('Reintentar'), findsOneWidget);
    },
  );
}
