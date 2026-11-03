import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/collections.dart';
import 'package:reminiscencia/song.dart';
import 'package:reminiscencia/ui/cards.dart';
import 'package:reminiscencia/ui/common.dart';
import 'package:reminiscencia/ui/player.dart';
import 'package:reminiscencia/ui/song_row.dart';

import 'support/fakes.dart';

const songId = 'S5aac103b6eb2ecf4';
const otherId = 'S0000000000000001';
const albumId = 'F0123456789abcdef';
const oldAlbumId = '0123456789';

/// Cuerpo de la incidencia abierta: payload ya decodificado.
Map<String, Object?> openedPayload(Uri uri) {
  expect(uri.host, 'github.com');
  expect(uri.path, '/seryi47/reminiscencia/issues/new');
  expect(uri.queryParameters['labels'], 'biblioteca');
  final body = uri.queryParameters['body']!;
  final lines = body.split('\n');
  expect(lines.first, 'action: organize');
  return (jsonDecode(lines.last.substring('payload: '.length)) as Map)
      .cast<String, Object?>();
}

/// Imagen mostrada por la portada que contiene [finder] (null si es solo el degradado).
ImageProvider? coverImageIn(WidgetTester tester, Finder finder) {
  final art = tester.widget<CoverArt>(
    find.descendant(of: finder, matching: find.byType(CoverArt)).first,
  );
  return art.image;
}

