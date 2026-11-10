import 'collections_controller.dart';
import 'edit_remote.dart';
import 'covers.dart';
import 'image_picker.dart';
import 'library_controller.dart';
import 'playback.dart';
import 'settings_store.dart';
import 'url_opener.dart';
import 'spotify_transfer.dart';
import 'youtube_importer.dart';
import 'youtube_stream.dart';

/// Duración en segundos de un archivo de audio del teléfono, o null si no se sabe (aviso de duplicados, ADR-0026).
typedef AudioDurationProbe = Future<double?> Function(String path);

Future<double?> _unknownDuration(String path) async => null;

/// Servicios que usa la interfaz. En pruebas se sustituyen por versiones falsas.
/// No hay usuarios ni modos: todos ven el mismo catálogo; las listas y «Me gusta» viven solo en este teléfono.
class AppServices {
  const AppServices({
    required this.library,
    required this.playback,
    required this.collections,
    required this.settings,
    CoverImages covers = const NoCoverImages(),
    this.openUrl = openInBrowser,
    this.submitEdit = submitLibraryEdit,
    this.submitCover = submitCatalogCover,
    this.pickImage = pickImageFromDevice,
    this.pickAudio = pickAudioFromDevice,
    this.probeDuration = _unknownDuration,
    this.youtube,
    this.streamResolver,
    this.spotify,
    this.clock = DateTime.now,
    // El campo es privado: el getter [covers] lo envuelve con las vistas previas pendientes.
    // ignore: prefer_initializing_formals
  }) : _covers = covers;

  final LibraryController library;
  final PlaybackPort playback;
  final CollectionsController collections;
  final SettingsController settings;

  final CoverImages _covers;

  /// Portadas de la web guardadas en el teléfono. Las portadas enviadas que aún no han llegado al catálogo se ven ya
  /// con su vista previa (ADR-0027).
  CoverImages get covers => library.edits.coverImages(_covers);

  /// Abre direcciones en el navegador (peticiones a la biblioteca común).
  final UrlOpener openUrl;

  /// Guarda cambios de la biblioteca común por /api/editar (ADR-0022). La interfaz los envía por
  /// `library.edits` (ADR-0027), que evita duplicados y los deja pendientes.
  final EditSubmitter submitEdit;

  /// Guarda la portada de una canción o un álbum del catálogo.
  final CoverSubmitter submitCover;

  /// Elige una imagen del teléfono (portada propia de una lista).
  final ImagePicker pickImage;

  /// Elige archivos de audio del teléfono («Subir canciones»).
  final AudioFilesPicker pickAudio;

  /// Lee la duración de un archivo elegido antes de subirlo, para el aviso de duplicados. En la app, con FFprobe.
  final AudioDurationProbe probeDuration;

  /// Importador de playlists para Homeostasia. Es opcional en pruebas y en
  /// construcciones que no necesitan la conexión de YouTube.
  final YoutubeImporter? youtube;

  /// Abre el audio de un resultado de YouTube para «Escuchar» en el buscador (ADR-0021). Opcional en pruebas.
  final YoutubeStreamResolver? streamResolver;

  /// Motor de «Transferir música» desde Spotify (ADR-0044). Opcional: si falta, la pantalla crea el suyo.
  final SpotifyTransfer? spotify;

  /// Hora actual (saludo de Inicio). Se sustituye en pruebas.
  final DateTime Function() clock;
}
