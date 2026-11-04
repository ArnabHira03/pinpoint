from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import AfterValidator
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Review
from ..schemas import ReviewCreate, ReviewJoin, ReviewOut, WebCommentCreate, WebCommentOut, WebCommentUpdate, normalize_page_url
from ..services import reviews as service

router = APIRouter(prefix="/api", tags=["reviews"])


UrlQuery = Annotated[str, Query(min_length=1, max_length=2048), AfterValidator(normalize_page_url)]


def _review_or_404(db: Session, review_id: int) -> Review:
    review = db.get(Review, review_id)
    if review is None:
        raise HTTPException(status_code=404, detail="Review not found")
    return review


def _comment_not_found() -> HTTPException:
    return HTTPException(status_code=404, detail="Comment not found")


@router.get("/reviews", response_model=list[ReviewOut])
def list_reviews(db: Session = Depends(get_db)):
    return service.list_reviews(db)


@router.post("/reviews", response_model=ReviewOut, status_code=status.HTTP_201_CREATED)
def create_review(body: ReviewCreate, db: Session = Depends(get_db)):
    return service.create_review(db, body.name)


@router.post("/reviews/join", response_model=ReviewOut)
def join_review(body: ReviewJoin, db: Session = Depends(get_db)):
    review = service.find_by_share_code(db, body.share_code)
    if review is None:
        raise HTTPException(status_code=404, detail="Review not found")
    return review


@router.get("/reviews/{review_id}", response_model=ReviewOut)
def get_review(review_id: int, db: Session = Depends(get_db)):
    return _review_or_404(db, review_id)


@router.delete("/reviews/{review_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_review(review_id: int, db: Session = Depends(get_db)):
    if not service.delete_review(db, review_id):
        raise HTTPException(status_code=404, detail="Review not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/reviews/{review_id}/comments", response_model=list[WebCommentOut])
def list_comments(review_id: int, url: UrlQuery, db: Session = Depends(get_db)):
    _review_or_404(db, review_id)
    return service.list_comments(db, review_id, url)


@router.post("/reviews/{review_id}/comments", response_model=WebCommentOut, status_code=status.HTTP_201_CREATED)
def create_comment(review_id: int, body: WebCommentCreate, db: Session = Depends(get_db)):
    _review_or_404(db, review_id)
    return service.create_comment(db, review_id, body)


@router.patch("/comments/{comment_id}", response_model=WebCommentOut)
def update_comment(comment_id: int, body: WebCommentUpdate, db: Session = Depends(get_db)):
    comment = service.update_comment(db, comment_id, body.comment)
    if comment is None:
        raise _comment_not_found()
    return comment


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_comment(comment_id: int, db: Session = Depends(get_db)):
    if not service.delete_comment(db, comment_id):
        raise _comment_not_found()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
