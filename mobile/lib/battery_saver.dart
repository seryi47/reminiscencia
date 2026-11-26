/// Ajustes de "Ahorro de batería" (ADR-0052). Un solo flag global cambia varios comportamientos a la vez,
/// pensados para dejar la radio y la CPU descansando cuando el usuario quiere alargar la autonomía.
///
/// El flag vive en `AppSettings.batterySaver` y se persiste en SharedPreferences desde `settings_page`.
///
/// NO inicializar en `main.dart`: se lee bajo demanda.
library;

/// Duración del long-poll del catálogo (segundos) según el ahorro de batería.
///
/// - 25 s en normal (consistente con el fork del realtime, `catalogo/wait?timeout=25`).
/// - 10 s en ahorro (menos ventanas de radio activa; a cambio, más reconexiones, pero son 304 ≈ 0 bytes).
int catalogWaitSeconds({required bool batterySaver}) =>
    batterySaver ? 10 : 25;

/// Si hay que precargar la siguiente canción del reproductor.
///
/// - true en normal (siguiente canción suena instantánea).
/// - false en ahorro (ahorramos el fetch; la siguiente canción tardará unos cientos de ms la primera vez).
bool prefetchNextSong({required bool batterySaver}) => !batterySaver;

/// Frecuencia del chequeo automático de actualizaciones al arrancar (ADR-0047).
///
/// - En normal: cada arranque.
/// - En ahorro: como mucho una vez por día. Se compara con la marca `reminiscencia.update_last_check` en
///   SharedPreferences (gestionado en update_check.dart).
Duration updateCheckMinInterval({required bool batterySaver}) =>
    batterySaver ? const Duration(days: 1) : Duration.zero;

/// Tras cuántos ms en background se pausa el long-poll (ADR-0052).
///
/// - En normal: 60 s de margen (para no cortar si el user cambia de pantalla un momento).
/// - En ahorro: 10 s.
int backgroundPollPauseAfterMs({required bool batterySaver}) =>
    batterySaver ? 10_000 : 60_000;

/// Bitrate de audio por defecto al descargar (kbps). ADR-0051 dice 48 kbps, 64 si quieres más calidad.
/// En ahorro forzamos 48 para menos tráfico.
int preferredBitrateKbps({required bool batterySaver}) =>
    batterySaver ? 48 : 64;
