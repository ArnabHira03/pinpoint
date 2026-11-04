from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Screenshot
from ..schemas import AnnotationCreate, AnnotationOut, AnnotationUpdate
from ..services import annotations as service

router = APIRouter(prefix="/api", tags=["annotations"])


def _screenshot_or_404(db: Session, screenshot_id: int) -> None:
    if db.get(Screenshot, screenshot_id) is None:
        raise HTTPException(status_code=404, detail="Screenshot not found")


def _not_found() -> HTTPException:
    return HTTPException(status_code=404, detail="Annotation not found")


@router.get("/screenshots/{screenshot_id}/annotations", response_model=list[AnnotationOut])
def list_annotations(screenshot_id: int, db: Session = Depends(get_db)):
    _screenshot_or_404(db, screenshot_id)
    return service.list_annotations(db, screenshot_id)


@router.post(
    "/screenshots/{screenshot_id}/annotations",
    response_model=AnnotationOut,
    status_code=status.HTTP_201_CREATED,
)
def create_annotation(screenshot_id: int, body: AnnotationCreate, db: Session = Depends(get_db)):
    _screenshot_or_404(db, screenshot_id)
    return service.create_annotation(db, screenshot_id, body)


@router.patch("/annotations/{annotation_id}", response_model=AnnotationOut)
def update_annotation(annotation_id: int, body: AnnotationUpdate, db: Session = Depends(get_db)):
    annotation = service.update_annotation(db, annotation_id, body)
    if annotation is None:
        raise _not_found()
    return annotation


@router.delete("/annotations/{annotation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_annotation(annotation_id: int, db: Session = Depends(get_db)):
    if not service.delete_annotation(db, annotation_id):
        raise _not_found()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
