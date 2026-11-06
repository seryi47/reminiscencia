import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/app_error.dart';
import 'package:reminiscencia/collections.dart';
import 'package:reminiscencia/song.dart';
import 'package:reminiscencia/ui/cards.dart';
import 'package:reminiscencia/ui/common.dart';
import 'package:reminiscencia/ui/library_edit.dart';
import 'package:reminiscencia/ui/player.dart';
import 'package:reminiscencia/ui/song_row.dart';

import 'support/fakes.dart';

const songId = 'S5aac103b6eb2ecf4';
const otherId = 'S0000000000000001';
const albumId = 'F0123456789abcdef';
const oldAlbumId = '0123456789';

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

  group('edición sin GitHub', () {
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
        expect(
          find.byKey(const ValueKey('remove-from-album')),
          findsNothing,
          reason: 'solo se ofrece desde la página del álbum',
        );
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

      expect(find.textContaining('sin pasar por GitHub'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('request-field-0')), '   ');
      await tester.tap(find.text('Guardar'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('request-error')), findsOneWidget);
      expect(t.submitted, isEmpty, reason: 'no se envía nada que no valga');

      await tester.enterText(
        find.byKey(const Key('request-field-0')),
        'Charleston (Fox Trot)',
      );
      await tester.enterText(
        find.byKey(const Key('request-field-1')),
        'The Golden Gate Orchestra',
      );
      await tester.tap(find.text('Guardar'));
      await tester.pumpAndSettle();
      expect(t.submitted.single.payload, {
        'op': 'edit_song',
        'song_id': songId,
        'title': 'Charleston (Fox Trot)',
        'artist': 'The Golden Gate Orchestra',
      });
      expect(t.submitted.single.title, 'Editar la canción $songId');
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
      expect(t.submitted.single.payload, {
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
      await tester.tap(find.text('Guardar'));
      await tester.pumpAndSettle();
      expect(t.submitted.single.payload, {
        'op': 'create_folder',
        'name': 'Boleros',
        'artist': 'Antonio Machín',
      });
    });

    testWidgets(
      '«Cambiar portada» recorta la imagen elegida y la envía con el ID',
      (tester) async {
        setWindow(tester, const Size(400, 1000));
        final t = buildTestServices(
          songs: songs,
          folders: folders,
          pickImage: () async => kTinyPng,
        );
        await pumpApp(tester, t.services);
        await openSongMenu(tester);
        await tester.tap(find.text('Cambiar portada'));
        await tester.pumpAndSettle();

        expect(t.submittedCovers.single.id, songId);
        expect(t.submittedCovers.single.jpeg.sublist(0, 2), [0xff, 0xd8]);
        expect(find.text('Guardado.'), findsOneWidget);
      },
    );

    testWidgets('un error al guardar se ve en un aviso', (tester) async {
      setWindow(tester, const Size(400, 1000));
      final t = buildTestServices(
        songs: songs,
        folders: folders,
        submitError: const AppException('El token no vale.'),
      );
      await pumpApp(tester, t.services);
      await openSongMenu(tester);
      await tester.tap(find.text('Crear álbum'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('request-field-0')), 'X');
      await tester.tap(find.text('Guardar'));
      await tester.pumpAndSettle();
      expect(find.text('El token no vale.'), findsOneWidget);
    });

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
        await tester.tap(find.text('Guardar'));
        await tester.pumpAndSettle();
        expect(t.submitted.single.payload, {
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

    Future<void> openAddSongsSheet(WidgetTester tester) async {
      await tester.tap(find.text('Jazz de los años 20').last);
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Más opciones de «Jazz de los años 20»'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Añadir canciones a este álbum'));
      await tester.pumpAndSettle();
    }

    const besameId = 'S00000000000000b1';
    const pagaId = 'S00000000000000b2';
    final pickerSongs = [
      ...songs,
      const Song(
        id: besameId,
        title: 'Bésame mucho',
        artist: 'Consuelo Velázquez',
        year: 1940,
        tags: [],
        folderId: oldAlbumId,
        durationS: 180,
        license: 'Dominio público',
        audio: 'audio/$besameId.opus',
      ),
      const Song(
        id: pagaId,
        title: 'La bien pagá',
        artist: 'Miguel de Molina',
        year: 1936,
        tags: [],
        folderId: oldAlbumId,
        durationS: 190,
        license: 'Dominio público',
        audio: 'audio/$pagaId.opus',
      ),
      fakeSong('s-local'),
    ];

    testWidgets(
      '«Añadir canciones a este álbum» busca sin tildes y no lista las que ya están ni las del teléfono',
      (tester) async {
        setWindow(tester, const Size(400, 1000));
        final t = buildTestServices(songs: pickerSongs, folders: folders);
        await pumpApp(tester, t.services);
        await openAddSongsSheet(tester);
        final sheet = find.byType(BottomSheet);
        Finder inSheet(String text) =>
            find.descendant(of: sheet, matching: find.text(text));

        expect(inSheet('Charleston'), findsNothing, reason: 'ya está');
        expect(inSheet('Canción s-local'), findsNothing, reason: 'local');
        expect(inSheet('Canción $otherId'), findsOneWidget);
        expect(inSheet('Bésame mucho'), findsOneWidget);
        expect(inSheet('La bien pagá'), findsOneWidget);
        final submit = find.byKey(const ValueKey('add-songs-submit'));
        expect(tester.widget<FilledButton>(submit).onPressed, isNull);
        expect(inSheet('Añadir (0)'), findsOneWidget);

        final search = find.byKey(const ValueKey('add-songs-search'));
        expect(tester.widget<TextField>(search).autofocus, isTrue);
        await tester.enterText(search, 'BESAME');
        await tester.pumpAndSettle();
        expect(inSheet('Bésame mucho'), findsOneWidget);
        expect(inSheet('La bien pagá'), findsNothing);
        expect(inSheet('Canción $otherId'), findsNothing);

        // Por el nombre del álbum en el que está ahora.
        await tester.enterText(search, 'coplas');
        await tester.pumpAndSettle();
        expect(inSheet('Bésame mucho'), findsOneWidget);
        expect(inSheet('La bien pagá'), findsOneWidget);
        expect(inSheet('Canción $otherId'), findsNothing);

        await tester.enterText(search, 'zzzz');
        await tester.pumpAndSettle();
        expect(inSheet('Ninguna canción coincide con «zzzz».'), findsOneWidget);

        await tester.tap(find.byKey(const ValueKey('add-songs-search-clear')));
        await tester.pumpAndSettle();
        expect(inSheet('Canción $otherId'), findsOneWidget);
        expect(t.submitted, isEmpty);
      },
    );

    testWidgets(
      'marca varias en búsquedas distintas y envía UNA petición move_songs',
      (tester) async {
        setWindow(tester, const Size(400, 1000));
        final t = buildTestServices(songs: pickerSongs, folders: folders);
        await pumpApp(tester, t.services);
        await openAddSongsSheet(tester);
        final search = find.byKey(const ValueKey('add-songs-search'));

        await tester.enterText(search, 'molina');
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey('add-song-$pagaId')));
        await tester.pumpAndSettle();
        expect(find.text('1 seleccionada'), findsOneWidget);

        await tester.enterText(search, 'bessie');
        await tester.pumpAndSettle();
        expect(find.byKey(const ValueKey('add-song-$pagaId')), findsNothing);
        await tester.tap(find.byKey(const ValueKey('add-song-$otherId')));
        await tester.pumpAndSettle();
        expect(find.text('2 seleccionadas'), findsOneWidget);
        expect(find.text('Añadir (2)'), findsOneWidget);

        // La selección se mantiene al cambiar la búsqueda.
        await tester.enterText(search, '');
        await tester.pumpAndSettle();
        bool checked(String id) => tester
            .widget<CheckboxListTile>(find.byKey(ValueKey('add-song-$id')))
            .value!;
        expect(checked(pagaId), isTrue);
        expect(checked(otherId), isTrue);
        expect(checked(besameId), isFalse);

        await tester.tap(find.byKey(const ValueKey('add-songs-submit')));
        await tester.pumpAndSettle();
        expect(t.submitted, hasLength(1));
        expect(t.submitted.single.payload, {
          'op': 'move_songs',
          'song_ids': [otherId, pagaId],
          'folder_id': albumId,
        });
        expect(
          t.submitted.single.title,
          'Añadir 2 canciones al álbum «Jazz de los años 20»',
        );
        expect(find.byType(BottomSheet), findsNothing);
        expect(find.text('Guardado.'), findsOneWidget);
      },
    );

    testWidgets(
      '«Quitar de este álbum» solo en el álbum; confirma y envía edit_song con folder_id null',
      (tester) async {
        setWindow(tester, const Size(400, 1000));
        final t = buildTestServices(songs: songs, folders: folders);
        await pumpApp(tester, t.services);
        await tester.tap(find.text('Jazz de los años 20').last);
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Más opciones de «Charleston»'));
        await tester.pumpAndSettle();
        final remove = find.byKey(const ValueKey('remove-from-album'));
        expect(remove, findsOneWidget);
        expect(find.text('Quitar de este álbum'), findsOneWidget);

        // Cancelar no envía nada.
        await tester.tap(remove);
        await tester.pumpAndSettle();
        expect(
          find.text(
            '¿Quitar «Charleston» de «Jazz de los años 20»? La canción sigue en la biblioteca; solo deja de estar en este álbum.',
          ),
          findsOneWidget,
        );
        await tester.tap(find.text('Cancelar'));
        await tester.pumpAndSettle();
        expect(t.submitted, isEmpty);

        await tester.tap(find.byTooltip('Más opciones de «Charleston»'));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey('remove-from-album')));
        await tester.pumpAndSettle();
        await tester.tap(find.widgetWithText(FilledButton, 'Quitar'));
        await tester.pumpAndSettle();
        expect(t.submitted.single.payload, {
          'op': 'edit_song',
          'song_id': songId,
          'folder_id': null,
        });
      },
    );
  });

  group('filtro de «Añadir canciones a este álbum»', () {
    final albums = {albumId: 'Jazz de los años 20', oldAlbumId: 'Coplas'};
    String albumOf(Song song) => albums[song.folderId] ?? '';
    List<String> ids(String query) => filterSongsForAlbumPicker(
      songs,
      query,
      albumName: albumOf,
    ).map((song) => song.id).toList();

    test('sin texto devuelve todas, en el mismo orden', () {
      expect(ids(''), [songId, otherId]);
      expect(ids('   '), [songId, otherId]);
    });

    test('por título, artista y álbum, sin tildes ni mayúsculas', () {
      expect(ids('CHARLESTON'), [songId]);
      expect(ids('bessie'), [otherId]);
      expect(ids('anos 20'), [songId], reason: 'álbum, sin tilde');
      expect(ids('orquesta jazz'), [songId], reason: 'cada palabra');
    });

    test(
      'la regla común de búsqueda: año, etiquetas y una errata (ADR-0028)',
      () {
        expect(ids('1925'), [songId]);
        expect(ids('jazz'), [songId, otherId], reason: 'etiqueta de las dos');
        expect(ids('charlestom'), [songId]);
        expect(ids('1926'), isEmpty, reason: 'los números no admiten erratas');
        expect(ids('ton'), isEmpty, reason: 'no busca en mitad de una palabra');
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

    testWidgets('las listas propias no ofrecen acciones de edición', (
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
      expect(find.text('Guardar'), findsNothing);
      expect(find.byTooltip('Más opciones de «Tardes»'), findsNothing);
    });
  });
}
