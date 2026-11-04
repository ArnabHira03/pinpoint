from datetime import datetime, timezone

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    screenshots: Mapped[list["Screenshot"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", passive_deletes=True
    )


class Screenshot(Base):
    __tablename__ = "screenshots"
    __table_args__ = (Index("ix_screenshots_project_created", "project_id", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(Text, unique=True)
    original_filename: Mapped[str] = mapped_column(Text)
    mime_type: Mapped[str] = mapped_column(Text)
    file_size: Mapped[int] = mapped_column(Integer)
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    next_annotation_number: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    project: Mapped[Project] = relationship(back_populates="screenshots")
    annotations: Mapped[list["Annotation"]] = relationship(
        back_populates="screenshot", cascade="all, delete-orphan", passive_deletes=True
    )


class Annotation(Base):
    __tablename__ = "annotations"
    __table_args__ = (
        UniqueConstraint("screenshot_id", "number"),
        CheckConstraint("x BETWEEN 0 AND 1", name="ck_annotations_x"),
        CheckConstraint("y BETWEEN 0 AND 1", name="ck_annotations_y"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    screenshot_id: Mapped[int] = mapped_column(ForeignKey("screenshots.id", ondelete="CASCADE"))
    number: Mapped[int] = mapped_column(Integer)
    x: Mapped[float]
    y: Mapped[float]
    comment: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    screenshot: Mapped[Screenshot] = relationship(back_populates="annotations")
