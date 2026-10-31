"""Interfaz de línea de comandos: `python -m sonidos <orden>`."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from sonidos.compression import PROFILES
from sonidos.importer import import_local_file
from sonidos.library import LicenseRequiredError, Library
from sonidos.probe import ProbeError
from sonidos.web_build import build_web

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

    web = commands.add_parser("build-web", help="copia el audio de reproducción y el índice a la web")
    web.add_argument("--web-dir", type=Path, default=Path("frontend/web"))

    serve = commands.add_parser("serve", help="arranca el panel de administración en este equipo")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8787)
    serve.add_argument("--staging-dir", type=Path, default=Path("audio-library/staging"))

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "serve":
        return serve(args)
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
        elif args.command == "build-web":
            entries = build_web(library, args.web_dir)
            print(f"{len(entries)} canciones preparadas en {args.web_dir}")
    except (LicenseRequiredError, ProbeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    finally:
        library.close()
    return 0


def serve(args) -> int:
    import uvicorn

    from sonidos.api import create_app

    app = create_app(
        db_path=args.db,
        audio_dir=DEFAULT_AUDIO,
        staging_dir=args.staging_dir,
        web_dir=Path("frontend/web"),
        index_path=DEFAULT_INDEX,
    )
    print(f"Panel local en http://{args.host}:{args.port}  (solo este equipo)")
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
    return 0
