from datetime import datetime

from app.config import Settings
from app.main import create_app
from app.models import Screenshot
from fastapi.testclient import TestClient


def test_create_and_list(client):
    res = client.post("/api/projects", json={"name": "  Landing page  "})
    assert res.status_code == 201
    body = res.json()
    assert body["name"] == "Landing page"
    assert body["screenshot_count"] == 0

    listed = client.get("/api/projects").json()
    assert [p["id"] for p in listed] == [body["id"]]


def test_list_orders_newest_first(client):
    a = client.post("/api/projects", json={"name": "A"}).json()
    b = client.post("/api/projects", json={"name": "B"}).json()
    assert [p["id"] for p in client.get("/api/projects").json()] == [b["id"], a["id"]]


def test_name_validation(client):
    for bad in ["", "   ", "x" * 101]:
        assert client.post("/api/projects", json={"name": bad}).status_code == 422
    assert client.post("/api/projects", json={}).status_code == 422
    assert client.post("/api/projects", json={"name": "x" * 100}).status_code == 201


def test_get_and_404(client):
    pid = client.post("/api/projects", json={"name": "P"}).json()["id"]
    assert client.get(f"/api/projects/{pid}").json()["name"] == "P"
    assert client.get("/api/projects/9999").status_code == 404


def test_rename(client):
    created = client.post("/api/projects", json={"name": "Old"}).json()
    res = client.patch(f"/api/projects/{created['id']}", json={"name": "New"})
    assert res.status_code == 200
    assert res.json()["name"] == "New"
    assert client.patch(f"/api/projects/{created['id']}", json={"name": " "}).status_code == 422
    assert client.patch("/api/projects/9999", json={"name": "X"}).status_code == 404


def test_screenshot_count(client):
    pid = client.post("/api/projects", json={"name": "P"}).json()["id"]
    with client.app.state.session_factory() as db:
        for i in range(2):
            db.add(Screenshot(project_id=pid, filename=f"f{i}.png", original_filename="a.png",
                              mime_type="image/png", file_size=1, width=1, height=1))
        db.commit()
    assert client.get(f"/api/projects/{pid}").json()["screenshot_count"] == 2
    assert client.get("/api/projects").json()[0]["screenshot_count"] == 2


def test_delete_removes_rows_and_dir(client, settings):
    pid = client.post("/api/projects", json={"name": "P"}).json()["id"]
    with client.app.state.session_factory() as db:
        db.add(Screenshot(project_id=pid, filename="f.png", original_filename="a.png",
                          mime_type="image/png", file_size=1, width=1, height=1))
        db.commit()
    pdir = settings.storage_dir / "screenshots" / str(pid)
    pdir.mkdir(parents=True)
    (pdir / "f.png").write_bytes(b"x")

    assert client.delete(f"/api/projects/{pid}").status_code == 204
    assert client.get(f"/api/projects/{pid}").status_code == 404
    assert not pdir.exists()
    with client.app.state.session_factory() as db:
        assert db.query(Screenshot).count() == 0
    assert client.delete(f"/api/projects/{pid}").status_code == 404


def test_persists_across_restart(tmp_path):
    settings = Settings(data_dir=tmp_path / "data", storage_dir=tmp_path / "storage")
    with TestClient(create_app(settings)) as c1:
        pid = c1.post("/api/projects", json={"name": "Survivor"}).json()["id"]
    with TestClient(create_app(settings)) as c2:
        body = c2.get(f"/api/projects/{pid}").json()
        assert body["name"] == "Survivor"
        assert datetime.fromisoformat(body["created_at"]).utcoffset() is not None
