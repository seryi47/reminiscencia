"""Cola de importaciones en segundo plano.

Un único hilo trabajador procesa las importaciones en orden, para no saturar la
red ni el disco. El estado de cada trabajo vive en memoria: si el proceso se
reinicia, los trabajos pendientes se pierden y hay que volver a pegar la URL.
La biblioteca sí queda consistente, porque cada importación es atómica por
canción (una canción a medias no llega a registrarse).
"""

from __future__ import annotations

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Callable


@dataclass
class Job:
    id: str
    url: str
    status: str = "queued"  # queued | running | done | failed
    song_id: str | None = None
    created_new: bool | None = None
    source: str | None = None
    license: str | None = None
    error: str | None = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat(timespec="seconds"))

    def public(self) -> dict:
        return asdict(self)


class JobQueue:
    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="importador")

    def submit(self, url: str, work: Callable[[Job], None]) -> Job:
        job = Job(id=uuid.uuid4().hex[:12], url=url)
        with self._lock:
            self._jobs[job.id] = job
        self._executor.submit(self._run, job, work)
        return job

    def _run(self, job: Job, work: Callable[[Job], None]) -> None:
        self._update(job, status="running")
        try:
            work(job)
            self._update(job, status="done")
        except Exception as error:  # el trabajo nunca debe tumbar al hilo trabajador
            self._update(job, status="failed", error=str(error) or error.__class__.__name__)

    def _update(self, job: Job, **fields) -> None:
        with self._lock:
            for name, value in fields.items():
                setattr(job, name, value)

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def list(self) -> list[Job]:
        with self._lock:
            return sorted(self._jobs.values(), key=lambda job: job.created_at, reverse=True)

    def set_result(self, job: Job, **fields) -> None:
        self._update(job, **fields)

    def shutdown(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=True)
