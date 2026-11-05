import 'library_controller.dart' show foldForSearch;
import 'song.dart';

/// Búsqueda tolerante, igual que en la web (`js/catalog.js`): cada palabra de la consulta debe coincidir con el
/// principio de alguna palabra del texto, o con una errata. «kid keo» encuentra «Kidd Keo».
int _maxEdits(int length) => length < 4 ? 0 : (length < 7 ? 1 : 2);

/// Distancia de edición con intercambio de letras contiguas (Damerau).
int editDistance(String a, String b) {
  final rows = List.generate(
    a.length + 1,
    (i) => List<int>.filled(b.length + 1, 0)..[0] = i,
  );
  for (var j = 1; j <= b.length; j++) {
    rows[0][j] = j;
  }
  for (var i = 1; i <= a.length; i++) {
    for (var j = 1; j <= b.length; j++) {
      final cost = a[i - 1] == b[j - 1] ? 0 : 1;
      var best = [
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + cost,
      ].reduce((x, y) => x < y ? x : y);
      if (i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1]) {
        final swap = rows[i - 2][j - 2] + 1;
        if (swap < best) best = swap;
      }
      rows[i][j] = best;
    }
  }
  return rows[a.length][b.length];
}

int _wordMatch(String token, List<String> words) {
  var best = 0;
  final allowed = _maxEdits(token.length);
  for (final word in words) {
    if (word.startsWith(token)) return 2;
    if (allowed > 0) {
      final head = word.length > token.length
          ? word.substring(0, token.length)
          : word;
      if (editDistance(token, head) <= allowed ||
          editDistance(token, word) <= allowed) {
        best = 1;
      }
    }
  }
  return best;
}

/// ¿Aparecen todas las palabras de [query] (ya normalizada), enteras o con erratas, en [text]?
bool fuzzyMatches(String text, String query) {
  final words = foldForSearch(text).split(' ').where((w) => w.isNotEmpty);
  final tokens = query.split(' ').where((w) => w.isNotEmpty);
  if (words.isEmpty || tokens.isEmpty) return false;
  final list = words.toList();
  return tokens.every((token) => _wordMatch(token, list) > 0);
}

/// Canciones que coinciden con [rawQuery] por título, artista, año, etiquetas o [albumName], con erratas.
/// Conserva el orden. Sin texto devuelve todas.
List<Song> filterSongsByText(
  List<Song> songs,
  String rawQuery, {
  String Function(Song song)? albumName,
}) {
  final needle = foldForSearch(rawQuery);
  if (needle.isEmpty) return songs;
  return songs.where((song) {
    final text = [
      song.title,
      song.artist,
      albumName?.call(song) ?? '',
      if (song.year != null) '${song.year}',
      ...song.tags,
    ].join(' ');
    return foldForSearch(text).contains(needle) || fuzzyMatches(text, needle);
  }).toList();
}
