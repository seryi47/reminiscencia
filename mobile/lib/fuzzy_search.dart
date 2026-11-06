import 'duplicates.dart' show foldText;
import 'song.dart';

// Búsqueda (ADR-0028). Una sola regla para todos los buscadores de la app: Buscar (canciones y álbumes), «Buscar en
// esta colección» y «Añadir canciones» de un álbum. La web tiene la misma (js/catalog.js) y las dos pasan los casos de
// tests/contrato/busqueda.json.
//
// - Texto comparable ([foldForSearch]): minúsculas, sin tildes ni diéresis (se quitan las marcas combinantes U+0300 a
//   U+036F y se pliegan las letras de kFoldFrom a kFoldTo), todo lo que no es letra ni número pasa a espacio, y
//   espacios simples.
// - Cada palabra de la consulta tiene que coincidir con alguna palabra de algún campo: igual (3 puntos), como principio
//   de la palabra (2) o, si tiene 4 o más caracteres y alguna letra, con una errata (1): una letra de más, de menos,
//   cambiada o dos contiguas intercambiadas, frente al principio de la palabra o frente a la palabra entera.
// - Los puntos de cada palabra se multiplican por el peso del campo en el que mejor coincide (3 el primero, 2 el
//   segundo y 1 los demás) y se suman. Si el primer campo entero es igual a la consulta, +100; si empieza por ella, +50.
// - Resultados de más a menos puntos; con los mismos puntos, en el orden de entrada.

const int kSearchExactPoints = 3;
const int kSearchPrefixPoints = 2;
const int kSearchTypoPoints = 1;
const List<int> kSearchFieldWeights = [3, 2, 1];
const int kSearchEqualBonus = 100;
const int kSearchStartsWithBonus = 50;
const int kSearchTypoMinLength = 4;

final RegExp _notLetterOrNumber = RegExp(r'[^\p{L}\p{N}]+', unicode: true);
final RegExp _hasLetter = RegExp(r'\p{L}', unicode: true);

/// Texto comparable de la búsqueda: plegado, sin signos y con espacios simples.
/// «¡Corazón, de MIMBRE!» → «corazon de mimbre».
String foldForSearch(String text) =>
    foldText(text).replaceAll(_notLetterOrNumber, ' ').trim();

List<String> _wordsOf(String text) =>
    text.split(' ').where((word) => word.isNotEmpty).toList();

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

/// Puntos de una palabra de la consulta frente a una palabra del texto (las dos ya normalizadas): 3, 2, 1 o 0.
int wordPoints(String token, String word) {
  if (word == token) return kSearchExactPoints;
  if (word.startsWith(token)) return kSearchPrefixPoints;
  if (token.length >= kSearchTypoMinLength && _hasLetter.hasMatch(token)) {
    final head = word.length > token.length
        ? word.substring(0, token.length)
        : word;
    if (editDistance(token, head) <= 1 || editDistance(token, word) <= 1) {
      return kSearchTypoPoints;
    }
  }
  return 0;
}

class _Query {
  _Query(String raw) : text = foldForSearch(raw) {
    tokens = _wordsOf(text);
  }

  final String text;
  late final List<String> tokens;
}

String _fieldText(Object? field) => field is Iterable
    ? field.map((item) => '$item').join(' ')
    : (field == null ? '' : '$field');

int _scoreFields(List<Object?> fields, _Query query) {
  if (query.tokens.isEmpty || fields.isEmpty) return 0;
  final prepared = [
    for (var i = 0; i < fields.length; i++)
      (
        weight:
            kSearchFieldWeights[i < kSearchFieldWeights.length
                ? i
                : kSearchFieldWeights.length - 1],
        words: _wordsOf(foldForSearch(_fieldText(fields[i]))),
      ),
  ];
  var total = 0;
  for (final token in query.tokens) {
    var best = 0;
    for (final field in prepared) {
      for (final word in field.words) {
        final points = wordPoints(token, word) * field.weight;
        if (points > best) best = points;
      }
    }
    if (best == 0) return 0;
    total += best;
  }
  final main = foldForSearch(_fieldText(fields.first));
  if (main == query.text) {
    total += kSearchEqualBonus;
  } else if (main.startsWith(query.text)) {
    total += kSearchStartsWithBonus;
  }
  return total;
}

/// Puntos de un elemento para [rawQuery] (0 si no coincide). [fields]: sus campos en orden de importancia; cada uno
/// es un texto o una lista de textos (las etiquetas).
int searchScore(List<Object?> fields, String rawQuery) =>
    _scoreFields(fields, _Query(rawQuery));

/// La regla de búsqueda: los elementos de [items] que coinciden con [rawQuery], de más a menos relevantes (a
/// igualdad, en su orden). [fieldsOf] da sus campos en orden de importancia. Sin texto que buscar, devuelve [items].
List<T> searchRank<T>(
  List<T> items,
  String rawQuery,
  List<Object?> Function(T item) fieldsOf,
) {
  final query = _Query(rawQuery);
  if (query.tokens.isEmpty) return items;
  final scored = <({T item, int index, int score})>[];
  for (var i = 0; i < items.length; i++) {
    final score = _scoreFields(fieldsOf(items[i]), query);
    if (score > 0) scored.add((item: items[i], index: i, score: score));
  }
  scored.sort(
    (a, b) => a.score != b.score
        ? b.score.compareTo(a.score)
        : a.index.compareTo(b.index),
  );
  return [for (final entry in scored) entry.item];
}

/// Campos de búsqueda de una canción: título, artista, álbum, año y etiquetas.
List<Object?> songSearchFields(Song song, [String albumName = '']) => [
  song.title,
  song.artist,
  albumName,
  song.year == null ? '' : '${song.year}',
  song.tags,
];

/// Campos de búsqueda de un álbum: nombre y artista.
List<Object?> folderSearchFields(Folder folder) => [folder.name, folder.artist];

/// Canciones que coinciden con [rawQuery] («Buscar en esta colección»), de más a menos relevantes. [albumName] da el
/// nombre del álbum de cada canción. Sin texto devuelve todas, en su orden.
List<Song> filterSongsByText(
  List<Song> songs,
  String rawQuery, {
  String Function(Song song)? albumName,
}) => searchRank(
  songs,
  rawQuery,
  (song) => songSearchFields(song, albumName?.call(song) ?? ''),
);
