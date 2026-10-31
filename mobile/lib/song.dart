/// Una canción del índice (assets/data/songs.json, generado desde la biblioteca).
class Song {
  const Song({
    required this.id,
    required this.title,
    required this.durationS,
    required this.license,
    required this.audio,
  });

  final String id;
  final String title;
  final double durationS;
  final String license;

  /// Ruta relativa a la raíz de la web, por ejemplo "audio/S123.opus".
  final String audio;

  /// Ruta dentro de los assets empaquetados en la APK.
  String get assetPath => 'assets/$audio';

  factory Song.fromJson(Map<String, dynamic> json) {
    return Song(
      id: json['id'] as String,
      title: json['title'] as String,
      durationS: (json['duration_s'] as num).toDouble(),
      license: json['license'] as String,
      audio: json['audio'] as String,
    );
  }
}
