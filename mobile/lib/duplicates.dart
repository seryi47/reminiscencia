import 'package:flutter/foundation.dart';

// Regla común de «posible duplicado» (ADR-0026), igual que el backend (backend/sonidos/duplicados.py) y la web
// (frontend/web/js/duplicates.js). Los datos y los casos de prueba están en tests/contrato/duplicados.json, que
// comprueba mobile/test/duplicates_test.dart.
//
// Dos canciones son un posible duplicado si su título normalizado es igual y no está vacío y, además: si las dos
// tienen duración (mayor que 0), se diferencian como mucho en [kDuplicateToleranceS] segundos; si a alguna le falta,
// su artista normalizado es igual. Solo avisa: nunca impide subir.

/// Diferencia máxima de duración, en segundos.
const int kDuplicateToleranceS = 2;

/// Letras que se pliegan (posición a posición) a [kFoldTo].
const String kFoldFrom = 'áàäâãåāéèëêēíìïîīóòöôõøōúùüûūñçýÿ';
const String kFoldTo = 'aaaaaaaeeeeeiiiiiooooooouuuuuncyy';

/// Contenido de un paréntesis o corchete que se quita del título, ya normalizado.
const List<String> kDuplicateTags = [
  'official video',
  'official music video',
  'official audio',
  'official lyric video',
  'official visualizer',
  'lyric video',
  'lyrics video',
  'video lyric',
  'video lyrics',
  'video oficial',
  'videoclip oficial',
  'videoclip',
  'video',
  'audio oficial',
  'audio',
  'letra',
  'con letra',
  'lyrics',
  'lyric',
  'visualizer',
  'hd',
  'hq',
  '4k',
];

/// Marcas de featuring: un grupo que empieza por una se quita, y desde la primera (si no es la primera palabra) se
/// corta el resto del título.
const List<String> kFeaturingMarks = ['ft', 'feat', 'featuring'];

final RegExp _combining = RegExp('[̀-ͯ]');
final RegExp _signs = RegExp(r'[^\p{L}\p{N}]+', unicode: true);
final RegExp _group = RegExp(r'[(\[]([^()\[\]]*)[)\]]');
final Set<String> _tags = kDuplicateTags.toSet();
final Set<String> _featuring = kFeaturingMarks.toSet();

/// Minúsculas, sin marcas combinantes (U+0300 a U+036F) y con las letras de [kFoldFrom] plegadas a [kFoldTo]. Lo usan
/// también la búsqueda (lib/fuzzy_search.dart, ADR-0028) y la web (foldText de js/catalog.js).
String foldText(String text) {
  final lower = text.toLowerCase().replaceAll(_combining, '');
  final buffer = StringBuffer();
  for (final rune in lower.runes) {
    final char = String.fromCharCode(rune);
    final index = kFoldFrom.indexOf(char);
    buffer.write(index < 0 ? char : kFoldTo[index]);
  }
  return buffer.toString();
}

List<String> _words(String text) => text
    .replaceAll(_signs, ' ')
    .split(' ')
    .where((word) => word.isNotEmpty)
    .toList();

/// Título comparable: sin mayúsculas, acentos, signos, etiquetas como «(Official Video)» ni featuring.
String normalizeDuplicateTitle(String title) {
  final grouped = foldText(title).replaceAllMapped(_group, (match) {
    final inner = match.group(1)!;
    final words = _words(inner);
    if (words.isNotEmpty &&
        (_tags.contains(words.join(' ')) || _featuring.contains(words[0]))) {
      return ' ';
    }
    return ' $inner ';
  });
  var words = _words(grouped);
  for (var i = 1; i < words.length; i++) {
    if (_featuring.contains(words[i])) {
      words = words.sublist(0, i);
      break;
    }
  }
  return words.join(' ');
}

/// Artista comparable: sin mayúsculas, acentos ni signos, con espacios simples.
String normalizeDuplicateArtist(String artist) =>
    _words(foldText(artist)).join(' ');

/// Lo que se compara de una canción: título, artista y duración (null si no se conoce).
@immutable
class DuplicateCandidate {
  const DuplicateCandidate({
    required this.title,
    this.artist = '',
    this.durationS,
  });

  final String title;
  final String artist;
  final double? durationS;
}

double? _duration(double? value) =>
    value != null && value.isFinite && value > 0 ? value : null;

/// ¿Parecen la misma canción?
bool isPossibleDuplicate(DuplicateCandidate a, DuplicateCandidate b) {
  final title = normalizeDuplicateTitle(a.title);
  if (title.isEmpty || title != normalizeDuplicateTitle(b.title)) return false;
  final da = _duration(a.durationS);
  final db = _duration(b.durationS);
  if (da != null && db != null) return (da - db).abs() <= kDuplicateToleranceS;
  return normalizeDuplicateArtist(a.artist) ==
      normalizeDuplicateArtist(b.artist);
}

/// Las de [others] que parecen la misma canción que [candidate], en su orden.
List<T> possibleDuplicates<T extends DuplicateCandidate>(
  DuplicateCandidate candidate,
  Iterable<T> others,
) => [
  for (final other in others)
    if (isPossibleDuplicate(candidate, other)) other,
];

/// Aviso de una canción que se va a subir y parece repetida.
@immutable
class UploadDuplicate {
  const UploadDuplicate({
    required this.index,
    required this.matchTitle,
    required this.matchDurationS,
    required this.inBatch,
  });

  /// Posición del archivo en la tanda.
  final int index;

  /// Título de la canción de la biblioteca (o del otro archivo de la tanda) a la que se parece.
  final String matchTitle;
  final double? matchDurationS;

  /// True si se parece a otro archivo anterior de la misma tanda; false si a una canción de la biblioteca.
  final bool inBatch;

  /// «Parece que ya está en la biblioteca: «X» (3:21). ¿Subirla igualmente?»
  String get message {
    final duration = _duration(matchDurationS);
    final when = duration == null ? '' : ' (${_clock(duration)})';
    final where = inBatch
        ? 'Parece repetida en esta subida'
        : 'Parece que ya está en la biblioteca';
    return '$where: «$matchTitle»$when. ¿Subirla igualmente?';
  }
}

String _clock(double seconds) {
  final total = seconds.floor();
  final h = total ~/ 3600;
  final m = (total % 3600) ~/ 60;
  final s = (total % 60).toString().padLeft(2, '0');
  return h > 0 ? '$h:${m.toString().padLeft(2, '0')}:$s' : '$m:$s';
}

/// Para cada archivo de [batch], el primer parecido: antes una canción de [library]; si no, un archivo anterior de la
/// misma tanda. Solo devuelve los archivos que se parecen a algo, en orden.
List<UploadDuplicate> findUploadDuplicates(
  List<DuplicateCandidate> batch,
  List<DuplicateCandidate> library,
) {
  final found = <UploadDuplicate>[];
  for (var i = 0; i < batch.length; i++) {
    final candidate = batch[i];
    final inLibrary = possibleDuplicates(candidate, library);
    if (inLibrary.isNotEmpty) {
      found.add(
        UploadDuplicate(
          index: i,
          matchTitle: inLibrary.first.title,
          matchDurationS: inLibrary.first.durationS,
          inBatch: false,
        ),
      );
      continue;
    }
    final earlier = possibleDuplicates(candidate, batch.sublist(0, i));
    if (earlier.isNotEmpty) {
      found.add(
        UploadDuplicate(
          index: i,
          matchTitle: earlier.first.title,
          matchDurationS: earlier.first.durationS,
          inBatch: true,
        ),
      );
    }
  }
  return found;
}
