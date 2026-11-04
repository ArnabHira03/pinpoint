from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import storage
from ..models import Project, Screenshot, utcnow
from ..schemas import ProjectOut


def _count_subquery():
    return (
        select(func.count(Screenshot.id))
        .where(Screenshot.project_id == Project.id)
        .correlate(Project)
        .scalar_subquery()
    )


def _to_out(project: Project, count: int) -> ProjectOut:
    return ProjectOut(
        id=project.id,
        name=project.name,
        created_at=project.created_at,
        updated_at=project.updated_at,
        screenshot_count=count,
    )


def list_projects(db: Session) -> list[ProjectOut]:
    rows = db.execute(select(Project, _count_subquery()).order_by(Project.updated_at.desc(), Project.id.desc()))
    return [_to_out(p, c) for p, c in rows]


def get_project(db: Session, project_id: int) -> ProjectOut | None:
    row = db.execute(select(Project, _count_subquery()).where(Project.id == project_id)).first()
    return _to_out(*row) if row else None


def create_project(db: Session, name: str) -> ProjectOut:
    project = Project(name=name)
    db.add(project)
    db.commit()
    return _to_out(project, 0)


def rename_project(db: Session, project_id: int, name: str) -> ProjectOut | None:
    project = db.get(Project, project_id)
    if project is None:
        return None
    project.name = name
    project.updated_at = utcnow()
    db.commit()
    return get_project(db, project_id)


def delete_project(db: Session, screenshots_dir: Path, project_id: int) -> bool:
    project = db.get(Project, project_id)
    if project is None:
        return False
    db.delete(project)
    db.commit()
    storage.remove_project_files(screenshots_dir, project_id)
    return True
