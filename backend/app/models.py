import secrets
from datetime import datetime, timezone

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# No 0/O or 1/I, so codes are easy to read out and type.
SHARE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def new_share_code() -> str:
    return "".join(secrets.choice(SHARE_CODE_ALPHABET) for _ in range(8))


ROLE_OWNER = "owner"
ROLE_MEMBER = "member"


class Review(Base):
    __tablename__ = "reviews"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    share_code: Mapped[str] = mapped_column(String(8), unique=True, index=True, default=new_share_code)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    pages: Mapped[list["ReviewPage"]] = relationship(
        back_populates="review", cascade="all, delete-orphan", passive_deletes=True
    )
    members: Mapped[list["ReviewMember"]] = relationship(
        back_populates="review", cascade="all, delete-orphan", passive_deletes=True
    )


class ReviewMember(Base):
    """One person's access to one review. Only a hash of their key is stored."""

    __tablename__ = "review_members"

    id: Mapped[int] = mapped_column(primary_key=True)
    review_id: Mapped[int] = mapped_column(ForeignKey("reviews.id", ondelete="CASCADE"), index=True)
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(50))
    role: Mapped[str] = mapped_column(String(10), default=ROLE_MEMBER)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    review: Mapped[Review] = relationship(back_populates="members")

    @property
    def is_owner(self) -> bool:
        return self.role == ROLE_OWNER


class ReviewPage(Base):
    """A web page within a review. Kept after its last comment goes, so numbers are never reused."""

    __tablename__ = "review_pages"
    __table_args__ = (UniqueConstraint("review_id", "url"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    review_id: Mapped[int] = mapped_column(ForeignKey("reviews.id", ondelete="CASCADE"))
    url: Mapped[str] = mapped_column(Text)
    next_comment_number: Mapped[int] = mapped_column(Integer, default=1, server_default="1")

    review: Mapped[Review] = relationship(back_populates="pages")
    comments: Mapped[list["WebComment"]] = relationship(
        back_populates="page", cascade="all, delete-orphan", passive_deletes=True
    )


class WebComment(Base):
    __tablename__ = "web_comments"
    __table_args__ = (
        UniqueConstraint("page_id", "number"),
        CheckConstraint("offset_x BETWEEN 0 AND 1", name="ck_web_comments_offset_x"),
        CheckConstraint("offset_y BETWEEN 0 AND 1", name="ck_web_comments_offset_y"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    page_id: Mapped[int] = mapped_column(ForeignKey("review_pages.id", ondelete="CASCADE"))
    member_id: Mapped[int | None] = mapped_column(ForeignKey("review_members.id", ondelete="SET NULL"))
    number: Mapped[int] = mapped_column(Integer)
    author_name: Mapped[str] = mapped_column(Text, default="", server_default="")
    selector: Mapped[str] = mapped_column(Text)
    offset_x: Mapped[float]
    offset_y: Mapped[float]
    text_snippet: Mapped[str] = mapped_column(Text, default="")
    comment: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    page: Mapped[ReviewPage] = relationship(back_populates="comments", lazy="joined")

    @property
    def review_id(self) -> int:
        return self.page.review_id

    @property
    def url(self) -> str:
        return self.page.url
