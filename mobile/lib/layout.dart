/// Ancho (dp) a partir del cual la app usa diseño de tableta: navegación lateral y reproductor junto a la lista.
const double kTabletBreakpoint = 720;

/// Ancho (dp) de la columna del reproductor en tableta.
const double kTabletPlayerWidth = 360;

/// Tamaño mínimo (dp) de cualquier botón de reproducción en modo paciente.
const double kPatientTargetSize = 64;

/// Tamaño (dp) de los botones grandes de reproducción en modo paciente.
const double kPatientButtonSize = 72;

bool isTabletWidth(double width) => width >= kTabletBreakpoint;
