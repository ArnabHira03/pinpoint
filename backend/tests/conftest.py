import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.config import Settings
from app.database import make_engine
from app.main import create_app

# Set this to run the same tests against Postgres. Its public schema gets wiped.
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")
ON_POSTGRES = bool(TEST_DATABASE_URL)


@pytest.fixture
def settings(tmp_path) -> Settings:
    settings = Settings(data_dir=tmp_path / "data", database_url=TEST_DATABASE_URL)
    if ON_POSTGRES:
        engine = make_engine(settings.resolved_database_url)
        with engine.begin() as conn:
            conn.execute(text("DROP SCHEMA public CASCADE"))
            conn.execute(text("CREATE SCHEMA public"))
        engine.dispose()
    return settings


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as c:
        yield c
