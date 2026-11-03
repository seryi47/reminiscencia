import 'collections_controller.dart';
import 'library_controller.dart';
import 'playback.dart';
import 'settings_store.dart';
import 'url_opener.dart';

/// Servicios que usa la interfaz. En pruebas se sustituyen por versiones falsas.
/// No hay usuarios ni modos: todos ven el mismo catálogo; las listas y «Me gusta» viven solo en este teléfono.
class AppServices {
  const AppServices({
    required this.library,
    required this.playback,
    required this.collections,
    required this.settings,
    this.openUrl = openInBrowser,
    this.clock = DateTime.now,
  });

  final LibraryController library;
  final PlaybackPort playback;
  final CollectionsController collections;
  final SettingsController settings;

  /// Abre direcciones en el navegador (subida «Para todos»).
  final UrlOpener openUrl;

  /// Hora actual (saludo de Inicio). Se sustituye en pruebas.
  final DateTime Function() clock;
}
