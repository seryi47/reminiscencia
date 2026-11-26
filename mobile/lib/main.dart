import 'dart:async';

import 'package:audio_service/audio_service.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'app.dart';
import 'auth_store.dart';
import 'collections_controller.dart';
import 'collections_store.dart';
import 'covers.dart';
import 'edit_remote.dart';
import 'error_log.dart';
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
import 'upload_tracker.dart';
import 'worker_catalog_client.dart';
import 'worker_edit_submitter.dart';
import 'youtube_importer.dart';
import 'youtube_stream.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Antes que nada: en la versión de producción un error no capturado queda registrado en lugar de perderse.
  ErrorLog? errorLog;
  try {
    errorLog = await ErrorLog.open();
    installErrorHandlers(errorLog);
  } catch (error) {
    debugPrint('registro: no se pudo preparar: $error');
  }
  // 1.4.12: todo el arranque va en un try/catch global. Si CUALQUIER inicialización lanza, en lugar de un cierre
  // silencioso se muestra StartupErrorApp con el stack trace a pantalla (y se intenta guardar en el errorlog). Así
  // los crashes en dispositivos específicos (Samsung, One UI con permisos raros) dejan de ser una caja negra.
  try {
    await _bootstrap(errorLog);
  } catch (error, stack) {
    debugPrint('arranque: no se pudo terminar: $error\n$stack');
    unawaited(errorLog?.record('arranque', error, stack) ?? Future<void>.value());
    runApp(StartupErrorApp(reason: '$error', stack: '$stack'));
  }
}

Future<void> _bootstrap(ErrorLog? errorLog) async {
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
      builder: () => SonidosAudioHandler(libraryStore, covers: covers),
      config: kAudioServiceConfig,
    );
  } catch (error, stack) {
    debugPrint('reproductor: no se pudo iniciar: $error');
    unawaited(errorLog?.record('audio_service', error, stack) ?? Future<void>.value());
    runApp(StartupErrorApp(reason: '$error', stack: '$stack'));
    return;
  }
  final settings = SettingsController(store: SettingsStore());
  final client = http.Client();
  final collections = CollectionsController(
    repository: FileCollectionsRepository(),
    covers: playlistCovers,
  );
  // Contraseña del Worker (ADR-0052). La guarda SharedPreferences; se pone una vez con
  // AuthPromptScreen o la pega Claude Code desde el llavero de la Mac. Nunca se le pide
  // al usuario «de memoria».
  final authStore = SharedPreferencesAuthStore();
  final workerCatalog = WorkerCatalogClient(auth: authStore, client: client);
  final workerSubmitter = WorkerBackedEditSubmitter(
    worker: workerCatalog,
    fallback: (request) => submitLibraryEdit(request, client: client),
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
          covers: covers,
          // Subida para todos: la función de la web guarda en el buzón; la app no tiene ningún token.
          uploader: SharedUploader(
            client: client,
            converter: const FfmpegOpusConverter(enforceLimits: false),
            hasConnection: hasAnyConnection,
          ),
          // Tras subir: se mira songs.json cada 20 s, solo en primer plano, hasta que aparece (máx. 10 min).
          published: HttpPublishedSongs(client: client),
          uploadsStore: UploadsStore(),
        ),
        playback: handler,
        covers: covers,
        collections: collections,
        settings: settings,
        youtube: YoutubeImporter(client: client),
        streamResolver: ExplodeStreamResolver(),
        probeDuration: probeAudioDurationS,
        authStore: authStore,
        workerCatalog: workerCatalog,
        submitEdit: workerSubmitter.submit,
      ),
    ),
  );
}

/// Pantalla de error si cualquier parte del arranque falla: en lugar de una pantalla en blanco o un cierre
/// silencioso, se explica el motivo y se muestra el stack trace para que se pueda copiar y enviar.
class StartupErrorApp extends StatelessWidget {
  const StartupErrorApp({super.key, required this.reason, this.stack});

  final String reason;
  final String? stack;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      home: Scaffold(
        backgroundColor: const Color(0xFF111111),
        body: SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Reminiscencia no pudo arrancar',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 22,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 16),
                SelectableText(
                  reason,
                  style: const TextStyle(color: Colors.white, fontSize: 14),
                ),
                if (stack != null) ...[
                  const SizedBox(height: 24),
                  const Text(
                    'Traza:',
                    style: TextStyle(color: Colors.white70, fontSize: 12),
                  ),
                  const SizedBox(height: 8),
                  SelectableText(
                    stack!,
                    style: const TextStyle(
                      color: Colors.white54,
                      fontSize: 11,
                      fontFamily: 'monospace',
                    ),
                  ),
                ],
                const SizedBox(height: 24),
                const Text(
                  'Mantén pulsado el texto para copiarlo y enviarlo.',
                  style: TextStyle(color: Colors.white60, fontSize: 12),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
