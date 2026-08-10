"""
User Settings API Router
GET  /api/user/settings  — Get notification preferences
PUT  /api/user/settings  — Update notification preferences
POST /api/user/fcm-token — Register FCM device token for push notifications
POST /api/user/poll-now  — Trigger immediate Gmail fetch (no wait for scheduler)
"""
import logging
from fastapi import APIRouter, Depends, BackgroundTasks
from pydantic import BaseModel
from typing import Optional
from core.dependencies import get_current_user
from core.db import db_select, db_upsert, db_update

logger = logging.getLogger(__name__)
router = APIRouter()


class SettingsUpdate(BaseModel):
    placement_enabled: Optional[bool] = None
    faculty_enabled: Optional[bool] = None
    department_enabled: Optional[bool] = None
    push_enabled: Optional[bool] = None
    telegram_digest_enabled: Optional[bool] = None
    dnd_start: Optional[str] = None    # "HH:MM"
    dnd_end: Optional[str] = None      # "HH:MM"
    digest_time: Optional[str] = None  # "HH:MM"


class FCMTokenRequest(BaseModel):
    fcm_token: str


@router.get("/settings")
async def get_settings(user: dict = Depends(get_current_user)):
    """Get user notification preferences."""
    prefs_list = await db_select("notification_prefs", filters={"user_id": user["id"]})
    if not prefs_list:
        # Return defaults
        return {
            "placement_enabled": True,
            "faculty_enabled": True,
            "department_enabled": True,
            "push_enabled": True,
            "telegram_digest_enabled": False,
            "dnd_start": "23:00",
            "dnd_end": "08:00",
            "digest_time": "09:00",
            "gmail_connected": False,
            "calendar_connected": False,
        }
    prefs = prefs_list[0]
    return {
        "placement_enabled": prefs.get("placement_enabled", True),
        "faculty_enabled": prefs.get("faculty_enabled", True),
        "department_enabled": prefs.get("department_enabled", True),
        "push_enabled": prefs.get("push_enabled", True),
        "telegram_digest_enabled": prefs.get("tg_digest", False),
        "dnd_start": str(prefs.get("dnd_start", "23:00")),
        "dnd_end": str(prefs.get("dnd_end", "08:00")),
        "digest_time": str(prefs.get("digest_time", "09:00")),
        "gmail_connected": bool(prefs.get("gmail_token")),
        "calendar_connected": bool(prefs.get("gmail_token")),
    }


@router.put("/settings")
async def update_settings(
    body: SettingsUpdate,
    user: dict = Depends(get_current_user),
):
    """Update user notification preferences."""
    updates = {}
    if body.placement_enabled is not None:
        updates["placement_enabled"] = body.placement_enabled
    if body.faculty_enabled is not None:
        updates["faculty_enabled"] = body.faculty_enabled
    if body.department_enabled is not None:
        updates["department_enabled"] = body.department_enabled
    if body.push_enabled is not None:
        updates["push_enabled"] = body.push_enabled
    if body.telegram_digest_enabled is not None:
        updates["tg_digest"] = body.telegram_digest_enabled
    if body.dnd_start is not None:
        updates["dnd_start"] = body.dnd_start
    if body.dnd_end is not None:
        updates["dnd_end"] = body.dnd_end
    if body.digest_time is not None:
        updates["digest_time"] = body.digest_time

    if updates:
        await db_update("notification_prefs",
                        match={"user_id": user["id"]},
                        data=updates)
    return {"status": "updated"}


@router.post("/fcm-token")
async def register_fcm_token(
    body: FCMTokenRequest,
    user: dict = Depends(get_current_user),
):
    """Register the browser's FCM token so we can send push notifications."""
    if not body.fcm_token:
        return {"status": "no token provided"}
    await db_upsert("notification_prefs",
                    {"user_id": user["id"], "fcm_token": body.fcm_token},
                    on_conflict="user_id")
    logger.info(f"[FCM] Registered token for user {user['id']}")
    return {"status": "registered"}


@router.post("/poll-now")
async def poll_now(
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):
    """
    Trigger immediate Gmail fetch for this user (no waiting for scheduler).
    Runs in background so response is instant.
    """
    async def _do_poll(user_id: str, user_data: dict):
        try:
            from ingestion.gmail import fetch_new_emails
            from ml.classifier import classify, score_urgency
            from ml.deadline_extractor import extract_deadline
            from core.db import db_upsert as _upsert, db_select as _select
            from ingestion.deduplication import deduplicate

            logger.info(f"[PollNow] Starting Gmail fetch for user {user_id}")
            gmail_msgs = await fetch_new_emails(user_data)

            if not gmail_msgs:
                logger.info(f"[PollNow] No new emails for user {user_id}")
                return

            # Get recent for dedup
            recent = await _select("messages", filters={"user_id": user_id}, limit=50)
            unique_msgs = deduplicate(gmail_msgs, recent)
            logger.info(f"[PollNow] {len(unique_msgs)} unique new emails after dedup")

            for msg in unique_msgs:
                text = f"{msg.get('subject', '')} {msg.get('body_text', '')}"
                result = classify(text, sender=msg.get("sender", ""),
                                  sender_domain=msg.get("sender_domain", ""))
                msg["category"] = result["category"]
                msg["confidence"] = result["confidence"]
                deadline = extract_deadline(text)
                msg["deadline"] = deadline.isoformat() if deadline else None
                msg["urgency"] = score_urgency(text, deadline=deadline)
                try:
                    await _upsert("messages", msg, on_conflict="user_id,source,raw_id")
                except Exception as e:
                    logger.warning(f"[PollNow] Upsert skipped: {e}")

            logger.info(f"[PollNow] Done — stored {len(unique_msgs)} messages for user {user_id}")
        except Exception as e:
            logger.error(f"[PollNow] Error for user {user_id}: {e}", exc_info=True)

    background_tasks.add_task(_do_poll, user["id"], user)
    return {"status": "polling", "message": "Gmail sync started — refresh in 15 seconds"}
