"""Métricas objetivas para comparar un audio decodificado con su original.

Se calculan sobre PCM float32 (muestras en [-1, 1]) a la frecuencia de muestreo
nativa del original:

- Alineación: desfase entero estimado por correlación cruzada (FFT) sobre la
  mezcla mono, en una ventana de +-max_lag muestras.
- SNR (dB): 10 log10( suma x^2 / suma (x - y)^2 ), con todos los canales juntos.
- LSD (dB): distancia espectral logarítmica. Para cada canal y trama de 2048
  muestras (Hann periódica, salto de 512), la distancia por trama es la raíz de
  la media de (10 log10(P_ref + eps) - 10 log10(P_dec + eps))^2 sobre las bins
  de 0 a fs/2; se promedian las tramas y después los canales. eps = 1e-10.

Diagnósticos añadidos para interpretar el SNR y el LSD:

- Ganancia óptima g (minimiza |ref - g dec|^2): separa el error de nivel del de forma
  de onda. SNR y LSD "tras ganancia" se calculan con g * dec.
- Fracción de energía por debajo de 20 Hz (ventana de Hann), en la referencia y en el error.

Son métricas OBJETIVAS. No sustituyen una prueba perceptual con oyentes
(ITU-R BS.1534, MUSHRA), que el experimento no realiza.
"""

from __future__ import annotations

import numpy as np

LSD_N_FFT = 2048
LSD_HOP = 512
LSD_EPS = 1e-10
LSD_CHUNK_FRAMES = 1024


def pcm_from_bytes(raw: bytes, channels: int) -> np.ndarray:
    """Convierte PCM float32 little-endian intercalado en una matriz (muestras, canales)."""
    if channels < 1:
        raise ValueError("el número de canales debe ser al menos 1")
    data = np.frombuffer(raw, dtype="<f4")
    if data.size % channels:
        raise ValueError(f"{data.size} muestras no son múltiplo de {channels} canales")
    return data.reshape(-1, channels).astype(np.float64)


def mono_mix(samples: np.ndarray) -> np.ndarray:
    """Mezcla de canales por media aritmética; devuelve un vector 1-D."""
    return samples.mean(axis=1)


def estimate_lag(ref_mono: np.ndarray, dec_mono: np.ndarray, max_lag: int) -> int:
    """Desfase entero L que maximiza la correlación cruzada con dec[n + L] ~ ref[n].

    L > 0 indica que la salida decodificada va retrasada L muestras respecto al
    original; L < 0 que va adelantada. Se busca en el intervalo [-max_lag, max_lag].
    """
    if max_lag < 0:
        raise ValueError("max_lag no puede ser negativo")
    n = min(len(ref_mono), len(dec_mono))
    ref_mono = ref_mono[:n]
    dec_mono = dec_mono[:n]
    nfft = 1
    while nfft < n + max_lag + 1:
        nfft *= 2
    ref_spec = np.fft.rfft(ref_mono, nfft)
    dec_spec = np.fft.rfft(dec_mono, nfft)
    # c[k] = sum_n ref[n] * dec[n + k], con relleno a ceros para evitar envoltura circular
    correlation = np.fft.irfft(np.conj(ref_spec) * dec_spec, nfft)
    lags = np.arange(-max_lag, max_lag + 1)
    values = correlation[lags % nfft]
    return int(lags[int(np.argmax(values))])


def align(ref: np.ndarray, dec: np.ndarray, lag: int) -> tuple[np.ndarray, np.ndarray]:
    """Recorta ambas señales para que ref[n] y dec[n + lag] queden enfrentadas."""
    if lag >= 0:
        ref_part = ref[: len(ref) - lag]
        dec_part = dec[lag:]
    else:
        ref_part = ref[-lag:]
        dec_part = dec[: len(dec) + lag]
    length = min(len(ref_part), len(dec_part))
    return ref_part[:length], dec_part[:length]


def alignment_correlation(ref_mono: np.ndarray, dec_mono: np.ndarray) -> float:
    """Coeficiente de correlación de Pearson sin media entre dos vectores ya alineados."""
    denominator = np.sqrt(np.sum(ref_mono**2) * np.sum(dec_mono**2))
    if denominator == 0.0:
        return float("nan")
    return float(np.sum(ref_mono * dec_mono) / denominator)


