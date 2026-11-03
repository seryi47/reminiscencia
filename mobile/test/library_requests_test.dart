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

    test('artista de 0 a 80 caracteres', () {
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
          artist: 'z' * 81,
        ),
        throwsA(isA<AppException>()),
      );
    });

    test('se cuentan caracteres, no unidades UTF-16', () {
      final emoji = '🎵' * 80;
      expect(
        LibraryRequest.createAlbum(name: emoji, artist: '').payload['name'],
        emoji,
      );
    });

    test(
      'una sola línea: sin saltos, separadores ni caracteres de control',
      () {
        for (final bad in [
          'dos\nlíneas',
          'retorno\r',
          'tab\tulador',
          'sep ',
          'par ',
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
      },
    );

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

  group('enlaces', () {
    test(
      'incidencia nueva con la etiqueta biblioteca, título y cuerpo codificados como la web',
      () {
        final request = LibraryRequest.createAlbum(
          name: 'Jazz & blues',
          artist: 'Varios',
        );
        final uri = request.issueUri;
        expect(uri.scheme, 'https');
        expect(uri.host, 'github.com');
        expect(uri.path, '/seryi47/reminiscencia/issues/new');
        expect(uri.queryParameters['labels'], 'biblioteca');
        expect(uri.queryParameters['title'], 'Crear el álbum «Jazz & blues»');
        expect(uri.queryParameters['body'], request.body);
        // Espacios como %20 (encodeURIComponent), no como «+».
        expect(uri.toString(), contains('title=Crear%20el%20%C3%A1lbum'));
        expect(uri.toString(), isNot(contains('+')));
        expect(uri.toString(), contains('%26%20blues'));
      },
    );

    test('el título de la incidencia se corta a 120 caracteres', () {
      final title = cleanIssueTitle('x' * 200);
      expect(title.runes.length, 120);
      expect(title, endsWith('…'));
      expect(cleanIssueTitle('  a\nb  '), 'a b');
      expect(cleanIssueTitle(''), 'Petición de la biblioteca');
    });

    test('la subida de portadas va al buzón de portadas', () {
      expect(
        kCoverUploadUri.toString(),
        'https://github.com/seryi47/reminiscencia/upload/main/audio-library/buzon/portadas',
      );
    });
  });
}
