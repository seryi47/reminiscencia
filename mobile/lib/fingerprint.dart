import 'dart:math' as math;
import 'dart:typed_data';

/// Reconocimiento musical estilo Shazam a mano (ADR-0048). NUESTRA huella acústica: espectrograma → picos espectrales →
/// pares de picos cercanos (constellation map) empaquetados en un entero de 32 bits como «hash». Puro Dart, sin plugins
/// nativos. Se reutiliza en el móvil (consulta en vivo) y en el Worker (base de datos de nuestra biblioteca).

/// Frecuencia a la que se remuestrea el audio antes de huellar. 16 kHz da el rango útil para música popular (0–8 kHz)
/// con una señal cuatro veces más pequeña que la de 44,1 kHz; Shazam usa 8 kHz y nos basta.
const int kFingerprintSampleRate = 16000;

/// Tamaño de ventana para la FFT (muestras). 4096 @16 kHz = ~256 ms por ventana → resolución de ~4 Hz por bin, suficiente
/// para separar picos tonales de una canción pop.
const int kFingerprintWindowSize = 4096;

/// Salto entre ventanas (75 % de solape). 1024 muestras @16 kHz = 64 ms por fotograma.
const int kFingerprintHopSize = 1024;

/// Nº de picos espectrales por fotograma (ANCLAS). Más = más robusto al ruido pero más peso y falsos positivos.
const int kFingerprintPeaksPerFrame = 5;

/// Nº de objetivos con los que cada ancla se empareja. CADA uno tiene un `delta` distinto (un objetivo por fotograma),
/// así los hashes se reparten en varios deltas y no se agotan en delta=1.
const int kFingerprintFanOut = 10;

/// Rango de separación de fotogramas entre ancla y objetivo (en fotogramas). Fuera de esto no se empareja.
const int kFingerprintMinDeltaFrames = 1;
const int kFingerprintMaxDeltaFrames = 30;

/// Nº de bandas logarítmicas de frecuencia (6 bits en el hash). 32 bandas de 60 Hz a 4000 Hz dan muchos valores distintos
/// de hash sin perder robustez (la banda abarca todavía un rango útil para música popular).
const int kFingerprintNumBands = 32;
const double _bandMinHz = 60;
const double _bandMaxHz = 4000;

/// Resultado de huellar: lista de pares (hash, offset_de_fotograma). El offset sirve para desplazar en el tiempo cuando
/// se compara contra la biblioteca.
class FingerprintHash {
  const FingerprintHash(this.hash, this.offset);

  /// Hash entero (clave) que identifica el par de picos.
  final int hash;

  /// Fotograma del ancla desde el inicio del fragmento (no absoluto; cada huella es su propio origen).
  final int offset;
}

/// Pico espectral: (banda, magnitud).
class _Peak {
  _Peak(this.band, this.magnitude);
  final int band;
  final double magnitude;
}

/// Calcula una ventana de Hann para suavizar los bordes del fotograma y reducir «leakage» de la FFT.
Float64List _hannWindow(int n) {
  final w = Float64List(n);
  for (var i = 0; i < n; i++) {
    w[i] = 0.5 * (1.0 - math.cos(2 * math.pi * i / (n - 1)));
  }
  return w;
}

