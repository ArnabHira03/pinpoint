import logging
import os
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

from PIL import Image, UnidentifiedImageError

logger = logging.getLogger(__name__)

CHUNK_SIZE = 1024 * 1024

# Pillow format name -> (extension, mime type)
FORMATS = {
    "PNG": (".png", "image/png"),
    "JPEG": (".jpg", "image/jpeg"),
    "WEBP": (".webp", "image/webp"),
    "GIF": (".gif", "image/gif"),
}


class FileTooLarge(Exception):
    pass


class InvalidImage(Exception):
    pass


@dataclass
class ImageInfo:
    format: str
    width: int
    height: int

    @property
    def extension(self) -> str:
        return FORMATS[self.format][0]

    @property
    def mime_type(self) -> str:
        return FORMATS[self.format][1]


def project_dir(screenshots_dir: Path, project_id: int) -> Path:
    return screenshots_dir / str(project_id)


def safe_path(screenshots_dir: Path, project_id: int, filename: str) -> Path:
    """Resolve a stored file's path, refusing anything that escapes the storage root."""
    pdir = (screenshots_dir / str(project_id)).resolve()
    path = (pdir / filename).resolve()
    if path.parent != pdir:
        raise ValueError(f"Unsafe storage path: {filename!r}")
    return path


def new_filename(info: ImageInfo) -> str:
    return uuid.uuid4().hex + info.extension


def write_temp(src: BinaryIO, tmp_dir: Path, max_bytes: int) -> Path:
    """Copy an upload stream to tmp_dir in chunks, aborting once it exceeds max_bytes."""
    path = tmp_dir / f"{uuid.uuid4().hex}.part"
    written = 0
    try:
        with path.open("wb") as out:
            while chunk := src.read(CHUNK_SIZE):
                written += len(chunk)
                if written > max_bytes:
                    raise FileTooLarge
                out.write(chunk)
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return path


def probe_image(path: Path, allowed_formats: frozenset[str], max_pixels: int) -> ImageInfo:
    """Identify an image by its content (never its name or claimed MIME type)."""
    try:
        with Image.open(path) as img:
            fmt, (width, height) = img.format, img.size
            if fmt not in allowed_formats or fmt not in FORMATS:
                raise InvalidImage(f"Unsupported image format: {fmt}")
            if width * height > max_pixels:
                raise InvalidImage("Image dimensions are too large")
            img.verify()
        # verify() leaves the image unusable; reopen and decode to catch truncated data.
        with Image.open(path) as img:
            img.load()
    except InvalidImage:
        raise
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError, ValueError) as e:
        raise InvalidImage("File is not a valid image") from e
    return ImageInfo(fmt, width, height)


def move_into_place(tmp_path: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    os.replace(tmp_path, dest)


def remove_file(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        logger.exception("Failed to remove %s", path)


def remove_project_files(screenshots_dir: Path, project_id: int) -> None:
    path = project_dir(screenshots_dir, project_id)
    try:
        shutil.rmtree(path)
    except FileNotFoundError:
        pass
    except OSError:
        logger.exception("Failed to remove %s", path)


def clear_dir(path: Path) -> None:
    for child in path.iterdir():
        if child.is_dir():
            shutil.rmtree(child, ignore_errors=True)
        else:
            remove_file(child)


def sweep_orphans(screenshots_dir: Path, known: set[tuple[int, str]]) -> int:
    """Delete files under screenshots_dir with no matching (project_id, filename) row."""
    removed = 0
    for pdir in screenshots_dir.iterdir():
        if not pdir.is_dir():
            remove_file(pdir)
            removed += 1
            continue
        pid = int(pdir.name) if pdir.name.isdigit() else None
        for f in pdir.iterdir():
            if pid is None or (pid, f.name) not in known:
                if f.is_dir():
                    shutil.rmtree(f, ignore_errors=True)
                else:
                    remove_file(f)
                removed += 1
        if not any(pdir.iterdir()):
            pdir.rmdir()
    return removed
