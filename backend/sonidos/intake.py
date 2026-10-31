"""Importación de una URL: resolver fuente, descargar a staging e importar a la biblioteca."""

from __future__ import annotations

import json
from pathlib import Path
from urllib.request import Request, urlopen

from sonidos.importer import ImportReport, import_local_file
from sonidos.library import Library
from sonidos.sources import ResolvedSource, SourceError, classify, resolve_direct_file, resolve_internet_archive

MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024
USER_AGENT = "reminiscencia-backend/0.1 (importacion con licencia)"


def fetch_json(url: str) -> dict:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def download(url: str, destination: Path) -> Path:
    """Descarga un fichero con límite de tamaño. Nunca escribe fuera de `destination`."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = Request(url, headers={"User-Agent": USER_AGENT})
    written = 0
    with urlopen(request, timeout=60) as response, destination.open("wb") as handle:
        while True:
            chunk = response.read(1 << 20)
            if not chunk:
                break
            written += len(chunk)
            if written > MAX_DOWNLOAD_BYTES:
                handle.close()
                destination.unlink(missing_ok=True)
                raise SourceError("El fichero supera el límite de 200 MB")
            handle.write(chunk)
    return destination


def resolve_url(url: str, *, license: str | None = None) -> ResolvedSource:
    kind = classify(url)
    if kind == "internet-archive":
        identifier = url.rstrip("/").split("/")[-1]
        metadata = fetch_json(f"https://archive.org/metadata/{identifier}")
        return resolve_internet_archive(url, metadata)
    return resolve_direct_file(url, license)


def intake_url(
    library: Library,
    url: str,
    *,
    staging_dir: Path,
    audio_dir: Path,
    license: str | None = None,
    title: str | None = None,
    variant_profile: str = "opus-64k",
) -> tuple[ImportReport, ResolvedSource]:
    resolved = resolve_url(url, license=license)
    target = download(resolved.download_url, staging_dir / resolved.identifier.replace("/", "_") / resolved.file_name)
    report = import_local_file(
        library,
        target,
        license=resolved.license,
        title=title or resolved.title or target.stem,
        origin=f"{resolved.source}:{resolved.identifier}",
        variant_profiles=(variant_profile,),
        audio_dir=audio_dir,
    )
    return report, resolved
