import 'collections_controller.dart';
import 'covers.dart';
import 'image_picker.dart';
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
    this.covers = const NoCoverImages(),
    this.openUrl = openInBrowser,
    this.pickImage = pickImageFromDevice,
    this.pickAudio = pickAudioFromDevice,
    this.clock = DateTime.now,
  });

  final LibraryController library;
  final PlaybackPort playback;
  final CollectionsController collections;
  final SettingsController settings;

  /// Portadas de la web guardadas en el teléfono.
  final CoverImages covers;

  /// Abre direcciones en el navegador (peticiones a la biblioteca común).
  final UrlOpener openUrl;

  /// Elige una imagen del teléfono (portada propia de una lista).
  final ImagePicker pickImage;

  /// Elige archivos de audio del teléfono («Subir canciones»).
  final AudioFilesPicker pickAudio;

  /// Hora actual (saludo de Inicio). Se sustituye en pruebas.
  final DateTime Function() clock;
}
