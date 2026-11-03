import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/layout.dart';
import 'package:reminiscencia/library_controller.dart';
import 'package:reminiscencia/playback.dart';
import 'package:reminiscencia/song.dart';
import 'package:reminiscencia/ui/home_page.dart';
import 'package:reminiscencia/ui/player.dart';
import 'package:reminiscencia/ui/song_row.dart';
import 'package:reminiscencia/url_opener.dart';

import 'support/fakes.dart';

/// Toca el minirreproductor y espera a que el reproductor a pantalla completa termine de abrirse.
Future<void> openPlayer(WidgetTester tester) async {
  await tester.tap(find.byKey(const Key('mini-player-open')));
  await tester.pumpAndSettle();
  expect(find.byType(FullPlayerPage), findsOneWidget);
}

void main() {
  final songs = [
    fakeSong('s1', folderId: 'f1', artist: 'Bessie Smith'),
    fakeSong('s2', artist: 'Louis Armstrong'),
  ];
  final folders = [const Folder(id: 'f1', name: 'Jazz', parentId: null)];

  group('sin usuarios', () {
    testWidgets(
      'abre directamente en Inicio con la música, sin perfiles ni modos',
      (tester) async {
        setWindow(tester, const Size(400, 800));
        final t = buildTestServices(songs: songs, folders: folders);
        await pumpApp(tester, t.services);

        expect(find.byType(HomePage), findsOneWidget);
        expect(find.text('Buenos días'), findsOneWidget);
        expect(find.text('Canción s1'), findsWidgets);
        final bar = tester.widget<NavigationBar>(find.byType(NavigationBar));
        expect(
          bar.destinations.map((d) => (d as NavigationDestination).label),
          ['Inicio', 'Buscar', 'Tu biblioteca'],
        );
        for (final gone in const [
          'Modo paciente',
          'Modo cuidador',
          'Perfil',
          'Perfiles',
          'Iniciar sesión',
          'Cuenta',
        ]) {
          expect(find.text(gone), findsNothing, reason: gone);
        }
      },
    );

    testWidgets('Ajustes no ofrece ningún modo ni cuenta', (tester) async {
      setWindow(tester, const Size(400, 800));
      final t = buildTestServices(songs: songs);
      await pumpApp(tester, t.services);

      await tester.tap(find.byTooltip('Ajustes'));
      await tester.pumpAndSettle();

      expect(find.text('Alto contraste'), findsOneWidget);
      expect(find.text('Reducir animaciones'), findsOneWidget);
      expect(find.text('Modo paciente'), findsNothing);
      expect(find.textContaining('Cuenta'), findsNothing);
      // La barra inferior sigue a la vista dentro de la pestaña.
      expect(find.byType(NavigationBar), findsOneWidget);
    });
  });

  group('Inicio', () {
    test('el saludo cambia con la hora', () {
      expect(greetingFor(DateTime(2026, 1, 1, 6)), 'Buenos días');
      expect(greetingFor(DateTime(2026, 1, 1, 12, 59)), 'Buenos días');
      expect(greetingFor(DateTime(2026, 1, 1, 13)), 'Buenas tardes');
      expect(greetingFor(DateTime(2026, 1, 1, 20, 59)), 'Buenas tardes');
      expect(greetingFor(DateTime(2026, 1, 1, 21)), 'Buenas noches');
      expect(greetingFor(DateTime(2026, 1, 1, 3)), 'Buenas noches');
    });

    testWidgets('saludo de noche, accesos rápidos y estantes', (tester) async {
      setWindow(tester, const Size(400, 1200));
      final t = buildTestServices(
        songs: songs,
        folders: folders,
        now: DateTime(2026, 11, 3, 23),
      );
      await pumpApp(tester, t.services);

      expect(find.text('Buenas noches'), findsOneWidget);
      expect(find.text('Canciones que te gustan'), findsWidgets);
      expect(find.text('Carpetas'), findsOneWidget);
      expect(find.text('Añadidas recientemente'), findsOneWidget);
      expect(find.text('Tus listas'), findsOneWidget);
      expect(find.text('Jazz'), findsWidgets);
    });

    testWidgets(
      'una carpeta abre su página con cabecera, botón verde y filas de canción',
      (tester) async {
        setWindow(tester, const Size(400, 800));
        final t = buildTestServices(songs: songs, folders: folders);
        await pumpApp(tester, t.services);

        await tester.tap(find.text('Jazz').first);
        await tester.pumpAndSettle();

        expect(find.byType(SongRow), findsOneWidget);
        expect(find.text('Carpeta · 1 canción · 3 min'), findsOneWidget);
        await tester.tap(find.byKey(const Key('collection-play')));
        await settle(tester);
        expect(t.playback.log.last, 'play:0');
        expect(t.playback.nowPlaying.value.songId, 's1');
        // La barra inferior y el minirreproductor siguen a la vista.
        expect(find.byType(NavigationBar), findsOneWidget);
        expect(find.byType(MiniPlayer), findsOneWidget);
      },
    );
  });

  group('reproductor', () {
    testWidgets(
      'el reproductor a pantalla completa tiene los cinco controles y llaman al reproductor',
      (tester) async {
        setWindow(tester, const Size(400, 800));
        final t = buildTestServices(songs: songs);
        await pumpApp(tester, t.services);
        await openPlayer(tester);

        for (final key in const [
          Key('transport-shuffle'),
          Key('transport-previous'),
          Key('transport-play'),
          Key('transport-next'),
          Key('transport-repeat'),
        ]) {
          final size = tester.getSize(find.byKey(key));
          expect(
            size.width,
            greaterThanOrEqualTo(kMinTouchTarget),
            reason: '$key',
          );
          expect(
            size.height,
            greaterThanOrEqualTo(kMinTouchTarget),
            reason: '$key',
          );
        }
        expect(
          tester.getSize(find.byKey(const Key('transport-play'))).width,
          greaterThanOrEqualTo(64),
        );

        await tester.tap(find.byKey(const Key('transport-play')));
        await settle(tester);
        await tester.tap(find.byKey(const Key('transport-next')));
        await settle(tester);
        await tester.tap(find.byKey(const Key('transport-previous')));
        await settle(tester);
        await tester.tap(find.byKey(const Key('transport-shuffle')));
        await settle(tester);
        await tester.tap(find.byKey(const Key('transport-repeat')));
        await settle(tester);
        await tester.tap(find.byKey(const Key('transport-repeat')));
        await settle(tester);

        expect(
          t.playback.log,
          containsAllInOrder([
            'toggle',
            'next',
            'previous',
            'shuffle:true',
            'repeat:all',
            'repeat:one',
          ]),
        );
        expect(find.byTooltip('Aleatorio: activado'), findsOneWidget);
        expect(find.byTooltip('Repetir: esta canción'), findsOneWidget);

        await tester.tap(find.byTooltip('Cerrar el reproductor'));
        await tester.pumpAndSettle();
        expect(find.byType(FullPlayerPage), findsNothing);
      },
    );

    testWidgets('portada, título, artista y «Me gusta» en pantalla completa', (
      tester,
    ) async {
      setWindow(tester, const Size(400, 800));
      final t = buildTestServices(songs: songs);
      await pumpApp(tester, t.services);
      await openPlayer(tester);

      final player = find.byType(FullPlayerPage);
      expect(
        find.descendant(of: player, matching: find.text('Canción s1')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: player, matching: find.text('Bessie Smith')),
        findsOneWidget,
      );
      await tester.tap(
        find.descendant(
          of: player,
          matching: find.byTooltip('Añadir a Me gusta'),
        ),
      );
      await settle(tester);
      expect(t.services.collections.isFavorite('s1'), isTrue);
    });

    testWidgets('la barra de progreso muestra la posición y permite saltar', (
      tester,
    ) async {
      setWindow(tester, const Size(400, 800));
      final t = buildTestServices(songs: songs);
      await pumpApp(tester, t.services);
      t.playback.setProgress(
        const PlaybackProgress(
          position: Duration(seconds: 60),
          duration: Duration(seconds: 180),
        ),
      );
      await settle(tester);

      final mini = tester.widget<LinearProgressIndicator>(
        find.byKey(const Key('mini-progress')),
      );
      expect(mini.value, closeTo(1 / 3, 1e-6));
      expect(mini.minHeight, lessThanOrEqualTo(2));

      await openPlayer(tester);
      expect(find.text('1:00'), findsOneWidget);
      expect(find.text('3:00'), findsOneWidget);
      final slider = tester.widget<Slider>(
        find.byKey(const Key('player-seek')),
      );
      slider.onChangeEnd!(120000);
      await settle(tester);
      expect(t.playback.log.last, 'seek:120');
    });

    testWidgets(
      'el progreso solo se redibuja mientras suena y está a la vista (sin sondeos)',
      (tester) async {
        final playback = FakePlaybackPort();
        var builds = 0;
        var visible = true;
        late StateSetter setOuter;
        await tester.pumpWidget(
          StatefulBuilder(
            builder: (context, setState) {
              setOuter = setState;
              return TickerMode(
                enabled: visible,
                child: ProgressBuilder(
                  playback: playback,
                  builder: (context, position, duration) {
                    builds++;
                    return const SizedBox.shrink();
                  },
                ),
              );
            },
          ),
        );
        final paused = builds;
        await tester.pump(const Duration(seconds: 5));
        expect(builds, paused, reason: 'en pausa no hay temporizador');

        playback.setProgress(
          PlaybackProgress(
            duration: const Duration(minutes: 3),
            playing: true,
            updatedAt: DateTime.now(),
          ),
        );
        await tester.pump();
        final started = builds;
        await tester.pump(const Duration(seconds: 2));
        expect(builds, greaterThan(started), reason: 'sonando avanza');

        setOuter(() => visible = false);
        await tester.pump();
        final hidden = builds;
        await tester.pump(const Duration(seconds: 5));
        expect(builds, hidden, reason: 'fuera de la vista se para');
      },
    );
  });

  group('progreso', () {
    test('la posición se extrapola solo mientras suena y se acota', () {
      final at = DateTime(2026, 1, 1, 12);
      final playing = PlaybackProgress(
        position: const Duration(seconds: 10),
        duration: const Duration(seconds: 30),
        playing: true,
        updatedAt: at,
      );
      expect(
        playing.positionAt(at.add(const Duration(seconds: 5))),
        const Duration(seconds: 15),
      );
      expect(
        playing.positionAt(at.add(const Duration(minutes: 5))),
        const Duration(seconds: 30),
      );
      expect(
        playing.fractionAt(at.add(const Duration(seconds: 5))),
        closeTo(0.5, 1e-9),
      );
      final paused = PlaybackProgress(
        position: const Duration(seconds: 10),
        duration: const Duration(seconds: 30),
        updatedAt: at,
      );
      expect(
        paused.positionAt(at.add(const Duration(seconds: 5))),
        const Duration(seconds: 10),
      );
      expect(PlaybackProgress.zero.fractionAt(at), 0);
    });

    test('repetir pasa por no, todo, una y vuelve a no', () {
      expect(nextRepeatMode(LoopSetting.off), LoopSetting.all);
      expect(nextRepeatMode(LoopSetting.all), LoopSetting.one);
      expect(nextRepeatMode(LoopSetting.one), LoopSetting.off);
    });
  });

  group('Buscar', () {
    test('la búsqueda no distingue mayúsculas ni tildes', () {
      expect(foldForSearch('  Canción   ÁRBOL '), 'cancion arbol');
    });

    testWidgets(
      'sin texto muestra «Explorar todo»; con texto, las canciones que coinciden',
      (tester) async {
        setWindow(tester, const Size(400, 800));
        final t = buildTestServices(songs: songs, folders: folders);
        await pumpApp(tester, t.services);

        await tester.tap(find.text('Buscar'));
        await settle(tester);
        expect(find.text('Explorar todo'), findsOneWidget);
        expect(find.text('¿Qué te apetece escuchar?'), findsOneWidget);

        await tester.enterText(find.byKey(const Key('search-field')), 'louis');
        await settle(tester);
        expect(find.byType(SongRow), findsOneWidget);
        expect(find.text('Canción s2'), findsOneWidget);

        await tester.enterText(find.byKey(const Key('search-field')), 'jazz');
        await settle(tester);
        // La carpeta y la etiqueta «jazz» de las dos canciones.
        expect(find.text('Carpeta'), findsOneWidget);
        expect(find.byType(SongRow), findsNWidgets(2));

        await tester.enterText(find.byKey(const Key('search-field')), 'zzz');
        await settle(tester);
        expect(find.text('No hay resultados para «zzz».'), findsOneWidget);

        await tester.tap(find.byTooltip('Borrar la búsqueda'));
        await settle(tester);
        expect(find.text('Explorar todo'), findsOneWidget);
      },
    );
  });

  group('Subir canciones', () {
    testWidgets(
      'ofrece «Solo en este teléfono» y «Para todos»; «Para todos» explica y abre GitHub',
      (tester) async {
        setWindow(tester, const Size(400, 800));
        final t = buildTestServices(songs: songs);
        await pumpApp(tester, t.services);

        await tester.tap(find.text('Tu biblioteca'));
        await settle(tester);
        await tester.tap(find.byKey(const Key('upload-songs')));
        await tester.pumpAndSettle();
        expect(find.text('Solo en este teléfono'), findsOneWidget);
        expect(find.text('Para todos'), findsOneWidget);

        await tester.tap(find.text('Para todos'));
        await tester.pumpAndSettle();
        expect(find.textContaining('permiso de escritura'), findsOneWidget);
        expect(find.textContaining('«Licencia: …»'), findsOneWidget);
        expect(find.textContaining('quedan privadas'), findsOneWidget);

        await tester.tap(find.text('Abrir GitHub'));
        await tester.pumpAndSettle();
        expect(t.openedUrls, [kSharedUploadUri]);
        expect(
          kSharedUploadUri.toString(),
          'https://github.com/seryi47/reminiscencia/upload/main/audio-library/buzon',
        );
      },
    );

    testWidgets('si el navegador no abre, se dice y se da la dirección', (
      tester,
    ) async {
      setWindow(tester, const Size(400, 800));
      final t = buildTestServices(songs: songs, canOpenUrls: false);
      await pumpApp(tester, t.services);

      await tester.tap(find.text('Tu biblioteca'));
      await settle(tester);
      await tester.tap(find.byKey(const Key('upload-songs')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Para todos'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Abrir GitHub'));
      await tester.pumpAndSettle();

      expect(
        find.textContaining('No se pudo abrir el navegador'),
        findsOneWidget,
      );
    });

    testWidgets('«Cancelar» no abre nada', (tester) async {
      setWindow(tester, const Size(400, 800));
      final t = buildTestServices(songs: songs);
      await pumpApp(tester, t.services);

      await tester.tap(find.text('Tu biblioteca'));
      await settle(tester);
      await tester.tap(find.byKey(const Key('upload-songs')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Para todos'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancelar'));
      await tester.pumpAndSettle();

      expect(t.openedUrls, isEmpty);
    });
  });

  group('biblioteca', () {
    test('añadidas recientemente: primero lo último del catálogo', () async {
      final t = buildTestServices(
        songs: [fakeSong('a'), fakeSong('b'), fakeSong('c')],
      );
      await t.services.library.load();
      expect(t.services.library.recentSongs(limit: 2).map((s) => s.id), [
        'c',
        'b',
      ]);
      expect(t.services.library.searchSongs('canción b').single.id, 'b');
      expect(t.services.library.searchSongs('   '), isEmpty);
    });
  });

  group('accesibilidad', () {
    Future<void> checkGuidelines(WidgetTester tester) async {
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
    }

    testWidgets('Inicio cumple objetivos de 48 dp, etiquetas y contraste', (
      tester,
    ) async {
      final handle = tester.ensureSemantics();
      setWindow(tester, const Size(400, 800));
      final t = buildTestServices(songs: songs, folders: folders);
      await pumpApp(tester, t.services);
      await checkGuidelines(tester);
      handle.dispose();
    });

    testWidgets('Buscar y Tu biblioteca cumplen las mismas pautas', (
      tester,
    ) async {
      final handle = tester.ensureSemantics();
      setWindow(tester, const Size(400, 800));
      final t = buildTestServices(songs: songs, folders: folders);
      await pumpApp(tester, t.services);

      await tester.tap(find.text('Buscar'));
      await settle(tester);
      await tester.enterText(find.byKey(const Key('search-field')), 'canción');
      await settle(tester);
      await checkGuidelines(tester);

      await tester.tap(find.text('Tu biblioteca'));
      await settle(tester);
      await checkGuidelines(tester);
      handle.dispose();
    });

    testWidgets(
      'la página de una carpeta y el reproductor cumplen las pautas',
      (tester) async {
        final handle = tester.ensureSemantics();
        setWindow(tester, const Size(400, 800));
        final t = buildTestServices(songs: songs, folders: folders);
        await pumpApp(tester, t.services);

        await tester.tap(find.text('Jazz').first);
        await tester.pumpAndSettle();
        await checkGuidelines(tester);

        await tester.tap(find.byKey(const Key('collection-play')));
        await settle(tester);
        await openPlayer(tester);
        await checkGuidelines(tester);
        handle.dispose();
      },
    );

    testWidgets('las filas de canción se anuncian con título y artista', (
      tester,
    ) async {
      final handle = tester.ensureSemantics();
      setWindow(tester, const Size(400, 800));
      final t = buildTestServices(songs: songs, folders: folders);
      await pumpApp(tester, t.services);

      await tester.tap(find.text('Jazz').first);
      await tester.pumpAndSettle();
      expect(
        tester.getSemantics(find.byType(SongRow)),
        // s1 es la canción cargada (en pausa): la fila se marca como seleccionada y lo dice.
        isSemantics(
          label: 'Canción s1, Bessie Smith · 1931, 3:05, en pausa',
          isButton: true,
          hasTapAction: true,
          hasSelectedState: true,
          isSelected: true,
        ),
      );
      expect(find.byTooltip('Más opciones de «Canción s1»'), findsOneWidget);
      handle.dispose();
    });
  });
}
