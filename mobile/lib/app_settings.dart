/// Ajustes de accesibilidad de la app. Clase pura de Dart: no depende de Flutter.
class AppSettings {
  const AppSettings({
    this.textScale = minTextScale,
    this.patientMode = false,
    this.highContrast = false,
    this.reduceMotion = false,
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
  final bool patientMode;
  final bool highContrast;
  final bool reduceMotion;

  /// Acota el factor al rango permitido. NaN vuelve al valor mínimo.
  static double clampTextScale(double value) {
    if (value.isNaN) return minTextScale;
    return value.clamp(minTextScale, maxTextScale).toDouble();
  }

  AppSettings copyWith({
    double? textScale,
    bool? patientMode,
    bool? highContrast,
    bool? reduceMotion,
  }) {
    return AppSettings(
      textScale: clampTextScale(textScale ?? this.textScale),
      patientMode: patientMode ?? this.patientMode,
      highContrast: highContrast ?? this.highContrast,
      reduceMotion: reduceMotion ?? this.reduceMotion,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is AppSettings &&
      other.textScale == textScale &&
      other.patientMode == patientMode &&
      other.highContrast == highContrast &&
      other.reduceMotion == reduceMotion;

  @override
  int get hashCode =>
      Object.hash(textScale, patientMode, highContrast, reduceMotion);

  @override
  String toString() =>
      'AppSettings(textScale: $textScale, patientMode: $patientMode, highContrast: $highContrast, reduceMotion: $reduceMotion)';
}