/// FFT in-place radix-2 de Cooley-Tukey. `re` y `im` tienen longitud [n], potencia de 2.
void _fft(Float64List re, Float64List im) {
  final n = re.length;
  // Inversión de bits.
  var j = 0;
  for (var i = 1; i < n; i++) {
    var bit = n >> 1;
    for (; (j & bit) != 0; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      var t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  // Mariposas.
  for (var len = 2; len <= n; len <<= 1) {
    final ang = -2 * math.pi / len;
    final wlenR = math.cos(ang);
    final wlenI = math.sin(ang);
    for (var i = 0; i < n; i += len) {
      var wR = 1.0;
      var wI = 0.0;
      final half = len >> 1;
      for (var k = 0; k < half; k++) {
        final uR = re[i + k];
        final uI = im[i + k];
        final vR = re[i + k + half] * wR - im[i + k + half] * wI;
        final vI = re[i + k + half] * wI + im[i + k + half] * wR;
        re[i + k] = uR + vR;
        im[i + k] = uI + vI;
        re[i + k + half] = uR - vR;
        im[i + k + half] = uI - vI;
        final nwR = wR * wlenR - wI * wlenI;
        final nwI = wR * wlenI + wI * wlenR;
        wR = nwR; wI = nwI;
      }
    }
  }
}

/// Convierte un fotograma de muestras PCM en el pico máximo de cada banda logarítmica. Lo que devuelve es un conjunto
/// pequeño (una por banda) con la banda y la magnitud, que luego se cribará para quedarse con los más altos.
List<_Peak> _frameToPeaks(Float32List slice, Float64List window) {
  final n = slice.length;
  final re = Float64List(n);
  final im = Float64List(n);
  for (var i = 0; i < n; i++) {
    re[i] = slice[i] * window[i];
  }
  _fft(re, im);

  // Magnitud por bin (solo la mitad útil del espectro).
  final half = n ~/ 2;
  final mags = Float64List(half);
  for (var i = 0; i < half; i++) {
    mags[i] = math.sqrt(re[i] * re[i] + im[i] * im[i]);
  }

  // Bandas logarítmicas: calcula los bordes de cada banda.
  final binsPerHz = n / kFingerprintSampleRate;
  final logMin = math.log(_bandMinHz);
  final logMax = math.log(_bandMaxHz);
  final bandIndices = List<int>.generate(kFingerprintNumBands + 1, (b) {
    final hz = math.exp(logMin + (logMax - logMin) * b / kFingerprintNumBands);
    return math.min((hz * binsPerHz).round(), half);
  });

  final peaks = <_Peak>[];
  for (var b = 0; b < kFingerprintNumBands; b++) {
    final start = bandIndices[b];
    final end = bandIndices[b + 1];
    if (end <= start) continue;
    var maxV = mags[start];
    for (var i = start + 1; i < end; i++) {
      if (mags[i] > maxV) maxV = mags[i];
    }
    peaks.add(_Peak(b, maxV));
  }
  // Nos quedamos con los K picos más fuertes del fotograma; eso descarta bandas «muertas» y reduce ruido.
  peaks.sort((a, b) => b.magnitude.compareTo(a.magnitude));
  if (peaks.length > kFingerprintPeaksPerFrame) peaks.removeRange(kFingerprintPeaksPerFrame, peaks.length);
  return peaks;
}

/// Empaqueta un par de picos: `anchor_band:6b | target_band:6b | delta_frames:10b` → 22 bits, hueco en int32.
int _packHash(int anchorBand, int targetBand, int deltaFrames) {
  return (anchorBand & 0x3F) << 16 | (targetBand & 0x3F) << 10 | (deltaFrames & 0x3FF);
}

/// Desempaqueta un hash para pruebas.
({int anchorBand, int targetBand, int deltaFrames}) unpackHash(int hash) {
  return (anchorBand: (hash >> 16) & 0x3F, targetBand: (hash >> 10) & 0x3F, deltaFrames: hash & 0x3FF);
}

/// Calcula la huella acústica de [samples] (PCM mono [-1.0, 1.0] a [kFingerprintSampleRate] Hz). Devuelve los hashes
/// con el offset de fotograma del ancla desde el inicio del fragmento.
List<FingerprintHash> fingerprint(Float32List samples) {
  if (samples.length < kFingerprintWindowSize) return const [];
  final window = _hannWindow(kFingerprintWindowSize);
  final frames = <List<_Peak>>[];
  for (var start = 0; start + kFingerprintWindowSize <= samples.length; start += kFingerprintHopSize) {
    final slice = Float32List.sublistView(samples, start, start + kFingerprintWindowSize);
    frames.add(_frameToPeaks(slice, window));
  }
  final hashes = <FingerprintHash>[];
  for (var i = 0; i < frames.length; i++) {
    for (final anchor in frames[i]) {
      var fanned = 0;
      // UN objetivo por fotograma (el pico más fuerte de ese fotograma) para que `delta` recorra 1,2,3… y no se agote
      // en delta=1: si los picos de la banda son iguales entre fotogramas, con fan-out = 15 los hashes van a cubrir
      // 15 deltas distintos en vez de 15 copias del mismo.
      for (var dt = kFingerprintMinDeltaFrames; dt <= kFingerprintMaxDeltaFrames && i + dt < frames.length; dt++) {
        final targetFrame = frames[i + dt];
        if (targetFrame.isEmpty) continue;
        final target = targetFrame.first; // el más fuerte
        hashes.add(FingerprintHash(_packHash(anchor.band, target.band, dt), i));
        fanned += 1;
        if (fanned >= kFingerprintFanOut) break;
      }
    }
  }
  return hashes;
}

/// Decodifica un bloque de PCM 16-bit little-endian (como el que suelta el micrófono) a Float32 en [-1, 1].
/// [data] no incluye cabecera: ya es PCM puro.
Float32List pcm16leToFloat32(Uint8List data) {
  final out = Float32List(data.length ~/ 2);
  final view = ByteData.sublistView(data);
  for (var i = 0; i < out.length; i++) {
    out[i] = view.getInt16(i * 2, Endian.little) / 32768.0;
  }
  return out;
}
