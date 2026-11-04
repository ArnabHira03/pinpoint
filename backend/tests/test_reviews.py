from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import inspect, text

from app.main import create_app
from .conftest import ON_POSTGRES

URL = "https://example.com/pricing"


def auth(person: dict) -> dict:
    return {"Authorization": f"Bearer {person['member_key']}"}


def new_review(client, name="Site review", display_name="Olu") -> dict:
    res = client.post("/api/reviews", json={"name": name, "display_name": display_name})
    assert res.status_code == 201
    return res.json()


def join(client, owner: dict, display_name="Asha") -> dict:
    res = client.post("/api/reviews/join", json={"share_code": owner["share_code"], "display_name": display_name})
    assert res.status_code == 200
    return res.json()


@pytest.fixture
def owner(client) -> dict:
    return new_review(client)


@pytest.fixture
def member(client, owner) -> dict:
    return join(client, owner)


@pytest.fixture
def outsider(client) -> dict:
    return new_review(client, "Someone else's", "Eve")


def payload(**overrides) -> dict:
    return {
        "url": URL,
        "selector": "main > h2:nth-of-type(1)",
        "offset_x": 0.25,
        "offset_y": 0.75,
        "text_snippet": "Simple pricing",
        "comment": "Fix this",
    } | overrides


def create(client, person, **overrides):
    return client.post(f"/api/reviews/{person['id']}/comments", json=payload(**overrides), headers=auth(person))


def listed(client, person, url=URL):
    return client.get(f"/api/reviews/{person['id']}/comments", params={"url": url}, headers=auth(person))


def numbers(client, person, url=URL):
    return [c["number"] for c in listed(client, person, url).json()]


def edit(client, person, comment_id, text_="Updated"):
    return client.patch(f"/api/comments/{comment_id}", json={"comment": text_}, headers=auth(person))


def remove(client, person, comment_id):
    return client.delete(f"/api/comments/{comment_id}", headers=auth(person))


# Access: every route.

PUBLIC_ROUTES = {("GET", "/api/health"), ("POST", "/api/reviews"), ("POST", "/api/reviews/join")}


def protected_routes(client):
    # The schema lists routes from included routers, which app.routes doesn't flatten.
    for path, operations in client.app.openapi()["paths"].items():
        for method in operations:
            if (method.upper(), path) not in PUBLIC_ROUTES:
                yield method.upper(), path


def fill(path: str, review_id: int, comment_id: int) -> str:
    return path.replace("{review_id}", str(review_id)).replace("{comment_id}", str(comment_id))


def test_the_expected_routes_are_protected(client):
    # Forces this list, and so these checks, to be reviewed when a route is added.
    assert set(protected_routes(client)) == {
        ("GET", "/api/reviews/{review_id}"),
        ("DELETE", "/api/reviews/{review_id}"),
        ("POST", "/api/reviews/{review_id}/share-code"),
        ("GET", "/api/reviews/{review_id}/comments"),
        ("POST", "/api/reviews/{review_id}/comments"),
        ("PATCH", "/api/comments/{comment_id}"),
        ("DELETE", "/api/comments/{comment_id}"),
    }


@pytest.mark.parametrize(
    "headers",
    [{}, {"Authorization": "Bearer wrong"}, {"Authorization": "Basic abc"}, {"Authorization": "Bearer "}],
    ids=["none", "unknown", "wrong-scheme", "empty"],
)
def test_every_protected_route_rejects_a_missing_or_bad_key(client, owner, headers):
    comment_id = create(client, owner).json()["id"]
    for method, path in protected_routes(client):
        # No query or body: the key must be checked before anything else is looked at.
        res = client.request(method, fill(path, owner["id"], comment_id), headers=headers)
        assert res.status_code == 401, (method, path)
    assert numbers(client, owner) == [1]


def test_every_protected_route_hides_other_reviews(client, owner, outsider):
    comment_id = create(client, owner, comment="Private").json()["id"]
    for method, path in protected_routes(client):
        kwargs = {"headers": auth(outsider)}
        if path.endswith("/comments"):
            kwargs["params"] = {"url": URL}
            if method == "POST":
                kwargs["json"] = payload()
        if method == "PATCH":
            kwargs["json"] = {"comment": "Hacked"}
        res = client.request(method, fill(path, owner["id"], comment_id), **kwargs)
        assert res.status_code == 404, (method, path)
        assert "Private" not in res.text
    [comment] = listed(client, owner).json()
    assert comment["comment"] == "Private"


