from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import AfterValidator
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ReviewMember, WebComment
from ..schemas import ReviewAccess, ReviewCreate, ReviewJoin, ReviewOut, ReviewPageOut, WebCommentCreate, WebCommentOut, WebCommentUpdate, normalize_page_url
from ..services import reviews as service

router = APIRouter(prefix="/api", tags=["reviews"])

UrlQuery = Annotated[str, Query(min_length=1, max_length=2048), AfterValidator(normalize_page_url)]
bearer = HTTPBearer(auto_error=False)


def current_member(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> ReviewMember:
    member = service.find_member_by_key(db, credentials.credentials) if credentials else None
    if member is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="A valid member key is required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return member


def member_of_review(review_id: int, member: ReviewMember = Depends(current_member)) -> ReviewMember:
    # A key opens one review. Other reviews look the same as ones that don't exist.
    if member.review_id != review_id:
        raise HTTPException(status_code=404, detail="Review not found")
    return member


def owner_of_review(member: ReviewMember = Depends(member_of_review)) -> ReviewMember:
    if not member.is_owner:
        raise HTTPException(status_code=403, detail="Only the review owner can do this")
    return member


def _comment_or_404(db: Session, comment_id: int, member: ReviewMember) -> WebComment:
    comment = service.find_comment_in_review(db, comment_id, member.review_id)
    if comment is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    return comment


def _can_edit(comment: WebComment, member: ReviewMember) -> bool:
    return comment.member_id == member.id


def _can_delete(comment: WebComment, member: ReviewMember) -> bool:
    return _can_edit(comment, member) or member.is_owner


def _review_out(member: ReviewMember) -> dict:
    review = member.review
    return {
        "id": review.id,
        "name": review.name,
        "role": member.role,
        "display_name": member.display_name,
        "share_code": review.share_code if member.is_owner else None,
        "created_at": review.created_at,
    }


def _comment_out(comment: WebComment, member: ReviewMember) -> WebCommentOut:
    out = WebCommentOut.model_validate(comment)
    out.can_edit = _can_edit(comment, member)
    out.can_delete = _can_delete(comment, member)
    return out


@router.post("/reviews", response_model=ReviewAccess, status_code=status.HTTP_201_CREATED)
def create_review(body: ReviewCreate, db: Session = Depends(get_db)):
    member, key = service.create_review(db, body.name, body.display_name)
    return {**_review_out(member), "member_key": key}


@router.post("/reviews/join", response_model=ReviewAccess)
def join_review(body: ReviewJoin, db: Session = Depends(get_db)):
    joined = service.join_review(db, body.share_code, body.display_name)
    if joined is None:
        raise HTTPException(status_code=404, detail="Review not found")
    member, key = joined
    return {**_review_out(member), "member_key": key}


@router.get("/reviews/{review_id}", response_model=ReviewOut)
def get_review(member: ReviewMember = Depends(member_of_review)):
    return _review_out(member)


@router.post("/reviews/{review_id}/share-code", response_model=ReviewOut)
def replace_share_code(member: ReviewMember = Depends(owner_of_review), db: Session = Depends(get_db)):
    service.replace_share_code(db, member.review)
    return _review_out(member)


@router.delete("/reviews/{review_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_review(member: ReviewMember = Depends(owner_of_review), db: Session = Depends(get_db)):
    service.delete_review(db, member.review)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/reviews/{review_id}/pages", response_model=list[ReviewPageOut])
def list_pages(member: ReviewMember = Depends(member_of_review), db: Session = Depends(get_db)):
    return service.list_pages_with_comments(db, member.review_id)


@router.get("/reviews/{review_id}/comments", response_model=list[WebCommentOut])
def list_comments(url: UrlQuery, member: ReviewMember = Depends(member_of_review), db: Session = Depends(get_db)):
    return [_comment_out(comment, member) for comment in service.list_comments(db, member.review_id, url)]


@router.post("/reviews/{review_id}/comments", response_model=WebCommentOut, status_code=status.HTTP_201_CREATED)
def create_comment(body: WebCommentCreate, member: ReviewMember = Depends(member_of_review), db: Session = Depends(get_db)):
    return _comment_out(service.create_comment(db, member, body), member)


@router.patch("/comments/{comment_id}", response_model=WebCommentOut)
def update_comment(
    comment_id: int,
    body: WebCommentUpdate,
    member: ReviewMember = Depends(current_member),
    db: Session = Depends(get_db),
):
    comment = _comment_or_404(db, comment_id, member)
    if not _can_edit(comment, member):
        raise HTTPException(status_code=403, detail="Only the comment's author can edit it")
    service.update_comment(db, comment, body.comment)
    return _comment_out(comment, member)


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_comment(comment_id: int, member: ReviewMember = Depends(current_member), db: Session = Depends(get_db)):
    comment = _comment_or_404(db, comment_id, member)
    if not _can_delete(comment, member):
        raise HTTPException(status_code=403, detail="Only the comment's author or the review owner can delete it")
    service.delete_comment(db, comment)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
