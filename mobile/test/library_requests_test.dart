import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/app_error.dart';
import 'package:reminiscencia/library_requests.dart';

const songId = 'S5aac103b6eb2ecf4';
const albumId = 'F0123456789abcdef';
const oldAlbumId = '0123456789';

/// Payload (ya decodificado) de una línea «payload: …» del cuerpo.
Map<String, Object?> payloadOf(String body) {
  final lines = body.split('\n');
  expect(lines, hasLength(2));
  expect(lines.first, 'action: organize');
  expect(lines.last, startsWith('payload: '));
  final json = lines.last.substring('payload: '.length);
  expect(json, isNot(contains('\n')));
  return (jsonDecode(json) as Map).cast<String, Object?>();
}

void main() {
  group('formato de las peticiones', () {
    test('Editar detalles de una canción: edit_song con título y artista', () {
      final request = LibraryRequest.editSong(
        songId: songId,
        title: '  Charleston  ',
        artist: 'Orquesta',
      );
      expect(
        request.body,
        'action: organize\npayload: {"op":"edit_song","song_id":"$songId","title":"Charleston","artist":"Orquesta"}',
      );
      expect(request.title, 'Editar la canción $songId');
    });

    test(
      'Añadir a un álbum: edit_song con folder_id (nuevo, antiguo o null)',
      () {
        expect(
          payloadOf(
            LibraryRequest.moveSong(
              songId: songId,
              folderId: albumId,
              albumName: 'Jazz',
            ).body,
          ),
          {'op': 'edit_song', 'song_id': songId, 'folder_id': albumId},
        );
        expect(
          payloadOf(
            LibraryRequest.moveSong(songId: songId, folderId: oldAlbumId).body,
          ),
          {'op': 'edit_song', 'song_id': songId, 'folder_id': oldAlbumId},
        );
        final out = LibraryRequest.moveSong(songId: songId, folderId: null);
        expect(
          out.body,
          'action: organize\npayload: {"op":"edit_song","song_id":"$songId","folder_id":null}',
        );
        expect(
          LibraryRequest.moveSong(
            songId: songId,
            folderId: albumId,
            albumName: 'Jazz',
          ).title,
          'Mover la canción $songId al álbum «Jazz»',
        );
      },
    );

    test('Crear álbum: create_folder con nombre y artista', () {
      final request = LibraryRequest.createAlbum(name: 'Coplas', artist: '');
      expect(payloadOf(request.body), {
        'op': 'create_folder',
        'name': 'Coplas',
        'artist': '',
      });
      expect(request.title, 'Crear el álbum «Coplas»');
    });

    test('Editar detalles de un álbum: edit_folder con nombre y artista', () {
      for (final id in [albumId, oldAlbumId]) {
        final request = LibraryRequest.editAlbum(
          folderId: id,
          name: 'Coplas',
          artist: 'Concha Piquer',
        );
        expect(payloadOf(request.body), {
          'op': 'edit_folder',
          'folder_id': id,
          'name': 'Coplas',
          'artist': 'Concha Piquer',
        });
      }
    });

    test('los acentos y las comillas van en el JSON sin romper la línea', () {
      final request = LibraryRequest.createAlbum(
        name: 'Canción "de" cuna',
        artist: 'Ñandú',
      );
      expect(payloadOf(request.body)['name'], 'Canción "de" cuna');
    });
  });

  group('validación antes de abrir GitHub', () {
    test('nombre del álbum de 1 a 80 caracteres', () {
      expect(
        LibraryRequest.createAlbum(name: 'a' * 80, artist: '').payload['name'],
        'a' * 80,
      );
      expect(
        () => LibraryRequest.createAlbum(name: '', artist: ''),
        throwsA(isA<AppException>()),
      );
      expect(
        () => LibraryRequest.createAlbum(name: '   ', artist: ''),
        throwsA(isA<AppException>()),
      );
      expect(
        () => LibraryRequest.createAlbum(name: 'a' * 81, artist: ''),
        throwsA(isA<AppException>()),
      );
      expect(
        () => LibraryRequest.editAlbum(
          folderId: albumId,
          name: 'b' * 81,
          artist: '',
        ),
        throwsA(isA<AppException>()),
      );
    });

    test('artista del álbum de 0 a 80 caracteres; de la canción, de 0 a 200', () {
      expect(
        LibraryRequest.createAlbum(
          name: 'x',
          artist: 'z' * 80,
        ).payload['artist'],
        'z' * 80,
      );
      expect(
        () => LibraryRequest.createAlbum(name: 'x', artist: 'z' * 81),
        throwsA(isA<AppException>()),
      );
      expect(
        () => LibraryRequest.editSong(
          songId: songId,
          title: 't',
          artist: 'z' * 201,
        ),
        throwsA(isA<AppException>()),
      );
      // Como en el backend (catalog.SONG_ARTIST_MAX_CHARS): antes la APK cortaba el de la canción en 80.
      expect(
        LibraryRequest.editSong(
          songId: songId,
          title: 't',
          artist: 'z' * 200,
        ).payload['artist'],
        'z' * 200,
      );
    });

    test('se cuentan caracteres, no unidades UTF-16', () {
      final emoji = '🎵' * 80;
      expect(
        LibraryRequest.createAlbum(name: emoji, artist: '').payload['name'],
        emoji,
      );
    });

    test('una sola línea: sin saltos, separadores ni caracteres de control', () {
      for (final bad in [
        'dos\nlíneas',
        'retorno\rde carro',
        'tab\tulador',
        'sep arador',
        'par rafo',
        'ancho​cero',
        'nulo\u0000',
      ]) {
        expect(
          () => LibraryRequest.createAlbum(name: bad, artist: ''),
          throwsA(isA<AppException>()),
          reason: jsonEncode(bad),
        );
        expect(
          () => LibraryRequest.createAlbum(name: 'x', artist: bad),
          throwsA(isA<AppException>()),
          reason: jsonEncode(bad),
        );
      }
      // Como en el backend, los espacios de los lados (también un salto de línea o un tabulador) se quitan antes de
      // mirar los caracteres de control.
      expect(
        LibraryRequest.createAlbum(name: 'Valses\t', artist: ' x\r\n').payload,
        {'op': 'create_folder', 'name': 'Valses', 'artist': 'x'},
      );
    });

    test('el título de la canción no puede quedar vacío', () {
      expect(
        () => LibraryRequest.editSong(songId: songId, title: ' ', artist: ''),
        throwsA(isA<AppException>()),
      );
    });

    test('solo identificadores de la biblioteca común', () {
      expect(
        () => LibraryRequest.editSong(songId: 'L123', title: 't', artist: ''),
        throwsA(isA<AppException>()),
      );
      expect(
        () => LibraryRequest.moveSong(songId: songId, folderId: 'f1'),
        throwsA(isA<AppException>()),
      );
      expect(
        () => LibraryRequest.moveSong(songId: songId, folderId: 'F0123'),
        throwsA(isA<AppException>()),
      );
      expect(
        () => LibraryRequest.editAlbum(
          folderId: 'ABCDEF0123',
          name: 'x',
          artist: '',
        ),
        throwsA(isA<AppException>()),
      );
      expect(isCatalogFolderId(albumId), isTrue);
      expect(isCatalogFolderId(oldAlbumId), isTrue);
    });

    test('«Cambiar portada» solo para canciones S y álbumes F', () {
      expect(canChangeCatalogCover(songId), isTrue);
      expect(canChangeCatalogCover(albumId), isTrue);
      expect(canChangeCatalogCover(oldAlbumId), isFalse);
      expect(canChangeCatalogCover('L0123456789abcdef'), isFalse);
    });
  });

  group('move_songs (varias canciones de una vez)', () {
    const otherId = 'S0000000000000001';

    test('payload exacto y título al añadir a un álbum', () {
      final request = LibraryRequest.moveSongs(
        songIds: [songId, otherId],
        folderId: albumId,
        albumName: '  Jazz  ',
      );
      expect(payloadOf(request.body), {
        'op': 'move_songs',
        'song_ids': [songId, otherId],
        'folder_id': albumId,
      });
      expect(
        request.body,
        'action: organize\npayload: {"op":"move_songs","song_ids":["$songId","$otherId"],"folder_id":"$albumId"}',
      );
      expect(request.title, 'Añadir 2 canciones al álbum «Jazz»');
      expect(
        LibraryRequest.moveSongs(
          songIds: [songId],
          folderId: albumId,
          albumName: 'Jazz',
        ).title,
        'Añadir 1 canción al álbum «Jazz»',
      );
      expect(
        LibraryRequest.moveSongs(songIds: [songId], folderId: oldAlbumId).title,
        'Añadir 1 canción al álbum $oldAlbumId',
      );
    });

    test('folder_id null las deja sin álbum', () {
      final one = LibraryRequest.moveSongs(songIds: [songId], folderId: null);
      expect(
        one.body,
        'action: organize\npayload: {"op":"move_songs","song_ids":["$songId"],"folder_id":null}',
      );
      expect(one.title, 'Quitar 1 canción de su álbum');
      expect(
        LibraryRequest.moveSongs(
          songIds: [songId, otherId],
          folderId: null,
        ).title,
        'Quitar 2 canciones de su álbum',
      );
    });

    test('admite hasta 100 IDs', () {
      final ids = [
        for (var i = 0; i < kMaxMoveSongs; i++)
          'S${i.toRadixString(16).padLeft(16, '0')}',
      ];
      final request = LibraryRequest.moveSongs(songIds: ids, folderId: albumId);
      expect(payloadOf(request.body)['song_ids'], ids);
      expect(request.title, 'Añadir 100 canciones al álbum $albumId');
    });

    test(
      'rechaza lista vacía, más de 100, repetidas, IDs y álbum no válidos',
      () {
        Matcher fails(String text) => throwsA(
          isA<AppException>().having((e) => e.message, 'message', text),
        );
        expect(
          () => LibraryRequest.moveSongs(songIds: const [], folderId: albumId),
          fails('Elige al menos una canción.'),
        );
        final tooMany = [
          for (var i = 0; i <= kMaxMoveSongs; i++)
            'S${i.toRadixString(16).padLeft(16, '0')}',
        ];
        expect(
          () => LibraryRequest.moveSongs(songIds: tooMany, folderId: albumId),
          fails('Se pueden mover 100 canciones como mucho de una vez.'),
        );
        expect(
          () => LibraryRequest.moveSongs(
            songIds: [songId, otherId, songId],
            folderId: albumId,
          ),
          fails('Hay canciones repetidas en la selección.'),
        );
        expect(
          () => LibraryRequest.moveSongs(
            songIds: [songId, 'L0123456789abcdef'],
            folderId: albumId,
          ),
          fails('Solo se pueden editar las canciones de la biblioteca común.'),
        );
        expect(
          () => LibraryRequest.moveSongs(songIds: [songId], folderId: 'xyz'),
          fails('El álbum no es un álbum de la biblioteca común.'),
        );
      },
    );
  });

  group('título', () {
    test('el título de la incidencia se corta a 120 caracteres', () {
      final title = cleanIssueTitle('x' * 200);
      expect(title.runes.length, 120);
      expect(title, endsWith('…'));
      expect(cleanIssueTitle('  a\nb  '), 'a b');
      expect(cleanIssueTitle(''), 'Petición de la biblioteca');
    });
  });
}