void main() {
  final songs = [
    Song(
      id: songId,
      title: 'Charleston',
      artist: 'Orquesta',
      year: 1925,
      tags: const ['jazz'],
      folderId: albumId,
      durationS: 185,
      license: 'Dominio público',
      audio: 'audio/$songId.opus',
      cover: 'covers/$songId.jpg',
    ),
    fakeSong(otherId, artist: 'Bessie Smith'),
  ];
  final folders = [
    const Folder(
      id: albumId,
      name: 'Jazz de los años 20',
      parentId: null,
      artist: 'Varios',
      cover: 'covers/$albumId.jpg',
    ),
    const Folder(id: oldAlbumId, name: 'Coplas', parentId: null),
  ];
  const covers = ['covers/$songId.jpg', 'covers/$albumId.jpg'];

  group('portadas', () {
    testWidgets(
      'se ven en tarjetas, filas, minirreproductor y reproductor completo',
      (tester) async {
        setWindow(tester, const Size(400, 1400));
        final t = buildTestServices(
          songs: songs,
          folders: folders,
          availableCovers: covers,
        );
        await pumpApp(tester, t.services);

        // Estante «Añadidas recientemente»: la canción con portada y la que no tiene.
        final cards = find.byType(ShelfCard);
        final charleston = find.ancestor(
          of: find.text('Charleston').first,
          matching: cards,
        );
        expect(coverImageIn(tester, charleston), isA<MemoryImage>());
        final plain = find.ancestor(
          of: find.text('Canción $otherId').first,
          matching: cards,
        );
        expect(
          coverImageIn(tester, plain),
          isNull,
          reason: 'sin portada: degradado',
        );
        // Tarjeta del álbum.
        final album = find.ancestor(
          of: find.text('Jazz de los años 20').last,
          matching: cards,
        );
        expect(coverImageIn(tester, album), isA<MemoryImage>());

        // Página del álbum: cabecera y filas.
        await tester.tap(find.text('Jazz de los años 20').last);
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('cover-image')), findsWidgets);
        final row = find.byType(SongRow);
        expect(coverImageIn(tester, row), isA<MemoryImage>());

        // Minirreproductor y reproductor completo.
        await tester.tap(row);
        await settle(tester);
        expect(
          coverImageIn(tester, find.byType(MiniPlayer)),
          isA<MemoryImage>(),
        );
        await tester.tap(find.byKey(const Key('mini-player-open')));
        await tester.pumpAndSettle();
        expect(
          coverImageIn(tester, find.byKey(const Key('player-artwork'))),
          isA<MemoryImage>(),
        );
      },
    );

    testWidgets(
      'una portada que llega después se pinta sin recargar la página',
      (tester) async {
        setWindow(tester, const Size(400, 900));
        final t = buildTestServices(songs: songs, folders: folders);
        await pumpApp(tester, t.services);
        await tester.tap(find.text('Jazz de los años 20').last);
        await tester.pumpAndSettle();
        final row = find.byType(SongRow);
        expect(coverImageIn(tester, row), isNull);
        expect(t.covers.requested, contains('covers/$songId.jpg'));

        t.covers.arrive('covers/$songId.jpg');
        await tester.pump();
        expect(coverImageIn(tester, row), isA<MemoryImage>());
      },
    );
  });

  group('álbumes', () {
    testWidgets('«Carpetas» pasa a «Álbumes» con el artista como subtítulo', (
      tester,
    ) async {
      setWindow(tester, const Size(400, 1400));
      final t = buildTestServices(songs: songs, folders: folders);
      await pumpApp(tester, t.services);

      expect(find.text('Álbumes'), findsOneWidget);
      expect(
        find.text('Varios'),
        findsWidgets,
        reason: 'artista en la tarjeta',
      );
      expect(find.textContaining('Carpeta'), findsNothing);

      await tester.tap(find.text('Tu biblioteca'));
      await settle(tester);
      await tester.tap(find.widgetWithText(ChoiceChip, 'Álbumes'));
      await settle(tester);
      expect(find.text('Álbum · Varios · 1 canción'), findsOneWidget);
      expect(find.text('Álbum · 0 canciones'), findsOneWidget);
      expect(find.textContaining('Carpeta'), findsNothing);

      await tester.tap(find.text('Jazz de los años 20'));
      await tester.pumpAndSettle();
      expect(find.text('Álbum · Varios · 1 canción · 3 min'), findsOneWidget);
    });

    testWidgets('Buscar encuentra un álbum por su artista', (tester) async {
      setWindow(tester, const Size(400, 900));
      final t = buildTestServices(songs: songs, folders: folders);
      await pumpApp(tester, t.services);
      await tester.tap(find.text('Buscar'));
      await settle(tester);
      await tester.enterText(find.byKey(const Key('search-field')), 'varios');
      await settle(tester);
      expect(find.text('Jazz de los años 20'), findsOneWidget);
      expect(find.text('Álbum · Varios'), findsOneWidget);
    });
  });

  group('edición por GitHub', () {
    Future<void> openSongMenu(WidgetTester tester) async {
      await tester.tap(find.text('Tu biblioteca'));
      await settle(tester);
      await tester.tap(find.text('Todas las canciones'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Más opciones de «Charleston»'));
      await tester.pumpAndSettle();
    }

    testWidgets(
      'el menú de canción tiene las cuatro acciones; las subidas al teléfono no',
      (tester) async {
        setWindow(tester, const Size(400, 1000));
        final t = buildTestServices(
          songs: [...songs, fakeSong('s-local')],
          folders: folders,
        );
        await pumpApp(tester, t.services);
        await openSongMenu(tester);
        for (final label in [
          'Editar detalles',
          'Añadir a un álbum',
          'Crear álbum',
          'Cambiar portada',
        ]) {
          expect(find.text(label), findsOneWidget, reason: label);
        }
        Navigator.of(tester.element(find.text('Editar detalles'))).pop();
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Más opciones de «Canción s-local»'));
        await tester.pumpAndSettle();
        expect(find.text('Editar detalles'), findsNothing);
        expect(find.text('Añadir a una lista'), findsOneWidget);
      },
    );

    testWidgets('«Editar detalles» valida y abre la incidencia edit_song', (
      tester,
    ) async {
      setWindow(tester, const Size(400, 1000));
      final t = buildTestServices(songs: songs, folders: folders);
      await pumpApp(tester, t.services);
      await openSongMenu(tester);
      await tester.tap(find.text('Editar detalles'));
      await tester.pumpAndSettle();

      expect(find.textContaining('permiso de escritura'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('request-field-0')), '   ');
      await tester.tap(find.text('Abrir GitHub'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('request-error')), findsOneWidget);
      expect(t.openedUrls, isEmpty, reason: 'no se abre nada que no valga');

      await tester.enterText(
        find.byKey(const Key('request-field-0')),
        'Charleston (Fox Trot)',
      );
      await tester.enterText(
        find.byKey(const Key('request-field-1')),
        'The Golden Gate Orchestra',
      );
      await tester.tap(find.text('Abrir GitHub'));
      await tester.pumpAndSettle();
      expect(openedPayload(t.openedUrls.single), {
        'op': 'edit_song',
        'song_id': songId,
        'title': 'Charleston (Fox Trot)',
        'artist': 'The Golden Gate Orchestra',
      });
      expect(
        t.openedUrls.single.queryParameters['title'],
        'Editar la canción $songId',
      );
    });

    testWidgets('«Añadir a un álbum» abre edit_song con folder_id', (
      tester,
    ) async {
      setWindow(tester, const Size(400, 1000));
      final t = buildTestServices(songs: songs, folders: folders);
      await pumpApp(tester, t.services);
      await openSongMenu(tester);
      await tester.tap(find.text('Añadir a un álbum'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Coplas'));
      await tester.pumpAndSettle();
      expect(openedPayload(t.openedUrls.single), {
        'op': 'edit_song',
        'song_id': songId,
        'folder_id': oldAlbumId,
      });
    });

    testWidgets('«Crear álbum» abre create_folder con nombre y artista', (
      tester,
    ) async {
      setWindow(tester, const Size(400, 1000));
      final t = buildTestServices(songs: songs, folders: folders);
      await pumpApp(tester, t.services);
      await openSongMenu(tester);
      await tester.tap(find.text('Crear álbum'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('request-field-0')),
        'Boleros',
      );
      await tester.enterText(
        find.byKey(const Key('request-field-1')),
        'Antonio Machín',
      );
      await tester.tap(find.text('Abrir GitHub'));
      await tester.pumpAndSettle();
      expect(openedPayload(t.openedUrls.single), {
        'op': 'create_folder',
        'name': 'Boleros',
        'artist': 'Antonio Machín',
      });
    });

    testWidgets(
      '«Cambiar portada» muestra el ID, lo copia y abre el buzón de portadas',
      (tester) async {
        setWindow(tester, const Size(400, 1000));
        final copied = <String>[];
        tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          SystemChannels.platform,
          (call) async {
            if (call.method == 'Clipboard.setData') {
              copied.add((call.arguments as Map)['text'] as String);
            }
            return null;
          },
        );
        addTearDown(
          () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
            SystemChannels.platform,
            null,
          ),
        );
        final t = buildTestServices(songs: songs, folders: folders);
        await pumpApp(tester, t.services);
        await openSongMenu(tester);
        await tester.tap(find.text('Cambiar portada'));
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('cover-id')), findsOneWidget);
        expect(find.text(songId), findsOneWidget);
        expect(find.textContaining('permiso de escritura'), findsOneWidget);
        await tester.tap(find.byKey(const Key('copy-cover-id')));
        await tester.pumpAndSettle();
        expect(copied, [songId]);

        await tester.tap(find.text('Abrir GitHub'));
        await tester.pumpAndSettle();
        expect(
          t.openedUrls.single.toString(),
          'https://github.com/seryi47/reminiscencia/upload/main/audio-library/buzon/portadas',
        );
      },
    );

    testWidgets(
      'el menú del álbum edita con edit_folder; «Cambiar portada» solo en álbumes F',
      (tester) async {
        setWindow(tester, const Size(400, 1000));
        final t = buildTestServices(songs: songs, folders: folders);
        await pumpApp(tester, t.services);
        await tester.tap(find.text('Jazz de los años 20').last);
        await tester.pumpAndSettle();
        await tester.tap(
          find.byTooltip('Más opciones de «Jazz de los años 20»'),
        );
        await tester.pumpAndSettle();
        for (final label in [
          'Editar detalles',
          'Añadir canciones a este álbum',
          'Crear álbum',
          'Cambiar portada',
        ]) {
          expect(find.text(label), findsOneWidget, reason: label);
        }
        await tester.tap(find.text('Editar detalles'));
        await tester.pumpAndSettle();
        await tester.enterText(
          find.byKey(const Key('request-field-1')),
          'Orquestas de baile',
        );
        await tester.tap(find.text('Abrir GitHub'));
        await tester.pumpAndSettle();
        expect(openedPayload(t.openedUrls.single), {
          'op': 'edit_folder',
          'folder_id': albumId,
          'name': 'Jazz de los años 20',
          'artist': 'Orquestas de baile',
        });

        // Un álbum antiguo (10 hexadecimales) se edita, pero su portada no se cambia por el buzón.
        await tester.tap(find.byTooltip('Volver'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Coplas').last);
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Más opciones de «Coplas»'));
        await tester.pumpAndSettle();
        expect(find.text('Editar detalles'), findsOneWidget);
        expect(find.text('Cambiar portada'), findsNothing);
      },
    );

    testWidgets(
      '«Añadir canciones a este álbum» abre edit_song hacia ese álbum',
      (tester) async {
        setWindow(tester, const Size(400, 1000));
        final t = buildTestServices(songs: songs, folders: folders);
        await pumpApp(tester, t.services);
        await tester.tap(find.text('Jazz de los años 20').last);
        await tester.pumpAndSettle();
        await tester.tap(
          find.byTooltip('Más opciones de «Jazz de los años 20»'),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.text('Añadir canciones a este álbum'));
        await tester.pumpAndSettle();
        final sheet = find.byType(BottomSheet);
        expect(
          find.descendant(of: sheet, matching: find.text('Charleston')),
          findsNothing,
          reason: 'ya está en el álbum',
        );
        await tester.tap(
          find.descendant(of: sheet, matching: find.text('Canción $otherId')),
        );
        await tester.pumpAndSettle();
        expect(openedPayload(t.openedUrls.single), {
          'op': 'edit_song',
          'song_id': otherId,
          'folder_id': albumId,
        });
      },
    );
  });

  group('listas propias', () {
    testWidgets('nombre, descripción y portada elegida del teléfono', (
      tester,
    ) async {
      setWindow(tester, const Size(400, 1000));
      final initial = Collections();
      initial.createPlaylist(id: 'a', name: 'Tardes');
      final t = buildTestServices(
        songs: songs,
        folders: folders,
        collections: initial,
        pickImage: () async => kTinyPng,
      );
      await pumpApp(tester, t.services);
      await tester.tap(find.text('Tu biblioteca'));
      await settle(tester);
      await tester.tap(find.text('Tardes'));
      await tester.pumpAndSettle();

      await tester.tap(find.byTooltip('Editar detalles'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('playlist-name')),
        'Tardes de domingo',
      );
      await tester.enterText(
        find.byKey(const Key('playlist-description')),
        'Para merendar',
      );
      await tester.tap(find.text('Guardar'));
      await tester.pumpAndSettle();
      expect(find.text('Tardes de domingo'), findsWidgets);
      expect(find.byKey(const Key('collection-description')), findsOneWidget);
      expect(
        t.repository.stored.playlistOrNull('a')!.description,
        'Para merendar',
      );

      await tester.tap(find.byTooltip('Cambiar portada'));
      await tester.pumpAndSettle();
      expect(find.textContaining('640 px'), findsOneWidget);
      await tester.tap(find.byKey(const Key('playlist-cover-pick')));
      await tester.pumpAndSettle();
      final saved = t.repository.stored.playlistOrNull('a')!.coverFile;
      expect(saved, isNotNull);
      expect(t.playlistCovers.files[saved], kTinyPng);
      expect(
        coverImageIn(tester, find.byType(CustomScrollView)),
        isA<FileImage>(),
      );

      await tester.tap(find.byTooltip('Cambiar portada'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('playlist-cover-remove')));
      await tester.pumpAndSettle();
      expect(t.repository.stored.playlistOrNull('a')!.coverFile, isNull);
      expect(t.playlistCovers.deleted, [saved]);
    });

    testWidgets('las listas propias no ofrecen acciones de GitHub', (
      tester,
    ) async {
      setWindow(tester, const Size(400, 1000));
      final initial = Collections();
      initial.createPlaylist(id: 'a', name: 'Tardes');
      final t = buildTestServices(songs: songs, collections: initial);
      await pumpApp(tester, t.services);
      await tester.tap(find.text('Tu biblioteca'));
      await settle(tester);
      await tester.tap(find.text('Tardes'));
      await tester.pumpAndSettle();
      expect(find.text('Abrir GitHub'), findsNothing);
      expect(find.byTooltip('Más opciones de «Tardes»'), findsNothing);
    });
  });
}
