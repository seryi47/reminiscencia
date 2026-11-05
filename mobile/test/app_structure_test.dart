import 'dart:typed_data';

import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/image_picker.dart';
import 'package:reminiscencia/layout.dart';
import 'package:reminiscencia/library_controller.dart';
import 'package:reminiscencia/library_requests.dart';
import 'package:reminiscencia/local_audio.dart';
import 'package:reminiscencia/playback.dart';
import 'package:reminiscencia/services.dart';
import 'package:reminiscencia/song.dart';
import 'package:reminiscencia/ui/home_page.dart';
import 'package:reminiscencia/ui/player.dart';
import 'package:reminiscencia/ui/song_row.dart';
import 'package:reminiscencia/shared_upload.dart';
import 'package:reminiscencia/upload_tracker.dart';

import 'support/fakes.dart';
import 'support/zips.dart';

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
      expect(find.text('Álbumes'), findsOneWidget);
      expect(find.text('Añadidas recientemente'), findsOneWidget);
      expect(find.text('Tus listas'), findsOneWidget);
      expect(find.text('Jazz'), findsWidgets);
    });

    testWidgets(
      'un álbum abre su página con cabecera, botón verde y filas de canción',
      (tester) async {
        setWindow(tester, const Size(400, 800));
        final t = buildTestServices(songs: songs, folders: folders);
        await pumpApp(tester, t.services);

        await tester.tap(find.text('Jazz').first);
        await tester.pumpAndSettle();

        expect(find.byType(SongRow), findsOneWidget);
        expect(find.text('Álbum · 1 canción · 3 min'), findsOneWidget);
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
        // El álbum y la etiqueta «jazz» de las dos canciones.
        expect(find.text('Álbum'), findsOneWidget);
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
    late Directory work;
    late List<http.Request> requests;
    late FakePollTimer timers;
    late FakePublishedSongs published;

    setUp(() {
      work = Directory.systemTemp.createTempSync('subida_ui');
      requests = [];
      timers = FakePollTimer();
      published = FakePublishedSongs();
    });
    tearDown(() async {
      // Deja terminar las escrituras del índice de subidas.
      await Future<void>.delayed(const Duration(milliseconds: 60));
      if (work.existsSync()) work.deleteSync(recursive: true);
    });

    SharedUploader uploader({
      bool online = true,
      http.Response Function(int n)? reply,
    }) => SharedUploader(
      client: MockClient((request) async {
        requests.add(request);
        return reply?.call(requests.length) ??
            http.Response(
              jsonEncode({'ok': true, 'ruta': 'r', 'nombre': 'n'}),
              200,
            );
      }),
      converter: _BytesConverter(),
      hasConnection: () async => online,
      workDir: () async => work,
      retryDelay: Duration.zero,
    );

    ({
      AppServices services,
      FakeLibrarySource source,
      FakePlaybackPort playback,
      MemoryCollectionsRepository repository,
      List<Uri> openedUrls,
      List<LibraryRequest> submitted,
      List<({String id, Uint8List jpeg})> submittedCovers,
      FakeCoverImages covers,
      FakeCoverStore coverStore,
      MemoryPlaylistCoverStore playlistCovers,
    })
    servicesWith({
      required SharedUploader uploader,
      AudioFilesPicker? pickAudio,
    }) => buildTestServices(
      songs: songs,
      uploader: uploader,
      pickAudio: pickAudio,
      published: published,
      uploadsStore: UploadsStore(
        root: () async => Directory('${work.path}/subidas'),
      ),
      pollTimer: timers.call,
    );

    /// Deja correr la E/S real (conversión, índice, peticiones) y pinta.
    Future<void> realWork(WidgetTester tester, AppServices services) async {
      await tester.runAsync(() async {
        await Future<void>.delayed(const Duration(milliseconds: 50));
        for (var i = 0; i < 100 && services.library.importing; i++) {
          await Future<void>.delayed(const Duration(milliseconds: 20));
        }
        await Future<void>.delayed(const Duration(milliseconds: 50));
      });
      await settle(tester);
    }

    /// Toca «Subir canciones» y espera, con E/S real, a que termine la subida.
    Future<void> tapUpload(WidgetTester tester, AppServices services) async {
      await tester.runAsync(() async {
        await tester.tap(find.byKey(const Key('upload-songs')));
      });
      await realWork(tester, services);
    }

    testWidgets(
      'Homeostasia se centra en YouTube y la subida manual sigue separada',
      (tester) async {
        setWindow(tester, const Size(400, 900));
        final t = servicesWith(uploader: uploader());
        await pumpApp(tester, t.services);
        await tester.tap(find.text('Tu biblioteca'));
        await settle(tester);

        await tester.tap(find.byKey(const Key('homeostasia')));
        for (var i = 0; i < 20; i++) {
          await tester.pump(const Duration(milliseconds: 50));
        }
        expect(find.byKey(const Key('homeostasia-sheet')), findsOneWidget);
        expect(find.text('Añade un vídeo o una playlist'), findsOneWidget);
        expect(find.text('Importar música'), findsOneWidget);
        expect(find.byKey(const Key('homeostasia-pick')), findsNothing);
        expect(find.byKey(const Key('upload-songs')), findsOneWidget);
        expect(
          find.textContaining('Añade música desde tu dispositivo'),
          findsNothing,
        );
      },
    );

    testWidgets(
      'una fila por archivo con nombre, estado y barra, y el resumen; al publicarse, «Publicada» y aviso',
      (tester) async {
        setWindow(tester, const Size(400, 900));
        var picks = 0;
        final t = servicesWith(
          uploader: uploader(),
          pickAudio: () async {
            picks++;
            return const [
              PickedAudioFile(name: 'Canción de cuna.mp3', path: '/x/1.mp3'),
              PickedAudioFile(name: 'Charleston.wav', path: '/x/2.wav'),
            ];
          },
        );
        await pumpApp(tester, t.services);
        await tester.tap(find.text('Tu biblioteca'));
        await settle(tester);

        expect(find.text(kUploadRightsNotice), findsOneWidget);
        expect(find.byKey(const Key('uploads-panel')), findsNothing);
        await tapUpload(tester, t.services);

        expect(picks, 1);
        expect(find.text('Solo en este teléfono'), findsNothing);
        expect(find.text('Para todos'), findsNothing);
        expect(requests, hasLength(2));
        expect(requests.map((r) => r.headers['X-Nombre-Archivo']), [
          'Canci%C3%B3n%20de%20cuna.mp3',
          'Charleston.wav',
        ]);
        expect(t.openedUrls, isEmpty, reason: 'ya no abre GitHub');
        expect(find.byType(AlertDialog), findsNothing);

        // Una fila por archivo, con el nombre, el estado y la barra.
        expect(find.text('Canción de cuna.mp3'), findsOneWidget);
        expect(find.text('Charleston.wav'), findsOneWidget);
        expect(find.text('Guardada en GitHub'), findsNWidgets(2));
        expect(
          find.descendant(
            of: find.byKey(const Key('uploads-panel')),
            matching: find.byType(LinearProgressIndicator),
          ),
          findsNWidgets(2),
        );
        expect(find.text('0 de 2 publicadas'), findsOneWidget);
        // Ya suena desde la copia local, antes de publicarse.
        expect(find.text('Reproducir'), findsNWidgets(2));
        expect(
          tester.getSemantics(
            find.bySemanticsLabel('Charleston.wav: Guardada en GitHub'),
          ),
          isSemantics(isLiveRegion: true),
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));

        // Primera comprobación (20 s después): todavía no está.
        await tester.runAsync(() async {
          timers.fire();
          await Future<void>.delayed(const Duration(milliseconds: 50));
        });
        await settle(tester);
        expect(
          find.text('Publicándose… (suele tardar 2–3 minutos)'),
          findsNWidgets(2),
        );

        // Aparece en songs.json: «Publicada», resumen y aviso con «Reproducir».
        published.songs.add(const PublishedSong('S77', 'Charleston'));
        await tester.runAsync(() async {
          timers.fire();
          await Future<void>.delayed(const Duration(milliseconds: 50));
        });
        await settle(tester);
        expect(find.text('Publicada'), findsOneWidget);
        expect(find.text('1 de 2 publicadas'), findsOneWidget);
        expect(find.text('«Charleston» ya está publicada.'), findsOneWidget);
        expect(
          tester.getSemantics(
            find.bySemanticsLabel('Charleston.wav: Publicada'),
          ),
          isSemantics(isLiveRegion: true),
        );
        expect(t.source.loads, greaterThan(1), reason: 'se sincronizó sola');
      },
    );

    testWidgets(
      'en cuanto se convierte aparece en Inicio con «Publicándose…» y suena desde la copia local',
      (tester) async {
        setWindow(tester, const Size(400, 900));
        final t = servicesWith(
          uploader: uploader(),
          pickAudio: () async => const [
            PickedAudioFile(name: 'Vals nuevo.mp3', path: '/x/v.mp3'),
          ],
        );
        await pumpApp(tester, t.services);
        await tester.tap(find.text('Tu biblioteca'));
        await settle(tester);
        await tapUpload(tester, t.services);

        await tester.tap(find.text('Inicio'));
        await settle(tester);
        expect(find.text('Vals nuevo'), findsWidgets);
        expect(find.text('Publicándose…'), findsWidgets);

        await tester.tap(find.text('Tu biblioteca'));
        await settle(tester);
        await tester.tap(find.text('Reproducir'));
        await settle(tester);
        final playing = t.playback.nowPlaying.value.songId!;
        expect(playing, startsWith('P'));
        expect(t.services.library.songOrNull(playing)?.title, 'Vals nuevo');
      },
    );

    testWidgets('sin red avisa y no abre el selector ni envía nada', (
      tester,
    ) async {
      setWindow(tester, const Size(400, 800));
      var picks = 0;
      final t = servicesWith(
        uploader: uploader(online: false),
        pickAudio: () async {
          picks++;
          return const [];
        },
      );
      await pumpApp(tester, t.services);
      await tester.tap(find.text('Tu biblioteca'));
      await settle(tester);
      await tapUpload(tester, t.services);

      expect(find.text(kOfflineMessage), findsOneWidget);
      expect(picks, 0);
      expect(requests, isEmpty);
    });

    testWidgets(
      'un error de la web se muestra en su fila con «Reintentar», que lo vuelve a subir',
      (tester) async {
        setWindow(tester, const Size(400, 900));
        var fail = true;
        final t = servicesWith(
          uploader: uploader(
            reply: (_) => fail
                ? http.Response(
                    jsonEncode({'ok': false, 'error': 'Formato no admitido.'}),
                    415,
                  )
                : http.Response(
                    jsonEncode({'ok': true, 'ruta': 'r', 'nombre': 'n'}),
                    200,
                  ),
          ),
          pickAudio: () async => const [
            PickedAudioFile(name: 'Rara.flac', path: '/x/r.flac'),
          ],
        );
        await pumpApp(tester, t.services);
        await tester.tap(find.text('Tu biblioteca'));
        await settle(tester);
        await tapUpload(tester, t.services);

        expect(find.text('Rara.flac'), findsOneWidget);
        expect(find.text('Error: Formato no admitido.'), findsOneWidget);
        expect(find.text('Reintentar'), findsOneWidget);
        expect(find.text('0 de 1 publicada'), findsOneWidget);
        expect(requests, hasLength(1));
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));

        fail = false;
        await tester.runAsync(() async {
          await tester.tap(find.text('Reintentar'));
        });
        await realWork(tester, t.services);

        expect(requests, hasLength(2));
        expect(find.text('Guardada en GitHub'), findsOneWidget);
        expect(find.text('Reintentar'), findsNothing);
      },
    );

    testWidgets(
      'un ZIP aparece como grupo con una fila por canción, lo ignorado y el resumen; un ZIP dañado, con su error',
      (tester) async {
        setWindow(tester, const Size(400, 1200));
        final zips = Directory('${work.path}/elegidos')..createSync();
        final album = File('${zips.path}/Álbum.zip')
          ..writeAsBytesSync(
            buildZip({
              'Álbum/01 Canción de cuna.mp3': fakeAudioBytes('1'),
              'Álbum/CD2/02 Pasodoble.flac': fakeAudioBytes('2'),
              '__MACOSX/Álbum/._01 Canción de cuna.mp3': fakeAudioBytes('3'),
              'Álbum/portada.jpg': fakeAudioBytes('4'),
            }),
          );
        final broken = File('${zips.path}/Roto.zip')
          ..writeAsBytesSync(List<int>.filled(64, 9));
        final t = servicesWith(
          uploader: uploader(),
          pickAudio: () async => [
            PickedAudioFile(name: 'Álbum.zip', path: album.path),
            const PickedAudioFile(name: 'Suelta.mp3', path: '/x/s.mp3'),
            PickedAudioFile(name: 'Roto.zip', path: broken.path),
          ],
        );
        await pumpApp(tester, t.services);
        await tester.tap(find.text('Tu biblioteca'));
        await settle(tester);
        await tapUpload(tester, t.services);

        expect(requests.map((r) => r.headers['X-Nombre-Archivo']), [
          '01%20Canci%C3%B3n%20de%20cuna.mp3',
          '02%20Pasodoble.flac',
          'Suelta.mp3',
        ]);
        expect(find.text('Álbum.zip: 2 canciones'), findsOneWidget);
        expect(
          find.text('Se ignoraron 2 archivos que no son canciones.'),
          findsOneWidget,
        );
        expect(find.text('01 Canción de cuna.mp3'), findsOneWidget);
        expect(find.text('02 Pasodoble.flac'), findsOneWidget);
        expect(find.text('Suelta.mp3'), findsOneWidget);
        expect(find.text('Roto.zip'), findsOneWidget);
        expect(
          find.text('Error: «Roto.zip» está dañado o no es un ZIP válido.'),
          findsOneWidget,
        );
        expect(find.text('Guardada en GitHub'), findsNWidgets(3));
        expect(find.text('0 de 3 publicadas'), findsOneWidget);
        expect(
          tester.getSemantics(
            find.bySemanticsLabel(
              'Álbum.zip: 2 canciones. Se ignoraron 2 archivos que no son canciones.',
            ),
          ),
          isSemantics(isLiveRegion: true),
        );
        // Las filas del ZIP van dentro de su grupo.
        final group = find.byWidgetPredicate(
          (w) =>
              w.key is ValueKey<String> &&
              (w.key! as ValueKey<String>).value.startsWith('upload-group-Z') &&
              !(w.key! as ValueKey<String>).value.contains('title'),
        );
        expect(group, findsNWidgets(2));
        expect(
          find.descendant(
            of: group.first,
            matching: find.text('02 Pasodoble.flac'),
          ),
          findsOneWidget,
        );
        expect(
          find.descendant(of: group.first, matching: find.text('Suelta.mp3')),
          findsNothing,
        );
        expect(Directory('${work.path}/zip').existsSync(), isFalse);
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      },
    );

    testWidgets('si se cancela el selector no pasa nada', (tester) async {
      setWindow(tester, const Size(400, 800));
      final t = servicesWith(uploader: uploader());
      await pumpApp(tester, t.services);
      await tester.tap(find.text('Tu biblioteca'));
      await settle(tester);
      await tapUpload(tester, t.services);

      expect(requests, isEmpty);
      expect(find.byType(AlertDialog), findsNothing);
      expect(find.byKey(const Key('uploads-panel')), findsNothing);
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

    testWidgets('la página de un álbum y el reproductor cumplen las pautas', (
      tester,
    ) async {
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
    });

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

/// Conversor falso para las pruebas de interfaz: escribe unos bytes cualesquiera.
class _BytesConverter implements AudioConverter {
  @override
  Future<ConvertedAudio> convert({
    required String inputPath,
    required String outputPath,
    required String title,
  }) async {
    await File(outputPath).writeAsBytes(List<int>.filled(32, 7));
    return const ConvertedAudio(
      durationS: 10,
      channels: 2,
      bitrate: kBitrateStereo,
      bytes: 32,
    );
  }

  @override
  Future<void> cancel() async {}
}
