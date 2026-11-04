import re
from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app import storage
from app.config import Settings
from app.main import create_app
from app.models import Annotation
from app.services.screenshots import sanitize_filename

from .conftest import make_image


def upload(client, project_id, *files):
    return client.post(f"/api/projects/{project_id}/screenshots", files=[("files", f) for f in files])


def stored_files(settings: Settings) -> list[str]:
    return sorted(p.name for p in settings.screenshots_dir.rglob("*") if p.is_file())


@pytest.mark.parametrize(
    "fmt,ext,mime", [("PNG", ".png", "image/png"), ("JPEG", ".jpg", "image/jpeg"), ("WEBP", ".webp", "image/webp"),
                     ("GIF", ".gif", "image/gif")]
)
def test_upload_valid_formats(client, settings, project_id, fmt, ext, mime):
    res = upload(client, project_id, (f"shot{ext}", make_image(fmt, (64, 48)), mime))
    assert res.status_code == 201
    [shot] = res.json()
    assert shot["original_filename"] == f"shot{ext}"
    assert shot["mime_type"] == mime
    assert (shot["width"], shot["height"]) == (64, 48)
    assert shot["annotation_count"] == 0
    assert shot["file_available"] is True
    assert re.fullmatch(rf"/api/screenshots/{shot['id']}/image\?v=[0-9a-f]{{32}}", shot["image_url"])
    assert "filename" not in shot and str(settings.storage_dir) not in res.text
    [name] = stored_files(settings)
    assert name.endswith(ext) and name != f"shot{ext}"


def test_format_comes_from_content_not_name_or_mime(client, settings, project_id):
    [shot] = upload(client, project_id, ("photo.jpg", make_image("PNG"), "image/jpeg")).json()
    assert shot["mime_type"] == "image/png"
    assert stored_files(settings)[0].endswith(".png")


def test_multi_file_upload(client, project_id):
    res = upload(client, project_id, ("a.png", make_image("PNG"), "image/png"),
                 ("b.jpg", make_image("JPEG"), "image/jpeg"))
    assert res.status_code == 201
    assert [s["original_filename"] for s in res.json()] == ["a.png", "b.jpg"]
    listed = client.get(f"/api/projects/{project_id}/screenshots").json()
    assert [s["original_filename"] for s in listed] == ["a.png", "b.jpg"]
    assert client.get(f"/api/projects/{project_id}").json()["screenshot_count"] == 2


@pytest.mark.parametrize(
    "name,data",
    [
        ("notes.png", b"just some text, not an image"),
        ("broken.png", make_image("PNG", (200, 200))[:120]),
        ("old.bmp", make_image("BMP")),
    ],
    ids=["spoofed-text", "truncated", "unsupported-bmp"],
)
def test_rejects_invalid_images(client, settings, project_id, name, data):
    res = upload(client, project_id, (name, data, "image/png"))
    assert res.status_code == 415
    assert name in res.json()["detail"]
    assert stored_files(settings) == []


def test_multi_file_is_all_or_nothing(client, settings, project_id):
    res = upload(client, project_id, ("good.png", make_image("PNG"), "image/png"),
                 ("bad.png", b"nope", "image/png"))
    assert res.status_code == 415
    assert client.get(f"/api/projects/{project_id}/screenshots").json() == []
    assert stored_files(settings) == []


def test_rejects_oversize(tmp_path):
    settings = Settings(data_dir=tmp_path / "d", storage_dir=tmp_path / "s", max_upload_bytes=1000)
    with TestClient(create_app(settings)) as client:
        pid = client.post("/api/projects", json={"name": "P"}).json()["id"]
        res = upload(client, pid, ("big.png", b"\x89PNG" + b"0" * 2000, "image/png"))
        assert res.status_code == 413
        assert stored_files(settings) == []


def test_rejects_too_many_pixels(tmp_path):
    settings = Settings(data_dir=tmp_path / "d", storage_dir=tmp_path / "s", max_image_pixels=100)
    with TestClient(create_app(settings)) as client:
        pid = client.post("/api/projects", json={"name": "P"}).json()["id"]
        res = upload(client, pid, ("huge.png", make_image("PNG", (20, 20)), "image/png"))
        assert res.status_code == 415


def test_upload_errors(client, project_id):
    assert upload(client, 9999, ("a.png", make_image(), "image/png")).status_code == 404
    assert client.post(f"/api/projects/{project_id}/screenshots").status_code == 422


def test_get_and_image(client, project_id):
    data = make_image("PNG")
    [shot] = upload(client, project_id, ("a.png", data, "image/png")).json()
    assert client.get(f"/api/screenshots/{shot['id']}").json() == shot

    res = client.get(shot["image_url"])
    assert res.status_code == 200
    assert res.content == data
    assert res.headers["content-type"] == "image/png"
    assert "immutable" in res.headers["cache-control"]

    bare = client.get(f"/api/screenshots/{shot['id']}/image")
    assert bare.content == data
    assert bare.headers["cache-control"] == "no-cache"
    assert client.get(f"/api/screenshots/{shot['id']}/image?v=deadbeef").status_code == 404

    assert client.get("/api/screenshots/9999").status_code == 404
    assert client.get("/api/screenshots/9999/image").status_code == 404
    assert client.get("/api/projects/9999/screenshots").status_code == 404


