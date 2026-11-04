from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Project
from ..schemas import ScreenshotOut, ScreenshotUpdate
from ..services import screenshots as service

router = APIRouter(prefix="/api", tags=["screenshots"])


def _project_or_404(db: Session, project_id: int) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _not_found() -> HTTPException:
    return HTTPException(status_code=404, detail="Screenshot not found")


@router.get("/projects/{project_id}/screenshots", response_model=list[ScreenshotOut])
def list_screenshots(project_id: int, request: Request, db: Session = Depends(get_db)):
    _project_or_404(db, project_id)
    return service.list_screenshots(db, request.app.state.settings, project_id)


@router.post(
    "/projects/{project_id}/screenshots",
    response_model=list[ScreenshotOut],
    status_code=status.HTTP_201_CREATED,
)
def upload_screenshots(
    project_id: int, request: Request, files: list[UploadFile] = File(...), db: Session = Depends(get_db)
):
    project = _project_or_404(db, project_id)
    try:
        return service.upload_screenshots(db, request.app.state.settings, project, files)
    except service.UploadError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)


@router.get("/screenshots/{screenshot_id}", response_model=ScreenshotOut)
def get_screenshot(screenshot_id: int, request: Request, db: Session = Depends(get_db)):
    shot = service.get_screenshot(db, request.app.state.settings, screenshot_id)
    if shot is None:
        raise _not_found()
    return shot


@router.get("/screenshots/{screenshot_id}/image")
def get_image(screenshot_id: int, request: Request, v: str | None = None, db: Session = Depends(get_db)):
    shot = service.get_screenshot_row(db, screenshot_id)
    if shot is None or (v is not None and v != service.image_version(shot)):
        raise _not_found()
    path = service.image_path(request.app.state.settings, shot)
    if path is None:
        raise HTTPException(status_code=404, detail="Image file missing")
    # A versioned URL names one stored file forever, so it can be cached for good. A bare id URL can point at a
    # different file later (ids get reused), so the browser must revalidate it.
    cache = "private, max-age=31536000, immutable" if v is not None else "no-cache"
    return FileResponse(path, media_type=shot.mime_type, headers={"Cache-Control": cache})


@router.patch("/screenshots/{screenshot_id}", response_model=ScreenshotOut)
def rename_screenshot(screenshot_id: int, body: ScreenshotUpdate, request: Request, db: Session = Depends(get_db)):
    shot = service.rename_screenshot(db, request.app.state.settings, screenshot_id, body.original_filename)
    if shot is None:
        raise _not_found()
    return shot


@router.delete("/screenshots/{screenshot_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_screenshot(screenshot_id: int, request: Request, db: Session = Depends(get_db)):
    if not service.delete_screenshot(db, request.app.state.settings, screenshot_id):
        raise _not_found()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