def snr_db(ref: np.ndarray, dec: np.ndarray) -> float:
    """SNR en dB sobre señales alineadas de la misma forma. Devuelve inf si son idénticas."""
    if ref.shape != dec.shape:
        raise ValueError(f"formas distintas: {ref.shape} y {dec.shape}")
    noise = float(np.sum((ref - dec) ** 2))
    signal = float(np.sum(ref**2))
    if noise == 0.0:
        return float("inf")
    if signal == 0.0:
        raise ValueError("la señal de referencia es silencio: el SNR no está definido")
    return float(10.0 * np.log10(signal / noise))


def _periodic_hann(length: int) -> np.ndarray:
    return 0.5 - 0.5 * np.cos(2.0 * np.pi * np.arange(length) / length)


def lsd_db(
    ref: np.ndarray,
    dec: np.ndarray,
    n_fft: int = LSD_N_FFT,
    hop: int = LSD_HOP,
    eps: float = LSD_EPS,
) -> float:
    """Distancia espectral logarítmica en dB (ver la cabecera del módulo)."""
    ref = np.asarray(ref, dtype=np.float64)
    dec = np.asarray(dec, dtype=np.float64)
    if ref.ndim == 1:
        ref = ref[:, None]
        dec = dec[:, None]
    if ref.shape != dec.shape:
        raise ValueError(f"formas distintas: {ref.shape} y {dec.shape}")
    if ref.shape[0] < n_fft:
        raise ValueError("la señal es más corta que una trama de análisis")
    window = _periodic_hann(n_fft)
    per_channel = []
    for channel in range(ref.shape[1]):
        ref_frames = np.lib.stride_tricks.sliding_window_view(ref[:, channel], n_fft)[::hop]
        dec_frames = np.lib.stride_tricks.sliding_window_view(dec[:, channel], n_fft)[::hop]
        distances = []
        for start in range(0, ref_frames.shape[0], LSD_CHUNK_FRAMES):
            stop = start + LSD_CHUNK_FRAMES
            ref_power = np.abs(np.fft.rfft(ref_frames[start:stop] * window, axis=1)) ** 2
            dec_power = np.abs(np.fft.rfft(dec_frames[start:stop] * window, axis=1)) ** 2
            difference = 10.0 * np.log10(ref_power + eps) - 10.0 * np.log10(dec_power + eps)
            distances.append(np.sqrt(np.mean(difference**2, axis=1)))
        per_channel.append(float(np.mean(np.concatenate(distances))))
    return float(np.mean(per_channel))


def duration_delta_ms(ref_samples: int, dec_samples: int, sample_rate: int) -> float:
    """Diferencia de duración (decodificado menos original) en milisegundos."""
    return (dec_samples - ref_samples) * 1000.0 / sample_rate


def best_gain(ref: np.ndarray, dec: np.ndarray) -> float:
    """Ganancia escalar g que minimiza la suma de (ref - g * dec)^2 sobre señales alineadas.

    Sirve para separar el error de nivel (una ganancia distinta de 1) del error de forma de
    onda: g = 1 significa que no hay desviación de nivel.
    """
    if ref.shape != dec.shape:
        raise ValueError(f"formas distintas: {ref.shape} y {dec.shape}")
    denominator = float(np.sum(dec * dec))
    if denominator == 0.0:
        raise ValueError("la señal decodificada es silencio: la ganancia óptima no está definida")
    return float(np.sum(ref * dec) / denominator)


def low_frequency_energy_share(signal: np.ndarray, sample_rate: int, cutoff_hz: float = 20.0) -> float:
    """Fracción de la energía (suma de canales) que queda por debajo de cutoff_hz.

    Se calcula con una ventana de Hann sobre toda la señal. Devuelve nan si la señal es silencio.
    """
    samples = np.asarray(signal, dtype=np.float64)
    if samples.ndim == 1:
        samples = samples[:, None]
    window = np.hanning(samples.shape[0])
    frequencies = np.fft.rfftfreq(samples.shape[0], 1.0 / sample_rate)
    below = frequencies < cutoff_hz
    total = 0.0
    low = 0.0
    for channel in range(samples.shape[1]):
        power = np.abs(np.fft.rfft(samples[:, channel] * window)) ** 2
        total += float(power.sum())
        low += float(power[below].sum())
    if total == 0.0:
        return float("nan")
    return low / total
