"""Falla si el repositorio incumple los límites de GitHub (ver sonidos/limits.py).

Uso: python scripts/check_repo_limits.py
"""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from sonidos.limits import audit_repository  # noqa: E402


def main() -> int:
    problems = audit_repository(ROOT)
    for problem in problems:
        print(f"AVISO/ERROR: {problem}")
    blocking = [problem for problem in problems if "bloquea" in problem or "máximo" in problem]
    if blocking:
        return 1
    print("Límites de GitHub: correcto")
    return 0


if __name__ == "__main__":
    sys.exit(main())
