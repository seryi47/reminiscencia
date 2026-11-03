import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';

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
