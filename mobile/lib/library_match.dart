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
final RegExp _group = RegExp(r'[(\[]([^()\[\]]*)[)\]]');

/// Quita los grupos entre paréntesis/corchetes que contienen una etiqueta neutra, con todo lo que lleven dentro (así
/// «(Remastered 2011)» desaparece entero, año incluido). Las versiones (live, remix…) no son neutras y se conservan.
String _stripNeutralGroups(String title) {
  return title.replaceAllMapped(_group, (match) {
    final norm = normalizeDuplicateArtist(match.group(1) ?? '');
    final hit = kNeutralVersionTags.any((tag) => ' $norm '.contains(' $tag '));
    return hit ? ' ' : match.group(0)!;
  });
}

/// Clave de título para comparar presencia en biblioteca: quitar grupos neutros, normalizar como duplicados y, por último,
/// quitar las etiquetas neutras sueltas (sin paréntesis, p. ej. «Tema - Radio Edit»).
String libraryTitleKey(String title) {
  var key = normalizeDuplicateTitle(_stripNeutralGroups(title));
  final tags = [...kNeutralVersionTags]..sort((a, b) => b.length - a.length);
  for (final tag in tags) {
    while (' $key '.contains(' $tag ')) {
      key = ' $key '.replaceAll(' $tag ', ' ').trim();
    }
  }
  return key.replaceAll(RegExp(r'\s+'), ' ').trim();
}

List<String> _artistTokens(String artist) => normalizeDuplicateArtist(artist)
    .split(' ')
    .where((word) => word.isNotEmpty && !_featuring.contains(word))
    .toList();

bool _artistsOverlap(String a, String b) {
  final ta = _artistTokens(a);
  final tb = _artistTokens(b);
  if (ta.isEmpty || tb.isEmpty) return false;
  bool subset(List<String> x, List<String> y) => x.every(y.contains);
  return subset(ta, tb) || subset(tb, ta);
}

double? _duration(double? value) =>
    value != null && value.isFinite && value > 0 ? value : null;

/// ¿Esta pista ya está en la biblioteca? Simétrica. Misma lógica que isSameLibraryTrack de la web.
bool isSameLibraryTrack(DuplicateCandidate a, DuplicateCandidate b) {
  final keyA = libraryTitleKey(a.title);
  final keyB = libraryTitleKey(b.title);
  if (keyA.isEmpty || keyA != keyB) return false;
  final tokensA = _artistTokens(a.artist);
  final tokensB = _artistTokens(b.artist);
  if (tokensA.isNotEmpty && tokensB.isNotEmpty) {
    return _artistsOverlap(a.artist, b.artist);
  }
  final da = _duration(a.durationS);
  final db = _duration(b.durationS);
  if (da != null && db != null) return (da - db).abs() <= kLibraryMatchToleranceS;
  return true;
}
