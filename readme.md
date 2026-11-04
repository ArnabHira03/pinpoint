to run:

backend-
cd ~/Desktop/Dev/markdrop_v4/backend
source .venv/bin/activate
pip install -r requirements-dev.txt   # only needed if dependencies are missing
uvicorn app.main:app --reload --port 8000

API docs are at http://localhost:8000/docs

extension-
1. Open chrome://extensions and turn on Developer mode.
2. Turn off the V3 Pinpoint extension if it is loaded.
3. Click "Load unpacked" and choose ~/Desktop/Dev/markdrop_v4/extension
4. Click the Pinpoint icon (under the puzzle-piece menu), enter your name, and create a review.
5. Open a website, click the icon, and click "Comment on this page".

To review together: copy the share code from the popup and send it to the other person.
They enter it under "Share code" and click Join. Their comments appear when you reopen
comment mode or reload the page and click "Comment on this page" again.

Both people must reach the same backend. For now that means two browser profiles on this
computer. It runs only on localhost and has no sign-in, so don't expose it to a network.

The backend must run on port 8000. Comments are saved on the server, in backend/data/.
If the server is down, an error appears and whatever you typed stays in its box.

tests-
cd ~/Desktop/Dev/markdrop_v4/backend
.venv/bin/python -m pytest

After changing the extension code, click reload on its card and reload the website.
