import hashlib
import secrets

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import ROLE_MEMBER, ROLE_OWNER, Review, ReviewMember, ReviewPage, WebComment, new_share_code, utcnow
from ..schemas import WebCommentCreate


def hash_key(key: str) -> str:
    # The key is long and random, so a plain fast hash is safe here.
    return hashlib.sha256(key.encode()).hexdigest()


def find_member_by_key(db: Session, key: str) -> ReviewMember | None:
    return db.scalar(select(ReviewMember).where(ReviewMember.key_hash == hash_key(key)))


def _add_member(db: Session, review: Review, display_name: str, role: str) -> tuple[ReviewMember, str]:
    key = secrets.token_urlsafe(32)
    member = ReviewMember(review=review, key_hash=hash_key(key), display_name=display_name, role=role)
    db.add(member)
    return member, key


def create_review(db: Session, name: str, display_name: str) -> tuple[ReviewMember, str]:
    review = Review(name=name)
    db.add(review)
    member, key = _add_member(db, review, display_name, ROLE_OWNER)
    db.commit()
    return member, key


def join_review(db: Session, share_code: str, display_name: str) -> tuple[ReviewMember, str] | None:
    review = db.scalar(select(Review).where(Review.share_code == share_code))
    if review is None:
        return None
    member, key = _add_member(db, review, display_name, ROLE_MEMBER)
    db.commit()
    return member, key


def replace_share_code(db: Session, review: Review) -> None:
    review.share_code = new_share_code()
    db.commit()


def delete_review(db: Session, review: Review) -> None:
    db.delete(review)
    db.commit()


def list_comments(db: Session, review_id: int, url: str) -> list[WebComment]:
    return list(
        db.scalars(
            select(WebComment)
            .join(WebComment.page)
            .where(ReviewPage.review_id == review_id, ReviewPage.url == url)
            .order_by(WebComment.number)
        )
    )


def _get_or_create_page(db: Session, review_id: int, url: str) -> ReviewPage:
    query = select(ReviewPage).where(ReviewPage.review_id == review_id, ReviewPage.url == url)
    page = db.scalar(query)
    if page is not None:
        return page
    db.add(ReviewPage(review_id=review_id, url=url))
    try:
        db.commit()
    except IntegrityError:
        # Someone else commented on this page first.
        db.rollback()
    return db.scalars(query).one()


def create_comment(db: Session, member: ReviewMember, data: WebCommentCreate) -> WebComment:
    # Read before any commit below, while the member is certainly loaded.
    member_id, author_name = member.id, member.display_name
    page = _get_or_create_page(db, member.review_id, data.url)
    # Claim the next number atomically. Numbers are never reused after a delete.
    next_number = db.execute(
        update(ReviewPage)
        .where(ReviewPage.id == page.id)
        .values(next_comment_number=ReviewPage.next_comment_number + 1)
        .returning(ReviewPage.next_comment_number)
    ).scalar_one()
    comment = WebComment(
        page=page,
        member_id=member_id,
        number=next_number - 1,
        author_name=author_name,
        selector=data.selector,
        offset_x=data.offset_x,
        offset_y=data.offset_y,
        text_snippet=data.text_snippet,
        comment=data.comment,
    )
    db.add(comment)
    db.commit()
    return comment


def find_comment_in_review(db: Session, comment_id: int, review_id: int) -> WebComment | None:
    comment = db.get(WebComment, comment_id)
    if comment is None or comment.review_id != review_id:
        return None
    return comment


def update_comment(db: Session, comment: WebComment, text: str) -> None:
    comment.comment = text
    comment.updated_at = utcnow()
    db.commit()


def delete_comment(db: Session, comment: WebComment) -> None:
    db.delete(comment)
    db.commit()
