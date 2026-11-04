import io
import os
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from db import Annotation, Project, Screenshot, make_engine, now

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
# Pillow format -> (extension, mime type). The client's filename/MIME are never trusted.
ALLOWED_FORMATS = {
    "PNG": (".png", "image/png"),
    "JPEG": (".jpg", "image/jpeg"),
    "WEBP": (".webp", "image/webp"),
    "GIF": (".gif", "image/gif"),
}


# ---------- schemas ----------

class ProjectIn(BaseModel):
    name: str = Field(max_length=100)

    @field_validator("name")
    @classmethod
    def not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name must not be empty")
        return v


class ProjectOut(BaseModel):
    id: int
    name: str
    created_at: datetime
    updated_at: datetime
    screenshot_count: int


class ScreenshotOut(BaseModel):
    id: int
    project_id: int
    original_filename: str
    mime_type: str
    file_size: int
    created_at: datetime
    annotation_count: int
    image_url: str


class AnnotationIn(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    comment: str = Field(max_length=2000)

    @field_validator("comment")
    @classmethod
    def not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("comment must not be empty")
        return v


class AnnotationOut(BaseModel):
    id: int
    screenshot_id: int
    number: int
    x: float
    y: float
    comment: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ---------- app ----------

def create_app(data_dir: Path | None = None) -> FastAPI:
    data_dir = Path(data_dir or os.environ.get("APP_DATA_DIR", Path(__file__).parent / "data"))
    storage_dir = data_dir / "storage"
    storage_dir.mkdir(parents=True, exist_ok=True)

    engine = make_engine(str(data_dir / "app.db"))
    SessionLocal = sessionmaker(engine, expire_on_commit=False)

    app = FastAPI(title="Screenshot Annotator")
    app.state.engine = engine
    app.state.storage_dir = storage_dir

    def get_db():
        with SessionLocal() as db:
            yield db

    def file_path(filename: str) -> Path:
        path = (storage_dir / filename).resolve()
        if not path.is_relative_to(storage_dir.resolve()):
            raise HTTPException(404, "File not found")
        return path

    def remove_files(filenames: list[str]) -> None:
        # Called only after the DB commit, so a failure here leaves an orphan file, not a broken row.
        for name in filenames:
            file_path(name).unlink(missing_ok=True)

    def get_or_404(db: Session, model, obj_id: int):
        obj = db.get(model, obj_id)
        if obj is None:
            raise HTTPException(404, f"{model.__name__} not found")
        return obj

    def project_out(db: Session, p: Project) -> ProjectOut:
        count = db.scalar(select(func.count()).where(Screenshot.project_id == p.id))
        return ProjectOut(id=p.id, name=p.name, created_at=p.created_at,
                          updated_at=p.updated_at, screenshot_count=count)

    def screenshot_out(db: Session, s: Screenshot) -> ScreenshotOut:
        count = db.scalar(select(func.count()).where(Annotation.screenshot_id == s.id))
        return ScreenshotOut(id=s.id, project_id=s.project_id, original_filename=s.original_filename,
                             mime_type=s.mime_type, file_size=s.file_size, created_at=s.created_at,
                             annotation_count=count, image_url=f"/api/screenshots/{s.id}/image")

    # --- projects ---

    @app.get("/api/projects", response_model=list[ProjectOut])
    def list_projects(db: Session = Depends(get_db)):
        projects = db.scalars(select(Project).order_by(Project.created_at.desc())).all()
        return [project_out(db, p) for p in projects]

    @app.post("/api/projects", response_model=ProjectOut, status_code=201)
    def create_project(body: ProjectIn, db: Session = Depends(get_db)):
        p = Project(name=body.name)
        db.add(p)
        db.commit()
        return project_out(db, p)

    @app.get("/api/projects/{project_id}", response_model=ProjectOut)
    def get_project(project_id: int, db: Session = Depends(get_db)):
        return project_out(db, get_or_404(db, Project, project_id))

    @app.delete("/api/projects/{project_id}", status_code=204)
    def delete_project(project_id: int, db: Session = Depends(get_db)):
        p = get_or_404(db, Project, project_id)
        filenames = [s.filename for s in p.screenshots]
        db.delete(p)
        db.commit()
        remove_files(filenames)
        return Response(status_code=204)

    # --- screenshots ---

    @app.get("/api/projects/{project_id}/screenshots", response_model=list[ScreenshotOut])
    def list_screenshots(project_id: int, db: Session = Depends(get_db)):
        get_or_404(db, Project, project_id)
        shots = db.scalars(
            select(Screenshot).where(Screenshot.project_id == project_id).order_by(Screenshot.created_at)
        ).all()
        return [screenshot_out(db, s) for s in shots]

    @app.post("/api/projects/{project_id}/screenshots", response_model=ScreenshotOut, status_code=201)
    def upload_screenshot(project_id: int, file: UploadFile, db: Session = Depends(get_db)):
        project = get_or_404(db, Project, project_id)

        data = file.file.read(MAX_UPLOAD_BYTES + 1)
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "File is larger than 10 MB")
        try:
            with Image.open(io.BytesIO(data)) as img:
                img.verify()
                fmt = img.format
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
            fmt = None
        if fmt not in ALLOWED_FORMATS:
            raise HTTPException(415, "Upload a PNG, JPEG, WebP or GIF image")

        ext, mime = ALLOWED_FORMATS[fmt]
        filename = uuid.uuid4().hex + ext
        path = file_path(filename)
        path.write_bytes(data)

        shot = Screenshot(project_id=project.id, filename=filename,
                          original_filename=Path(file.filename or "screenshot").name[:255],
                          mime_type=mime, file_size=len(data))
        try:
            db.add(shot)
            project.updated_at = now()
            db.commit()
        except Exception:
            db.rollback()
            path.unlink(missing_ok=True)
            raise
        return screenshot_out(db, shot)

    @app.get("/api/screenshots/{screenshot_id}", response_model=ScreenshotOut)
    def get_screenshot(screenshot_id: int, db: Session = Depends(get_db)):
        return screenshot_out(db, get_or_404(db, Screenshot, screenshot_id))

    @app.get("/api/screenshots/{screenshot_id}/image")
    def get_image(screenshot_id: int, db: Session = Depends(get_db)):
        s = get_or_404(db, Screenshot, screenshot_id)
        path = file_path(s.filename)
        if not path.is_file():
            raise HTTPException(404, "Image file is missing")
        return FileResponse(path, media_type=s.mime_type)

    @app.delete("/api/screenshots/{screenshot_id}", status_code=204)
    def delete_screenshot(screenshot_id: int, db: Session = Depends(get_db)):
        s = get_or_404(db, Screenshot, screenshot_id)
        filename = s.filename
        db.delete(s)
        db.commit()
        remove_files([filename])
        return Response(status_code=204)

    # --- annotations ---

    @app.get("/api/screenshots/{screenshot_id}/annotations", response_model=list[AnnotationOut])
    def list_annotations(screenshot_id: int, db: Session = Depends(get_db)):
        get_or_404(db, Screenshot, screenshot_id)
        return db.scalars(
            select(Annotation).where(Annotation.screenshot_id == screenshot_id).order_by(Annotation.number)
        ).all()

    @app.post("/api/screenshots/{screenshot_id}/annotations", response_model=AnnotationOut, status_code=201)
    def create_annotation(screenshot_id: int, body: AnnotationIn, db: Session = Depends(get_db)):
        get_or_404(db, Screenshot, screenshot_id)
        # Next number = highest existing + 1. Deleting a marker never renumbers the others.
        highest = db.scalar(select(func.max(Annotation.number)).where(Annotation.screenshot_id == screenshot_id))
        a = Annotation(screenshot_id=screenshot_id, number=(highest or 0) + 1,
                       x=body.x, y=body.y, comment=body.comment)
        db.add(a)
        db.commit()
        return a

    @app.delete("/api/annotations/{annotation_id}", status_code=204)
    def delete_annotation(annotation_id: int, db: Session = Depends(get_db)):
        db.delete(get_or_404(db, Annotation, annotation_id))
        db.commit()
        return Response(status_code=204)

    return app


app = create_app()
