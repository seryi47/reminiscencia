import 'collections_controller.dart';
import 'library_controller.dart';
import 'playback.dart';
import 'settings_store.dart';

/// Servicios que usa la interfaz. En pruebas se sustituyen por versiones falsas.
class AppServices {
  const AppServices({
    required this.library,
    required this.playback,
    required this.collections,
    required this.settings,
  });

  final LibraryController library;
  final PlaybackPort playback;
  final CollectionsController collections;
  final SettingsController settings;
}
