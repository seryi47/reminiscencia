// Descargas sin conexión y panel de subidas en teléfonos pequeños (ADR-0033): sin desbordamientos a 360 × 740 y
// 320 × 640, con texto al 100 % y al 130 %; el progreso se repinta solo donde se ve; cancelar la descarga.
// Datos ficticios. Opcional: con CAPTURAS_DIR=<carpeta> guarda una captura PNG de cada pantalla.
import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/offline_downloads.dart';
import 'package:reminiscencia/services.dart';
import 'package:reminiscencia/ui/uploads_panel.dart';
import 'package:reminiscencia/upload_tracker.dart';

import 'support/fakes.dart';

const String kLong =
    'Concierto para piano y orquesta n.º 21 en do mayor K. 467 - II. Andante (grabación histórica de 1958 restaurada)';

/// Una subida de cada paso, con nombres y errores largos, y un ZIP con su error.
void showEveryStage(AppServices services) {
  var n = 0;
  const zipKey = 'Z0011223344556677';
  const zipName =
      'Grabaciones históricas restauradas de la colección familiar.zip';
  UploadEntry entry(
    String name,
    UploadStage stage, {
    String? error,
    bool zip = false,
  }) {
    n += 1;
    return UploadEntry(
      key: 'P${n.toRadixString(16).padLeft(16, '0')}',
      name: name,
      title: name,
      stage: stage,
      error: error,
      groupKey: zip ? zipKey : null,
      groupName: zip ? zipName : null,
    );
  }

  final uploads = services.library.uploads;
  uploads.debugShow([
    entry('$kLong.wav', UploadStage.publishing),
    entry('Vals de las olas.mp3', UploadStage.slow),
    entry(
      '$kLong (otra toma).flac',
      UploadStage.failed,
      error:
          'el archivo no es Ogg Opus. Comprueba que el archivo no está dañado y vuelve a intentarlo más tarde.',
    ),
    entry('Bolero.wav', UploadStage.converting),
    entry('Pasodoble.wav', UploadStage.sending)
      ..part = 1
      ..parts = 3,
    entry('Corta.wav', UploadStage.sending)..waitingToSend = true,
    entry('Chotis.wav', UploadStage.queued),
    entry('Habanera.wav', UploadStage.published)..publishedId = 'S1',
  ]);
  uploads.debugShow([
    entry('Disco 1/01 $kLong.mp3', UploadStage.sending, zip: true),
    entry('Disco 1/02 Mazurca.mp3', UploadStage.queued, zip: true),
  ], group: UploadGroup(key: zipKey, name: zipName, songs: 2, ignored: 3));
}

/// Carpeta de capturas (CAPTURAS_DIR) o null: sin ella no se captura nada.
String? get capturesDir {
  final dir = Platform.environment['CAPTURAS_DIR'];
  return dir == null || dir.isEmpty ? null : dir;
}

/// Con capturas, la letra real (Figtree e iconos de Material) en lugar de la de pruebas, que pinta cajas.
Future<void> loadRealFonts() async {
  if (capturesDir == null) return;
  final figtree = FontLoader('Figtree');
  for (final weight in ['Regular', 'Medium', 'SemiBold', 'Bold']) {
    final bytes = File('assets/fonts/Figtree-$weight.ttf').readAsBytesSync();
    figtree.addFont(Future.value(ByteData.sublistView(bytes)));
  }
  await figtree.load();
  final root = Platform.environment['FLUTTER_ROOT'] ?? '';
  final icons = File(
    '$root/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
  );
  if (icons.existsSync()) {
    final loader = FontLoader('MaterialIcons')
      ..addFont(Future.value(ByteData.sublistView(icons.readAsBytesSync())));
    await loader.load();
  }
}

/// Guarda una captura de la pantalla en `CAPTURAS_DIR/apk-NOMBRE.png` (solo si está definida).
Future<void> capture(WidgetTester tester, String name) async {
  final dir = capturesDir;
  if (dir == null) return;
  final boundary = tester.renderObject<RenderRepaintBoundary>(
    find.byType(RepaintBoundary).first,
  );
  await tester.runAsync(() async {
    final image = await boundary.toImage();
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    await File(
      '$dir/apk-$name.png',
    ).writeAsBytes(bytes!.buffer.asUint8List(), flush: true);
  });
}

