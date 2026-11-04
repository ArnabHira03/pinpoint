to run:

backend-
cd ~/Desktop/Dev/markdrop_v2/backend
source .venv/bin/activate
pip install -r requirements.txt   # only needed if dependencies are missing
uvicorn app.main:app --reload --port 8000

frontend- 
cd ~/Desktop/Dev/markdrop_v2/frontend
npm install   # only needed if dependencies are missing
npm run dev