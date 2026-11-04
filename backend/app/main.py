import math
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from . import models  # noqa: F401  (registers tables on Base.metadata)
from .api import reviews
from .config import Settings
from .database import create_tables, make_engine, make_session_factory


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        database_url = settings.resolved_database_url
        if not settings.is_hosted_database:
            settings.data_dir.mkdir(parents=True, exist_ok=True)
        engine = make_engine(database_url)
        create_tables(engine)
        app.state.settings = settings
        app.state.engine = engine
        app.state.session_factory = make_session_factory(engine)
        yield
        engine.dispose()

    # The API's map is for local development, not for anyone who finds the hosted address.
    docs = {} if not settings.is_hosted_database else {"docs_url": None, "redoc_url": None, "openapi_url": None}
    app = FastAPI(title="Pinpoint", lifespan=lifespan, **docs)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        # The default handler echoes the bad input back; NaN/Infinity can't be encoded as JSON.
        safe_float = {float: lambda v: v if math.isfinite(v) else str(v)}
        return JSONResponse(status_code=422, content={"detail": jsonable_encoder(exc.errors(), custom_encoder=safe_float)})

    app.include_router(reviews.router)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
