"""Redacta la respuesta a una incidencia de biblioteca (ADR-0008, paso 'Responder').

Uso dentro del workflow biblioteca.yml:
  python scripts/responder_incidencia.py --peticion FICHERO --resultado FICHERO --cuerpo FICHERO

--peticion es la salida de scripts/issue_request.py (resumen o {"error": ...}) y --resultado la de
scripts/ci_library.py. Los estados de cada paso llegan por ESTADO_PREPARAR, ESTADO_APLICAR y
ESTADO_GUARDAR. Escribe el comentario en --cuerpo e imprime por stdout 'ok' (la incidencia se cierra)
o 'error' (la incidencia recibe la etiqueta error). No llama a GitHub: el workflow publica el
comentario con gh issue comment --body-file, así que el texto de la incidencia nunca se interpola.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

FORMAT_DOC = "docs/decisions/ADR-0008-entrada-por-incidencias.md"


def load_json(path: Path) -> dict | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def evaluate(peticion: dict | None, resultado: dict | None, estados: dict[str, str]) -> tuple[bool, str]:
    """Devuelve (todo correcto, texto del comentario)."""
    peticion = peticion or {}
    resultado = resultado or {}
    if estados.get("preparar") != "success":
        motivo = peticion.get("error") or "la petición no se pudo validar; revisa el registro de la ejecución"
        return False, _error_body(str(motivo))
    if estados.get("aplicar") != "success":
        motivo = resultado.get("error") or "no se pudo aplicar al catálogo; revisa el registro de la ejecución"
        return False, _error_body(str(motivo))
    if estados.get("guardar") != "success":
        return False, _error_body("no se pudieron guardar los cambios en el repositorio; revisa el registro de la ejecución")
    return True, _success_body(peticion, resultado)


def _error_body(motivo: str) -> str:
    return (
        "No se ha podido procesar esta petición.\n\n"
        f"Motivo: {motivo}\n\n"
        f"Corrige la incidencia y vuelve a enviarla (formato en {FORMAT_DOC}). "
        "La incidencia queda abierta con la etiqueta `error`.\n"
    )


def _success_body(peticion: dict, resultado: dict) -> str:
    lines = ["Petición procesada correctamente."]
    if peticion.get("action"):
        lines.append(f"- Acción: {peticion['action']}")
    if peticion.get("url"):
        lines.append(f"- URL: {peticion['url']}")
    if peticion.get("op"):
        lines.append(f"- Operación: {peticion['op']}")
    if "song_id" in resultado:
        estado = "añadida al catálogo" if resultado.get("created") else "ya estaba en el catálogo"
        lines.append(f"- Canción {resultado['song_id']}: {estado}.")
    cleaned = resultado.get("cleaned")
    if isinstance(cleaned, int) and not isinstance(cleaned, bool):
        # clean_titles (ADR-0032): solo el número; los cambios están en el resumen de la ejecución.
        lines.append(f"- Títulos limpiados: {cleaned} {'canción' if cleaned == 1 else 'canciones'}.")
    web = resultado.get("web")
    if isinstance(web, dict):
        lines.append(f"- Web pública: {web.get('public', 0)} canciones publicadas y {web.get('folders', 0)} carpetas.")
    lines.append("")
    lines.append("La incidencia se cierra.")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Redacta la respuesta a una incidencia de biblioteca.")
    parser.add_argument("--peticion", required=True, type=Path)
    parser.add_argument("--resultado", required=True, type=Path)
    parser.add_argument("--cuerpo", required=True, type=Path)
    args = parser.parse_args(argv)
    estados = {
        "preparar": os.environ.get("ESTADO_PREPARAR", ""),
        "aplicar": os.environ.get("ESTADO_APLICAR", ""),
        "guardar": os.environ.get("ESTADO_GUARDAR", ""),
    }
    ok, body = evaluate(load_json(args.peticion), load_json(args.resultado), estados)
    args.cuerpo.write_text(body, encoding="utf-8")
    print("ok" if ok else "error")
    return 0


if __name__ == "__main__":
    sys.exit(main())
