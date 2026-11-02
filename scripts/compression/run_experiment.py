#!/usr/bin/env python3
"""Experimento de compresión de audio, de principio a fin.

Pasos:
1. Comprueba ffmpeg/ffprobe y los encoders necesarios, y guarda el entorno en
   research-data/compression/environment.json.
2. Para cada fuente de research-data/compression/sources.json: consulta los
   metadatos de Internet Archive (licencia de dominio público, MD5 y tamaño),
   descarga el fichero si falta y comprueba su SHA-256.
3. Recorta 60 s desde el segundo 30 a un WAV de referencia sin pérdida, con la
   misma frecuencia de muestreo, canales y profundidad que el original.
4. Control de la cadena de medida (sin códec): ida y vuelta de remuestreo a 48 kHz
   y energía de la referencia por debajo de 20 Hz. Se escribe en controls.csv.
5. Codifica cada configuración (3 repeticiones; se usa la mediana de los tiempos),
   decodifica a PCM float32 y calcula tamaño, tasa efectiva, tiempos, SNR, LSD,
   ganancia óptima y las métricas tras corregirla, con scripts/compression/metrics.py.
6. Escribe research-data/compression/results.csv: una fila por fuente y por
   fichero codificado.

El audio nunca se escribe dentro del repositorio: el directorio de trabajo debe
estar fuera de él (por defecto, en el directorio temporal del sistema).

Uso (con un entorno virtual fuera del repositorio con las dependencias de requirements.txt):
    <venv>/bin/python scripts/compression/run_experiment.py --work-dir <ruta fuera del repositorio>
"""

from __future__ import annotations

import argparse
import csv
import dataclasses
import hashlib
import json
import math
import os
import platform
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))

import numpy as np  # noqa: E402

import metrics  # noqa: E402

DATA_DIR = REPO_ROOT / "research-data" / "compression"
SOURCES_PATH = DATA_DIR / "sources.json"
RESULTS_PATH = DATA_DIR / "results.csv"
CONTROLS_PATH = DATA_DIR / "controls.csv"
ENVIRONMENT_PATH = DATA_DIR / "environment.json"

REPETITIONS = 3
DURATION_TOLERANCE_MS = 50.0
LAG_SEARCH_S = 0.25
LOW_FREQUENCY_CUTOFF_HZ = 20.0
CONTROL_RESAMPLE_HZ = 48000
USER_AGENT = "reminiscencia-compression-experiment/1.0"
PUBLIC_DOMAIN_MARKS = (
    "creativecommons.org/publicdomain/mark/1.0",
    "creativecommons.org/publicdomain/zero/1.0",
)
REQUIRED_ENCODERS = ("libopus", "aac", "libmp3lame", "flac")
OPTIONAL_ENCODERS = ("libvorbis",)
PCM_CODEC_BY_BIT_DEPTH = {16: "pcm_s16le", 24: "pcm_s24le"}

RESULT_FIELDS = [
    "source_id",
    "source_type",
    "source_file",
    "source_license",
    "source_date",
    "source_channels",
    "source_sample_rate_hz",
    "source_bit_depth",
    "reference_sha256",
    "codec",
    "encoder",
    "config",
    "nominal_bitrate_kbps",
    "output_extension",
    "encoded_sample_rate_hz",
    "encoded_channels",
    "file_bytes",
    "effective_bitrate_kbps",
    "ref_duration_s",
    "dec_duration_s",
    "duration_delta_ms",
    "duration_preserved",
    "lag_samples",
    "alignment_corr",
    "bit_exact",
    "snr_db",
    "lsd_db",
    "best_gain_db",
    "snr_after_gain_db",
    "lsd_after_gain_db",
    "ref_low_share_lt20hz",
    "err_low_share_lt20hz",
    "enc_time_median_s",
    "dec_time_median_s",
    "enc_times_s",
    "dec_times_s",
    "enc_file_repeats_identical",
    "enc_pcm_repeats_identical",
    "encoded_sha256",
]

CONTROL_FIELDS = [
    "source_id",
    "source_sample_rate_hz",
    "source_channels",
    "control_path",
    "control_lag_samples",
    "control_alignment_corr",
    "control_snr_db",
    "control_lsd_db",
    "ref_rms",
    "ref_mean",
    "ref_low_share_lt20hz",
]


