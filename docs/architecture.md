# Architecture

Pinpoint has two parts: a Chrome extension that runs in each reviewer's browser, and an API that stores reviews and comments.

```
┌─────────────────────────── Browser ───────────────────────────┐
│                                                               │
│  Web page                                                     │
│   └─ content.js  (injected on click; Shadow DOM overlay,      │
│                   pins, comment panel, 5 s refresh)           │
│            │  chrome.runtime.sendMessage({action, ...})       │
│            ▼                                                  │
│  background.js (service worker) ◄── popup.html / popup.js     │
│   • fixed list of actions          (create / join review,     │
│   • holds member keys                share code)              │
│   • only place that calls the API                             │
└────────────┬──────────────────────────────────────────────────┘
             │ HTTPS, Authorization: Bearer <member key>
             ▼
   FastAPI app (backend/app) on Render
             │ SQLAlchemy
             ▼
   Postgres on Supabase (session pooler), or SQLite locally
```

## Extension (`extension/`)

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest. Permissions `activeTab`, `scripting`, `storage`. `host_permissions` cover only the API address. |
| `popup.html/js/css` | Create a review, join one with a share code, show or replace the code (owners), start comment mode on the current tab. |
| `content.js` | Injected into the current tab by the popup. Draws the overlay inside a Shadow DOM, captures clicks through a transparent layer, places pins, and shows the comment panel. |
| `background.js` | Service worker. Accepts messages only from this extension and maps them onto a fixed set of API calls. Waits up to 90 seconds for a sleeping server. |

**Why API calls happen only in the service worker:** the page can't reach the API through the extension, the page's CORS rules don't apply, and member keys never enter the page's context. User text is always rendered with `textContent`.

### Pin anchoring

A pin is stored relative to the element that was clicked, not to the viewport:

```json
{ "selector": "main > section:nth-of-type(2) > h2",
  "offsetX": 0.42, "offsetY": 0.5,
  "textSnippet": "Simple pricing" }
```

The page key is origin + path. The query string and hash are dropped, so tokens and tracking parameters are never stored. When pins are restored:

1. Find the element by `selector` and place the pin at `offsetX, offsetY` inside its box.
2. If the element's text no longer matches `textSnippet`, keep the pin and mark it **may have moved**.
3. If the element is hidden, show no pin and note it in the panel.
4. If the element is gone, list the comment as **detached**. It is never deleted.

Pins are repositioned on scroll, resize, load, transitions and DOM changes, at most once per animation frame.

## Backend (`backend/app/`)

| Module | Role |
| --- | --- |
| `main.py` | App factory, `/api/health`, validation error handler. API docs are turned off when a hosted database is configured. |
| `config.py` | Settings from `APP_*` environment variables. Picks SQLite or Postgres, and refuses SQLite on Render. |
| `database.py` | Engine and sessions. Creates tables and turns on row level security on Postgres. |
| `models.py` | `Review`, `ReviewMember`, `ReviewPage`, `WebComment`. |
| `api/reviews.py` | Routes and the bearer-key dependency. |
| `services/reviews.py` | Business rules: key hashing, membership, permissions, numbering. |

### Data model

- **Review:** name, unique 8-character share code.
- **ReviewMember:** one person's access to one review: SHA-256 hash of their random key, display name, role (`owner` or `member`).
- **ReviewPage:** a URL within a review. It keeps `next_comment_number`, so pin numbers are never reused after deletes.
- **WebComment:** number, author name, anchor (selector, offsets constrained to 0..1, text snippet), comment text.

### Routes

All routes except creating and joining a review require `Authorization: Bearer <member key>`.

| Method and path | Who |
| --- | --- |
| `POST /api/reviews` | Anyone. Creates a review and returns an owner key. |
| `POST /api/reviews/join` | Anyone with the share code. Returns a member key. |
| `GET /api/reviews/{id}` | Members |
| `POST /api/reviews/{id}/share-code` | Owner. Replaces the code. |
| `DELETE /api/reviews/{id}` | Owner |
| `GET /api/reviews/{id}/pages` | Members |
| `GET/POST /api/reviews/{id}/comments` | Members |
| `PATCH /api/comments/{id}` | Comment author |
| `DELETE /api/comments/{id}` | Comment author or owner |
| `GET /api/health` | Anyone |

## Hosting

- **Render** (free web service) runs `uvicorn app.main:app` from `backend/`. It sleeps after 15 idle minutes.
- **Supabase** (free Postgres) is reached through the session pooler. Row level security is turned on for every table, so Supabase's automatic Data API can't read them.
- **Backups:** `backend/scripts/backup.sh`, run by hand.

## What is sent to the server

Review and display names, comment text, the page URL (origin + path), and for each pin its selector, offsets and a short text snippet of the clicked element. No other page content is sent.
