import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.config import Settings
from app.main import create_app
from .conftest import ON_POSTGRES

sqlite_only = pytest.mark.skipif(ON_POSTGRES, reason="SQLite only")
postgres_only = pytest.mark.skipif(not ON_POSTGRES, reason="Postgres only")


def test_health(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


@sqlite_only
def test_startup_creates_database(client, settings):
    assert (settings.data_dir / "app.db").exists()


@sqlite_only
def test_foreign_keys_pragma_on(client):
    with client.app.state.engine.connect() as conn:
        assert conn.execute(text("PRAGMA foreign_keys")).scalar() == 1


def test_foreign_key_enforced(client):
    with client.app.state.engine.connect() as conn:
        with pytest.raises(IntegrityError):
            conn.execute(text("INSERT INTO review_pages (review_id, url, next_comment_number) VALUES (999, 'https://a.com/', 1)"))


@postgres_only
def test_every_table_has_row_level_security(client):
    # Supabase's automatic Data API must not be able to read these tables.
    with client.app.state.engine.connect() as conn:
        rows = conn.execute(text("SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'")).all()
    assert len(rows) == 4
    assert all(enabled for _, enabled in rows), rows


def test_docs_are_off_on_a_hosted_database():
    assert create_app(Settings(database_url="postgresql://u:p@db.example/x")).docs_url is None
    assert create_app(Settings(database_url="postgresql://u:p@db.example/x")).openapi_url is None


def test_local_database_keeps_docs(tmp_path):
    assert create_app(Settings(data_dir=tmp_path)).docs_url == "/docs"


@pytest.mark.parametrize(
    "given", ["postgres://u:p@h:5432/d", "postgresql://u:p@h:5432/d", "postgresql+psycopg://u:p@h:5432/d"]
)
def test_postgres_urls_use_the_installed_driver(given):
    assert Settings(database_url=given).resolved_database_url == "postgresql+psycopg://u:p@h:5432/d"


def test_render_refuses_to_start_without_a_hosted_database(tmp_path, monkeypatch):
    # Render's disk is wiped on every restart, so SQLite there would lose everything.
    monkeypatch.setenv("RENDER", "true")
    with pytest.raises(RuntimeError, match="APP_DATABASE_URL"):
        Settings(data_dir=tmp_path).resolved_database_url
