"""
Messages API Router
Handles: list, get, mark read, dismiss, search, feedback
"""
from fastapi import APIRouter, Depends, Query, HTTPException, BackgroundTasks
from pydantic import BaseModel
from core.db import db_select, db_update, db_insert, get_db
from core.dependencies import get_current_user
from core.cache import cache_get, cache_set, cache_delete
import re, html as html_lib, json


def _strip_html(raw: str) -> str:
    """Remove HTML tags and decode HTML entities to plain text."""
    if not raw:
        return ""
    text = html_lib.unescape(raw)
    text = re.sub(r"<(style|script)[^>]*>.*?</\1>", " ", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<(br|p|div|li|tr|h[1-6])[^>]*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


def _clean_msg(msg: dict) -> dict:
    """Strip HTML from body_text for display."""
    body = msg.get("body_text", "")
    if body and ("<" in body and ">" in body):
        msg = dict(msg)
        msg["body_text"] = _strip_html(body)
    return msg

router = APIRouter()


class FeedbackRequest(BaseModel):
    corrected_category: str
    feedback_type: str  # "wrong_category" | "mark_spam" | "not_spam"
    message_id: str | None = None  # for /feedback shortcut endpoint


@router.get("/")
async def list_messages(
    category: str | None = None,
    urgency: str | None = None,
    is_read: bool | None = None,
    search: str | None = None,
    limit: int = Query(default=50, le=200),
    user: dict = Depends(get_current_user),
):
    """Get messages for the current user with optional filters."""
    cache_key = f"user:{user['id']}:messages:{category}:{urgency}:{is_read}:{search}"
    cached = await cache_get(cache_key)
    if cached:
        return json.loads(cached)

    db = get_db()
    query = (db.table("messages")
             .select("*")
             .eq("user_id", user["id"])
             .eq("is_dismissed", False)
             .order("received_at", desc=True)
             .limit(limit))

    if category:
        query = query.eq("category", category)
    if urgency:
        query = query.eq("urgency", urgency)
    if is_read is not None:
        query = query.eq("is_read", is_read)
    if search:
        query = query.or_(f"subject.ilike.%{search}%,sender.ilike.%{search}%")

    result = query.execute()
    data = [_clean_msg(m) for m in (result.data or [])]

    await cache_set(cache_key, json.dumps(data, default=str), ttl_seconds=60)
    return data


@router.get("/board")
async def get_board(user: dict = Depends(get_current_user)):
    """Get messages grouped by urgency for Kanban board view."""
    db = get_db()
    result = (db.table("messages")
              .select("*")
              .eq("user_id", user["id"])
              .eq("is_dismissed", False)
              .order("received_at", desc=True)
              .limit(100)
              .execute())

    messages = [_clean_msg(m) for m in (result.data or [])]
    board = {"today": [], "week": [], "later": [], "flagged": []}
    for msg in messages:
        cat = msg.get("category")
        urg = msg.get("urgency")
        if cat == "spam":
            board["flagged"].append(msg)
        elif urg == "high":
            board["today"].append(msg)
        elif urg == "medium":
            board["week"].append(msg)
        else:
            board["later"].append(msg)
    return board


@router.get("/unread-count")
async def unread_count(user: dict = Depends(get_current_user)):
    cache_key = f"user:{user['id']}:unread_count"
    cached = await cache_get(cache_key)
    if cached:
        return {"count": int(cached)}

    db = get_db()
    result = (db.table("messages")
              .select("id", count="exact")
              .eq("user_id", user["id"])
              .eq("is_read", False)
              .eq("is_dismissed", False)
              .execute())
    count = result.count or 0
    await cache_set(cache_key, str(count), ttl_seconds=30)
    return {"count": count}


@router.get("/{message_id}")
async def get_message(message_id: str, user: dict = Depends(get_current_user)):
    db = get_db()
    result = (db.table("messages")
              .select("*")
              .eq("id", message_id)
              .eq("user_id", user["id"])
              .execute())
    if not result.data:
        raise HTTPException(status_code=404, detail="Message not found")
    return result.data[0]


# Both PATCH and POST supported for mark-read (frontend uses POST, keeping PATCH too)
@router.patch("/{message_id}/read")
@router.post("/{message_id}/read")
async def mark_read(message_id: str, user: dict = Depends(get_current_user)):
    await db_update("messages",
                    match={"id": message_id, "user_id": user["id"]},
                    data={"is_read": True})
    await cache_delete(f"user:{user['id']}:unread_count")
    return {"status": "ok"}


@router.patch("/{message_id}/dismiss")
@router.post("/{message_id}/dismiss")
async def dismiss(message_id: str, user: dict = Depends(get_current_user)):
    await db_update("messages",
                    match={"id": message_id, "user_id": user["id"]},
                    data={"is_dismissed": True, "is_read": True})
    await cache_delete(f"user:{user['id']}:unread_count")
    return {"status": "ok"}


@router.post("/{message_id}/feedback")
async def submit_feedback_on_message(
    message_id: str,
    body: FeedbackRequest,
    user: dict = Depends(get_current_user),
):
    """Student corrects a classification — feeds back into training data."""
    if body.corrected_category not in ["placement", "faculty", "department", "spam"]:
        raise HTTPException(status_code=400, detail="Invalid category")

    await db_insert("feedback", {
        "user_id": user["id"],
        "message_id": message_id,
        "corrected_category": body.corrected_category,
        "feedback_type": body.feedback_type,
    })
    await db_update("messages",
                    match={"id": message_id, "user_id": user["id"]},
                    data={"category": body.corrected_category})
    return {"status": "feedback recorded"}


# Global /feedback shortcut (frontend can POST to either place)
@router.post("/feedback")
async def submit_feedback_global(
    body: FeedbackRequest,
    user: dict = Depends(get_current_user),
):
    """Shortcut feedback endpoint — same as /{message_id}/feedback."""
    if not body.message_id:
        raise HTTPException(status_code=400, detail="message_id required")
    if body.corrected_category not in ["placement", "faculty", "department", "spam"]:
        raise HTTPException(status_code=400, detail="Invalid category")

    await db_insert("feedback", {
        "user_id": user["id"],
        "message_id": body.message_id,
        "corrected_category": body.corrected_category,
        "feedback_type": body.feedback_type,
    })
    await db_update("messages",
                    match={"id": body.message_id, "user_id": user["id"]},
                    data={"category": body.corrected_category})
    return {"status": "feedback recorded"}
