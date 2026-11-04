from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import Review, ReviewPage, WebComment, utcnow
from ..schemas import WebCommentCreate


def list_reviews(db: Session) -> list[Review]:
    return list(db.scalars(select(Review).order_by(Review.id.desc())))


def create_review(db: Session, name: str) -> Review:
    review = Review(name=name)
    db.add(review)
    db.commit()
    return review


def find_by_share_code(db: Session, share_code: str) -> Review | None:
    return db.scalar(select(Review).where(Review.share_code == share_code))


def delete_review(db: Session, review_id: int) -> bool:
    review = db.get(Review, review_id)
    if review is None:
        return False
    db.delete(review)
    db.commit()
    return True


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


def create_comment(db: Session, review_id: int, data: WebCommentCreate) -> WebComment:
    page = _get_or_create_page(db, review_id, data.url)
    # Claim the next number atomically. Numbers are never reused after a delete.
    next_number = db.execute(
        update(ReviewPage)
        .where(ReviewPage.id == page.id)
        .values(next_comment_number=ReviewPage.next_comment_number + 1)
        .returning(ReviewPage.next_comment_number)
    ).scalar_one()
    comment = WebComment(
        page=page,
        number=next_number - 1,
        author_name=data.author_name,
        selector=data.selector,
        offset_x=data.offset_x,
        offset_y=data.offset_y,
        text_snippet=data.text_snippet,
        comment=data.comment,
    )
    db.add(comment)
    db.commit()
    return comment


def update_comment(db: Session, comment_id: int, text: str) -> WebComment | None:
    comment = db.get(WebComment, comment_id)
    if comment is None:
        return None
    comment.comment = text
    comment.updated_at = utcnow()
    db.commit()
    return comment


def delete_comment(db: Session, comment_id: int) -> bool:
    comment = db.get(WebComment, comment_id)
    if comment is None:
        return False
    db.delete(comment)
    db.commit()
    return True
