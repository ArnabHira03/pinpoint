from datetime import datetime, timezone
from typing import Annotated
from urllib.parse import urlsplit, urlunsplit

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, model_validator

# SQLite drops tzinfo on read; values are always stored as UTC.
UtcDatetime = Annotated[datetime, AfterValidator(lambda v: v if v.tzinfo else v.replace(tzinfo=timezone.utc))]

ProjectName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class ProjectCreate(BaseModel):
    name: ProjectName


class ProjectUpdate(BaseModel):
    name: ProjectName


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    created_at: UtcDatetime
    updated_at: UtcDatetime
    screenshot_count: int


DisplayName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]


class ScreenshotUpdate(BaseModel):
    original_filename: DisplayName


class ScreenshotOut(BaseModel):
    id: int
    project_id: int
    original_filename: str
    mime_type: str
    file_size: int
    width: int
    height: int
    annotation_count: int
    file_available: bool
    image_url: str
    created_at: UtcDatetime


# Normalized image coordinates: 0..1 relative to the image's width/height, never viewport pixels.
Coordinate = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]
CommentText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


class AnnotationCreate(BaseModel):
    x: Coordinate
    y: Coordinate
    comment: CommentText


class AnnotationUpdate(BaseModel):
    comment: CommentText | None = None
    x: Coordinate | None = None
    y: Coordinate | None = None

    @model_validator(mode="after")
    def _no_explicit_nulls(self):
        for name in self.model_fields_set:
            if getattr(self, name) is None:
                raise ValueError(f"{name} may be omitted but not null")
        return self


class AnnotationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    screenshot_id: int
    number: int
    x: float
    y: float
    comment: str
    created_at: UtcDatetime
    updated_at: UtcDatetime


def normalize_page_url(value: str) -> str:
    """Keep only scheme, host and path: queries and hashes can hold tokens and tracking data."""
    try:
        parts = urlsplit(value.strip())
        host = parts.hostname
    except ValueError:
        raise ValueError("must be a valid URL") from None
    if parts.scheme.lower() not in ("http", "https") or not host:
        raise ValueError("must be an http or https URL")
    # Rebuilt from the host and port alone, so any username or password is dropped.
    port = f":{parts.port}" if parts.port else ""
    return urlunsplit((parts.scheme.lower(), f"{host.lower()}{port}", parts.path or "/", "", ""))


PageUrl = Annotated[str, StringConstraints(min_length=1, max_length=2048), AfterValidator(normalize_page_url)]
ReviewName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class ReviewCreate(BaseModel):
    name: ReviewName


class ReviewJoin(BaseModel):
    share_code: Annotated[str, StringConstraints(strip_whitespace=True, to_upper=True, min_length=1, max_length=20)]


class ReviewOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    share_code: str
    created_at: UtcDatetime


class WebCommentCreate(BaseModel):
    url: PageUrl
    author_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]
    selector: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
    offset_x: Coordinate
    offset_y: Coordinate
    text_snippet: Annotated[str, StringConstraints(max_length=200)] = ""
    comment: CommentText


class WebCommentUpdate(BaseModel):
    comment: CommentText


class WebCommentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    review_id: int
    url: str
    number: int
    author_name: str
    selector: str
    offset_x: float
    offset_y: float
    text_snippet: str
    comment: str
    created_at: UtcDatetime
    updated_at: UtcDatetime
