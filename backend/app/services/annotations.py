from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..models import Annotation, Screenshot, utcnow
from ..schemas import AnnotationCreate, AnnotationUpdate


def list_annotations(db: Session, screenshot_id: int) -> list[Annotation]:
    return list(db.scalars(select(Annotation).where(Annotation.screenshot_id == screenshot_id).order_by(Annotation.number)))


def create_annotation(db: Session, screenshot_id: int, data: AnnotationCreate) -> Annotation:
    # Claim the next number atomically. Numbers are never reused after a delete,
    # so "#3" keeps meaning the same comment for the life of the screenshot.
    next_number = db.execute(
        update(Screenshot)
        .where(Screenshot.id == screenshot_id)
        .values(next_annotation_number=Screenshot.next_annotation_number + 1)
        .returning(Screenshot.next_annotation_number)
    ).scalar_one()
    annotation = Annotation(screenshot_id=screenshot_id, number=next_number - 1, x=data.x, y=data.y, comment=data.comment)
    db.add(annotation)
    db.commit()
    return annotation


def update_annotation(db: Session, annotation_id: int, data: AnnotationUpdate) -> Annotation | None:
    annotation = db.get(Annotation, annotation_id)
    if annotation is None:
        return None
    for name in data.model_fields_set:
        setattr(annotation, name, getattr(data, name))
    annotation.updated_at = utcnow()
    db.commit()
    return annotation


def delete_annotation(db: Session, annotation_id: int) -> bool:
    annotation = db.get(Annotation, annotation_id)
    if annotation is None:
        return False
    db.delete(annotation)
    db.commit()
    return True
