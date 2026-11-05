import 'package:flutter_test/flutter_test.dart';
import 'package:reminiscencia/shared_upload.dart';
import 'package:reminiscencia/ui/youtube_results.dart';

UploadItemResult _item(UploadOutcome outcome, String message) => UploadItemResult(
  name: 'a.wav',
  title: 'a',
  outcome: outcome,
  message: message,
);

void main() {
  test('un fallo de subida no se muestra como «En cola» y da el motivo', () {
    final download = downloadAfterUpload(
      SharedUploadResult([_item(UploadOutcome.failed, 'la web no aceptó el archivo (código 429).')]),
    );
    expect(download.state, YoutubeDownloadState.error);
    expect(download.message, contains('código 429'));
  });

  test('una subida correcta queda en cola', () {
    final download = downloadAfterUpload(
      SharedUploadResult([_item(UploadOutcome.uploaded, kUploadedMessage)]),
    );
    expect(download.state, YoutubeDownloadState.queued);
  });
}
