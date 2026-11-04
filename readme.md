to run:

backend-
cd ~/Desktop/Dev/markdrop_v5/backend
source .venv/bin/activate
pip install -r requirements-dev.txt   # only needed if dependencies are missing
uvicorn app.main:app --reload --port 8000

API docs are at http://localhost:8000/docs

extension-
1. Open chrome://extensions and turn on Developer mode.
2. Turn off any older Pinpoint extension that is loaded.
3. Click "Load unpacked" and choose ~/Desktop/Dev/markdrop_v5/extension
4. Click the Pinpoint icon (under the puzzle-piece menu), enter your name, and create a review.
5. Open a website, click the icon, and click "Comment on this page".

To review together: the review's owner copies the share code from the popup and sends it to
the other person. They enter their name and the code, then click Join. Joining gives that
browser a private key, which the extension sends with every request.

Who can do what:
- Anyone in the review can read and add comments, and edit or delete their own.
- The owner can also delete any comment, see the share code, and replace it with "New code".
  A new code stops new people joining with the old one. People already in the review stay in.

Your name is fixed when you join a review. Removing the extension loses its keys: you can
rejoin with the share code, but you become a new member and can't change your old comments.

For local use, the backend must run on port 8000.
Comments are saved on the server, in backend/data/. If the server is down, an error appears
and whatever you typed stays in its box.

tests-
cd ~/Desktop/Dev/markdrop_v5/backend
.venv/bin/python -m pytest
To run them on Postgres, set TEST_DATABASE_URL. That database's public schema gets wiped, so never point it at real data.

After changing the extension code, click reload on its card and reload the website.

hosting (free plans: Render for the API, Supabase for the database)-
Supabase:
1. Create a project on the free plan and save the database password somewhere safe.
2. Open its Connect screen and copy the "Session pooler" address (port 5432).
3. Put your password in that address. If the password has symbols, use one with only letters and numbers.

Render:
1. New Web Service, connected to this project's GitHub repo, on the Free instance type.
2. Root directory: backend
3. Build command: pip install -r requirements.txt
4. Start command: uvicorn app.main:app --host 0.0.0.0 --port $PORT
5. Health check path: /api/health
6. Environment variable: APP_DATABASE_URL = the session pooler address.

Keep that address out of code, chat, and Git. It gives full access to the database.

Free-plan behaviour:
- Render sleeps after 15 idle minutes. The next request takes about a minute.
- Supabase pauses after a week of no activity. Resume it in the Supabase dashboard.

backups-
Supabase's free plan has none, so run this about once a week. It needs Podman, and asks for the session pooler address:
cd ~/Desktop/Dev/markdrop_v5/backend && scripts/backup.sh
Files go in backend/backups/ and hold every comment, so keep them private. Git ignores that folder.
To restore into an empty database:
podman run --rm -i --network host docker.io/library/postgres:17 psql "<session pooler address>" -v ON_ERROR_STOP=1 -c 'DROP SCHEMA public CASCADE' -f - < backups/<file>.sql
