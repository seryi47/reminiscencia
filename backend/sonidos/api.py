"""API local del panel de administración (sólo para uso en el equipo del cuidador).

Cada petición abre su propia conexión a SQLite: FastAPI atiende peticiones en
hilos distintos y una conexión SQLite no debe compartirse entre ellos. Lo mismo
vale para el hilo trabajador de las importaciones.
"""

from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from sonidos.intake import intake_url
from sonidos.jobs import Job, JobQueue
from sonidos.library import Library
from sonidos.sources import SourceError, classify
from sonidos.web_build import build_web

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
    queue = JobQueue()
    app.state.jobs = queue

    @contextmanager
    def library():
        lib = Library(db_path)
        try:
            yield lib
        finally:
            lib.close()

    def run_import(request: IntakeRequest):
        def work(job: Job) -> None:
            with library() as lib:
                report, resolved = intake_url(
                    lib,
                    request.url,
                    staging_dir=staging_dir,
                    audio_dir=audio_dir,
                    license=request.license,
                    title=request.title,
                )
            queue.set_result(
                job,
                song_id=report.result.song_id,
                created_new=report.result.created,
                source=resolved.source,
                license=resolved.license,
            )

        return work

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

    @app.post("/api/intake", status_code=202)
    def intake(request: IntakeRequest) -> dict:
        # Validación inmediata: una URL no admitida responde al instante, sin encolar.
        try:
            classify(request.url)
        except SourceError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        job = queue.submit(request.url, run_import(request))
        return {"job_id": job.id, "status": job.status}

    @app.get("/api/jobs")
    def jobs() -> list[dict]:
        return [job.public() for job in queue.list()]

    @app.get("/api/jobs/{job_id}")
    def job(job_id: str) -> dict:
        found = queue.get(job_id)
        if found is None:
            raise HTTPException(status_code=404, detail="No existe ese trabajo")
        return found.public()

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
