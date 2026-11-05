import 'collections_controller.dart';
import 'edit_remote.dart';
import 'covers.dart';
import 'image_picker.dart';
import 'library_controller.dart';
import 'playback.dart';
import 'settings_store.dart';
import 'url_opener.dart';
import 'youtube_importer.dart';
import 'youtube_stream.dart';

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
    this.submitEdit = submitLibraryEdit,
    this.submitCover = submitCatalogCover,
    this.pickImage = pickImageFromDevice,
    this.pickAudio = pickAudioFromDevice,
    this.youtube,
    this.streamResolver,
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

  /// Guarda cambios de la biblioteca común por /api/editar (ADR-0022).
  final EditSubmitter submitEdit;

  /// Guarda la portada de una canción o un álbum del catálogo.
  final CoverSubmitter submitCover;

  /// Elige una imagen del teléfono (portada propia de una lista).
  final ImagePicker pickImage;

  /// Elige archivos de audio del teléfono («Subir canciones»).
  final AudioFilesPicker pickAudio;

  /// Importador de playlists para Homeostasia. Es opcional en pruebas y en
  /// construcciones que no necesitan la conexión de YouTube.
  final YoutubeImporter? youtube;

  /// Abre el audio de un resultado de YouTube para «Escuchar» en el buscador (ADR-0021). Opcional en pruebas.
  final YoutubeStreamResolver? streamResolver;

  /// Hora actual (saludo de Inicio). Se sustituye en pruebas.
  final DateTime Function() clock;
}
