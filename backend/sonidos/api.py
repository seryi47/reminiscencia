"""API local del panel de administración (sólo para uso en el equipo del cuidador).

Cada petición abre su propia conexión a SQLite: FastAPI atiende peticiones en
hilos distintos y una conexión SQLite no debe compartirse entre ellos.
"""

from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from sonidos.library import Library
from sonidos.sources import SourceError
from sonidos.web_build import build_web
from sonidos.intake import intake_url

ADMIN_DIR = Path(__file__).resolve().parents[2] / "frontend" / "admin"


class IntakeRequest(BaseModel):
    url: str = Field(min_length=8, max_length=2048)
    license: str | None = Field(default=None, max_length=300)
    title: str | None = Field(default=None, max_length=200)


def create_app(
    *,
    db_path: Path,
    audio_dir: Path,
    staging_dir: Path,
    web_dir: Path,
    index_path: Path,
) -> FastAPI:
    app = FastAPI(title="Reminiscencia: panel local", version="0.1.0")

    @contextmanager
    def library():
        lib = Library(db_path)
        try:
            yield lib
        finally:
            lib.close()

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok"}

    @app.get("/api/stats")
    def stats() -> dict:
        with library() as lib:
            return lib.stats()

    @app.get("/api/songs")
    def songs() -> list[dict]:
        with library() as lib:
            rows = lib.list_songs()
            for row in rows:
                row["variants"] = [item["profile"] for item in lib.variants_for(row["id"])]
            return rows

    @app.post("/api/intake", status_code=201)
    def intake(request: IntakeRequest) -> dict:
        with library() as lib:
            try:
                report, resolved = intake_url(
                    lib,
                    request.url,
                    staging_dir=staging_dir,
                    audio_dir=audio_dir,
                    license=request.license,
                    title=request.title,
                )
            except SourceError as error:
                raise HTTPException(status_code=422, detail=str(error)) from error
            except (OSError, ValueError) as error:
                raise HTTPException(status_code=502, detail=f"No se pudo obtener el audio: {error}") from error
            return {
                "song_id": report.result.song_id,
                "created": report.result.created,
                "source": resolved.source,
                "license": resolved.license,
            }

    @app.post("/api/publish-web")
    def publish_web() -> dict:
        with library() as lib:
            entries = build_web(lib, web_dir)
            lib.export_index(index_path)
            return {"published": len(entries), "web_dir": str(web_dir)}

    @app.get("/")
    def admin_page():
        return FileResponse(ADMIN_DIR / "index.html")

    app.mount("/", StaticFiles(directory=ADMIN_DIR), name="admin")
    return app
