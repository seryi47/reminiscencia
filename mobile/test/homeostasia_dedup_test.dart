import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/song.dart';
import 'package:reminiscencia/youtube_dedup.dart';
import 'package:reminiscencia/youtube_importer.dart';

Song _song({required String id, required String title, String artist = '', double duration = 180}) => Song(
      id: id,
      title: title,
      artist: artist,
      year: null,
      tags: const <String>[],
      folderId: null,
      durationS: duration,
      license: 'CC',
      audio: 'audio/$id.opus',
    );

YoutubeTrack _yt({required String title, String artist = '', double? expected}) =>
    YoutubeTrack(url: 'https://youtu.be/$title', title: title, artist: artist, expectedDurationS: expected);

void main() {
  group('filterYoutubePlaylist (ADR-0019 + ADR-0046)', () {
    test('sin biblioteca, todo es nuevo', () {
      final tracks = [_yt(title: 'Averno', artist: 'Rayden'), _yt(title: 'Meteorito', artist: 'Rayden')];
      final res = filterYoutubePlaylist(tracks, const <Song>[]);
      expect(res.total, 2);
      expect(res.newCount, 2);
      expect(res.alreadyCount, 0);
      expect(res.toDownload, tracks);
      expect(res.skipped, isEmpty);
    });

    test('título igual con artista exacto se considera ya en biblioteca (sin duración en YT)', () {
      final library = [_song(id: 's1', title: 'Meteorito', artist: 'Rayden', duration: 261)];
      final tracks = [_yt(title: 'Meteorito', artist: 'Rayden')];
      final res = filterYoutubePlaylist(tracks, library);
      expect(res.alreadyCount, 1);
      expect(res.newCount, 0);
    });

    test('tolerante a «feat»: feat extra en YouTube no impide marcar como ya en biblioteca', () {
      final library = [_song(id: 's1', title: 'Itaboy!', artist: 'Rayden', duration: 185)];
      final tracks = [_yt(title: 'Itaboy! (feat. SFDK)', artist: 'Rayden ft SFDK')];
      final res = filterYoutubePlaylist(tracks, library);
      expect(res.alreadyCount, 1);
    });

    test('tolerante a «Remastered»: cuenta como ya en biblioteca si todo lo demás cuadra', () {
      final library = [_song(id: 's1', title: 'Clocks', artist: 'Coldplay', duration: 307)];
      final tracks = [_yt(title: 'Clocks (Remastered 2021)', artist: 'Coldplay')];
      final res = filterYoutubePlaylist(tracks, library);
      expect(res.alreadyCount, 1);
    });

    test('«(Live)» NO cuenta como que ya la tienes: se marca como nueva', () {
      final library = [_song(id: 's1', title: 'Clocks', artist: 'Coldplay', duration: 307)];
      final tracks = [_yt(title: 'Clocks (Live at Wembley)', artist: 'Coldplay')];
      final res = filterYoutubePlaylist(tracks, library);
      expect(res.alreadyCount, 0);
      expect(res.newCount, 1);
    });

    test('mezcla de ambos: cuenta y preserva orden', () {
      final library = [
        _song(id: 's1', title: 'Pólvora mojada', artist: 'Rayden', duration: 221),
        _song(id: 's2', title: 'Meteorito', artist: 'Rayden', duration: 261),
      ];
      final tracks = [
        _yt(title: 'Averno', artist: 'Rayden y Tanxugueiras'),
        _yt(title: 'Meteorito', artist: 'Rayden'),
        _yt(title: 'Haz de luz', artist: 'Rayden'),
        _yt(title: 'Pólvora mojada', artist: 'Rayden'),
      ];
      final res = filterYoutubePlaylist(tracks, library);
      expect(res.total, 4);
      expect(res.alreadyCount, 2);
      expect(res.newCount, 2);
      expect(res.toDownload.map((t) => t.title).toList(), ['Averno', 'Haz de luz']);
      expect(res.skipped.map((t) => t.title).toList(), ['Meteorito', 'Pólvora mojada']);
    });
  });
}
