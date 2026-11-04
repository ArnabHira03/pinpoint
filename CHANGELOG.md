# Changelog

Each version below is a tagged snapshot. The history was reconstructed from saved version snapshots, so commit dates don't reflect original development dates.

## [0.5.2]: V5, live updates and pilot kit

### Added
- Comments refresh every 5 seconds while comment mode is open in a visible tab. Refreshes wait while a comment is being edited or a delete is being confirmed.
- The panel lists the review's other pages with links.
- Pilot kit in `pilot/`: install guide for Windows, Mac and Linux, invite template, findings log.
- `pinpoint-0.5.2.zip` download (extension and install guide) attached to the v0.5.2 release.
- README, architecture and testing docs, MIT license.

### Changed
- The extension points at the hosted API.

## [0.5.0]: V5, private member keys and hosting

### Added
- Private member keys: joining with a share code gives the browser a random key, and the server stores only its SHA-256 hash.
- Review owners and permission checks on every route.
- Postgres support, chosen by `APP_DATABASE_URL`, with SQLite for local runs. The server refuses to start on Render without it.
- Notice and longer wait while a sleeping host wakes up.
- `backend/scripts/backup.sh` for manual database backups.

### Removed
- Screenshot routes, tables and tests, and the V2 web frontend.
- Cross-origin access from the backend.

### Security
- Members can edit or delete only their own comments. Owners can also delete any comment, delete the review, and see or replace the share code.
- Row level security is turned on for every table at startup, so Supabase's automatic Data API can't read them.
- API docs are turned off when a hosted database is configured.

### Known limitations
- No rate limits. Members can't be removed, display names are unverified, and keys can't be recovered.

## [0.4.0]: V4, shared backend and reviews

### Added
- Backend for reviews, pages and web comments, built on the V2 backend. Screenshot tables are unchanged.
- Extension popup to create or join a review with a share code and a display name.
- Readable offline errors that keep the typed comment.

### Changed
- Comments are saved through the API instead of `chrome.storage.local`. Requests go only through the service worker, and `host_permissions` cover only the API address.
- Click offsets are clamped to 0..1 and comments are limited to 2000 characters, matching the API.

### Known limitations
- No access control: anyone with a share code can change any comment. Runs on localhost only.

## [0.3.0]: V3, Chrome extension on live pages

### Added
- Chrome Manifest V3 extension in plain JavaScript, injected on click with `activeTab` + `scripting`.
- Comment mode with a transparent layer, so the page never receives the click.
- Shadow DOM overlay, numbered pins, and a comment panel with edit, delete, click-to-jump and Hide.
- Pins anchored by selector, offsets and text snippet, with "may have moved", hidden and detached states. Repositioned on scroll, resize and page changes.
- Comments saved per page (origin + path) in `chrome.storage.local`. Pin numbers are not reused.

### Removed
- The screenshot web app (backend and frontend). It returns as the base of the V4 backend.

## [0.2.0]: V2, structured screenshot app

### Added
- Backend split into API and service layers, with settings, models and schemas.
- Rename and edit routes, input validation and error handling.
- Pin numbers are never reused after a delete.
- Zoom, and pin and comment selection kept in sync.
- Backend (pytest) and frontend (Vitest) tests, and a GitHub Actions CI config.

### Changed
- Frontend reorganized into components, hooks, pages and services.

## [0.1.0]: V1, screenshot prototype

### Added
- Projects, screenshot upload, numbered pins and comments (add and delete).
- FastAPI + SQLite backend in `main.py` and `db.py`, with API tests.
- React + TypeScript frontend (Vite).

[0.5.2]: ../../tree/v0.5.2
[0.5.0]: ../../tree/v0.5.0
[0.4.0]: ../../tree/v0.4.0
[0.3.0]: ../../tree/v0.3.0
[0.2.0]: ../../tree/v0.2.0
[0.1.0]: ../../tree/v0.1.0
