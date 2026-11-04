# Pinpoint

Drop numbered comment pins on any live web page, and review it together.

Pinpoint is a Chrome extension (Manifest V3) with a small FastAPI backend. One person opens a website, clicks the toolbar icon, clicks a spot on the page to drop a numbered pin, and writes a comment. Other people invited to the review open the same page and see the pins and comments.

**Status:** v0.5.2, in a private pilot with invited reviewers. The extension is shared directly as a zip and loaded with Developer mode. It is not published in any web store.

## Features

- **Pins on live pages.** Comment mode covers the page with a transparent layer, so clicks drop pins instead of following links. The overlay lives in a Shadow DOM, so the site's styles and the extension's styles don't affect each other.
- **Pins that stay in place.** Each pin is anchored to the element that was clicked (CSS selector, relative offset, and a short text snippet), not to screen coordinates. When the page changes, a pin is marked *may have moved*, hidden while its element is hidden, or listed as *detached* when the element is gone. Comments are never silently deleted.
- **Invite-only reviews.** The owner creates a review and shares its code. Joining gives that browser a random private member key. The server stores only its hash.
- **Permissions.** Members read and add comments and edit or delete their own. Owners can also delete any comment, delete the review, and see or replace the share code.
- **Live updates.** While comment mode is open in a visible tab, comments refresh every 5 seconds.
- **Multi-page reviews.** The panel links to the review's other pages.
- **Minimal permissions.** `activeTab`, `scripting` and `storage`, plus host access to the API address only. API calls go through the extension's service worker, never from the page.

## Architecture

```
 web page ──(content script + Shadow DOM overlay)──┐
                                                   │ chrome.runtime messages
 popup (create / join review) ─────────────────────┤
                                                   ▼
                                     service worker (background.js)
                                                   │ HTTPS + member key
                                                   ▼
                              FastAPI backend (Render)  ──►  Postgres (Supabase)
                                                             or SQLite locally
```

See [docs/architecture.md](docs/architecture.md) for the details.

| Part | Stack |
| --- | --- |
| Extension | Plain JavaScript, Chrome Manifest V3, no build step |
| Backend | Python, FastAPI, SQLAlchemy 2, Pydantic |
| Database | SQLite (local) or Postgres via psycopg 3 (hosted) |
| Hosting | Render (API) and Supabase (Postgres), both on free plans |

## Repository layout

```
backend/     FastAPI app (app/), tests (tests/), scripts/backup.sh
extension/   The Chrome extension: manifest, service worker, content script, popup
pilot/       Reviewer install guide, invite template, pilot findings
docs/        Architecture and testing notes
```

## Getting started

### Install the extension

**Download:** get `pinpoint-0.5.2.zip` from the [v0.5.2 release](../../releases/tag/v0.5.2). The zip holds the extension and `INSTALL.txt`. Unzip it and follow `INSTALL.txt`, or load from source:

1. Open `chrome://extensions` (or `brave://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `extension/` folder (or the unzipped `pinpoint` folder).
3. Click the Pinpoint icon, enter your name, and create a review, or join one with a share code.
4. Open a website, click the icon, then **Comment on this page**.

Reviewers who receive the zip can follow [pilot/INSTALL.txt](pilot/INSTALL.txt).

The extension talks to the hosted API set in `extension/background.js` (`API`) and `extension/manifest.json` (`host_permissions`). To use a local backend, change both to `http://localhost:8000`.

### Run the backend locally

Requires Python 3.11 or newer.

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000
```

Without `APP_DATABASE_URL`, data is stored in SQLite at `backend/data/app.db`. Interactive API docs are at `http://localhost:8000/docs`. They are turned off when a hosted database is configured.

### Configuration

| Variable | Meaning |
| --- | --- |
| `APP_DATABASE_URL` | Postgres address, e.g. `postgresql://USER:PASSWORD@HOST:5432/postgres`. Empty means local SQLite. Required on Render. |
| `TEST_DATABASE_URL` | Optional. Runs the tests against Postgres. **Its public schema is wiped**, so never point it at real data. |

Never commit a real database address. It gives full access to the data.

### Deploy (free plans)

- **Supabase:** create a project and copy the *Session pooler* address (port 5432).
- **Render:** create a Web Service from this repo with the following settings:
  - Root directory: `backend`
  - Build command: `pip install -r requirements.txt`
  - Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
  - Health check path: `/api/health`
  - Environment: `APP_DATABASE_URL`

The free Render service sleeps after 15 idle minutes, and the next request takes about a minute while it wakes. The extension waits for it. A Supabase project pauses after a week without activity. Supabase's free plan has no backups, so run `backend/scripts/backup.sh` regularly.

## Tests

```bash
cd backend
python -m pytest
```

See [docs/testing.md](docs/testing.md) for coverage and gaps.

## How it evolved

Pinpoint was built in five versions, each a complete, runnable snapshot. Each version is a tagged commit in this repository, so you can browse the code exactly as it was:

| Version | Tag | What it proved |
| --- | --- | --- |
| V1 | [`v0.1.0`](../../tree/v0.1.0) | The core loop (projects, screenshot upload, numbered pins, comments) as a FastAPI + React prototype |
| V2 | [`v0.2.0`](../../tree/v0.2.0) | The same loop as a structured app: layered API, editing, validation, never-reused pin numbers, test suites, CI |
| V3 | [`v0.3.0`](../../tree/v0.3.0) | Pins on **live websites** instead of images: a Chrome extension with element anchoring, one user, saved in the browser |
| V4 | [`v0.4.0`](../../tree/v0.4.0) | Shared comments: the V2 backend comes back with reviews, share codes and display names, reached through the service worker |
| V5 | [`v0.5.0`](../../tree/v0.5.0), [`v0.5.2`](../../tree/v0.5.2) | Real people on other computers: private member keys, permissions, Postgres hosting, live updates |

See [CHANGELOG.md](CHANGELOG.md) for the changes in each version.

> The Git history was reconstructed on 2026-11-04 from the saved snapshot of each version. Commit dates are the reconstruction date, not the original development dates. The V5 commits replay the originally pushed commits, which their messages name.

## Known limitations

- Each reviewer must load the extension with Developer mode, and updates are manual.
- `activeTab` access is temporary, so after loading a page you click the icon and **Comment on this page** again.
- Member keys belong to one browser and can't be recovered. A reinstall means joining again as a new member.
- Display names are not verified. Members can't be removed yet, and a new share code only stops new joins.
- There are no rate limits yet.
- Pin selectors follow page structure. Reordered content can move a pin, which is flagged only when the element's text changes.
- Single-page apps that change the URL without a reload, scrolling containers, and cross-origin iframes are not fully supported yet.
- Pages that differ only by query string or hash share one set of comments.

## License

[MIT](LICENSE)