def test_reused_id_gets_a_new_image_url(client, project_id):
    """Regression: a new upload that reuses a deleted screenshot's id must not hit the old image's cache entry."""
    old_bytes, new_bytes = make_image("PNG", (10, 10)), make_image("JPEG", (20, 30))
    [old] = upload(client, project_id, ("old.png", old_bytes, "image/png")).json()
    assert client.delete(f"/api/screenshots/{old['id']}").status_code == 204
    [new] = upload(client, project_id, ("new.jpg", new_bytes, "image/jpeg")).json()

    assert new["id"] == old["id"]  # SQLite reuses the max rowid
    assert new["image_url"] != old["image_url"]
    assert client.get(new["image_url"]).content == new_bytes
    assert client.get(old["image_url"]).status_code == 404


def test_missing_file_is_reported_and_still_deletable(client, settings, project_id):
    [shot] = upload(client, project_id, ("a.png", make_image(), "image/png")).json()
    next(settings.screenshots_dir.rglob("*.png")).unlink()

    assert client.get(f"/api/screenshots/{shot['id']}").json()["file_available"] is False
    assert client.get(shot["image_url"]).status_code == 404
    assert client.delete(f"/api/screenshots/{shot['id']}").status_code == 204


def test_rename(client, project_id):
    [shot] = upload(client, project_id, ("a.png", make_image(), "image/png")).json()
    res = client.patch(f"/api/screenshots/{shot['id']}", json={"original_filename": "  Home  "})
    assert res.json()["original_filename"] == "Home"
    assert client.patch(f"/api/screenshots/{shot['id']}", json={"original_filename": ""}).status_code == 422
    assert client.patch("/api/screenshots/9999", json={"original_filename": "x"}).status_code == 404


def test_delete_screenshot_removes_row_annotations_and_file(client, settings, project_id):
    [shot, other] = upload(client, project_id, ("a.png", make_image(), "image/png"),
                           ("b.png", make_image(), "image/png")).json()
    with client.app.state.session_factory() as db:
        db.add(Annotation(screenshot_id=shot["id"], number=1, x=0.5, y=0.5, comment="hi"))
        db.commit()
    before = client.get(f"/api/projects/{project_id}").json()["updated_at"]

    assert client.delete(f"/api/screenshots/{shot['id']}").status_code == 204
    assert client.get(f"/api/screenshots/{shot['id']}").status_code == 404
    assert len(stored_files(settings)) == 1
    with client.app.state.engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM annotations")).scalar() == 0
    assert datetime.fromisoformat(client.get(f"/api/projects/{project_id}").json()["updated_at"]) > \
        datetime.fromisoformat(before)
    assert client.get(f"/api/screenshots/{other['id']}").status_code == 200
    assert client.delete(f"/api/screenshots/{shot['id']}").status_code == 404


def test_project_delete_removes_screenshots_and_dir(client, settings, project_id):
    upload(client, project_id, ("a.png", make_image(), "image/png"))
    pdir = settings.screenshots_dir / str(project_id)
    assert pdir.is_dir()
    assert client.delete(f"/api/projects/{project_id}").status_code == 204
    assert not pdir.exists()
    with client.app.state.engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM screenshots")).scalar() == 0


def test_startup_sweeps_orphans_and_tmp(tmp_path):
    settings = Settings(data_dir=tmp_path / "d", storage_dir=tmp_path / "s")
    with TestClient(create_app(settings)) as client:
        pid = client.post("/api/projects", json={"name": "P"}).json()["id"]
        [shot] = upload(client, pid, ("a.png", make_image(), "image/png")).json()
    kept = stored_files(settings)
    (settings.screenshots_dir / str(pid) / "orphan.png").write_bytes(b"x")
    (settings.screenshots_dir / "777").mkdir()
    (settings.screenshots_dir / "777" / "gone.png").write_bytes(b"x")
    (settings.tmp_dir / "half.part").write_bytes(b"x")

    with TestClient(create_app(settings)) as client:
        assert client.get(f"/api/screenshots/{shot['id']}").json()["file_available"] is True
    assert stored_files(settings) == kept
    assert not (settings.screenshots_dir / "777").exists()
    assert list(settings.tmp_dir.iterdir()) == []


@pytest.mark.parametrize("bad", ["../x.png", "../../etc/passwd", "/etc/passwd", "..", ""])
def test_safe_path_rejects_traversal(tmp_path, bad):
    with pytest.raises(ValueError):
        storage.safe_path(tmp_path, 1, bad)


def test_safe_path_accepts_stored_name(tmp_path):
    assert storage.safe_path(tmp_path, 3, "abc.png") == (tmp_path / "3" / "abc.png").resolve()


@pytest.mark.parametrize(
    "raw,expected",
    [("../../evil.png", "evil.png"), ("C:\\Users\\me\\shot.png", "shot.png"), ("a\x00b.png", "ab.png"),
     ("", "screenshot.png"), (None, "screenshot.png")],
)
def test_sanitize_filename(raw, expected):
    info = storage.ImageInfo("PNG", 1, 1)
    assert sanitize_filename(raw, info) == expected
