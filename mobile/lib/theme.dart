import 'package:flutter/material.dart';

/// Colores de la app (tema oscuro con la estructura visual de Spotify, sin su marca).
/// Para cambiar el diseño se toca este fichero y nada más.
class AppPalette {
  const AppPalette({
    required this.black,
    required this.background,
    required this.card,
    required this.cardPressed,
    required this.elevated,
    required this.ink,
    required this.inkMuted,
    required this.accent,
    required this.onAccent,
    required this.track,
    required this.outline,
    required this.error,
  });

  /// Negro de la barra inferior, el minirreproductor y las cabeceras.
  final Color black;

  /// Fondo de las páginas.
  final Color background;

  /// Tarjetas y filas destacadas.
  final Color card;

  /// Tarjeta pulsada (o con el puntero encima).
  final Color cardPressed;

  /// Superficies elevadas: menús, hojas inferiores, diálogos y minirreproductor.
  final Color elevated;

  /// Texto principal.
  final Color ink;

  /// Texto secundario.
  final Color inkMuted;

  /// Acento (reproducir, elemento activo). El texto encima va en [onAccent].
  final Color accent;
  final Color onAccent;

  /// Parte sin reproducir de las barras de progreso.
  final Color track;

  /// Bordes (solo visibles en alto contraste).
  final Color outline;

  final Color error;

  /// Paleta por defecto. Contraste (WCAG): #fff sobre #121212 18,7:1; #b3b3b3 sobre #121212 8,9:1
  /// y sobre #282828 7,0:1; #000 sobre #1fdf64 11,8:1; barra sin reproducir #727272 3,9:1.
  static const AppPalette standard = AppPalette(
    black: Color(0xFF000000),
    background: Color(0xFF121212),
    card: Color(0xFF181818),
    cardPressed: Color(0xFF282828),
    elevated: Color(0xFF242424),
    ink: Color(0xFFFFFFFF),
    inkMuted: Color(0xFFB3B3B3),
    accent: Color(0xFF1FDF64),
    onAccent: Color(0xFF000000),
    track: Color(0xFF727272),
    outline: Color(0xFF3E3E3E),
    error: Color(0xFFF3727F),
  );

