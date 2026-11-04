import re
from dataclasses import dataclass
from pathlib import Path

from fastapi import UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import storage
from ..config import Settings
from ..models import Annotation, Project, Screenshot, utcnow
from ..schemas import ScreenshotOut

_UNSAFE_CHARS = re.compile(r"[\x00-\x1f\x7f]")


class UploadError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass
class _Validated:
    tmp_path: Path
    info: storage.ImageInfo
    original_filename: str
    file_size: int


def sanitize_filename(name: str | None, info: storage.ImageInfo) -> str:
    base = Path((name or "").replace("\\", "/")).name
    base = _UNSAFE_CHARS.sub("", base).strip()[:255]
    return base or f"screenshot{info.extension}"


def _count_subquery():
    return (
        select(func.count(Annotation.id))
        .where(Annotation.screenshot_id == Screenshot.id)
        .correlate(Screenshot)
        .scalar_subquery()
    )


def _file_path(settings: Settings, shot: Screenshot) -> Path:
    return storage.safe_path(settings.screenshots_dir, shot.project_id, shot.filename)


def image_version(shot: Screenshot) -> str:
    """Cache key for the stored file: its random uuid stem. Ids can be reused (SQLite reuses the max id, and a
    fresh database starts at 1 again), so the image URL must change whenever the underlying file does."""
    return Path(shot.filename).stem


def _to_out(settings: Settings, shot: Screenshot, annotation_count: int) -> ScreenshotOut:
    return ScreenshotOut(
        id=shot.id,
        project_id=shot.project_id,
        original_filename=shot.original_filename,
        mime_type=shot.mime_type,
        file_size=shot.file_size,
        width=shot.width,
        height=shot.height,
        annotation_count=annotation_count,
        file_available=_file_path(settings, shot).is_file(),
        image_url=f"/api/screenshots/{shot.id}/image?v={image_version(shot)}",
        created_at=shot.created_at,
    )


def list_screenshots(db: Session, settings: Settings, project_id: int) -> list[ScreenshotOut]:
    rows = db.execute(
        select(Screenshot, _count_subquery())
        .where(Screenshot.project_id == project_id)
        .order_by(Screenshot.created_at, Screenshot.id)
    )
    return [_to_out(settings, s, c) for s, c in rows]


def get_screenshot_row(db: Session, screenshot_id: int) -> Screenshot | None:
    return db.get(Screenshot, screenshot_id)


def get_screenshot(db: Session, settings: Settings, screenshot_id: int) -> ScreenshotOut | None:
    row = db.execute(select(Screenshot, _count_subquery()).where(Screenshot.id == screenshot_id)).first()
    return _to_out(settings, *row) if row else None


def image_path(settings: Settings, shot: Screenshot) -> Path | None:
    path = _file_path(settings, shot)
    return path if path.is_file() else None


def upload_screenshots(
    db: Session, settings: Settings, project: Project, files: list[UploadFile]
) -> list[ScreenshotOut]:
    """All-or-nothing: validate every file, then move them into place and commit once."""
    validated: list[_Validated] = []
    moved: list[Path] = []
    try:
        for upload in files:
            label = upload.filename or "file"
            try:
                tmp = storage.write_temp(upload.file, settings.tmp_dir, settings.max_upload_bytes)
            except storage.FileTooLarge:
                limit_mb = settings.max_upload_bytes // (1024 * 1024)
                raise UploadError(413, f"{label} is larger than {limit_mb} MB")
            try:
                info = storage.probe_image(tmp, settings.allowed_formats, settings.max_image_pixels)
            except storage.InvalidImage as e:
                tmp.unlink(missing_ok=True)
                raise UploadError(415, f"{label}: {e}. Use PNG, JPEG, WebP or GIF.")
            validated.append(_Validated(tmp, info, sanitize_filename(upload.filename, info), tmp.stat().st_size))

        shots = []
        for v in validated:
            filename = storage.new_filename(v.info)
            dest = storage.safe_path(settings.screenshots_dir, project.id, filename)
            storage.move_into_place(v.tmp_path, dest)
            moved.append(dest)
            shot = Screenshot(
                project_id=project.id,
                filename=filename,
                original_filename=v.original_filename,
                mime_type=v.info.mime_type,
                file_size=v.file_size,
                width=v.info.width,
                height=v.info.height,
            )
            db.add(shot)
            shots.append(shot)
        project.updated_at = utcnow()
        db.commit()
    except BaseException:
        db.rollback()
        for path in moved:
            storage.remove_file(path)
        raise
    finally:
        for v in validated:
            v.tmp_path.unlink(missing_ok=True)

    return [_to_out(settings, s, 0) for s in shots]


def rename_screenshot(db: Session, settings: Settings, screenshot_id: int, name: str) -> ScreenshotOut | None:
    shot = db.get(Screenshot, screenshot_id)
    if shot is None:
        return None
    shot.original_filename = name
    db.commit()
    return get_screenshot(db, settings, screenshot_id)


def delete_screenshot(db: Session, settings: Settings, screenshot_id: int) -> bool:
    shot = db.get(Screenshot, screenshot_id)
    if shot is None:
        return False
    path = _file_path(settings, shot)
    db.get(Project, shot.project_id).updated_at = utcnow()
    db.delete(shot)
    db.commit()
    storage.remove_file(path)
    return True
