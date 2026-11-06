"""Punto de entrada del job 'procesar' de buzon.yml (ADR-0014).

Procesa las subidas a audio-library/buzon/ del push que lanzó el workflow (sonidos.buzon.procesar_buzon): convierte
las canciones a Opus (también las de dentro de un ZIP, descomprimido fuera del repositorio) y las portadas de audio-library/buzon/portadas/ a JPEG de 640×640 (ADR-0016), las añade al
catálogo y las borra del buzón. No confirma ni sube: después, el job empaqueta los cambios con
scripts/empaquetar_cambios.py (ACTION=buzon) y 'publicar' los valida y los aplica.

Entradas, solo por variables de entorno (nunca por la línea de comandos):
  ACTOR                 la cuenta de GitHub que hizo el push (github.actor)
  GITHUB_EVENT_PATH     el evento del push (lo pone GitHub Actions)
  GITHUB_EVENT_NAME     con repository_dispatch (una subida de la web o la APK, ADR-0024) solo se procesan las
                        subidas de --entrada, no el buzón de main
  GITHUB_STEP_SUMMARY   opcional: aquí se escribe el resumen del job, con las canciones privadas y los rechazos
--entrada <carpeta>: las subidas de la web que el job 'recoger' bajó del bucket privado (<UUID>/...). Si no existe, no
hay ninguna.
Salida: --resultado <ruta> guarda el resultado en JSON (el paquete lo lleva como resultado.json). Lo imprime también,
en la última línea. Ante cualquier error el resultado es {"error": "..."} y sale con código 1.

Uso dentro de buzon.yml:
  python scripts/buzon.py --resultado "$RUNNER_TEMP/paquete/resultado.json" --entrada "$RUNNER_TEMP/entrada"
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Mapping
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from sonidos.buzon import BuzonError, procesar_buzon, resumen_markdown  # noqa: E402

MAX_EVENT_BYTES = 30 * 1024 * 1024  # GitHub limita los eventos a 25 MB


def _event(env: Mapping[str, str]) -> dict:
    path = env.get("GITHUB_EVENT_PATH", "")
    if not path:
        raise BuzonError("falta GITHUB_EVENT_PATH: el buzón solo se procesa desde un push")
    event_file = Path(path)
    if event_file.stat().st_size > MAX_EVENT_BYTES:
        raise BuzonError("el evento es demasiado grande")
    data = json.loads(event_file.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise BuzonError("el evento no tiene la forma esperada")
    return data


def run(env: Mapping[str, str], *, root: Path = ROOT, entrada: Path | None = None) -> dict:
    if entrada is not None and entrada.is_symlink():
        raise BuzonError("la carpeta de subidas de la web es un enlace simbólico")
    return procesar_buzon(
        repo=root, event=_event(env), actor=env.get("ACTOR", ""),
        entrada=entrada if entrada is not None and entrada.is_dir() else None,
        solo_entrada=env.get("GITHUB_EVENT_NAME", "") == "repository_dispatch",
    )


def _summary(env: Mapping[str, str], result: dict) -> None:
    destination = env.get("GITHUB_STEP_SUMMARY", "")
    if destination:
        with Path(destination).open("a", encoding="utf-8") as handle:
            handle.write(resumen_markdown(result))


def _write(path: Path | None, result: dict) -> None:
    text = json.dumps(result, ensure_ascii=False)
    if path is not None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text + "\n", encoding="utf-8")


def main(argv: list[str] | None = None, *, env: Mapping[str, str] | None = None, root: Path = ROOT) -> int:
    parser = argparse.ArgumentParser(description="Procesa las subidas al buzón de canciones.")
    parser.add_argument("--resultado", type=Path, default=None)
    parser.add_argument("--entrada", type=Path, default=None)
    args = parser.parse_args(argv)
    env = os.environ if env is None else env
    try:
        result = run(env, root=root, entrada=args.entrada)
    except Exception as error:  # cualquier fallo sale como JSON; el workflow no publica nada si falla
        result = {"error": str(error) or type(error).__name__, "actor": env.get("ACTOR", "")}
        _write(args.resultado, result)
        _summary(env, result)
        print(json.dumps(result, ensure_ascii=True))  # en el registro, solo ASCII: ningún separador de línea Unicode
        return 1
    _write(args.resultado, result)
    _summary(env, result)
    if result["privadas"]:
        # Texto fijo: los nombres de archivo no van a los comandos de GitHub Actions, solo al resumen escapado.
        print(f"::warning title=Buzón::{len(result['privadas'])} canción(es) sin línea «Licencia:» entran como "
              "privadas; ver el resumen del job.")
    if result.get("posibles_duplicados"):
        print(f"::warning title=Buzón::{len(result['posibles_duplicados'])} canción(es) nueva(s) parecen estar ya en la "
              "biblioteca (mismo título y duración parecida); se han añadido igualmente. Ver el resumen del job.")
    if result["revisar"]:
        print(f"::warning title=Buzón::{len(result['revisar'])} elemento(s) del buzón hay que revisarlos a mano; "
              "ver el resumen del job.")
    print(json.dumps(result, ensure_ascii=True))  # en el registro, solo ASCII: ningún separador de línea Unicode
    return 0


if __name__ == "__main__":
    sys.exit(main())