  /// Alto contraste: negro puro, texto secundario casi blanco y bordes visibles.
  static const AppPalette highContrast = AppPalette(
    black: Color(0xFF000000),
    background: Color(0xFF000000),
    card: Color(0xFF0A0A0A),
    cardPressed: Color(0xFF242424),
    elevated: Color(0xFF141414),
    ink: Color(0xFFFFFFFF),
    inkMuted: Color(0xFFE6E6E6),
    accent: Color(0xFF1FDF64),
    onAccent: Color(0xFF000000),
    track: Color(0xFF8A8A8A),
    outline: Color(0xFFFFFFFF),
    error: Color(0xFFFF9AA4),
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

/// Familia tipográfica incluida en la app (assets/fonts, licencia OFL).
const String kFontFamily = 'Figtree';

/// Tipografía de la app. Los tamaños se escalan con el ajuste de texto (MediaQuery.textScaler).
abstract final class AppTypography {
  static TextTheme build(AppPalette palette) {
    TextStyle style(double size, FontWeight weight, {double height = 1.25}) =>
        TextStyle(
          fontFamily: kFontFamily,
          fontSize: size,
          fontWeight: weight,
          height: height,
          color: palette.ink,
          letterSpacing: 0,
        );
    final muted = palette.inkMuted;
    return TextTheme(
      displaySmall: style(32, FontWeight.w800, height: 1.1),
      headlineLarge: style(30, FontWeight.w800, height: 1.15),
      headlineMedium: style(24, FontWeight.w700, height: 1.2),
      headlineSmall: style(22, FontWeight.w700),
      titleLarge: style(20, FontWeight.w700),
      titleMedium: style(16, FontWeight.w700),
      titleSmall: style(14, FontWeight.w600),
      bodyLarge: style(16, FontWeight.w400, height: 1.4),
      bodyMedium: style(14, FontWeight.w400, height: 1.4),
      bodySmall: style(13, FontWeight.w400).copyWith(color: muted),
      labelLarge: style(14, FontWeight.w700),
      labelMedium: style(12, FontWeight.w600),
      labelSmall: style(11, FontWeight.w500).copyWith(color: muted),
    );
  }
}

/// Construye el tema completo a partir de los ajustes de pantalla.
ThemeData buildAppTheme({
  bool highContrast = false,
  bool reduceMotion = false,
}) {
  final p = highContrast ? AppPalette.highContrast : AppPalette.standard;
  final scheme = ColorScheme(
    brightness: Brightness.dark,
    primary: p.accent,
    onPrimary: p.onAccent,
    secondary: p.ink,
    onSecondary: p.black,
    error: p.error,
    onError: p.black,
    surface: p.background,
    onSurface: p.ink,
    onSurfaceVariant: p.inkMuted,
    surfaceContainerLowest: p.black,
    surfaceContainerLow: p.card,
    surfaceContainer: p.card,
    surfaceContainerHigh: p.elevated,
    surfaceContainerHighest: p.cardPressed,
    outline: p.outline,
    outlineVariant: p.outline,
    inverseSurface: p.ink,
    onInverseSurface: p.black,
    shadow: p.black,
    scrim: p.black,
  );
  final text = AppTypography.build(p);
  final pill = const StadiumBorder();
  final minTarget = const Size(48, 48);
  return ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    colorScheme: scheme,
    fontFamily: kFontFamily,
    textTheme: text,
    primaryTextTheme: text,
    scaffoldBackgroundColor: p.background,
    canvasColor: p.background,
    visualDensity: VisualDensity.standard,
    materialTapTargetSize: MaterialTapTargetSize.padded,
    splashFactory: reduceMotion ? NoSplash.splashFactory : null,
    highlightColor: p.cardPressed.withValues(alpha: 0.6),
    splashColor: p.cardPressed.withValues(alpha: 0.6),
    extensions: [AppPaletteExtension(p)],
    appBarTheme: AppBarTheme(
      backgroundColor: p.background,
      foregroundColor: p.ink,
      elevation: 0,
      scrolledUnderElevation: 0,
      titleTextStyle: text.titleLarge,
      centerTitle: false,
    ),
    iconTheme: IconThemeData(color: p.ink, size: 24),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(
        foregroundColor: p.ink,
        minimumSize: minTarget,
        disabledForegroundColor: p.inkMuted.withValues(alpha: 0.5),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: p.accent,
        foregroundColor: p.onAccent,
        minimumSize: minTarget,
        shape: pill,
        textStyle: text.labelLarge,
        padding: const EdgeInsets.symmetric(horizontal: 24),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: p.ink,
        minimumSize: minTarget,
        shape: pill,
        side: BorderSide(color: p.inkMuted),
        textStyle: text.labelLarge,
        padding: const EdgeInsets.symmetric(horizontal: 20),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: p.ink,
        minimumSize: minTarget,
        shape: pill,
        textStyle: text.labelLarge,
      ),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: p.cardPressed,
      selectedColor: p.accent,
      labelStyle: text.labelLarge?.copyWith(color: p.ink),
      secondaryLabelStyle: text.labelLarge?.copyWith(color: p.onAccent),
      checkmarkColor: p.onAccent,
      showCheckmark: false,
      shape: StadiumBorder(
        side: BorderSide(color: highContrast ? p.outline : Colors.transparent),
      ),
      side: BorderSide.none,
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
    ),
    listTileTheme: ListTileThemeData(
      iconColor: p.inkMuted,
      textColor: p.ink,
      minTileHeight: 56,
      titleTextStyle: text.bodyLarge,
      subtitleTextStyle: text.bodySmall,
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: p.elevated,
      titleTextStyle: text.titleLarge,
      contentTextStyle: text.bodyMedium,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: p.elevated,
      modalBackgroundColor: p.elevated,
      dragHandleColor: p.inkMuted,
      showDragHandle: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: p.ink,
      contentTextStyle: text.bodyMedium?.copyWith(color: p.black),
      actionTextColor: p.black,
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
    ),
    sliderTheme: SliderThemeData(
      activeTrackColor: p.ink,
      inactiveTrackColor: p.track,
      thumbColor: p.ink,
      overlayColor: p.ink.withValues(alpha: 0.12),
      trackHeight: 4,
      valueIndicatorColor: p.elevated,
      valueIndicatorTextStyle: text.labelLarge,
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith(
        (states) =>
            states.contains(WidgetState.selected) ? p.black : p.inkMuted,
      ),
      trackColor: WidgetStateProperty.resolveWith(
        (states) =>
            states.contains(WidgetState.selected) ? p.accent : p.cardPressed,
      ),
      trackOutlineColor: WidgetStateProperty.resolveWith(
        (states) =>
            states.contains(WidgetState.selected) ? p.accent : p.inkMuted,
      ),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(
      color: p.accent,
      linearTrackColor: p.track,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: p.cardPressed,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: BorderSide.none,
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: BorderSide(color: p.ink, width: 2),
      ),
      labelStyle: text.bodyMedium?.copyWith(color: p.inkMuted),
      hintStyle: text.bodyMedium?.copyWith(color: p.inkMuted),
    ),
    textSelectionTheme: TextSelectionThemeData(
      cursorColor: p.accent,
      selectionColor: p.accent.withValues(alpha: 0.4),
      selectionHandleColor: p.accent,
    ),
    dividerTheme: DividerThemeData(color: p.outline, thickness: 1),
    navigationRailTheme: NavigationRailThemeData(
      backgroundColor: p.black,
      indicatorColor: p.cardPressed,
      selectedIconTheme: IconThemeData(color: p.ink),
      unselectedIconTheme: IconThemeData(color: p.inkMuted),
      selectedLabelTextStyle: text.labelMedium?.copyWith(color: p.ink),
      unselectedLabelTextStyle: text.labelMedium?.copyWith(color: p.inkMuted),
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

/// Color de portada estable para un identificador (las canciones no traen imagen).
/// Tonos oscuros y saturados: el texto blanco encima cumple AA.
Color coverColorFor(String seed) {
  const colors = [
    Color(0xFF8C1932),
    Color(0xFF1E3264),
    Color(0xFF477D95),
    Color(0xFF8D67AB),
    Color(0xFFBA5D07),
    Color(0xFF0D7307),
    Color(0xFF503750),
    Color(0xFF056952),
    Color(0xFFAF2896),
    Color(0xFF283EA3),
    Color(0xFF7D4B32),
    Color(0xFF2D46B9),
  ];
  var hash = 0;
  for (final unit in seed.codeUnits) {
    hash = (hash * 31 + unit) & 0x7fffffff;
  }
  return colors[hash % colors.length];
}
