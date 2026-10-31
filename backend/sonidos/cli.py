"""Interfaz de línea de comandos: `python -m sonidos <orden>`."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from sonidos.compression import PROFILES
from sonidos.importer import import_local_file
from sonidos.library import LicenseRequiredError, Library
from sonidos.probe import ProbeError

DEFAULT_DB = Path("audio-library/indexes/library.sqlite")
DEFAULT_AUDIO = Path("audio-library/audio")
DEFAULT_INDEX = Path("audio-library/indexes/songs.json")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="sonidos", description="Biblioteca musical local")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    commands = parser.add_subparsers(dest="command", required=True)

    importer = commands.add_parser("import", help="importa un archivo local con licencia declarada")
    importer.add_argument("file", type=Path)
    importer.add_argument("--license", required=True, help="licencia o justificación de uso")
    importer.add_argument("--title")
    importer.add_argument("--origin", default="local")
    importer.add_argument(
        "--variant",
        action="append",
        default=[],
        choices=sorted(PROFILES),
        help="perfil de reproducción a generar (repetible)",
    )
    importer.add_argument("--audio-dir", type=Path, default=DEFAULT_AUDIO)

    commands.add_parser("list", help="lista canciones")
    commands.add_parser("stats", help="resumen de la biblioteca")

    export = commands.add_parser("export-index", help="exporta el índice JSON")
    export.add_argument("--output", type=Path, default=DEFAULT_INDEX)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    library = Library(args.db)
    try:
        if args.command == "import":
            report = import_local_file(
                library,
                args.file,
                license=args.license,
                title=args.title,
                origin=args.origin,
                variant_profiles=tuple(args.variant),
                audio_dir=args.audio_dir,
            )
            state = "importada" if report.result.created else "ya existía (duplicado)"
            print(f"{report.result.song_id}: {state}")
            for variant in report.variants:
                print(f"  variante: {variant}")
        elif args.command == "list":
            for song in library.list_songs():
                print(f"{song['id']}\t{song['title']}\t{song['codec']}\t{song['duration_s']:.1f}s")
        elif args.command == "stats":
            for key, value in library.stats().items():
                print(f"{key}: {value}")
        elif args.command == "export-index":
            library.export_index(args.output)
            print(f"índice escrito en {args.output}")
    except (LicenseRequiredError, ProbeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    finally:
        library.close()
    return 0
