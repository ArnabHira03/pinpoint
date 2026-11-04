from datetime import datetime, timezone

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    create_engine,
    event,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)

    screenshots: Mapped[list["Screenshot"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", passive_deletes=True
    )


class Screenshot(Base):
    __tablename__ = "screenshots"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String(64), unique=True)  # server-generated uuid name
    original_filename: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(50))
    file_size: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

    project: Mapped[Project] = relationship(back_populates="screenshots")
    annotations: Mapped[list["Annotation"]] = relationship(
        back_populates="screenshot", cascade="all, delete-orphan", passive_deletes=True
    )


class Annotation(Base):
    __tablename__ = "annotations"
    __table_args__ = (
        UniqueConstraint("screenshot_id", "number"),
        CheckConstraint("x >= 0 AND x <= 1"),
        CheckConstraint("y >= 0 AND y <= 1"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    screenshot_id: Mapped[int] = mapped_column(ForeignKey("screenshots.id", ondelete="CASCADE"))
    number: Mapped[int] = mapped_column(Integer)
    x: Mapped[float] = mapped_column(Float)  # 0..1, relative to image width
    y: Mapped[float] = mapped_column(Float)  # 0..1, relative to image height
    comment: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)

    screenshot: Mapped[Screenshot] = relationship(back_populates="annotations")


def make_engine(db_path: str):
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})

    # SQLite ignores foreign keys (and so ON DELETE CASCADE) unless enabled per connection.
    @event.listens_for(engine, "connect")
    def _enable_fk(dbapi_conn, _record):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    return engine
