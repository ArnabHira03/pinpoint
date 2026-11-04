import pytest

from .conftest import make_image


@pytest.fixture
def screenshot_id(client, project_id) -> int:
    res = client.post(f"/api/projects/{project_id}/screenshots", files=[("files", ("a.png", make_image(), "image/png"))])
    return res.json()[0]["id"]


def create(client, sid, x=0.5, y=0.5, comment="Fix this"):
    return client.post(f"/api/screenshots/{sid}/annotations", json={"x": x, "y": y, "comment": comment})


def numbers(client, sid):
    return [a["number"] for a in client.get(f"/api/screenshots/{sid}/annotations").json()]


def test_create_and_list(client, screenshot_id):
    res = create(client, screenshot_id, x=0.25, y=0.75, comment="  Button is misaligned  ")
    assert res.status_code == 201
    body = res.json()
    assert body["number"] == 1
    assert (body["x"], body["y"]) == (0.25, 0.75)
    assert body["comment"] == "Button is misaligned"
    assert body["screenshot_id"] == screenshot_id
    assert client.get(f"/api/screenshots/{screenshot_id}/annotations").json() == [body]


def test_bounds_are_inclusive(client, screenshot_id):
    for x, y in [(0, 0), (1, 1), (0, 1)]:
        assert create(client, screenshot_id, x=x, y=y).status_code == 201


@pytest.mark.parametrize(
    "payload",
    [
        {"x": 1.01, "y": 0.5, "comment": "a"},
        {"x": -0.01, "y": 0.5, "comment": "a"},
        {"x": 0.5, "y": 2, "comment": "a"},
        {"x": 0.5, "y": 0.5, "comment": "   "},
        {"x": 0.5, "y": 0.5, "comment": "x" * 2001},
        {"x": 0.5, "y": 0.5},
        {"x": "left", "y": 0.5, "comment": "a"},
    ],
)
def test_create_validation(client, screenshot_id, payload):
    assert client.post(f"/api/screenshots/{screenshot_id}/annotations", json=payload).status_code == 422


@pytest.mark.parametrize("raw", ["NaN", "Infinity", "-Infinity"])
def test_rejects_non_finite(client, screenshot_id, raw):
    res = client.post(
        f"/api/screenshots/{screenshot_id}/annotations",
        content=f'{{"x": {raw}, "y": 0.5, "comment": "a"}}',
        headers={"Content-Type": "application/json"},
    )
    assert res.status_code == 422
    assert res.json()["detail"][0]["loc"] == ["body", "x"]


def test_max_length_comment_accepted(client, screenshot_id):
    assert create(client, screenshot_id, comment="x" * 2000).status_code == 201


def test_numbering_is_stable_with_gaps(client, screenshot_id):
    ids = [create(client, screenshot_id).json()["id"] for _ in range(3)]
    assert numbers(client, screenshot_id) == [1, 2, 3]
    assert client.delete(f"/api/annotations/{ids[1]}").status_code == 204
    assert numbers(client, screenshot_id) == [1, 3]
    assert create(client, screenshot_id).json()["number"] == 4
    assert numbers(client, screenshot_id) == [1, 3, 4]


def test_numbering_is_per_screenshot(client, project_id, screenshot_id):
    other = client.post(
        f"/api/projects/{project_id}/screenshots", files=[("files", ("b.png", make_image(), "image/png"))]
    ).json()[0]["id"]
    create(client, screenshot_id)
    create(client, screenshot_id)
    assert create(client, other).json()["number"] == 1
    assert create(client, screenshot_id).json()["number"] == 3


def test_annotation_count_in_screenshot(client, project_id, screenshot_id):
    create(client, screenshot_id)
    create(client, screenshot_id)
    assert client.get(f"/api/screenshots/{screenshot_id}").json()["annotation_count"] == 2
    assert client.get(f"/api/projects/{project_id}/screenshots").json()[0]["annotation_count"] == 2


def test_update(client, screenshot_id):
    created = create(client, screenshot_id).json()
    res = client.patch(f"/api/annotations/{created['id']}", json={"comment": " Updated "})
    assert res.status_code == 200
    body = res.json()
    assert body["comment"] == "Updated"
    assert (body["x"], body["y"], body["number"]) == (0.5, 0.5, 1)
    assert body["updated_at"] >= created["updated_at"]

    moved = client.patch(f"/api/annotations/{created['id']}", json={"x": 0.1, "y": 0.9}).json()
    assert (moved["x"], moved["y"], moved["comment"]) == (0.1, 0.9, "Updated")


@pytest.mark.parametrize("payload", [{"comment": ""}, {"comment": None}, {"x": 1.5}, {"y": None}])
def test_update_validation(client, screenshot_id, payload):
    aid = create(client, screenshot_id).json()["id"]
    assert client.patch(f"/api/annotations/{aid}", json=payload).status_code == 422


def test_not_found(client):
    assert client.get("/api/screenshots/999/annotations").status_code == 404
    assert create(client, 999).status_code == 404
    assert client.patch("/api/annotations/999", json={"comment": "a"}).status_code == 404
    assert client.delete("/api/annotations/999").status_code == 404


def test_delete(client, screenshot_id):
    aid = create(client, screenshot_id).json()["id"]
    assert client.delete(f"/api/annotations/{aid}").status_code == 204
    assert client.get(f"/api/screenshots/{screenshot_id}/annotations").json() == []
    assert client.delete(f"/api/annotations/{aid}").status_code == 404


def test_annotations_survive_restart(tmp_path):
    from fastapi.testclient import TestClient

    from app.config import Settings
    from app.main import create_app

    settings = Settings(data_dir=tmp_path / "d", storage_dir=tmp_path / "s")
    with TestClient(create_app(settings)) as c1:
        pid = c1.post("/api/projects", json={"name": "P"}).json()["id"]
        sid = c1.post(f"/api/projects/{pid}/screenshots",
                      files=[("files", ("a.png", make_image(), "image/png"))]).json()[0]["id"]
        create(c1, sid, x=0.123456, y=0.654321, comment="Persist me")
    with TestClient(create_app(settings)) as c2:
        [a] = c2.get(f"/api/screenshots/{sid}/annotations").json()
        assert (a["x"], a["y"], a["comment"], a["number"]) == (0.123456, 0.654321, "Persist me", 1)
        assert create(c2, sid).json()["number"] == 2