def test_a_missing_review_and_someone_elses_look_the_same(client, owner, outsider):
    theirs = client.get(f"/api/reviews/{owner['id']}", headers=auth(outsider))
    missing = client.get("/api/reviews/99999", headers=auth(outsider))
    assert (theirs.status_code, theirs.json()) == (missing.status_code, missing.json())


def test_reviews_cannot_be_listed(client, owner):
    assert client.get("/api/reviews", headers=auth(owner)).status_code == 405


def test_screenshot_routes_and_tables_are_gone(client, owner):
    for path in ("/api/projects", "/api/screenshots/1", "/api/annotations/1"):
        assert client.get(path, headers=auth(owner)).status_code == 404
    tables = set(inspect(client.app.state.engine).get_table_names())
    assert tables == {"reviews", "review_members", "review_pages", "web_comments"}


def test_other_sites_get_no_cross_origin_access(client):
    res = client.options(
        "/api/reviews/1",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"},
    )
    assert "access-control-allow-origin" not in res.headers


# Keys and joining.


def test_create_review_makes_the_owner(client):
    body = new_review(client, "  First  ", "  Olu  ")
    assert (body["name"], body["display_name"], body["role"]) == ("First", "Olu", "owner")
    assert body["share_code"] and body["member_key"]


@pytest.mark.parametrize(
    "data",
    [
        {"name": "", "display_name": "A"},
        {"name": "   ", "display_name": "A"},
        {"name": "x" * 101, "display_name": "A"},
        {"name": "R"},
        {"name": "R", "display_name": "   "},
        {"name": "R", "display_name": "x" * 51},
    ],
)
def test_create_review_validation(client, data):
    assert client.post("/api/reviews", json=data).status_code == 422


def test_keys_are_not_stored_in_plain_text(client, owner, member):
    with client.app.state.session_factory() as db:
        stored = db.execute(text("SELECT key_hash FROM review_members")).scalars().all()
    assert len(stored) == 2
    for person in (owner, member):
        assert person["member_key"] not in stored
    if ON_POSTGRES:
        return  # The whole-file check below only works on SQLite.
    with open(client.app.state.settings.data_dir / "app.db", "rb") as database:
        contents = database.read()
    assert owner["member_key"].encode() not in contents
    assert member["member_key"].encode() not in contents


def test_keys_are_returned_only_when_created(client, owner, member):
    for person in (owner, member):
        assert "member_key" not in client.get(f"/api/reviews/{person['id']}", headers=auth(person)).json()


def test_each_join_gets_its_own_key(client, owner):
    assert join(client, owner)["member_key"] != join(client, owner)["member_key"]


def test_reviews_get_distinct_readable_share_codes(client):
    codes = [new_review(client, f"R{i}")["share_code"] for i in range(20)]
    assert len(set(codes)) == 20
    assert all(len(code) == 8 and not set(code) & set("01OI") for code in codes)


def test_join_by_share_code(client, owner):
    for typed in (owner["share_code"], f"  {owner['share_code'].lower()} "):
        res = client.post("/api/reviews/join", json={"share_code": typed, "display_name": " Asha "})
        assert res.status_code == 200
        body = res.json()
        assert (body["id"], body["role"], body["display_name"]) == (owner["id"], "member", "Asha")
        assert body["share_code"] is None


@pytest.mark.parametrize(
    "share_code, display_name, expected",
    [("NOPE2345", "A", 404), ("", "A", 422), ("   ", "A", 422), ("x" * 21, "A", 422), ("NOPE2345", "  ", 422)],
)
def test_join_rejects_bad_requests(client, owner, share_code, display_name, expected):
    res = client.post("/api/reviews/join", json={"share_code": share_code, "display_name": display_name})
    assert res.status_code == expected


def test_only_the_owner_sees_the_share_code(client, owner, member):
    assert client.get(f"/api/reviews/{owner['id']}", headers=auth(owner)).json()["share_code"] == owner["share_code"]
    assert client.get(f"/api/reviews/{owner['id']}", headers=auth(member)).json()["share_code"] is None


