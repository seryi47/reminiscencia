// Regla común (web + APK) de «¿esta pista de Spotify ya está en mi biblioteca?» para «Transferir música» (ADR-0046).
// Datos y casos en tests/contrato/biblioteca-match.json; el espejo en la web es frontend/web/js/library-match.js.
//
// Es MÁS TOLERANTE que la regla de duplicados (ADR-0026) a propósito: evita contar como «falta» una canción que ya tienes
// por diferencias menores (un «Remastered» en el título, un «feat.» de más en el artista o unos segundos de duración).
// Parte del título ya normalizado de duplicados (sin ruido ni «feat») y, encima, quita las etiquetas NEUTRAS (remaster,
// radio edit… = misma grabación) pero CONSERVA las de versión (live, remix, acústico…), que sí son otra grabación.

import 'duplicates.dart';

const double kLibraryMatchToleranceS = 8;

/// Etiquetas que NO cambian la grabación: se quitan de la clave de título para que «Clocks (Remastered)» = «Clocks».
const List<String> kNeutralVersionTags = [
  'remaster',
  'remastered',
  'remasterizado',
  'remasterizada',
  'remastered version',
  'radio edit',
  'radio version',
  'single version',
  'album version',
  'original mix',
];

const Set<String> _featuring = {'ft', 'feat', 'featuring', 'con'};
const String _year = r'(?:19|20)\d\d';
String _escapeRe(String text) => text.replaceAllMapped(RegExp(r'[.*+?^${}()|[\]\\]'), (m) => '\\${m.group(0)}');

/// Clave de título para comparar presencia en biblioteca: la normalización de duplicados (minúsculas, sin acentos, sin ruido
/// ni «feat») y, encima, quitar las etiquetas NEUTRAS (remaster, radio edit…) con un año pegado si lo llevan, PERO
/// conservando las de versión (live, remix…). Se quita solo la etiqueta, no el grupo entero, para no tirar un «Live» que vaya
/// junto a un «Remastered».
String libraryTitleKey(String title) {
  var key = normalizeDuplicateTitle(title);
  final tags = [...kNeutralVersionTags]..sort((a, b) => b.length - a.length);
  for (final tag in tags) {
    final re = RegExp('(?:^|\\s)(?:$_year\\s+)?${_escapeRe(tag)}(?:\\s+$_year)?(?=\\s|\$)');
    key = key.replaceAll(re, ' ');
  }
  return key.replaceAll(RegExp(r'\s+'), ' ').trim();
}

List<String> _artistTokens(String artist) => normalizeDuplicateArtist(artist)
    .split(' ')
    .where((word) => word.isNotEmpty && !_featuring.contains(word))
    .toList();

bool _isSubset(List<String> x, List<String> y) => x.every(y.contains);
bool _sameArtistSet(List<String> x, List<String> y) => x.length == y.length && _isSubset(x, y) && _isSubset(y, x);

double? _duration(double? value) =>
    value != null && value.isFinite && value > 0 ? value : null;

/// ¿Esta pista ya está en la biblioteca? Simétrica. Misma lógica que isSameLibraryTrack de la web.
/// - mismo artista exacto → misma grabación aunque la duración difiera (radio edit);
/// - solape parcial (uno es «feat» del otro) → solo si la duración cuadra (±tolerancia);
/// - artistas distintos → no; falta algún artista → decide la duración o, sin ella, basta el título.
bool isSameLibraryTrack(DuplicateCandidate a, DuplicateCandidate b) {
  final keyA = libraryTitleKey(a.title);
  final keyB = libraryTitleKey(b.title);
  if (keyA.isEmpty || keyA != keyB) return false;
  final ta = _artistTokens(a.artist);
  final tb = _artistTokens(b.artist);
  final da = _duration(a.durationS);
  final db = _duration(b.durationS);
  final bool? durationOk = da != null && db != null ? (da - db).abs() <= kLibraryMatchToleranceS : null;
  if (ta.isNotEmpty && tb.isNotEmpty) {
    if (_sameArtistSet(ta, tb)) return true;
    if (!(_isSubset(ta, tb) || _isSubset(tb, ta))) return false;
    return durationOk ?? true;
  }
  return durationOk ?? true;
}
