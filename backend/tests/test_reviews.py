import sqlite3

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import inspect, text

from app.config import Settings
from app.main import create_app

URL = "https://example.com/pricing"


@pytest.fixture
def review_id(client) -> int:
    return client.post("/api/reviews", json={"name": "Site review"}).json()["id"]


def payload(**overrides) -> dict:
    return {
        "url": URL,
        "author_name": "Asha",
        "selector": "main > h2:nth-of-type(1)",
        "offset_x": 0.25,
        "offset_y": 0.75,
        "text_snippet": "Simple pricing",
        "comment": "Fix this",
    } | overrides


def create(client, rid, **overrides):
    return client.post(f"/api/reviews/{rid}/comments", json=payload(**overrides))


def listed(client, rid, url=URL):
    return client.get(f"/api/reviews/{rid}/comments", params={"url": url})


def numbers(client, rid, url=URL):
    return [c["number"] for c in listed(client, rid, url).json()]


def test_review_create_list_get_delete(client):
    res = client.post("/api/reviews", json={"name": "  First  "})
    assert res.status_code == 201
    first = res.json()
    assert first["name"] == "First"
    second = client.post("/api/reviews", json={"name": "Second"}).json()
    assert client.get("/api/reviews").json() == [second, first]
    assert client.get(f"/api/reviews/{first['id']}").json() == first
    assert client.delete(f"/api/reviews/{first['id']}").status_code == 204
    assert client.get(f"/api/reviews/{first['id']}").status_code == 404
    assert client.delete(f"/api/reviews/{first['id']}").status_code == 404


@pytest.mark.parametrize("name", ["", "   ", "x" * 101])
def test_review_name_validation(client, name):
    assert client.post("/api/reviews", json={"name": name}).status_code == 422


def test_comment_create_and_list(client, review_id):
    res = create(client, review_id, comment="  Button is misaligned  ")
    assert res.status_code == 201
    body = res.json()
    assert body["number"] == 1
    assert body["author_name"] == "Asha"
    assert body["review_id"] == review_id
    assert body["url"] == URL
    assert body["selector"] == "main > h2:nth-of-type(1)"
    assert (body["offset_x"], body["offset_y"]) == (0.25, 0.75)
    assert body["text_snippet"] == "Simple pricing"
    assert body["comment"] == "Button is misaligned"
    assert listed(client, review_id).json() == [body]


def test_snippet_is_optional(client, review_id):
    data = payload()
    del data["text_snippet"]
    res = client.post(f"/api/reviews/{review_id}/comments", json=data)
    assert res.status_code == 201
    assert res.json()["text_snippet"] == ""


@pytest.mark.parametrize(
    "overrides",
    [
        {"comment": "   "},
        {"comment": "x" * 2001},
        {"selector": ""},
        {"selector": "x" * 4001},
        {"offset_x": 1.01},
        {"offset_y": -0.01},
        {"text_snippet": "x" * 201},
        {"author_name": ""},
        {"author_name": "   "},
        {"author_name": "x" * 51},
        {"url": ""},
        {"url": "not a url"},
        {"url": "javascript:alert(1)"},
        {"url": "file:///etc/passwd"},
        {"url": "chrome://settings"},
        {"url": "https://"},
        {"url": "https://example.com:99999/"},
        {"url": "https://example.com/" + "x" * 2048},
    ],
)
def test_comment_validation(client, review_id, overrides):
    assert create(client, review_id, **overrides).status_code == 422
    assert client.get("/api/reviews").status_code == 200


def test_non_finite_offset_rejected(client, review_id):
    res = client.post(
        f"/api/reviews/{review_id}/comments",
        content='{"url": "https://a.com/", "selector": "p", "offset_x": NaN, "offset_y": 0, "comment": "a"}',
        headers={"Content-Type": "application/json"},
    )
    assert res.status_code == 422


@pytest.mark.parametrize(
    "raw, stored",
    [
        ("https://example.com/a?token=secret#top", "https://example.com/a"),
        ("HTTPS://EXAMPLE.com/Path", "https://example.com/Path"),
        ("https://user:pass@example.com/a", "https://example.com/a"),
        ("https://example.com", "https://example.com/"),
        ("http://localhost:8080/a", "http://localhost:8080/a"),
    ],
)
def test_url_is_reduced_to_origin_and_path(client, review_id, raw, stored):
    assert create(client, review_id, url=raw).json()["url"] == stored
    assert listed(client, review_id, raw).json()[0]["url"] == stored