@dataclasses.dataclass(frozen=True)
class Config:
    codec: str
    encoder: str
    label: str
    extension: str
    nominal_kbps: int | None
    args: tuple[str, ...]


# Los argumentos de Opus, AAC y MP3 coinciden con los perfiles de backend/sonidos/compression.py
# (opus-48k, opus-64k, aac-64k, aac-128k, mp3-128k). FLAC es la referencia sin pérdida.
CONFIGS: tuple[Config, ...] = (
    Config("opus", "libopus", "opus-24k-vbr", ".opus", 24, ("-c:a", "libopus", "-b:a", "24k", "-vbr", "on")),
    Config("opus", "libopus", "opus-32k-vbr", ".opus", 32, ("-c:a", "libopus", "-b:a", "32k", "-vbr", "on")),
    Config("opus", "libopus", "opus-48k-vbr", ".opus", 48, ("-c:a", "libopus", "-b:a", "48k", "-vbr", "on")),
    Config("opus", "libopus", "opus-64k-vbr", ".opus", 64, ("-c:a", "libopus", "-b:a", "64k", "-vbr", "on")),
    Config("opus", "libopus", "opus-96k-vbr", ".opus", 96, ("-c:a", "libopus", "-b:a", "96k", "-vbr", "on")),
    Config("aac", "aac", "aac-48k", ".m4a", 48, ("-c:a", "aac", "-b:a", "48k")),
    Config("aac", "aac", "aac-64k", ".m4a", 64, ("-c:a", "aac", "-b:a", "64k")),
    Config("aac", "aac", "aac-96k", ".m4a", 96, ("-c:a", "aac", "-b:a", "96k")),
    Config("aac", "aac", "aac-128k", ".m4a", 128, ("-c:a", "aac", "-b:a", "128k")),
    Config("mp3", "libmp3lame", "mp3-64k", ".mp3", 64, ("-c:a", "libmp3lame", "-b:a", "64k")),
    Config("mp3", "libmp3lame", "mp3-96k", ".mp3", 96, ("-c:a", "libmp3lame", "-b:a", "96k")),
    Config("mp3", "libmp3lame", "mp3-128k", ".mp3", 128, ("-c:a", "libmp3lame", "-b:a", "128k")),
    Config("flac", "flac", "flac-lossless", ".flac", None, ("-c:a", "flac", "-compression_level", "5")),
)


def run_command(command: list[str]) -> subprocess.CompletedProcess:
    result = subprocess.run(command, capture_output=True, check=False)
    if result.returncode != 0:
        message = result.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"falló {command[0]} (código {result.returncode}): {message}")
    return result


def command_text(command: list[str]) -> str:
    try:
        result = subprocess.run(command, capture_output=True, text=True, check=False)
    except OSError:
        return ""
    return result.stdout.strip() if result.returncode == 0 else ""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def check_tools() -> dict:
    for tool in ("ffmpeg", "ffprobe"):
        if shutil.which(tool) is None:
            raise SystemExit(f"No se encuentra {tool} en el PATH.")
    encoders_text = run_command(["ffmpeg", "-hide_banner", "-encoders"]).stdout.decode("utf-8", errors="replace")
    available: set[str] = set()
    for line in encoders_text.splitlines():
        parts = line.split()
        # Las líneas de encoders empiezan por una cadena de flags de 6 caracteres (p. ej. "A....D").
        if len(parts) >= 2 and len(parts[0]) == 6:
            available.add(parts[1])
    missing = [name for name in REQUIRED_ENCODERS if name not in available]
    if missing:
        raise SystemExit(f"Faltan encoders en ffmpeg: {', '.join(missing)}")
    version_lines = run_command(["ffmpeg", "-hide_banner", "-version"]).stdout.decode("utf-8", errors="replace").splitlines()
    configuration = next((line.strip() for line in version_lines if line.strip().startswith("configuration:")), "")
    probe_lines = run_command(["ffprobe", "-hide_banner", "-version"]).stdout.decode("utf-8", errors="replace").splitlines()
    return {
        "ffmpeg_version": version_lines[0] if version_lines else "",
        "ffmpeg_configuration": configuration,
        "ffprobe_version": probe_lines[0] if probe_lines else "",
        "encoders_available": {
            name: name in available for name in REQUIRED_ENCODERS + OPTIONAL_ENCODERS
        },
    }


