import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from main import create_app


def png_bytes(size=(40, 20)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, "skyblue").save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path)) as c:
        c.storage_dir = tmp_path / "storage"
        yield c


def make_project(client, name="Demo"):
    r = client.post("/api/projects", json={"name": name})
    assert r.status_code == 201
    return r.json()


def upload(client, project_id, data=None, filename="shot.png"):
    return client.post(f"/api/projects/{project_id}/screenshots",
                       files={"file": (filename, data or png_bytes(), "image/png")})


def test_project_crud_and_validation(client):
    assert client.post("/api/projects", json={"name": "   "}).status_code == 422
    p = make_project(client, "  Website v2 ")
    assert p["name"] == "Website v2"
    assert [x["id"] for x in client.get("/api/projects").json()] == [p["id"]]
    assert client.delete(f"/api/projects/{p['id']}").status_code == 204
    assert client.get(f"/api/projects/{p['id']}").status_code == 404


def test_upload_and_fetch_image(client):
    p = make_project(client)
    r = upload(client, p["id"])
    assert r.status_code == 201
    shot = r.json()
    assert shot["mime_type"] == "image/png"
    assert "filename" not in shot  # no storage names / paths leak to the client
    img = client.get(shot["image_url"])
    assert img.status_code == 200 and img.content == png_bytes()
    assert client.get(f"/api/projects/{p['id']}").json()["screenshot_count"] == 1


def test_rejects_non_images_and_large_files(client):
    p = make_project(client)
    assert upload(client, p["id"], data=b"not really a png").status_code == 415
    too_big = b"\x89PNG" + b"0" * (10 * 1024 * 1024)
    assert upload(client, p["id"], data=too_big).status_code == 413
    assert list(client.storage_dir.iterdir()) == []


def test_annotations_numbering_and_validation(client):
    p = make_project(client)
    sid = upload(client, p["id"]).json()["id"]
    url = f"/api/screenshots/{sid}/annotations"

    assert client.post(url, json={"x": 1.5, "y": 0.5, "comment": "x"}).status_code == 422
    assert client.post(url, json={"x": 0.5, "y": 0.5, "comment": "  "}).status_code == 422

    created = [client.post(url, json={"x": 0.1 * i, "y": 0.5, "comment": f"c{i}"}).json() for i in (1, 2, 3)]
    assert [a["number"] for a in created] == [1, 2, 3]

    assert client.delete(f"/api/annotations/{created[1]['id']}").status_code == 204
    nxt = client.post(url, json={"x": 0.9, "y": 0.9, "comment": "c4"}).json()
    assert nxt["number"] == 4
    assert [a["number"] for a in client.get(url).json()] == [1, 3, 4]


def test_delete_project_removes_rows_and_files(client):
    p = make_project(client)
    sid = upload(client, p["id"]).json()["id"]
    client.post(f"/api/screenshots/{sid}/annotations", json={"x": 0.5, "y": 0.5, "comment": "hi"})
    assert len(list(client.storage_dir.iterdir())) == 1

    assert client.delete(f"/api/projects/{p['id']}").status_code == 204
    assert client.get(f"/api/screenshots/{sid}").status_code == 404
    assert client.get(f"/api/screenshots/{sid}/annotations").status_code == 404
    assert list(client.storage_dir.iterdir()) == []


def test_delete_screenshot_removes_file_and_annotations(client):
    p = make_project(client)
    sid = upload(client, p["id"]).json()["id"]
    a = client.post(f"/api/screenshots/{sid}/annotations", json={"x": 0.5, "y": 0.5, "comment": "hi"}).json()
    assert client.delete(f"/api/screenshots/{sid}").status_code == 204
    assert client.delete(f"/api/annotations/{a['id']}").status_code == 404  # cascaded away
    assert list(client.storage_dir.iterdir()) == []


def test_data_survives_restart(tmp_path):
    with TestClient(create_app(tmp_path)) as c:
        pid = make_project(c, "Persist me")["id"]
        sid = upload(c, pid).json()["id"]
        c.post(f"/api/screenshots/{sid}/annotations", json={"x": 0.25, "y": 0.75, "comment": "kept"})
        c.app.state.engine.dispose()

    with TestClient(create_app(tmp_path)) as c:  # fresh app + engine on the same files
        assert c.get(f"/api/projects/{pid}").json()["name"] == "Persist me"
        assert c.get(f"/api/screenshots/{sid}/image").status_code == 200
        [a] = c.get(f"/api/screenshots/{sid}/annotations").json()
        assert (a["x"], a["y"], a["comment"]) == (0.25, 0.75, "kept")
