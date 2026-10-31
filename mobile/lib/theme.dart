import 'package:flutter/material.dart';

/// Colores de la app. Para cambiar el diseño se toca este fichero y nada más.
class AppPalette {
  const AppPalette({
    required this.background,
    required this.surface,
    required this.surfaceRaised,
    required this.accent,
    required this.ink,
    required this.inkMuted,
    required this.outline,
    required this.online,
  });

  final Color background;
  final Color surface;
  final Color surfaceRaised;
  final Color accent;
  final Color ink;
  final Color inkMuted;
  final Color outline;
  final Color online;

  /// Paleta por defecto: carbón con acento cálido.
  static const AppPalette standard = AppPalette(
    background: Color(0xFF0E0F12),
    surface: Color(0xFF14161C),
    surfaceRaised: Color(0xFF1B1E26),
    accent: Color(0xFFE0B26A),
    ink: Color(0xFFEFEDE8),
    inkMuted: Color(0xFFB9B5AD),
    outline: Color(0xFF6B707C),
    online: Color(0xFF86D3A2),
  );

  /// Alto contraste: negro puro, texto blanco y bordes visibles.
  static const AppPalette highContrast = AppPalette(
    background: Color(0xFF000000),
    surface: Color(0xFF000000),
    surfaceRaised: Color(0xFF141414),
    accent: Color(0xFFFFD27F),
    ink: Color(0xFFFFFFFF),
    inkMuted: Color(0xFFE6E6E6),
    outline: Color(0xFFFFFFFF),
    online: Color(0xFF9EF0B6),
  );
}

/// Lleva la paleta dentro del tema para leerla desde cualquier widget con [paletteOf].
class AppPaletteExtension extends ThemeExtension<AppPaletteExtension> {
  const AppPaletteExtension(this.palette);

  final AppPalette palette;

  @override
  AppPaletteExtension copyWith({AppPalette? palette}) =>
      AppPaletteExtension(palette ?? this.palette);

  @override
  AppPaletteExtension lerp(
    ThemeExtension<AppPaletteExtension>? other,
    double t,
  ) {
    if (other is AppPaletteExtension && t >= 0.5) return other;
    return this;
  }
}

/// Paleta activa para el contexto. Si el tema no la trae, usa la estándar.
AppPalette paletteOf(BuildContext context) =>
    Theme.of(context).extension<AppPaletteExtension>()?.palette ??
    AppPalette.standard;

/// Tipografía de la app. Los tamaños se escalan con el ajuste de texto (MediaQuery.textScaler).
abstract final class AppTypography {
  static TextTheme build(TextTheme base, AppPalette palette) {
    return base
        .copyWith(
          headlineMedium: base.headlineMedium?.copyWith(
            fontWeight: FontWeight.w700,
          ),
          headlineSmall: base.headlineSmall?.copyWith(
            fontWeight: FontWeight.w700,
          ),
          titleLarge: base.titleLarge?.copyWith(fontWeight: FontWeight.w700),
          titleMedium: base.titleMedium?.copyWith(fontWeight: FontWeight.w600),
          labelLarge: base.labelLarge?.copyWith(fontWeight: FontWeight.w600),
        )
        .apply(bodyColor: palette.ink, displayColor: palette.ink);
  }
}

/// Construye el tema completo a partir de los ajustes de accesibilidad.
ThemeData buildAppTheme({
  bool highContrast = false,
  bool reduceMotion = false,
}) {
  final palette = highContrast ? AppPalette.highContrast : AppPalette.standard;
  final scheme =
      ColorScheme.fromSeed(
        seedColor: palette.accent,
        brightness: Brightness.dark,
      ).copyWith(
        primary: palette.accent,
        surface: palette.background,
        onSurface: palette.ink,
        onSurfaceVariant: palette.inkMuted,
        surfaceContainerHighest: palette.surfaceRaised,
        surfaceContainerHigh: palette.surface,
        outline: palette.outline,
        outlineVariant: palette.outline,
      );
  final base = ThemeData(
    colorScheme: scheme,
    useMaterial3: true,
    extensions: [AppPaletteExtension(palette)],
  );
  return base.copyWith(
    scaffoldBackgroundColor: palette.background,
    visualDensity: VisualDensity.standard,
    textTheme: AppTypography.build(base.textTheme, palette),
    appBarTheme: AppBarTheme(
      backgroundColor: palette.background,
      foregroundColor: palette.ink,
      elevation: 0,
      scrolledUnderElevation: 0,
    ),
    pageTransitionsTheme: reduceMotion
        ? PageTransitionsTheme(builders: _noTransitions)
        : null,
  );
}

final Map<TargetPlatform, PageTransitionsBuilder> _noTransitions = {
  for (final platform in TargetPlatform.values)
    platform: const _InstantTransitionBuilder(),
};

/// Cambio de pantalla sin animación, para el ajuste «Reducir animaciones».
class _InstantTransitionBuilder extends PageTransitionsBuilder {
  const _InstantTransitionBuilder();

  @override
  Widget buildTransitions<T>(
    PageRoute<T> route,
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    return child;
  }
}
