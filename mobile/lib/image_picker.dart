import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';

import 'local_audio.dart';

/// Elige una imagen del teléfono y devuelve sus bytes, o null si se cancela.
typedef ImagePicker = Future<Uint8List?> Function();

/// Implementación real: el selector de archivos del sistema, solo imágenes.
Future<Uint8List?> pickImageFromDevice() async {
  try {
    final file = await FilePicker.pickFile(type: FileType.image);
    if (file == null) return null;
    return await file.readAsBytes();
  } catch (error) {
    debugPrint('portada: no se pudo leer la imagen elegida: $error');
    rethrow;
  }
}

/// Elige uno o varios archivos de audio (o ZIP con canciones) del teléfono. Lista vacía si se cancela.
typedef AudioFilesPicker = Future<List<PickedAudioFile>> Function();

/// Implementación real: el selector de archivos del sistema, con las extensiones de audio admitidas y ZIP
/// (la subida saca sus canciones). Sin allowMultiple: pickFiles ya admite varios archivos (el parámetro está
/// obsoleto).
Future<List<PickedAudioFile>> pickAudioFromDevice() async {
  final picked = await FilePicker.pickFiles(
    type: FileType.custom,
    allowedExtensions: [...kLocalAudioExtensions, 'zip'],
  );
  return [
    for (final file in picked)
      if (file.path != null) PickedAudioFile(name: file.name, path: file.path!),
  ];
}
