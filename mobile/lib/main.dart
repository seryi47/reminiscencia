import 'package:audio_service/audio_service.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'app.dart';
import 'collections_controller.dart';
import 'collections_store.dart';
import 'covers.dart';
import 'library_controller.dart';
import 'library_store.dart';
import 'local_audio.dart';
import 'local_audio_convert.dart';
import 'network.dart';
import 'offline_choice.dart';
import 'playlist_covers.dart';
import 'services.dart';
import 'settings_store.dart';
import 'shared_upload.dart';
import 'sonidos_audio_handler.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  registerFontLicense();
  final libraryStore = LibraryStore();
  final covers = CoverCache(base: kLibraryBase);
  final playlistCovers = FilePlaylistCoverStore();
  // Solo leen un índice pequeño y crean carpetas: no bloquean el arranque si fallan.
  await Future.wait([
    covers.init(),
    playlistCovers.init().catchError((Object error) {
      debugPrint('listas: no se pudo preparar la carpeta de portadas: $error');
    }),
  ]);
  final SonidosAudioHandler handler;
  try {
    handler = await AudioService.init(
      builder: () => SonidosAudioHandler(libraryStore, covers),
      config: const AudioServiceConfig(
        androidNotificationChannelId: 'es.orbitalabs.reminiscencia.audio',
        androidNotificationChannelName: 'Reproducción',
        androidNotificationOngoing: true,
      ),
    );
  } catch (error) {
    debugPrint('reproductor: no se pudo iniciar: $error');
    runApp(StartupErrorApp(reason: '$error'));
    return;
  }
  final settings = SettingsController(store: SettingsStore());
  final collections = CollectionsController(
    repository: FileCollectionsRepository(),
    covers: playlistCovers,
  );
  await Future.wait([settings.load(), collections.load()]);
  runApp(
    ReminiscenciaApp(
      services: AppServices(
        library: LibraryController(
          source: libraryStore,
          playback: handler,
          local: LocalAudioLibrary(
            store: LocalAudioStore(),
            converter: const FfmpegOpusConverter(),
          ),
          offline: SharedPrefsOfflineChoice(),
          network: const ConnectivityNetworkInfo(),
          covers: covers,
          // Subida para todos: la función de la web guarda en el buzón; la app no tiene ningún token.
          uploader: SharedUploader(
            client: http.Client(),
            converter: const FfmpegOpusConverter(enforceLimits: false),
            hasConnection: hasAnyConnection,
          ),
        ),
        playback: handler,
        covers: covers,
        collections: collections,
        settings: settings,
      ),
    ),
  );
}

/// Pantalla de error si el servicio de audio no arranca: en lugar de una pantalla en blanco, se explica el motivo.
class StartupErrorApp extends StatelessWidget {
  const StartupErrorApp({super.key, required this.reason});

  final String reason;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      home: Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text(
              'No se pudo iniciar el reproductor de audio. Cierra la app y vuelve a abrirla.\n\nMotivo: $reason',
              textAlign: TextAlign.center,
            ),
          ),
        ),
      ),
    );
  }
}
