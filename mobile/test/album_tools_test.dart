import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/app_error.dart';
import 'package:reminiscencia/library_requests.dart';
import 'package:reminiscencia/local_audio.dart';
import 'package:reminiscencia/song.dart';
import 'package:reminiscencia/ui/duplicate_review.dart';

import 'support/fakes.dart';

// Álbumes avanzados (ADR-0026): número de pista, «order_album», modo «Seleccionar» y «Ordenar canciones», y el aviso
// de duplicados de «Subir canciones».

const albumId = 'F0123456789abcdef';
const otherAlbumId = 'Ffedcba9876543210';
const a = 'S000000000000000a';
const b = 'S000000000000000b';
const c = 'S000000000000000c';
const loose = 'S000000000000000d';

Song song(String id, String title, {String? folderId, int? track}) => Song(
  id: id,
  title: title,
  artist: 'Marea',
  year: null,
  tags: const [],
  folderId: folderId,
  durationS: 201,
  license: 'CC0',
  audio: 'audio/$id.opus',
  track: track,
);

void main() {
  group('LibraryRequest.orderAlbum', () {
    test('lleva la lista completa en el orden nuevo', () {
      final request = LibraryRequest.orderAlbum(
        folderId: albumId,
        songIds: const [b, a],
        albumName: ' Fiesta ',
      );
      expect(request.payload, {
        'op': 'order_album',
        'folder_id': albumId,
        'song_ids': [b, a],
      });
      expect(request.title, 'Ordenar el álbum «Fiesta»');
      expect(
        request.body,
        'action: organize\npayload: {"op":"order_album","folder_id":"$albumId","song_ids":["$b","$a"]}',
      );
      expect(
        LibraryRequest.orderAlbum(folderId: albumId, songIds: const [a]).title,
        'Ordenar el álbum $albumId',
      );
      // Los álbumes antiguos (10 hexadecimales) también valen.
      expect(
        LibraryRequest.orderAlbum(
          folderId: '0123456789',
          songIds: const [a],
        ).payload['folder_id'],
        '0123456789',
      );
    });

    test(
      'rechaza listas vacías, largas, repetidas, ids no válidos y álbum no válido',
      () {
        Matcher fails(String message) => throwsA(
          isA<AppException>().having((e) => e.message, 'message', message),
        );
        expect(
          () => LibraryRequest.orderAlbum(folderId: albumId, songIds: const []),
          fails('El álbum no tiene canciones que ordenar.'),
        );
        final many = [
          for (var i = 0; i < kMaxOrderSongs + 1; i++)
            'S${i.toRadixString(16).padLeft(16, '0')}',
        ];
        expect(
          () => LibraryRequest.orderAlbum(folderId: albumId, songIds: many),
          fails('Se pueden ordenar 190 canciones como mucho.'),
        );
        expect(
          LibraryRequest.orderAlbum(
            folderId: albumId,
            songIds: many.sublist(0, kMaxOrderSongs),
          ).payload['song_ids'],
          hasLength(190),
        );
        expect(
          () => LibraryRequest.orderAlbum(
            folderId: albumId,
            songIds: const [a, a],
          ),
          fails('Hay canciones repetidas en el orden.'),
        );
        expect(
          () => LibraryRequest.orderAlbum(
            folderId: albumId,
            songIds: const ['L1'],
          ),
          throwsA(isA<AppException>()),
        );
        expect(
          () => LibraryRequest.orderAlbum(folderId: 'Fxyz', songIds: const [a]),
          throwsA(isA<AppException>()),
        );
      },
    );

    test('190 canciones caben en los 4000 caracteres del payload', () {
      final ids = [
        for (var i = 0; i < kMaxOrderSongs; i++)
          'S${i.toRadixString(16).padLeft(16, '0')}',
      ];
      final request = LibraryRequest.orderAlbum(
        folderId: albumId,
        songIds: ids,
      );
      expect(jsonEncode(request.payload).length, lessThanOrEqualTo(4000));
    });
  });

  group('número de pista', () {
    test('Song.fromJson lee track solo si es un entero desde 1', () {
      Map<String, dynamic> raw(Object? track) => {
        'id': a,
        'title': 'T',
        'duration_s': 10,
        'audio': 'audio/$a.opus',
        'track': ?track,
      };
      expect(Song.fromJson(raw(3)).track, 3);
      expect(Song.fromJson(raw(null)).track, isNull);
      for (final bad in [0, -1, 2.5, '2', true]) {
        expect(Song.fromJson(raw(bad)).track, isNull, reason: '$bad');
      }
    });

    test(
      'sortByTrack: primero por pista, después las que no tienen, en su orden',
      () {
        final sorted = sortByTrack([
          song('S1', 'Sin pista 1'),
          song('S2', 'Pista 2', track: 2),
          song('S3', 'Sin pista 2'),
          song('S4', 'Pista 1', track: 1),
          song('S5', 'Pista 2 bis', track: 2),
        ]);
        expect(sorted.map((s) => s.id), ['S4', 'S2', 'S5', 'S1', 'S3']);
      },
    );

    testWidgets('songsInFolder sigue el número de pista', (tester) async {
      setWindow(tester, const Size(400, 1200));
      final t = buildTestServices(
        songs: [
          song(a, 'Alfa', folderId: albumId, track: 3),
          song(b, 'Beta', folderId: albumId, track: 1),
          song(c, 'Gamma', folderId: albumId),
          song(loose, 'Delta', folderId: albumId, track: 2),
        ],
        folders: const [Folder(id: albumId, name: 'Fiesta', parentId: null)],
      );
      await pumpApp(tester, t.services);
      expect(t.services.library.songsInFolder(albumId).map((s) => s.title), [
        'Beta',
        'Delta',
        'Alfa',
        'Gamma',
      ]);
    });
  });

  group('álbum: Seleccionar y Ordenar canciones', () {
    final songs = [
      song(a, 'Alfa', folderId: albumId, track: 1),
      song(b, 'Beta', folderId: albumId, track: 2),
      song(c, 'Gamma', folderId: albumId, track: 3),
      song(loose, 'Suelta'),
    ];
    const folders = [
      Folder(id: albumId, name: 'Fiesta', parentId: null),
      Folder(id: otherAlbumId, name: 'Buga', parentId: null),
    ];

    /// Abre la página del álbum «Fiesta» y devuelve la lista de peticiones enviadas.
    Future<List<LibraryRequest>> openAlbum(WidgetTester tester) async {
      setWindow(tester, const Size(500, 1400));
      final t = buildTestServices(songs: songs, folders: folders);
      await pumpApp(tester, t.services);
      await tester.tap(find.text('Fiesta').last);
      await tester.pumpAndSettle();
      return t.submitted;
    }

    Text countText(WidgetTester tester) =>
        tester.widget<Text>(find.byKey(const ValueKey('album-select-count')));

    testWidgets(
      'casillas, contador, todo y ninguna; Cancelar sale sin enviar nada',
      (tester) async {
        final submitted = await openAlbum(tester);
        expect(find.byKey(const ValueKey('album-select-bar')), findsNothing);
        await tester.tap(find.byKey(const ValueKey('album-select')));
        await tester.pumpAndSettle();
        expect(find.byKey(const ValueKey('album-select-bar')), findsOneWidget);
        expect(countText(tester).data, 'Ninguna canción elegida');
        for (final id in [a, b, c]) {
          expect(find.byKey(ValueKey('album-select-song-$id')), findsOneWidget);
        }
        FilledButton remove() => tester.widget<FilledButton>(
          find.byKey(const ValueKey('album-select-remove')),
        );
        expect(remove().onPressed, isNull);

        await tester.tap(find.byKey(const ValueKey('album-select-song-$b')));
        await tester.pumpAndSettle();
        expect(countText(tester).data, '1 seleccionada');
        expect(remove().onPressed, isNotNull);

        await tester.tap(find.byKey(const ValueKey('album-select-all')));
        await tester.pumpAndSettle();
        expect(countText(tester).data, '3 seleccionadas');

        await tester.tap(find.byKey(const ValueKey('album-select-none')));
        await tester.pumpAndSettle();
        expect(countText(tester).data, 'Ninguna canción elegida');

        await tester.tap(find.byKey(const ValueKey('album-select-cancel')));
        await tester.pumpAndSettle();
        expect(find.byKey(const ValueKey('album-select-bar')), findsNothing);
        expect(submitted, isEmpty);
      },
    );

    testWidgets(
      '«Quitar del álbum» confirma y envía UNA move_songs con folder_id null',
      (tester) async {
        final submitted = await openAlbum(tester);
        await tester.tap(find.byKey(const ValueKey('album-select')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey('album-select-song-$c')));
        await tester.tap(find.byKey(const ValueKey('album-select-song-$a')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey('album-select-remove')));
        await tester.pumpAndSettle();
        expect(
          find.text(
            '¿Quitar 2 canciones de «Fiesta»? Siguen en la biblioteca; solo dejan de estar en este álbum.',
          ),
          findsOneWidget,
        );
        // Cancelar la confirmación no envía nada y deja la selección.
        await tester.tap(find.widgetWithText(TextButton, 'Cancelar').last);
        await tester.pumpAndSettle();
        expect(submitted, isEmpty);
        expect(countText(tester).data, '2 seleccionadas');

        await tester.tap(find.byKey(const ValueKey('album-select-remove')));
        await tester.pumpAndSettle();
        await tester.tap(find.widgetWithText(FilledButton, 'Quitar'));
        await tester.pumpAndSettle();
        expect(submitted, hasLength(1));
        // En el orden del álbum, no en el orden en que se marcaron.
        expect(submitted.single.payload, {
          'op': 'move_songs',
          'song_ids': [a, c],
          'folder_id': null,
        });
        expect(find.byKey(const ValueKey('album-select-bar')), findsNothing);
        expect(find.text('Guardado.'), findsOneWidget);
      },
    );

    testWidgets('«Mover a otro álbum» elige el álbum y envía UNA move_songs', (
      tester,
    ) async {
      final submitted = await openAlbum(tester);
      await tester.tap(find.byKey(const ValueKey('album-select')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('album-select-all')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('album-select-move')));
      await tester.pumpAndSettle();
      expect(find.text('Mover 3 canciones a otro álbum'), findsOneWidget);
      // El álbum actual no se ofrece como destino.
      expect(
        find.byKey(const ValueKey('album-move-target-$albumId')),
        findsNothing,
      );
      await tester.tap(
        find.byKey(const ValueKey('album-move-target-$otherAlbumId')),
      );
      await tester.pumpAndSettle();
      expect(submitted.single.payload, {
        'op': 'move_songs',
        'song_ids': [a, b, c],
        'folder_id': otherAlbumId,
      });
      expect(submitted.single.title, 'Añadir 3 canciones al álbum «Buga»');
    });

    testWidgets(
      '«Ordenar canciones»: Guardar orden solo con cambios y UNA order_album completa',
      (tester) async {
        final submitted = await openAlbum(tester);
        await tester.tap(find.byTooltip('Más opciones de «Fiesta»'));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey('album-menu-order')));
        await tester.pumpAndSettle();
        expect(find.text('Ordenar canciones'), findsOneWidget);
        FilledButton save() => tester.widget<FilledButton>(
          find.byKey(const ValueKey('order-album-save')),
        );
        expect(save().onPressed, isNull);
        // La primera no se puede subir ni la última bajar.
        expect(
          tester
              .widget<IconButton>(find.byKey(const ValueKey('order-up-$a')))
              .onPressed,
          isNull,
        );
        expect(
          tester
              .widget<IconButton>(find.byKey(const ValueKey('order-down-$c')))
              .onPressed,
          isNull,
        );

        await tester.tap(find.byKey(const ValueKey('order-down-$a')));
        await tester.pumpAndSettle();
        expect(find.text('«Alfa» ahora es la 2 de 3.'), findsOneWidget);
        expect(save().onPressed, isNotNull);
        // Volver al orden de antes desactiva «Guardar orden».
        await tester.tap(find.byKey(const ValueKey('order-up-$a')));
        await tester.pumpAndSettle();
        expect(save().onPressed, isNull);

        await tester.tap(find.byTooltip('Subir «Gamma»'));
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Subir «Gamma»'));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey('order-album-save')));
        await tester.pumpAndSettle();
        expect(submitted, hasLength(1));
        expect(submitted.single.payload, {
          'op': 'order_album',
          'folder_id': albumId,
          'song_ids': [c, a, b],
        });
        expect(submitted.single.title, 'Ordenar el álbum «Fiesta»');
        expect(find.text('Guardado.'), findsOneWidget);
      },
    );

    testWidgets('arrastrar con ReorderableListView también cambia el orden', (
      tester,
    ) async {
      final submitted = await openAlbum(tester);
      await tester.tap(find.byTooltip('Más opciones de «Fiesta»'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('album-menu-order')));
      await tester.pumpAndSettle();
      final list = tester.widget<ReorderableListView>(
        find.byKey(const ValueKey('order-album-list')),
      );
      list.onReorderItem!(0, 2);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('order-album-save')));
      await tester.pumpAndSettle();
      expect(submitted.single.payload['song_ids'], [b, c, a]);
    });

    testWidgets(
      'un álbum de una sola canción no ofrece «Ordenar canciones» y uno de más de 190 no deja guardar',
      (tester) async {
        setWindow(tester, const Size(500, 1400));
        final many = [
          for (var i = 0; i < kMaxOrderSongs + 1; i++)
            song(
              'S${i.toRadixString(16).padLeft(16, '0')}',
              'Tema $i',
              folderId: albumId,
              track: i + 1,
            ),
        ];
        final t = buildTestServices(
          songs: [
            ...many,
            song(loose, 'Sola', folderId: otherAlbumId),
          ],
          folders: folders,
        );
        await pumpApp(tester, t.services);
        await tester.tap(find.text('Buga').last);
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Más opciones de «Buga»'));
        await tester.pumpAndSettle();
        expect(find.byKey(const ValueKey('album-menu-order')), findsNothing);
        Navigator.of(tester.element(find.text('Editar detalles'))).pop();
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Volver'));
        await tester.pumpAndSettle();

        await tester.tap(find.text('Fiesta').last);
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Más opciones de «Fiesta»'));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey('album-menu-order')));
        await tester.pumpAndSettle();
        expect(
          find.text(
            'Este álbum tiene más de 190 canciones: no se puede ordenar desde aquí.',
          ),
          findsOneWidget,
        );
        expect(
          tester
              .widget<FilledButton>(
                find.byKey(const ValueKey('order-album-save')),
              )
              .onPressed,
          isNull,
        );
        expect(t.submitted, isEmpty);
      },
    );
  });

  group('accesibilidad de las pantallas nuevas', () {
    Future<void> checkGuidelines(WidgetTester tester) async {
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
    }

    final songs = [
      song(a, 'Alfa', folderId: albumId, track: 1),
      song(b, 'Beta', folderId: albumId, track: 2),
    ];
    const folders = [Folder(id: albumId, name: 'Fiesta', parentId: null)];

    testWidgets(
      'el modo «Seleccionar» y «Ordenar canciones» cumplen las pautas',
      (tester) async {
        setWindow(tester, const Size(500, 1400));
        final handle = tester.ensureSemantics();
        final t = buildTestServices(songs: songs, folders: folders);
        await pumpApp(tester, t.services);
        await tester.tap(find.text('Fiesta').last);
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey('album-select')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey('album-select-song-$a')));
        await tester.pumpAndSettle();
        await checkGuidelines(tester);
        await tester.tap(find.byKey(const ValueKey('album-select-cancel')));
        await tester.pumpAndSettle();

        await tester.tap(find.byTooltip('Más opciones de «Fiesta»'));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey('album-menu-order')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey('order-down-$a')));
        await tester.pumpAndSettle();
        await checkGuidelines(tester);
        handle.dispose();
      },
    );
  });

  group('aviso de duplicados al subir', () {
    Future<Set<int>?> runReview(
      WidgetTester tester,
      List<PickedAudioFile> files, {
      Map<String, double> durations = const {},
    }) async {
      final t = buildTestServices(
        songs: [song(a, 'Corazón de mimbre', folderId: albumId)],
        probeDuration: (path) async => durations[path],
      );
      await t.services.library.load();
      Set<int>? result;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => TextButton(
              onPressed: () async {
                result = await reviewUploadDuplicates(
                  context,
                  t.services,
                  files,
                );
              },
              child: const Text('Subir'),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Subir'));
      await tester.pumpAndSettle();
      return Future.value(result);
    }

    testWidgets('«Subir igualmente» la deja y «Quitar de la cola» la quita', (
      tester,
    ) async {
      Set<int>? result;
      final t = buildTestServices(
        songs: [song(a, 'Corazón de mimbre', folderId: albumId)],
        probeDuration: (path) async =>
            {'/x/1.mp3': 202.0, '/x/2.mp3': 100.0, '/x/3.mp3': 101.0}[path],
      );
      await t.services.library.load();
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => TextButton(
              onPressed: () async {
                result =
                    await reviewUploadDuplicates(context, t.services, const [
                      PickedAudioFile(
                        name: 'Corazon de mimbre (Official Video).mp3',
                        path: '/x/1.mp3',
                      ),
                      PickedAudioFile(name: 'Otra.mp3', path: '/x/2.mp3'),
                      PickedAudioFile(name: 'otra [HD].mp3', path: '/x/3.mp3'),
                    ]);
              },
              child: const Text('Subir'),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Subir'));
      await tester.pumpAndSettle();
      expect(
        find.text(
          'Parece que ya está en la biblioteca: «Corazón de mimbre» (3:21). ¿Subirla igualmente?',
        ),
        findsOneWidget,
      );
      expect(
        find.text('Corazon de mimbre (Official Video).mp3'),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const ValueKey('duplicate-keep')));
      await tester.pumpAndSettle();
      expect(
        find.text(
          'Parece repetida en esta subida: «Otra» (1:40). ¿Subirla igualmente?',
        ),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const ValueKey('duplicate-drop')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('duplicate-dialog')), findsNothing);
      expect(result, {2});
    });

    testWidgets('sin parecidos no pregunta nada', (tester) async {
      final result = await runReview(tester, const [
        PickedAudioFile(name: 'Nueva.mp3', path: '/x/n.mp3'),
      ]);
      expect(find.byKey(const ValueKey('duplicate-dialog')), findsNothing);
      expect(result, isEmpty);
    });
  });
}
