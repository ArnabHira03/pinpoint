import logging
import math
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from . import models  # noqa: F401  (registers tables on Base.metadata)
from . import storage
from .api import annotations, projects, reviews, screenshots
from .config import Settings
from .database import Base, make_engine, make_session_factory
from .models import Screenshot, new_share_code

logger = logging.getLogger(__name__)


def reconcile_storage(settings: Settings, session_factory) -> None:
    """Clear partial uploads and delete files that no screenshot row points at."""
    storage.clear_dir(settings.tmp_dir)
    with session_factory() as db:
        known = {(pid, name) for pid, name in db.query(Screenshot.project_id, Screenshot.filename)}
    removed = storage.sweep_orphans(settings.screenshots_dir, known)
    if removed:
        logger.info("Removed %d orphaned screenshot file(s)", removed)


def add_review_sharing_columns(engine: Engine) -> None:
    """Upgrade a database from V4 Stage 1, keeping its data. create_all never alters existing tables."""
    inspector = inspect(engine)
    review_columns = {column["name"] for column in inspector.get_columns("reviews")}
    comment_columns = {column["name"] for column in inspector.get_columns("web_comments")}
    with engine.begin() as conn:
        if "share_code" not in review_columns:
            conn.execute(text("ALTER TABLE reviews ADD COLUMN share_code VARCHAR(8)"))
            for (review_id,) in conn.execute(text("SELECT id FROM reviews")).fetchall():
                conn.execute(
                    text("UPDATE reviews SET share_code = :code WHERE id = :id"),
                    {"code": new_share_code(), "id": review_id},
                )
            conn.execute(text("CREATE UNIQUE INDEX ix_reviews_share_code ON reviews (share_code)"))
        if "author_name" not in comment_columns:
            conn.execute(text("ALTER TABLE web_comments ADD COLUMN author_name TEXT NOT NULL DEFAULT ''"))


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        settings.screenshots_dir.mkdir(parents=True, exist_ok=True)
        settings.tmp_dir.mkdir(parents=True, exist_ok=True)
        engine = make_engine(settings.database_url)
        Base.metadata.create_all(engine)
        add_review_sharing_columns(engine)
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
    app.include_router(reviews.router)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
