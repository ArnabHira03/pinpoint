to run:

Backend:

 python3 -m venv .venv                              # first time only
 .venv/bin/pip install -r requirements.txt          # first time only
 .venv/bin/uvicorn main:app --reload


Frontend:
 npm run dev