def test_secret_url_parts_are_never_stored(client, review_id):
    create(client, review_id, url="https://user:pass@example.com/a?token=secret#h")
    assert "secret" not in str(listed(client, review_id, "https://example.com/a").json())
    assert "pass" not in str(listed(client, review_id, "https://example.com/a").json())


def test_list_requires_valid_url(client, review_id):
    assert client.get(f"/api/reviews/{review_id}/comments").status_code == 422
    assert listed(client, review_id, "file:///etc/passwd").status_code == 422


def test_unknown_page_lists_empty(client, review_id):
    assert listed(client, review_id, "https://nothing.example/").json() == []


def test_comments_are_separate_per_page_and_review(client, review_id):
    other = client.post("/api/reviews", json={"name": "Other"}).json()["id"]
    create(client, review_id)
    create(client, review_id)
    create(client, review_id, url="https://example.com/about")
    create(client, other)
    assert numbers(client, review_id) == [1, 2]
    assert numbers(client, review_id, "https://example.com/about") == [1]
    assert numbers(client, other) == [1]


def test_numbers_never_reused(client, review_id):
    ids = [create(client, review_id).json()["id"] for _ in range(3)]
    assert client.delete(f"/api/comments/{ids[1]}").status_code == 204
    assert numbers(client, review_id) == [1, 3]
    assert create(client, review_id).json()["number"] == 4


def test_numbers_not_reused_after_every_comment_deleted(client, review_id):
    ids = [create(client, review_id).json()["id"] for _ in range(2)]
    for comment_id in ids:
        client.delete(f"/api/comments/{comment_id}")
    assert listed(client, review_id).json() == []
    assert create(client, review_id).json()["number"] == 3


def test_edit_comment(client, review_id):
    created = create(client, review_id).json()
    res = client.patch(f"/api/comments/{created['id']}", json={"comment": " Updated "})
    assert res.status_code == 200
    body = res.json()
    assert body["comment"] == "Updated"
    assert body["updated_at"] >= created["updated_at"]
    assert (body["number"], body["selector"], body["url"]) == (1, created["selector"], URL)
    assert listed(client, review_id).json() == [body]


@pytest.mark.parametrize("data", [{}, {"comment": ""}, {"comment": "   "}, {"comment": None}, {"comment": "x" * 2001}])
def test_edit_validation(client, review_id, data):
    comment_id = create(client, review_id).json()["id"]
    assert client.patch(f"/api/comments/{comment_id}", json=data).status_code == 422
    assert listed(client, review_id).json()[0]["comment"] == "Fix this"


def test_not_found(client):
    assert client.get("/api/reviews/999").status_code == 404
    assert listed(client, 999).status_code == 404
    assert create(client, 999).status_code == 404
    assert client.patch("/api/comments/999", json={"comment": "a"}).status_code == 404
    assert client.delete("/api/comments/999").status_code == 404


def test_delete_comment(client, review_id):
    comment_id = create(client, review_id).json()["id"]
    assert client.delete(f"/api/comments/{comment_id}").status_code == 204
    assert listed(client, review_id).json() == []
    assert client.delete(f"/api/comments/{comment_id}").status_code == 404


def test_deleting_review_removes_pages_and_comments(client, review_id):
    keep = client.post("/api/reviews", json={"name": "Keep"}).json()["id"]
    comment_id = create(client, review_id).json()["id"]
    create(client, keep)
    assert client.delete(f"/api/reviews/{review_id}").status_code == 204
    assert client.patch(f"/api/comments/{comment_id}", json={"comment": "a"}).status_code == 404
    assert numbers(client, keep) == [1]
    with client.app.state.session_factory() as db:
        assert db.execute(text("SELECT COUNT(*) FROM review_pages")).scalar_one() == 1
        assert db.execute(text("SELECT COUNT(*) FROM web_comments")).scalar_one() == 1


