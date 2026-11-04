import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError


def test_health(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_startup_creates_dirs(client, settings):
    assert (settings.data_dir / "app.db").exists()
    assert (settings.storage_dir / "screenshots").is_dir()
    assert (settings.storage_dir / "tmp").is_dir()


def test_foreign_keys_pragma_on(client):
    with client.app.state.engine.connect() as conn:
        assert conn.execute(text("PRAGMA foreign_keys")).scalar() == 1


def test_foreign_key_enforced(client):
    with client.app.state.engine.connect() as conn:
        with pytest.raises(IntegrityError):
            conn.execute(
                text(
                    "INSERT INTO annotations (screenshot_id, number, x, y, comment, created_at, updated_at) "
                    "VALUES (999, 1, 0.5, 0.5, 'hi', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
            )
