// Decisiones puras de reproducción y sincronización. No dependen de plugins, así se prueban en Dart.

import 'song.dart';

/// Si una canción puede sonar sin red: local (su fichero está en este teléfono) o ya guardada.
bool playableOffline({required Song song, required bool cached}) =>
    song.local || cached;

/// Índice de la siguiente canción que puede sonar después de [from], o null si no queda ninguna.
/// [playable] dice por posición si la canción puede sonar sin red (local o ya guardada).
int? nextAvailableIndex(List<bool> playable, int from) {
  for (var index = from + 1; index < playable.length; index += 1) {
    if (playable[index]) return index;
  }
  return null;
}

/// Ids cuyo audio guardado puede borrarse: los que ya no están en el catálogo y no están sonando ni en la cola.
/// Las canciones del catálogo nunca se borran; las locales no entran aquí (viven en otra carpeta).
Set<String> prunableAudioIds({
  required Set<String> cached,
  required Set<String> catalog,
  required Set<String> inUse,
}) {
  return cached.difference(catalog).difference(inUse);
}

/// Si hay que sincronizar al volver a primer plano: solo si ha pasado [minAge] desde la última sincronización.
/// No hay temporizadores en segundo plano; esta comprobación es la única vía de sincronizar sin tocar nada.
bool shouldSyncOnResume({
  required DateTime? last,
  required DateTime now,
  Duration minAge = const Duration(minutes: 10),
}) {
  if (last == null) return true;
  return now.difference(last) >= minAge;
}
