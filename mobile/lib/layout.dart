/// Ancho (dp) a partir del cual la app usa diseño de tableta: navegación lateral en lugar de la barra inferior.
const double kTabletBreakpoint = 720;

/// Ancho (dp) de la navegación lateral en tableta.
const double kTabletRailWidth = 96;

/// Objetivo táctil mínimo (dp) de cualquier control.
const double kMinTouchTarget = 48;

/// Alto (dp) del minirreproductor que va encima de la barra inferior.
const double kMiniPlayerHeight = 56;

/// Lado (dp) de la portada en las filas de canción.
const double kRowArtworkSize = 40;

bool isTabletWidth(double width) => width >= kTabletBreakpoint;
