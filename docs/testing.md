# Testing

## Backend tests

```bash
cd backend
python -m pytest
```

| File | Covers |
| --- | --- |
| `tests/test_foundation.py` | App startup, health route, database selection (SQLite, Postgres, refusal on Render), Postgres URL forms, API docs off when hosted, row level security on every table |
| `tests/test_reviews.py` | Creating and joining reviews, share codes, member keys, permissions for members, owners and non-members on every protected route, comment create/list/edit/delete, never-reused numbers, input limits, other-pages listing |

A guard test fails if the list of protected routes changes, so a new route can't skip access checks unnoticed.

**Last run (2026-11-04, Python 3.14, SQLite):** 86 passed, 2 skipped. The skipped tests run only on Postgres.

### Running on Postgres

```bash
TEST_DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/pinpoint_test python -m pytest
```

**The public schema of that database is wiped.** Use a throwaway database, never real data.

## Extension

The extension has no automated tests in this repository. Changes are checked by hand in Chrome or Brave:

1. Load `extension/` unpacked and point it at a local backend (see the README).
2. Create a review in one browser profile and join it from a second profile.
3. Drop pins, edit, delete, reload the page, and confirm the pins return to the same spot.
4. Confirm the second profile sees new comments within about 5 seconds while comment mode is open.

Pages worth checking for anchoring and overlay changes:

| Page type | Example | Watch for |
| --- | --- | --- |
| Simple static page | example.com | Baseline |
| Long article | A Wikipedia article | Pins far down the page, scrolling |
| Heavy CSS | A modern marketing site | Style leaks, covered pins |
| Single-page app, strict CSP | GitHub | URL changes without reload, blocked resources |
| Restricted pages | `chrome://` pages, Chrome Web Store | A clear error message |

## Known gaps

- No automated extension tests are checked in.
- Skipping refreshes in background tabs has not been tested automatically.
- Single-page app navigation and scrolling containers are not fully supported yet.
