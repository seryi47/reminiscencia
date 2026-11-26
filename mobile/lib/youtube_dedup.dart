// Detecta en una playlist de YouTube las pistas que ya están en la biblioteca y las aparta antes de convertir, para no
// re-descargar lo que ya tenemos (ADR-0019 ampliado). Reusa la regla tolerante de `library_match.dart` (ADR-0046):
// ignora diferencias cosméticas (feat., remaster…) sin confundir una versión en directo o un remix con la de estudio.
//
// Entrada: la lista de `YoutubeTrack` que devuelve `YoutubeImporter.listPlaylist` + el catálogo actual como lista de
// `Song`. Salida: tres listas en el mismo orden original — `toDownload` (nuevas), `skipped` (ya las tienes) y la lista
// total devuelta por el proxy, para que la UI pueda mostrar el conteo completo. No llama a la red: se decide por los
// datos que ya tenemos en memoria.
//
// NOTA sobre la duración: el proxy `/api/youtube/playlist` del Worker normalmente no devuelve duración por pista
// (sólo título y artista), así que `isSameLibraryTrack` compara por título+artista en ese caso. `library_match` ya
// decide correctamente cuando falta la duración de una de las dos canciones comparadas (ver `library_match.dart`).

import 'duplicates.dart';
import 'library_match.dart';
import 'song.dart';
import 'youtube_importer.dart';

/// Resultado del filtrado por catálogo.
class YoutubeDedupResult {
  const YoutubeDedupResult({
    required this.all,
    required this.toDownload,
    required this.skipped,
  });

  /// Lista original devuelta por el proxy, sin orden alterado.
  final List<YoutubeTrack> all;

  /// Las que NO están en la biblioteca y deben convertirse y subirse.
  final List<YoutubeTrack> toDownload;

  /// Las que ya están en la biblioteca según `isSameLibraryTrack`.
  final List<YoutubeTrack> skipped;

  int get total => all.length;
  int get alreadyCount => skipped.length;
  int get newCount => toDownload.length;
}

/// Convierte una canción publicada de la biblioteca en un candidato para `isSameLibraryTrack`.
DuplicateCandidate candidateFromSong(Song song) =>
    DuplicateCandidate(title: song.title, artist: song.artist, durationS: song.durationS);

/// Convierte una pista de YouTube en un candidato para `isSameLibraryTrack`. El proxy de playlist del Worker no suele
/// devolver duración, así que `durationS` queda `null` y `library_match` decide por título + artista.
DuplicateCandidate candidateFromYoutube(YoutubeTrack track) => DuplicateCandidate(
      title: track.title,
      artist: track.artist,
      // `expectedDurationS` sólo lo rellena el flujo de UNA pista (vídeo suelto o Spotify), nunca una playlist YouTube
      // vista por el proxy. Se pasa igual: si viene, ayuda; si es null, no estorba.
      durationS: track.expectedDurationS,
    );

/// Parte la lista en «ya la tienes» vs «es nueva» mirando únicamente título, artista y (opcionalmente) duración.
YoutubeDedupResult filterYoutubePlaylist(List<YoutubeTrack> tracks, List<Song> librarySongs) {
  final library = <DuplicateCandidate>[
    for (final song in librarySongs) candidateFromSong(song),
  ];
  final toDownload = <YoutubeTrack>[];
  final skipped = <YoutubeTrack>[];
  for (final track in tracks) {
    final probe = candidateFromYoutube(track);
    final already = library.any((song) => isSameLibraryTrack(probe, song));
    if (already) {
      skipped.add(track);
    } else {
      toDownload.add(track);
    }
  }
  return YoutubeDedupResult(all: tracks, toDownload: toDownload, skipped: skipped);
}