void main() {
  setUpAll(loadRealFonts);
  const sizes = {'360x740': Size(360, 740), '320x640': Size(320, 640)};
  const scales = [1.0, 1.3];

  for (final MapEntry(key: sizeName, value: size) in sizes.entries) {
    for (final scale in scales) {
      final label = '$sizeName, texto al ${(scale * 100).round()} %';

      testWidgets('panel de subidas sin desbordar ($label)', (tester) async {
        setWindow(tester, size);
        tester.platformDispatcher.textScaleFactorTestValue = scale;
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
        final t = buildTestServices(songs: [fakeSong('S1')]);
        showEveryStage(t.services);
        await pumpApp(tester, t.services);
        await tester.tap(find.text('Tu biblioteca'));
        await settle(tester);
        expect(find.byType(UploadsPanel), findsOneWidget);
        await capture(
          tester,
          'subidas-arriba-$sizeName-${(scale * 100).round()}',
        );
        // Se recorre la página entera: ninguna fila puede desbordar en ningún punto.
        final scrollable = find.byType(Scrollable).first;
        for (var i = 0; i < 12; i++) {
          expect(tester.takeException(), isNull, reason: 'paso $i');
          await tester.drag(scrollable, const Offset(0, -260));
          await settle(tester);
        }
        expect(tester.takeException(), isNull);
        // Cada barra ocupa su hueco aunque no se vea: «En espera» y «Esperando para subir» no la muestran.
        await tester.drag(scrollable, const Offset(0, 4000));
        await settle(tester);
        await tester.scrollUntilVisible(
          find.text('Chotis.wav'),
          200,
          scrollable: scrollable,
        );
        await settle(tester);
        expect(find.text('Esperando para subir'), findsOneWidget);
        expect(find.text('Subiendo… 33 %'), findsOneWidget);
        await capture(tester, 'subidas-$sizeName-${(scale * 100).round()}');
      });

      testWidgets('Inicio guardando para escuchar sin conexión ($label)', (
        tester,
      ) async {
        setWindow(tester, size);
        tester.platformDispatcher.textScaleFactorTestValue = scale;
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
        final t = buildTestServices(
          songs: [for (var i = 1; i <= 8; i++) fakeSong('S$i')],
        );
        t.source
          ..holdDownload = Completer<void>()
          ..downloadDetail = const OfflineProgress(
            done: 3,
            total: 120,
            bytes: 2621440,
          );
        await pumpApp(tester, t.services);
        await tester.tap(find.byKey(const Key('offline-download')));
        await settle(tester);
        expect(find.byKey(const Key('offline-progress-ring')), findsOneWidget);
        expect(find.text('Guardando 3 de 120 · 2,5 MB'), findsOneWidget);
        expect(tester.takeException(), isNull);
        // El anillo ocupa lo mismo que el botón: la cabecera no se mueve.
        expect(
          tester.getSize(find.byKey(const Key('offline-cancel'))).width,
          48,
        );
        await capture(
          tester,
          'inicio-descargando-$sizeName-${(scale * 100).round()}',
        );
        await tester.tap(find.byKey(const Key('offline-cancel')));
        await settle(tester);
        expect(find.byKey(const Key('offline-download')), findsOneWidget);
        expect(
          find.text(
            'Se ha cancelado la descarga. Lo ya guardado se queda en este teléfono.',
          ),
          findsOneWidget,
        );
        expect(t.services.library.offlineWanted, isFalse);
        expect(tester.takeException(), isNull);
      });
    }
  }

  testWidgets(
    'el progreso de una subida o de la descarga no repinta la biblioteca entera',
    (tester) async {
      setWindow(tester, const Size(360, 740));
      final t = buildTestServices(songs: [fakeSong('S1')]);
      final library = t.services.library;
      final entry = UploadEntry(
        key: 'P0000000000000001',
        name: 'a.wav',
        title: 'a',
        stage: UploadStage.sending,
      )..parts = 10;
      library.uploads.debugShow([entry]);
      var notified = 0;
      library.addListener(() => notified++);
      for (var part = 1; part < 10; part++) {
        entry.part = part;
        library.uploads.debugChanged();
      }
      expect(notified, 0, reason: 'un porcentaje no cambia la biblioteca');
      entry.stage = UploadStage.saved;
      library.uploads.debugChanged();
      expect(notified, 1, reason: 'un cambio de paso sí');

      // La descarga: cada canción solo cambia offlineProgress.
      t.source.holdDownload = Completer<void>();
      final downloading = library.downloadForOffline();
      await tester.pump();
      final before = notified;
      var progressChanges = 0;
      library.offlineProgress.addListener(() => progressChanges++);
      expect(library.offlineProgress.value?.text, 'Guardando 3 de 8');
      expect(notified, before);
      await library.cancelDownload();
      await downloading;
      expect(library.offlineProgress.value, isNull);
      expect(library.lastDownloadCancelled, isTrue);
      expect(progressChanges, 1);
    },
  );

  testWidgets(
    'en el panel, «Reintentar» funciona aunque otras se estén subiendo y la barra guarda su hueco',
    (tester) async {
      setWindow(tester, const Size(360, 740));
      final t = buildTestServices();
      final failed = UploadEntry(
        key: 'P0000000000000002',
        name: 'Rota.wav',
        title: 'Rota',
        stage: UploadStage.failed,
        error: 'formato no admitido.',
      );
      t.services.library.uploads.debugShow([
        UploadEntry(
          key: 'P0000000000000003',
          name: 'Larga.wav',
          title: 'Larga',
          stage: UploadStage.converting,
        ),
        failed,
      ]);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: UploadsPanel(services: t.services),
            ),
          ),
        ),
      );
      final retry = tester.widget<TextButton>(
        find.ancestor(
          of: find.text('Reintentar'),
          matching: find.byType(TextButton),
        ),
      );
      expect(retry.onPressed, isNotNull);
      final hidden = tester.widget<Visibility>(
        find.ancestor(
          of: find.byKey(const Key('upload-bar-P0000000000000002')),
          matching: find.byType(Visibility),
        ),
      );
      expect(hidden.visible, isFalse);
      expect(hidden.maintainSize, isTrue);
    },
  );
}