def test_replacing_the_code_stops_the_old_one_but_keeps_members(client, owner, member):
    res = client.post(f"/api/reviews/{owner['id']}/share-code", headers=auth(owner))
    assert res.status_code == 200
    code = res.json()["share_code"]
    assert code != owner["share_code"]
    old = client.post("/api/reviews/join", json={"share_code": owner["share_code"], "display_name": "Late"})
    assert old.status_code == 404
    assert client.post("/api/reviews/join", json={"share_code": code, "display_name": "Late"}).status_code == 200
    assert create(client, member).status_code == 201


def test_member_cannot_replace_the_code_or_delete_the_review(client, owner, member):
    assert client.post(f"/api/reviews/{owner['id']}/share-code", headers=auth(member)).status_code == 403
    assert client.delete(f"/api/reviews/{owner['id']}", headers=auth(member)).status_code == 403
    assert client.get(f"/api/reviews/{owner['id']}", headers=auth(owner)).status_code == 200


# Comment permissions.


def test_members_see_each_others_comments(client, owner, member):
    create(client, owner, comment="From owner")
    create(client, member, comment="From member")
    for person in (owner, member):
        assert [c["comment"] for c in listed(client, person).json()] == ["From owner", "From member"]


def test_member_cannot_edit_or_delete_anothers_comment(client, owner, member):
    comment_id = create(client, owner).json()["id"]
    assert edit(client, member, comment_id).status_code == 403
    assert remove(client, member, comment_id).status_code == 403
    assert listed(client, owner).json()[0]["comment"] == "Fix this"


def test_member_can_edit_and_delete_their_own(client, member):
    comment_id = create(client, member).json()["id"]
    assert edit(client, member, comment_id).json()["comment"] == "Updated"
    assert remove(client, member, comment_id).status_code == 204


def test_owner_can_delete_any_comment_but_not_edit_its_text(client, owner, member):
    comment_id = create(client, member).json()["id"]
    assert edit(client, owner, comment_id).status_code == 403
    assert listed(client, member).json()[0]["comment"] == "Fix this"
    assert remove(client, owner, comment_id).status_code == 204


def test_responses_say_what_this_person_may_do(client, owner, member):
    create(client, member)
    flags = lambda person: [(c["can_edit"], c["can_delete"]) for c in listed(client, person).json()]
    assert flags(member) == [(True, True)]
    assert flags(owner) == [(False, True)]
    assert (lambda c: (c["can_edit"], c["can_delete"]))(create(client, owner).json()) == (True, True)
    assert flags(member) == [(True, True), (False, False)]


def test_author_comes_from_the_member_not_the_request(client, member):
    body = create(client, member, author_name="Someone Else").json()
    assert body["author_name"] == "Asha"
    assert edit(client, member, body["id"]).json()["author_name"] == "Asha"


# Comments, as in V4.


def test_comment_create_and_list(client, owner):
    res = create(client, owner, comment="  Button is misaligned  ")
    assert res.status_code == 201
    body = res.json()
    assert body["number"] == 1
    assert body["author_name"] == "Olu"
    assert body["review_id"] == owner["id"]
    assert body["url"] == URL
    assert body["selector"] == "main > h2:nth-of-type(1)"
    assert (body["offset_x"], body["offset_y"]) == (0.25, 0.75)
    assert body["text_snippet"] == "Simple pricing"
    assert body["comment"] == "Button is misaligned"
    assert listed(client, owner).json() == [body]


def test_snippet_is_optional(client, owner):
    data = payload()
    del data["text_snippet"]
    res = client.post(f"/api/reviews/{owner['id']}/comments", json=data, headers=auth(owner))
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
def test_comment_validation(client, owner, overrides):
    assert create(client, owner, **overrides).status_code == 422


