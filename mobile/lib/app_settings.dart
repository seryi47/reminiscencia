/// Ajustes de pantalla de la app (iguales para todos: la app no tiene usuarios ni modos).
/// Clase pura de Dart: no depende de Flutter.
class AppSettings {
  const AppSettings({
    this.textScale = minTextScale,
    this.highContrast = false,
    this.reduceMotion = false,
    this.batterySaver = false,
    this.oledTheme = false,
  }) : assert(
         textScale >= minTextScale && textScale <= maxTextScale,
         'textScale fuera de rango',
       );

  /// Factor mínimo y máximo del tamaño de texto (multiplica el tamaño del sistema).
  static const double minTextScale = 1.0;
  static const double maxTextScale = 1.6;

  /// Pasos del control deslizante: 1.0, 1.1, … 1.6.
  static const int textScaleDivisions = 6;

  static const AppSettings defaults = AppSettings();

  final double textScale;
  final bool highContrast;
  final bool reduceMotion;

  /// Ahorro de batería: menos radio activa (long-poll más corto), sin prefetch de la siguiente canción,
  /// bitrate menor, chequeo de updates una vez por día (ADR-0052). Default OFF para no cambiar UX.
  final bool batterySaver;

  /// Negro puro para pantallas OLED: `AppPalette.oled`. Default OFF para mantener el gris de Spotify.
  final bool oledTheme;

  /// Acota el factor al rango permitido. NaN vuelve al valor mínimo.
  static double clampTextScale(double value) {
    if (value.isNaN) return minTextScale;
    return value.clamp(minTextScale, maxTextScale).toDouble();
  }

  AppSettings copyWith({
    double? textScale,
    bool? highContrast,
    bool? reduceMotion,
    bool? batterySaver,
    bool? oledTheme,
  }) {
    return AppSettings(
      textScale: clampTextScale(textScale ?? this.textScale),
      highContrast: highContrast ?? this.highContrast,
      reduceMotion: reduceMotion ?? this.reduceMotion,
      batterySaver: batterySaver ?? this.batterySaver,
      oledTheme: oledTheme ?? this.oledTheme,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is AppSettings &&
      other.textScale == textScale &&
      other.highContrast == highContrast &&
      other.reduceMotion == reduceMotion &&
      other.batterySaver == batterySaver &&
      other.oledTheme == oledTheme;

  @override
  int get hashCode =>
      Object.hash(textScale, highContrast, reduceMotion, batterySaver, oledTheme);

  @override
  String toString() =>
      'AppSettings(textScale: $textScale, highContrast: $highContrast, '
      'reduceMotion: $reduceMotion, batterySaver: $batterySaver, oledTheme: $oledTheme)';
}
