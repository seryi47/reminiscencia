import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/app_error.dart';
import 'package:reminiscencia/collections.dart';

void main() {
  group('nombre de lista', () {
    test('recorta los extremos y colapsa los espacios repetidos', () {
      expect(
        cleanPlaylistName('  Jazz   de  los años 30 '),
        'Jazz de los años 30',
      );
    });

    test(
      'rechaza nombres vacíos y demasiado largos con un mensaje para el usuario',
      () {
        expect(() => cleanPlaylistName('   '), throwsA(isA<AppException>()));
        expect(
          () => cleanPlaylistName('x' * (kMaxPlaylistNameLength + 1)),
          throwsA(isA<AppException>()),
        );
        expect(
          cleanPlaylistName('x' * kMaxPlaylistNameLength),
          hasLength(kMaxPlaylistNameLength),
        );
      },
    );
  });

  group('favoritos', () {
    test('marcar y desmarcar una canción', () {
      final collections = Collections();
      expect(collections.toggleFavorite('s1'), isTrue);
      expect(collections.isFavorite('s1'), isTrue);
      expect(collections.toggleFavorite('s1'), isFalse);
      expect(collections.isFavorite('s1'), isFalse);
    });

    test('conserva el orden en que se marcaron y no repite ids', () {
      final collections = Collections(favorites: ['b', 'a', 'b']);
      expect(collections.favorites, ['b', 'a']);
      collections.toggleFavorite('c');
      expect(collections.favorites, ['b', 'a', 'c']);
    });
  });

  group('listas', () {
    test('crear, renombrar y borrar', () {
      final collections = Collections();
      collections.createPlaylist(id: 'p1', name: 'Tarde  de domingo');
      expect(collections.playlists.single.name, 'Tarde de domingo');

      collections.renamePlaylist('p1', 'Domingos');
      expect(collections.playlists.single.name, 'Domingos');

      collections.deletePlaylist('p1');
      expect(collections.playlists, isEmpty);
    });

    test('añadir y quitar canciones sin duplicados', () {
      final collections = Collections()..createPlaylist(id: 'p1', name: 'Jazz');
      expect(collections.addSong('p1', 's1'), isTrue);
      expect(collections.addSong('p1', 's1'), isFalse);
      expect(collections.addSong('p1', 's2'), isTrue);
      expect(collections.playlistOrNull('p1')!.songIds, ['s1', 's2']);

      collections.removeSong('p1', 's1');
      expect(collections.playlistOrNull('p1')!.songIds, ['s2']);
    });

    test(
      'operar con una lista que ya no existe da un mensaje para el usuario',
      () {
        final collections = Collections();
        expect(
          () => collections.renamePlaylist('nope', 'X'),
          throwsA(isA<AppException>()),
        );
        expect(
          () => collections.addSong('nope', 's1'),
          throwsA(isA<AppException>()),
        );
        expect(
          () => collections.deletePlaylist('nope'),
          throwsA(isA<AppException>()),
        );
      },
    );

    test('no admite dos listas con el mismo id', () {
      final collections = Collections()..createPlaylist(id: 'p1', name: 'Uno');
      expect(
        () => collections.createPlaylist(id: 'p1', name: 'Dos'),
        throwsArgumentError,
      );
    });

    test('las listas expuestas no se pueden modificar desde fuera', () {
      final collections = Collections()..createPlaylist(id: 'p1', name: 'Jazz');
      expect(
        () => collections.playlists.add(Playlist(id: 'x', name: 'x')),
        throwsUnsupportedError,
      );
      expect(() => collections.favorites.add('x'), throwsUnsupportedError);
    });
  });

  group('JSON', () {
    test('ida y vuelta conserva favoritos y listas', () {
      final original = Collections(
        favorites: ['s1', 's3'],
        playlists: [
          Playlist(id: 'p1', name: 'Jazz', songIds: ['s2', 's1']),
        ],
      );
      final back = Collections.fromJson(original.toJson());
      expect(back.favorites, ['s1', 's3']);
      expect(back.playlists.single.id, 'p1');
      expect(back.playlists.single.name, 'Jazz');
      expect(back.playlists.single.songIds, ['s2', 's1']);
    });

    test('descarta las entradas que no se entienden sin romper el resto', () {
      final collections = Collections.fromJson({
        'favorites': ['a', 7, '', 'a'],
        'playlists': [
          {
            'id': 'p1',
            'name': 'Buena',
            'songs': ['s1', 's1', null],
          },
          {'id': '', 'name': 'Sin id'},
          'basura',
          {'id': 'p1', 'name': 'Duplicada'},
        ],
      });
      expect(collections.favorites, ['a']);
      expect(collections.playlists.map((playlist) => playlist.name), ['Buena']);
      expect(collections.playlists.single.songIds, ['s1']);
    });

    test('un JSON que no es un objeto lanza FormatException', () {
      expect(
        () => Collections.fromJson(['no es un objeto']),
        throwsFormatException,
      );
    });
  });
}
