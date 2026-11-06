import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/duplicates.dart';
import 'package:reminiscencia/fuzzy_search.dart';
import 'package:reminiscencia/library_controller.dart';
import 'package:reminiscencia/song.dart';
import 'package:reminiscencia/ui/library_edit.dart';

import 'support/fakes.dart';

// Regla común de búsqueda (ADR-0028): todos los buscadores de la APK (lib/fuzzy_search.dart) dan los resultados de
// tests/contrato/busqueda.json, que ejecuta también la web (tests/web-unit/busqueda-contrato.test.mjs).
Map<String, dynamic> _contract(String name) {
  final file = File('../tests/contrato/$name');
  return jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
}

void main() {
  final contract = _contract('busqueda.json');
  final folders = [
    for (final raw
        in (contract['albumes'] as List).cast<Map<String, dynamic>>())
      Folder(
        id: raw['id'] as String,
        name: raw['name'] as String,
        parentId: null,
        artist: raw['artist'] as String,
      ),
  ];
  final songs = [
    for (final raw
        in (contract['canciones'] as List).cast<Map<String, dynamic>>())
      Song(
        id: raw['id'] as String,
        title: raw['title'] as String,
        artist: raw['artist'] as String,
        year: raw['year'] as int?,
        tags: List<String>.from(raw['tags'] as List),
        folderId: raw['folder_id'] as String?,
        durationS: 100,
        license: 'CC0',
        audio: 'audio/${raw['id']}.opus',
      ),
  ];
  String albumName(Song song) {
    for (final folder in folders) {
      if (folder.id == song.folderId) return folder.name;
    }
    return '';
  }

  List<String> ids(Iterable<Object> items) => [
    for (final item in items) item is Song ? item.id : (item as Folder).id,
  ];

  group('datos de la regla', () {
    test('puntos, pesos, bonus y errata son los del contrato', () {
      final points = contract['puntos'] as Map<String, dynamic>;
      expect(kSearchExactPoints, points['exacta']);
      expect(kSearchPrefixPoints, points['prefijo']);
      expect(kSearchTypoPoints, points['errata']);
      expect(kSearchFieldWeights, contract['pesos_campos']);
      final bonus = contract['bonus'] as Map<String, dynamic>;
      expect(kSearchEqualBonus, bonus['igual']);
      expect(kSearchStartsWithBonus, bonus['empieza']);
      expect(kSearchTypoMinLength, contract['errata_min_caracteres']);
    });

    test('el pliegue es el del contrato y el mismo que el de duplicados', () {
      expect(kFoldFrom, contract['pliegue']['de']);
      expect(kFoldTo, contract['pliegue']['a']);
      expect(contract['pliegue'], _contract('duplicados.json')['pliegue']);
    });

    test('normalización', () {
      for (final entry
          in (contract['normalizar'] as List).cast<Map<String, dynamic>>()) {
        expect(
          foldForSearch(entry['entrada'] as String),
          entry['salida'],
          reason: jsonEncode(entry['entrada']),
        );
      }
    });

    test('puntos de una palabra', () {
      for (final entry
          in (contract['palabras'] as List).cast<Map<String, dynamic>>()) {
        expect(
          wordPoints(entry['consulta'] as String, entry['palabra'] as String),
          entry['puntos'],
          reason: '${entry['consulta']} / ${entry['palabra']}',
        );
      }
    });

    test('puntuaciones de canciones', () {
      for (final entry
          in (contract['puntuaciones'] as List).cast<Map<String, dynamic>>()) {
        final song = songs.firstWhere((s) => s.id == entry['id']);
        expect(
          searchScore(
            songSearchFields(song, albumName(song)),
            entry['consulta'] as String,
          ),
          entry['puntos'],
          reason: '${entry['consulta']} / ${entry['id']}',
        );
      }
    });
  });

  group('todos los buscadores dan el mismo resultado', () {
    late LibraryController library;

    setUp(() async {
      final bundle = buildTestServices(songs: songs, folders: folders);
      await bundle.services.library.load();
      library = bundle.services.library;
    });

    for (final entry
        in (contract['busquedas'] as List).cast<Map<String, dynamic>>()) {
      final query = entry['consulta'] as String;
      final expected = List<String>.from(entry['resultado'] as List);
      test(jsonEncode(query), () {
        expect(
          ids(
            searchRank<Song>(
              songs,
              query,
              (song) => songSearchFields(song, albumName(song)),
            ),
          ),
          expected,
          reason: 'searchRank',
        );
        expect(
          ids(filterSongsByText(songs, query, albumName: albumName)),
          expected,
          reason: 'filterSongsByText (Buscar en esta colección)',
        );
        expect(
          ids(filterSongsForAlbumPicker(songs, query, albumName: albumName)),
          expected,
          reason: 'filterSongsForAlbumPicker (Añadir canciones)',
        );
        expect(
          ids(library.searchSongs(query)),
          expected,
          reason: 'LibraryController.searchSongs (Buscar)',
        );
      });
    }

    test('sin texto, los filtros devuelven todo en su orden y Buscar nada', () {
      for (final query in (contract['sin_texto'] as List).cast<String>()) {
        expect(
          ids(filterSongsByText(songs, query, albumName: albumName)),
          ids(songs),
        );
        expect(
          ids(filterSongsForAlbumPicker(songs, query, albumName: albumName)),
          ids(songs),
        );
        expect(library.searchSongs(query), isEmpty);
        expect(library.searchFolders(query), isEmpty);
      }
    });

    for (final entry
        in (contract['busquedas_albumes'] as List)
            .cast<Map<String, dynamic>>()) {
      final query = entry['consulta'] as String;
      final expected = List<String>.from(entry['resultado'] as List);
      test('álbumes: ${jsonEncode(query)}', () {
        expect(
          ids(searchRank<Folder>(folders, query, folderSearchFields)),
          expected,
          reason: 'searchRank',
        );
        expect(
          ids(library.searchFolders(query)),
          expected,
          reason: 'LibraryController.searchFolders',
        );
      });
    }
  });
}
