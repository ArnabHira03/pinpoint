import logging
import math
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import models  # noqa: F401  (registers tables on Base.metadata)
from . import storage
from .api import annotations, projects, screenshots
from .config import Settings
from .database import Base, make_engine, make_session_factory
from .models import Screenshot

logger = logging.getLogger(__name__)


def reconcile_storage(settings: Settings, session_factory) -> None:
    """Clear partial uploads and delete files that no screenshot row points at."""
    storage.clear_dir(settings.tmp_dir)
    with session_factory() as db:
        known = {(pid, name) for pid, name in db.query(Screenshot.project_id, Screenshot.filename)}
    removed = storage.sweep_orphans(settings.screenshots_dir, known)
    if removed:
        logger.info("Removed %d orphaned screenshot file(s)", removed)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        settings.screenshots_dir.mkdir(parents=True, exist_ok=True)
        settings.tmp_dir.mkdir(parents=True, exist_ok=True)
        engine = make_engine(settings.database_url)
        Base.metadata.create_all(engine)
        app.state.settings = settings
        app.state.engine = engine
        app.state.session_factory = make_session_factory(engine)
        reconcile_storage(settings, app.state.session_factory)
        yield
        engine.dispose()

    app = FastAPI(title="Pinpoint", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        # The default handler echoes the bad input back; NaN/Infinity can't be encoded as JSON.
        safe_float = {float: lambda v: v if math.isfinite(v) else str(v)}
        return JSONResponse(status_code=422, content={"detail": jsonable_encoder(exc.errors(), custom_encoder=safe_float)})

    app.include_router(projects.router)
    app.include_router(screenshots.router)
    app.include_router(annotations.router)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