def test_comments_survive_restart(tmp_path):
    settings = Settings(data_dir=tmp_path / "d", storage_dir=tmp_path / "s")
    with TestClient(create_app(settings)) as first:
        rid = first.post("/api/reviews", json={"name": "R"}).json()["id"]
        saved = create(first, rid).json()
    with TestClient(create_app(settings)) as second:
        assert listed(second, rid).json() == [saved]
        assert create(second, rid).json()["number"] == 2


def test_screenshot_tables_are_untouched(client):
    tables = inspect(client.app.state.engine).get_table_names()
    assert {"projects", "screenshots", "annotations", "reviews", "review_pages", "web_comments"} <= set(tables)


def test_author_is_required(client, review_id):
    data = payload()
    del data["author_name"]
    assert client.post(f"/api/reviews/{review_id}/comments", json=data).status_code == 422


def test_editing_keeps_author(client, review_id):
    comment_id = create(client, review_id, author_name="  Ben  ").json()["id"]
    assert client.patch(f"/api/comments/{comment_id}", json={"comment": "New"}).json()["author_name"] == "Ben"


def test_reviews_get_distinct_readable_share_codes(client):
    codes = [client.post("/api/reviews", json={"name": f"R{i}"}).json()["share_code"] for i in range(20)]
    assert len(set(codes)) == 20
    assert all(len(code) == 8 and not set(code) & set("01OI") for code in codes)


def test_join_by_share_code(client):
    review = client.post("/api/reviews", json={"name": "Shared"}).json()
    client.post("/api/reviews", json={"name": "Other"})
    for typed in (review["share_code"], f"  {review['share_code'].lower()} "):
        res = client.post("/api/reviews/join", json={"share_code": typed})
        assert res.status_code == 200
        assert res.json() == review


@pytest.mark.parametrize("share_code, expected", [("NOPE2345", 404), ("", 422), ("   ", 422), ("x" * 21, 422)])
def test_join_rejects_bad_codes(client, share_code, expected):
    client.post("/api/reviews", json={"name": "Shared"})
    assert client.post("/api/reviews/join", json={"share_code": share_code}).status_code == expected


def test_stage_1_database_is_upgraded_without_data_loss(tmp_path):
    settings = Settings(data_dir=tmp_path / "d", storage_dir=tmp_path / "s")
    settings.data_dir.mkdir()
    db = sqlite3.connect(settings.data_dir / "app.db")
    db.executescript(
        """
        CREATE TABLE reviews (id INTEGER PRIMARY KEY, name VARCHAR(100) NOT NULL, created_at DATETIME NOT NULL);
        CREATE TABLE review_pages (id INTEGER PRIMARY KEY, review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
            url TEXT NOT NULL, next_comment_number INTEGER NOT NULL DEFAULT 1, UNIQUE (review_id, url));
        CREATE TABLE web_comments (id INTEGER PRIMARY KEY, page_id INTEGER NOT NULL REFERENCES review_pages(id) ON DELETE CASCADE,
            number INTEGER NOT NULL, selector TEXT NOT NULL, offset_x FLOAT NOT NULL, offset_y FLOAT NOT NULL,
            text_snippet TEXT NOT NULL, comment TEXT NOT NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL);
        INSERT INTO reviews VALUES (1, 'Old A', '2026-11-01 00:00:00'), (2, 'Old B', '2026-11-01 00:00:00');
        INSERT INTO review_pages VALUES (1, 1, 'https://example.com/pricing', 2);
        INSERT INTO web_comments VALUES (1, 1, 1, 'p', 0.5, 0.5, 'text', 'Old comment', '2026-11-01 00:00:00', '2026-11-01 00:00:00');
        """
    )
    db.close()
    for _ in range(2):  # The second start must leave the upgraded database alone.
        with TestClient(create_app(settings)) as client:
            reviews = client.get("/api/reviews").json()
            codes = [review["share_code"] for review in reviews]
            assert len(set(codes)) == 2 and all(codes)
            [old] = listed(client, 1).json()
            assert (old["comment"], old["author_name"], old["number"]) == ("Old comment", "", 1)
    with TestClient(create_app(settings)) as client:
        assert client.post("/api/reviews/join", json={"share_code": codes[0]}).status_code == 200
        assert create(client, 1).json()["number"] == 2
        assert client.get("/api/reviews").json()[0]["share_code"] == codes[0]