def environment_snapshot(tools: dict) -> dict:
    return {
        "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "python": sys.version.split()[0],
        "numpy": np.__version__,
        "platform": platform.platform(),
        "machine": platform.machine(),
        "macos_version": command_text(["sw_vers", "-productVersion"]),
        "cpu_brand": command_text(["sysctl", "-n", "machdep.cpu.brand_string"]),
        "logical_cpus": os.cpu_count(),
        "repetitions": REPETITIONS,
        "duration_tolerance_ms": DURATION_TOLERANCE_MS,
        "lag_search_s": LAG_SEARCH_S,
        "low_frequency_cutoff_hz": LOW_FREQUENCY_CUTOFF_HZ,
        "control_resample_hz": CONTROL_RESAMPLE_HZ,
        **tools,
    }


def load_document() -> dict:
    with open(SOURCES_PATH, encoding="utf-8") as handle:
        document = json.load(handle)
    if document.get("schema_version") != 1:
        raise SystemExit("sources.json: versión de esquema no soportada")
    return document


def fetch_json(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def normalize_license(url: str) -> str:
    return url.split("://", 1)[-1].rstrip("/").lower()


def verify_metadata(source: dict) -> None:
    meta = fetch_json(source["metadata_url"])
    license_url = str(meta.get("metadata", {}).get("licenseurl") or "")
    if normalize_license(license_url) not in PUBLIC_DOMAIN_MARKS:
        raise RuntimeError(f"{source['id']}: la licencia de los metadatos no es de dominio público: {license_url!r}")
    entry = next((item for item in meta.get("files", []) if item.get("name") == source["file_name"]), None)
    if entry is None:
        raise RuntimeError(f"{source['id']}: el fichero no aparece en los metadatos de Internet Archive")
    if entry.get("md5") != source["ia_md5"] or int(entry.get("size", -1)) != source["ia_size_bytes"]:
        raise RuntimeError(f"{source['id']}: los metadatos de Internet Archive han cambiado (MD5 o tamaño)")


def ensure_downloaded(source: dict, work_dir: Path) -> Path:
    target_dir = work_dir / "src" / source["id"]
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / source["file_name"]
    if not target.exists():
        partial = target.with_name(target.name + ".part")
        request = urllib.request.Request(source["download_url"], headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=600) as response, open(partial, "wb") as handle:
            shutil.copyfileobj(response, handle, length=1 << 20)
        os.replace(partial, target)
    digest = sha256_file(target)
    if digest != source["sha256"]:
        raise RuntimeError(f"{source['id']}: el SHA-256 no coincide con sources.json ({digest})")
    return target


def probe_audio(path: Path) -> dict:
    output = run_command(
        [
            "ffprobe", "-v", "error", "-select_streams", "a:0",
            "-show_entries", "stream=codec_name,sample_rate,channels",
            "-of", "json", str(path),
        ]
    ).stdout
    stream = json.loads(output)["streams"][0]
    return {
        "codec_name": stream.get("codec_name"),
        "sample_rate_hz": int(stream["sample_rate"]),
        "channels": int(stream["channels"]),
    }


def make_reference(source: dict, cut: dict, original: Path, work_dir: Path) -> Path:
    reference = work_dir / "ref" / f"{source['id']}.wav"
    reference.parent.mkdir(parents=True, exist_ok=True)
    pcm_codec = PCM_CODEC_BY_BIT_DEPTH[source["bit_depth"]]
    run_command(
        [
            "ffmpeg", "-hide_banner", "-y", "-v", "error",
            "-i", str(original), "-map", "0:a:0", "-vn",
            "-ss", str(cut["start_s"]), "-t", str(cut["duration_s"]),
            "-c:a", pcm_codec, str(reference),
        ]
    )
    info = probe_audio(reference)
    if info["sample_rate_hz"] != source["sample_rate_hz"] or info["channels"] != source["channels"]:
        raise RuntimeError(f"{source['id']}: la referencia no conserva frecuencia de muestreo o canales")
    return reference


def decode_float(path: Path, sample_rate: int, channels: int, audio_filter: str | None = None) -> np.ndarray:
    command = [
        "ffmpeg", "-hide_banner", "-v", "error",
        "-i", str(path), "-map", "0:a:0", "-vn",
    ]
    if audio_filter:
        command += ["-af", audio_filter]
    command += ["-ac", str(channels), "-ar", str(sample_rate), "-f", "f32le", "-"]
    return metrics.pcm_from_bytes(run_command(command).stdout, channels)


def timed_encode(reference: Path, destination: Path, config: Config) -> float:
    command = [
        "ffmpeg", "-hide_banner", "-y", "-v", "error",
        "-i", str(reference), "-map", "0:a:0", "-vn",
        *config.args, str(destination),
    ]
    start = time.perf_counter()
    run_command(command)
    return time.perf_counter() - start


def timed_decode(path: Path, sample_rate: int, channels: int) -> float:
    # Decodifica y remuestrea a la frecuencia de la fuente, sin escribir la salida.
    command = [
        "ffmpeg", "-hide_banner", "-v", "error",
        "-i", str(path), "-map", "0:a:0", "-vn",
        "-ac", str(channels), "-ar", str(sample_rate),
        "-f", "null", "-",
    ]
    start = time.perf_counter()
    run_command(command)
    return time.perf_counter() - start


def resampling_control(source: dict, reference: Path, ref_float: np.ndarray) -> dict:
    """Mide la cadena de remuestreo sin códec: frecuencia nativa -> 48 kHz -> nativa."""
    sample_rate = source["sample_rate_hz"]
    channels = source["channels"]
    row = {
        "source_id": source["id"],
        "source_sample_rate_hz": sample_rate,
        "source_channels": channels,
        "ref_rms": f"{float(np.sqrt(np.mean(ref_float**2))):.9f}",
        "ref_mean": f"{float(np.mean(ref_float)):.9f}",
        "ref_low_share_lt20hz": f"{metrics.low_frequency_energy_share(ref_float, sample_rate, LOW_FREQUENCY_CUTOFF_HZ):.9f}",
    }
    if sample_rate == CONTROL_RESAMPLE_HZ:
        return {
            **row,
            "control_path": "no aplica (fuente nativa a 48 kHz)",
            "control_lag_samples": "",
            "control_alignment_corr": "",
            "control_snr_db": "",
            "control_lsd_db": "",
        }
    round_trip = decode_float(
        reference, sample_rate, channels,
        audio_filter=f"aresample={CONTROL_RESAMPLE_HZ},aresample={sample_rate}",
    )
    length = min(ref_float.shape[0], round_trip.shape[0])
    ref_part, trip_part = ref_float[:length], round_trip[:length]
    lag = metrics.estimate_lag(
        metrics.mono_mix(ref_part), metrics.mono_mix(trip_part),
        max_lag=round(LAG_SEARCH_S * sample_rate),
    )
    ref_aligned, trip_aligned = metrics.align(ref_part, trip_part, lag)
    corr = metrics.alignment_correlation(metrics.mono_mix(ref_aligned), metrics.mono_mix(trip_aligned))
    return {
        **row,
        "control_path": f"{sample_rate} Hz -> {CONTROL_RESAMPLE_HZ} Hz -> {sample_rate} Hz",
        "control_lag_samples": lag,
        "control_alignment_corr": f"{corr:.9f}",
        "control_snr_db": f"{metrics.snr_db(ref_aligned, trip_aligned):.6f}",
        "control_lsd_db": f"{metrics.lsd_db(ref_aligned, trip_aligned):.6f}",
    }


def evaluate_config(
    source: dict,
    reference: Path,
    reference_sha256: str,
    ref_float: np.ndarray,
    config: Config,
    work_dir: Path,
) -> dict:
    sample_rate = source["sample_rate_hz"]
    channels = source["channels"]
    encoded = work_dir / "enc" / source["id"] / f"{config.label}{config.extension}"
    encoded.parent.mkdir(parents=True, exist_ok=True)

    enc_times: list[float] = []
    file_digests: list[str] = []
    pcm_digests: list[str] = []
    for _ in range(REPETITIONS):
        enc_times.append(timed_encode(reference, encoded, config))
        file_digests.append(sha256_file(encoded))
        decoded_pass = decode_float(encoded, sample_rate, channels)
        pcm_digests.append(hashlib.sha256(decoded_pass.tobytes()).hexdigest())
    dec_times = [timed_decode(encoded, sample_rate, channels) for _ in range(REPETITIONS)]

    encoded_info = probe_audio(encoded)
    decoded = decode_float(encoded, sample_rate, channels)

    ref_samples = ref_float.shape[0]
    dec_samples = decoded.shape[0]
    ref_mono = metrics.mono_mix(ref_float)
    dec_mono = metrics.mono_mix(decoded)
    lag = metrics.estimate_lag(ref_mono, dec_mono, max_lag=round(LAG_SEARCH_S * sample_rate))
    ref_aligned, dec_aligned = metrics.align(ref_float, decoded, lag)
    alignment_corr = metrics.alignment_correlation(
        metrics.mono_mix(ref_aligned), metrics.mono_mix(dec_aligned)
    )
    snr = metrics.snr_db(ref_aligned, dec_aligned)
    lsd = metrics.lsd_db(ref_aligned, dec_aligned)
    gain = metrics.best_gain(ref_aligned, dec_aligned)
    gained = gain * dec_aligned
    snr_after_gain = metrics.snr_db(ref_aligned, gained)
    lsd_after_gain = metrics.lsd_db(ref_aligned, gained)
    ref_low = metrics.low_frequency_energy_share(ref_float, sample_rate, LOW_FREQUENCY_CUTOFF_HZ)
    err_low = metrics.low_frequency_energy_share(
        ref_aligned - dec_aligned, sample_rate, LOW_FREQUENCY_CUTOFF_HZ
    )
    delta_ms = metrics.duration_delta_ms(ref_samples, dec_samples, sample_rate)
    ref_duration = ref_samples / sample_rate
    file_bytes = os.path.getsize(encoded)
    effective_kbps = file_bytes * 8 / ref_duration / 1000.0
    bit_exact = ref_samples == dec_samples and bool(np.array_equal(ref_float, decoded))

    return {
        "source_id": source["id"],
        "source_type": source["source_type"],
        "source_file": source["file_name"],
        "source_license": source["license_url"],
        "source_date": source["date"] or "",
        "source_channels": channels,
        "source_sample_rate_hz": sample_rate,
        "source_bit_depth": source["bit_depth"],
        "reference_sha256": reference_sha256,
        "codec": config.codec,
        "encoder": config.encoder,
        "config": config.label,
        "nominal_bitrate_kbps": "" if config.nominal_kbps is None else config.nominal_kbps,
        "output_extension": config.extension,
        "encoded_sample_rate_hz": encoded_info["sample_rate_hz"],
        "encoded_channels": encoded_info["channels"],
        "file_bytes": file_bytes,
        "effective_bitrate_kbps": f"{effective_kbps:.6f}",
        "ref_duration_s": f"{ref_duration:.6f}",
        "dec_duration_s": f"{dec_samples / sample_rate:.6f}",
        "duration_delta_ms": f"{delta_ms:.6f}",
        "duration_preserved": str(abs(delta_ms) <= DURATION_TOLERANCE_MS).lower(),
        "lag_samples": lag,
        "alignment_corr": f"{alignment_corr:.9f}",
        "bit_exact": str(bit_exact).lower(),
        "snr_db": f"{snr:.6f}",
        "lsd_db": f"{lsd:.6f}",
        "best_gain_db": f"{20.0 * math.log10(gain):.6f}",
        "snr_after_gain_db": f"{snr_after_gain:.6f}",
        "lsd_after_gain_db": f"{lsd_after_gain:.6f}",
        "ref_low_share_lt20hz": f"{ref_low:.9f}",
        "err_low_share_lt20hz": f"{err_low:.9f}",
        "enc_time_median_s": f"{statistics.median(enc_times):.6f}",
        "dec_time_median_s": f"{statistics.median(dec_times):.6f}",
        "enc_times_s": ";".join(f"{value:.6f}" for value in enc_times),
        "dec_times_s": ";".join(f"{value:.6f}" for value in dec_times),
        "enc_file_repeats_identical": str(len(set(file_digests)) == 1).lower(),
        "enc_pcm_repeats_identical": str(len(set(pcm_digests)) == 1).lower(),
        "encoded_sha256": file_digests[-1],
    }


def write_csv(path: Path, fields: list[str], rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def print_summary(rows: list[dict]) -> None:
    print(f"\nFilas escritas en {RESULTS_PATH}: {len(rows)}")
    for config in CONFIGS:
        subset = [row for row in rows if row["config"] == config.label]
        if not subset:
            continue

        def values(field: str) -> list[float]:
            return [float(row[field]) for row in subset]

        def finite_range(field: str) -> str:
            finite = [value for value in values(field) if math.isfinite(value)]
            if not finite:
                return "inf (sin pérdida)"
            return f"{min(finite):.2f}..{max(finite):.2f}"

        print(
            f"{config.label:14s} n={len(subset)} "
            f"tasa {min(values('effective_bitrate_kbps')):.2f}..{max(values('effective_bitrate_kbps')):.2f} kbps | "
            f"SNR {finite_range('snr_db')} dB | SNR tras ganancia {finite_range('snr_after_gain_db')} dB | "
            f"ganancia {min(values('best_gain_db')):+.3f}..{max(values('best_gain_db')):+.3f} dB | "
            f"LSD {min(values('lsd_db')):.2f}..{max(values('lsd_db')):.2f} dB | "
            f"enc {min(values('enc_time_median_s')):.3f}..{max(values('enc_time_median_s')):.3f} s | "
            f"dec {min(values('dec_time_median_s')):.3f}..{max(values('dec_time_median_s')):.3f} s"
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Experimento de compresión (ver docs/audio-processing/COMPRESSION.md).")
    parser.add_argument(
        "--work-dir",
        type=Path,
        default=Path(tempfile.gettempdir()) / "reminiscencia-compresion-experimento",
        help="Directorio de trabajo para descargas y ficheros codificados; debe estar fuera del repositorio.",
    )
    parser.add_argument(
        "--skip-metadata-check",
        action="store_true",
        help="No consulta los metadatos de Internet Archive; solo verifica el SHA-256 local.",
    )
    args = parser.parse_args(argv)

    work_dir = args.work_dir.expanduser().resolve()
    if work_dir == REPO_ROOT or REPO_ROOT in work_dir.parents:
        parser.error("el directorio de trabajo debe estar fuera del repositorio: el audio no se versiona")
    work_dir.mkdir(parents=True, exist_ok=True)

    tools = check_tools()
    ENVIRONMENT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(ENVIRONMENT_PATH, "w", encoding="utf-8") as handle:
        json.dump(environment_snapshot(tools), handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    document = load_document()
    cut = document["cut"]
    sources = document["sources"]
    rows: list[dict] = []
    controls: list[dict] = []
    for source_index, source in enumerate(sources, start=1):
        print(f"[fuente {source_index}/{len(sources)}] {source['id']}")
        if not args.skip_metadata_check:
            verify_metadata(source)
        original = ensure_downloaded(source, work_dir)
        reference = make_reference(source, cut, original, work_dir)
        expected_samples = round(cut["duration_s"] * source["sample_rate_hz"])
        ref_float = decode_float(reference, source["sample_rate_hz"], source["channels"])
        if ref_float.shape[0] != expected_samples:
            raise RuntimeError(
                f"{source['id']}: la referencia tiene {ref_float.shape[0]} muestras y se esperaban {expected_samples}"
            )
        control = resampling_control(source, reference, ref_float)
        controls.append(control)
        print(
            f"  control {control['control_path']}: SNR {control['control_snr_db'] or 'no aplica'} dB, "
            f"LSD {control['control_lsd_db'] or 'no aplica'} dB"
        )
        reference_sha256 = sha256_file(reference)
        for config in CONFIGS:
            row = evaluate_config(source, reference, reference_sha256, ref_float, config, work_dir)
            rows.append(row)
            print(
                f"  {config.label:14s} {float(row['effective_bitrate_kbps']):8.2f} kbps  "
                f"SNR {row['snr_db']:>10s} dB  LSD {row['lsd_db']:>10s} dB  "
                f"enc {row['enc_time_median_s']} s  dec {row['dec_time_median_s']} s"
            )

    write_csv(CONTROLS_PATH, CONTROL_FIELDS, controls)
    write_csv(RESULTS_PATH, RESULT_FIELDS, rows)
    print_summary(rows)
    return 0


if __name__ == "__main__":
    sys.exit(main())