def test_non_finite_offset_rejected(client, owner):
    res = client.post(
        f"/api/reviews/{owner['id']}/comments",
        content='{"url": "https://a.com/", "selector": "p", "offset_x": NaN, "offset_y": 0, "comment": "a"}',
        headers={"Content-Type": "application/json", **auth(owner)},
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
def test_url_is_reduced_to_origin_and_path(client, owner, raw, stored):
    assert create(client, owner, url=raw).json()["url"] == stored
    assert listed(client, owner, raw).json()[0]["url"] == stored


def test_secret_url_parts_are_never_stored(client, owner):
    create(client, owner, url="https://user:pass@example.com/a?token=secret#h")
    body = str(listed(client, owner, "https://example.com/a").json())
    assert "secret" not in body
    assert "pass" not in body


def test_list_requires_valid_url(client, owner):
    assert client.get(f"/api/reviews/{owner['id']}/comments", headers=auth(owner)).status_code == 422
    assert listed(client, owner, "file:///etc/passwd").status_code == 422


def test_unknown_page_lists_empty(client, owner):
    assert listed(client, owner, "https://nothing.example/").json() == []


def test_comments_are_separate_per_page_and_review(client, owner, outsider):
    create(client, owner)
    create(client, owner)
    create(client, owner, url="https://example.com/about")
    create(client, outsider)
    assert numbers(client, owner) == [1, 2]
    assert numbers(client, owner, "https://example.com/about") == [1]
    assert numbers(client, outsider) == [1]


def test_numbers_never_reused(client, owner):
    ids = [create(client, owner).json()["id"] for _ in range(3)]
    assert remove(client, owner, ids[1]).status_code == 204
    assert numbers(client, owner) == [1, 3]
    assert create(client, owner).json()["number"] == 4


def test_numbers_not_reused_after_every_comment_deleted(client, owner):
    ids = [create(client, owner).json()["id"] for _ in range(2)]
    for comment_id in ids:
        remove(client, owner, comment_id)
    assert listed(client, owner).json() == []
    assert create(client, owner).json()["number"] == 3


def test_edit_comment(client, owner):
    created = create(client, owner).json()
    res = edit(client, owner, created["id"], " Updated ")
    assert res.status_code == 200
    body = res.json()
    assert body["comment"] == "Updated"
    assert body["updated_at"] >= created["updated_at"]
    assert (body["number"], body["selector"], body["url"]) == (1, created["selector"], URL)
    assert listed(client, owner).json() == [body]


@pytest.mark.parametrize("data", [{}, {"comment": ""}, {"comment": "   "}, {"comment": None}, {"comment": "x" * 2001}])
def test_edit_validation(client, owner, data):
    comment_id = create(client, owner).json()["id"]
    assert client.patch(f"/api/comments/{comment_id}", json=data, headers=auth(owner)).status_code == 422
    assert listed(client, owner).json()[0]["comment"] == "Fix this"


def test_missing_comment_is_not_found(client, owner):
    assert edit(client, owner, 999).status_code == 404
    assert remove(client, owner, 999).status_code == 404


def test_delete_comment_twice(client, owner):
    comment_id = create(client, owner).json()["id"]
    assert remove(client, owner, comment_id).status_code == 204
    assert listed(client, owner).json() == []
    assert remove(client, owner, comment_id).status_code == 404


def test_deleting_review_removes_everything_and_its_keys(client, owner, member, outsider):
    create(client, owner)
    create(client, outsider)
    assert client.delete(f"/api/reviews/{owner['id']}", headers=auth(owner)).status_code == 204
    for person in (owner, member):
        assert client.get(f"/api/reviews/{owner['id']}", headers=auth(person)).status_code == 401
    assert numbers(client, outsider) == [1]
    with client.app.state.session_factory() as db:
        assert db.execute(text("SELECT COUNT(*) FROM review_pages")).scalar_one() == 1
        assert db.execute(text("SELECT COUNT(*) FROM web_comments")).scalar_one() == 1
        assert db.execute(text("SELECT COUNT(*) FROM review_members")).scalar_one() == 1


def test_comments_and_keys_survive_restart(settings):
    with TestClient(create_app(settings)) as first:
        owner = new_review(first)
        saved = create(first, owner).json()
    with TestClient(create_app(settings)) as second:
        assert listed(second, owner).json() == [saved]
        assert create(second, owner).json()["number"] == 2


@pytest.mark.skipif(not ON_POSTGRES, reason="SQLite handles one writer at a time")
def test_simultaneous_comments_get_distinct_numbers(client, owner):
    with ThreadPoolExecutor(max_workers=8) as pool:
        responses = list(pool.map(lambda _: create(client, owner), range(24)))
    assert [res.status_code for res in responses] == [201] * 24
    assert sorted(res.json()["number"] for res in responses) == list(range(1, 25))
