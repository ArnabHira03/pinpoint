from datetime import datetime, timezone
from typing import Annotated
from urllib.parse import urlsplit, urlunsplit

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

# SQLite drops tzinfo on read; values are always stored as UTC.
UtcDatetime = Annotated[datetime, AfterValidator(lambda v: v if v.tzinfo else v.replace(tzinfo=timezone.utc))]

# Where a pin sits inside its element: 0..1 of the element's width/height.
Coordinate = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]
CommentText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


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
MemberName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]
ReviewName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class ReviewCreate(BaseModel):
    name: ReviewName
    display_name: MemberName


class ReviewJoin(BaseModel):
    share_code: Annotated[str, StringConstraints(strip_whitespace=True, to_upper=True, min_length=1, max_length=20)]
    display_name: MemberName


class ReviewOut(BaseModel):
    id: int
    name: str
    role: str
    display_name: str
    # Only the owner sees the code, so reviewers can't pass it on by accident.
    share_code: str | None
    created_at: UtcDatetime


class ReviewAccess(ReviewOut):
    """Returned once, when the key is created. The server can't show it again."""

    member_key: str


class ReviewPageOut(BaseModel):
    url: str
    comment_count: int


class WebCommentCreate(BaseModel):
    url: PageUrl
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
    # What the person asking may do, so the extension only offers what will work.
    can_edit: bool = False
    can_delete: bool = False
