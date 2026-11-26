/// Helpers para decodificar portadas al tamaño real en que se pintan (ADR-0052).
///
/// Las portadas publicadas llegan a 640×640, y la mayoría de sitios donde se pintan
/// (filas de canción, cards, mosaicos) usan 40–80 dp. Decodificar al tamaño real
/// ahorra RAM y CPU de decode (ImageCache reutiliza por `cacheWidth/cacheHeight`).
///
/// Las vistas que ya pasan por [CoverArt] (common.dart) ya hacen esto. Este módulo
/// expone helpers reutilizables por si una vista nueva tiene que cargar una imagen
/// a mano sin pasar por CoverArt.
library;

import 'package:flutter/widgets.dart';

/// Pixels físicos que corresponden a un tamaño en dp con el devicePixelRatio actual.
///
/// Siempre devuelve >= 1 (evita cacheWidth: 0 que lanza).
int scaledPixelsFor(BuildContext context, double dp) {
  final ratio = MediaQuery.devicePixelRatioOf(context);
  final value = (dp * ratio).round();
  return value < 1 ? 1 : value;
}

/// Envuelve [image] con [ResizeImage] para que el decode use como mucho el tamaño
/// físico que corresponde a [dp]. Si no hay imagen, devuelve null.
ImageProvider? scaledImage(
  BuildContext context,
  ImageProvider? image, {
  required double dp,
}) {
  if (image == null) return null;
  final pixels = scaledPixelsFor(context, dp);
  return ResizeImage.resizeIfNeeded(pixels, pixels, image);
}

/// Umbral para considerar que el tamaño pintado cabe en una miniatura (ADR-0050).
///
/// Lo usan las vistas que pueden decidir entre pedir `covers/<id>.jpg` (640×640) o
/// `thumbs/<id>.jpg` (160×160). Si [dp] * dpr < 160, preferimos la miniatura: ahorra
/// descarga y decode.
bool prefersThumbnail(BuildContext context, double dp) {
  return scaledPixelsFor(context, dp) <= 160;
}
