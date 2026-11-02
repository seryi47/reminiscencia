import 'package:audio_service/audio_service.dart';
import 'package:flutter/material.dart';

import 'app.dart';
import 'collections_controller.dart';
import 'collections_store.dart';
import 'library_controller.dart';
import 'library_store.dart';
import 'local_audio.dart';
import 'local_audio_convert.dart';
import 'network.dart';
import 'offline_choice.dart';
import 'services.dart';
import 'settings_store.dart';
import 'sonidos_audio_handler.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final libraryStore = LibraryStore();
  final SonidosAudioHandler handler;
  try {
    handler = await AudioService.init(
      builder: () => SonidosAudioHandler(libraryStore),
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
        ),
        playback: handler,
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
