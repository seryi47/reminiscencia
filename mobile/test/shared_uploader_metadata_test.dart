import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:crypto/crypto.dart' as crypto;
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:reminiscencia/local_audio.dart';
import 'package:reminiscencia/shared_upload.dart';

/// Conversor mínimo: escribe `bytes` bytes numerados y declara una duración fija.
class _Converter implements AudioConverter {
  _Converter(this.bytes, this.durationS);
  final int bytes;
  final double durationS;
  List<int> get content => List<int>.generate(bytes, (i) => i % 251);
  @override
  Future<ConvertedAudio> convert({
    required String inputPath,
    required String outputPath,
    required String title,
  }) async {
    await File(outputPath).writeAsBytes(content);
    return ConvertedAudio(durationS: durationS, channels: 2, bitrate: 48000, bytes: bytes);
  }

  @override
  Future<void> cancel() async {}
}

http.Response _ok() => http.Response(
  jsonEncode({'ok': true, 'ruta': 'audio-library/buzon/x.opus', 'nombre': 'x'}),
  200,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

void main() {
  late Directory work;
  setUp(() async {
    work = await Directory.systemTemp.createTemp('shared_uploader_meta_test');
  });
  tearDown(() async {
    if (await work.exists()) await work.delete(recursive: true);
  });

  test('onItemDone recibe sha256, durationS, sizeBytes y uploadId del Opus convertido (ADR-0052)', () async {
    final converter = _Converter(64, 12.75);
    final uploader = SharedUploader(
      client: MockClient((_) async => _ok()),
      converter: converter,
      hasConnection: () async => true,
      workDir: () async => work,
      retryDelay: Duration.zero,
      random: Random(1),
    );
    UploadItemResult? seen;
    final result = await uploader.upload(
      [PickedAudioFile(name: 'Nueva.mp3', path: '/x/Nueva.mp3', artist: 'Artista')],
      onItemDone: (_, item) => seen = item,
    );
    expect(result.items.single.outcome, UploadOutcome.uploaded);
    expect(seen, isNotNull);
    expect(seen!.outcome, UploadOutcome.uploaded);
    expect(seen!.durationS, 12.75);
    expect(seen!.sizeBytes, 64);
    expect(seen!.uploadId, isNotNull);
    expect(seen!.uploadId!.length, greaterThan(10));
    // sha256 coincide con lo que calcularías desde el contenido conocido del conversor.
    final expected = crypto.sha256.convert(converter.content).toString();
    expect(seen!.sha256, expected);
    // Metadatos de la fuente llegan también al callback.
    expect(seen!.artist, 'Artista');
    expect(seen!.albumId, isNull);
  });

  test('un fallo de red deja igualmente sha256 y tamaño en el item para reintento (ADR-0052)', () async {
    final converter = _Converter(20, 4);
    final uploader = SharedUploader(
      client: MockClient((_) async => http.Response(jsonEncode({'ok': false}), 500,
          headers: {'content-type': 'application/json; charset=utf-8'})),
      converter: converter,
      hasConnection: () async => true,
      workDir: () async => work,
      retryDelay: Duration.zero,
      random: Random(2),
    );
    UploadItemResult? seen;
    await uploader.upload(
      [PickedAudioFile(name: 'Rota.mp3', path: '/x/Rota.mp3')],
      onItemDone: (_, item) => seen = item,
    );
    expect(seen, isNotNull);
    expect(seen!.outcome, UploadOutcome.failed);
    // Los metadatos están porque la conversión sí se completó.
    expect(seen!.sha256, isNotNull);
    expect(seen!.sizeBytes, 20);
    expect(seen!.durationS, 4);
  });
}
