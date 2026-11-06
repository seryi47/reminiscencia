import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/library_requests.dart';

// Contrato común de las peticiones de la biblioteca (ADR-0028): lo que construye la APK (LibraryRequest) da exactamente
// los resultados de tests/contrato/peticiones.json, que ejecutan también el backend (la referencia) y la web. Cada caso
// dice qué factoría lo construye («apk») o «no_aplica» si la APK no genera esa forma; la prueba comprueba también que
// esa etiqueta es correcta.
Map<String, dynamic> _contract() {
  final file = File('../tests/contrato/peticiones.json');
  return jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
}

bool _isStringList(Object? value) =>
    value is List && value.every((item) => item is String);

/// La factoría que construye [payload], con sus claves en el mismo orden, o null si la APK no lo genera.
String? _factoryFor(Object? payload) {
  if (payload is! Map<String, dynamic>) return null;
  final keys = payload.keys.toList();
  bool shape(String op, List<String> expected) =>
      payload['op'] == op && listEquals(keys, expected);
  bool strings(List<String> names) =>
      names.every((name) => payload[name] is String);
  final folder = payload['folder_id'];
  if (shape('create_folder', ['op', 'name', 'artist']) &&
      strings(['name', 'artist'])) {
    return 'createAlbum';
  }
  if (shape('edit_folder', ['op', 'folder_id', 'name', 'artist']) &&
      strings(['folder_id', 'name', 'artist'])) {
    return 'editAlbum';
  }
  if (shape('edit_song', ['op', 'song_id', 'title', 'artist']) &&
      strings(['song_id', 'title', 'artist'])) {
    return 'editSong';
  }
  if (shape('edit_song', ['op', 'song_id', 'folder_id']) &&
      strings(['song_id']) &&
      (folder == null || folder is String)) {
    return 'moveSong';
  }
  if (shape('move_songs', ['op', 'song_ids', 'folder_id']) &&
      _isStringList(payload['song_ids']) &&
      (folder == null || folder is String)) {
    return 'moveSongs';
  }
  if (shape('order_album', ['op', 'folder_id', 'song_ids']) &&
      strings(['folder_id']) &&
      _isStringList(payload['song_ids'])) {
    return 'orderAlbum';
  }
  return null;
}

bool listEquals(List<String> a, List<String> b) =>
    a.length == b.length &&
    [for (var i = 0; i < a.length; i++) a[i] == b[i]].every((same) => same);

LibraryRequest _build(String factory, Map<String, dynamic> payload) {
  List<String> ids() => List<String>.from(payload['song_ids'] as List);
  return switch (factory) {
    'createAlbum' => LibraryRequest.createAlbum(
      name: payload['name'] as String,
      artist: payload['artist'] as String,
    ),
    'editAlbum' => LibraryRequest.editAlbum(
      folderId: payload['folder_id'] as String,
      name: payload['name'] as String,
      artist: payload['artist'] as String,
    ),
    'editSong' => LibraryRequest.editSong(
      songId: payload['song_id'] as String,
      title: payload['title'] as String,
      artist: payload['artist'] as String,
    ),
    'moveSong' => LibraryRequest.moveSong(
      songId: payload['song_id'] as String,
      folderId: payload['folder_id'] as String?,
    ),
    'moveSongs' => LibraryRequest.moveSongs(
      songIds: ids(),
      folderId: payload['folder_id'] as String?,
    ),
    'orderAlbum' => LibraryRequest.orderAlbum(
      folderId: payload['folder_id'] as String,
      songIds: ids(),
    ),
    _ => throw ArgumentError(factory),
  };
}

void main() {
  final contract = _contract();
  final cases = (contract['operaciones'] as List).cast<Map<String, dynamic>>();

  test('los límites son los del contrato', () {
    final limits = contract['limites'] as Map<String, dynamic>;
    expect(kMaxAlbumNameLength, limits['nombre_album']);
    expect(kMaxArtistLength, limits['artista_album']);
    expect(kMaxSongTitleLength, limits['titulo_cancion']);
    expect(kMaxSongArtistLength, limits['artista_cancion']);
    expect(kMaxMoveSongs, limits['move_songs']);
    expect(kMaxOrderSongs, limits['order_album']);
    expect(kMaxIssueTitleLength, limits['titulo_incidencia']);
  });

  test(
    'se quitan a los lados los mismos espacios que en el backend, y solo esos',
    () {
      final spaces = {
        for (final code in (contract['espacios'] as List).cast<String>())
          int.parse(code.substring(2), radix: 16),
      };
      for (var code = 0; code <= 0x3000; code++) {
        if (code >= 0xd800 && code <= 0xdfff) continue;
        final char = String.fromCharCode(code);
        final expected = spaces.contains(code) ? 'x' : '${char}x$char';
        expect(stripLikeBackend('${char}x$char'), expected, reason: 'U+$code');
      }
      expect(stripLikeBackend('﻿x'), '﻿x');
    },
  );

  test('ids de canción, de álbum y de portada', () {
    final ids = contract['ids'] as Map<String, dynamic>;
    for (final pair in (ids['cancion'] as List).cast<List>()) {
      expect(isCatalogSongId(pair[0] as String), pair[1], reason: '${pair[0]}');
    }
    for (final pair in (ids['album'] as List).cast<List>()) {
      expect(
        isCatalogFolderId(pair[0] as String),
        pair[1],
        reason: '${pair[0]}',
      );
    }
    for (final pair in (ids['portada'] as List).cast<List>()) {
      expect(
        canChangeCatalogCover(pair[0] as String),
        pair[1],
        reason: '${pair[0]}',
      );
    }
  });

  test('la etiqueta «apk» de cada caso es la factoría que lo construye', () {
    final factories = <String>{};
    for (final c in cases) {
      final factory = _factoryFor(c['payload']);
      expect(c['apk'], factory ?? 'no_aplica', reason: c['caso'] as String);
      if (factory != null) factories.add(factory);
    }
    // Todas las factorías tienen casos.
    expect(factories, {
      'createAlbum',
      'editAlbum',
      'editSong',
      'moveSong',
      'moveSongs',
      'orderAlbum',
    });
  });

  group('operaciones que construye la APK', () {
    for (final c in cases.where((c) => c['apk'] != 'no_aplica')) {
      test(c['caso'] as String, () {
        final payload = c['payload'] as Map<String, dynamic>;
        final factory = c['apk'] as String;
        if (c['valido'] == true) {
          final request = _build(factory, payload);
          // El cuerpo de la incidencia, carácter a carácter: el mismo que la web, y el backend lo acepta.
          expect(request.body, c['cuerpo']);
        } else {
          expect(
            () => _build(factory, payload),
            throwsA(
              isA<LibraryRequestException>()
                  .having((e) => e.code, 'code', c['motivo'])
                  .having((e) => e.field, 'field', c['campo']),
            ),
          );
        }
      });
    }
  });
}
