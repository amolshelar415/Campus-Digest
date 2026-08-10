"""
Calendar API Router
POST /api/calendar/add  — Creates a Google Calendar event from a message's deadline
GET  /api/calendar/events — Lists upcoming calendar events for user
"""
import json
import logging
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from core.dependencies import get_current_user
from core.db import db_select, db_update, db_upsert
from core.security import decrypt_token, encrypt_token

logger = logging.getLogger(__name__)
router = APIRouter()

SCOPES = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/gmail.readonly",
    "openid", "email", "profile",
]


class CalendarAddRequest(BaseModel):
    message_id: str


def _get_credentials(token_data: dict) -> Credentials:
    return Credentials(
        token=token_data.get("access_token"),
        refresh_token=token_data.get("refresh_token"),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=token_data.get("client_id"),
        client_secret=token_data.get("client_secret"),
        scopes=SCOPES,
    )


@router.post("/add")
async def add_to_calendar(
    body: CalendarAddRequest,
    user: dict = Depends(get_current_user),
):
    """Create a Google Calendar event from a message's deadline."""
    # 1. Fetch the message
    from core.db import get_db
    db = get_db()
    result = (db.table("messages")
              .select("*")
              .eq("id", body.message_id)
              .eq("user_id", user["id"])
              .execute())
    if not result.data:
        raise HTTPException(status_code=404, detail="Message not found")
    msg = result.data[0]

    if not msg.get("deadline"):
        raise HTTPException(status_code=400, detail="Message has no extracted deadline")

    # 2. Get user's Gmail OAuth token (has Calendar scope)
    prefs_list = await db_select("notification_prefs", filters={"user_id": user["id"]})
    if not prefs_list or not prefs_list[0].get("gmail_token"):
        raise HTTPException(status_code=400,
                            detail="Google Calendar not connected. Please log out and log in again to re-grant Calendar access.")
    prefs = prefs_list[0]

    try:
        token_data = json.loads(decrypt_token(prefs["gmail_token"]))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Token error: {e}")

    creds = _get_credentials(token_data)

    # Refresh if expired
    if creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            token_data["access_token"] = creds.token
            await db_update("notification_prefs",
                            match={"user_id": user["id"]},
                            data={"gmail_token": encrypt_token(json.dumps(token_data))})
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Token refresh failed: {e}")

    # 3. Parse deadline
    deadline_str = msg["deadline"]
    try:
        if "T" in deadline_str:
            deadline_dt = datetime.fromisoformat(deadline_str.replace("Z", "+00:00"))
        else:
            deadline_dt = datetime.fromisoformat(deadline_str).replace(tzinfo=timezone.utc)
    except Exception:
        # Fallback: create an all-day event for tomorrow
        deadline_dt = datetime.now(timezone.utc) + timedelta(days=1)

    # 4. Create Calendar event
    service = build("calendar", "v3", credentials=creds, cache_discovery=False)
    event_body = {
        "summary": msg.get("subject", "Campus Digest Deadline"),
        "description": (
            f"Source: {msg.get('source', 'email').upper()}\n"
            f"Sender: {msg.get('sender', '')}\n\n"
            f"{msg.get('body_text', '')[:500]}"
        ),
        "start": {
            "dateTime": deadline_dt.isoformat(),
            "timeZone": "Asia/Kolkata",
        },
        "end": {
            "dateTime": (deadline_dt + timedelta(hours=1)).isoformat(),
            "timeZone": "Asia/Kolkata",
        },
        "reminders": {
            "useDefault": False,
            "overrides": [
                {"method": "popup",  "minutes": 60},
                {"method": "popup",  "minutes": 30},
                {"method": "email",  "minutes": 120},
            ],
        },
    }

    try:
        created_event = service.events().insert(calendarId="primary", body=event_body).execute()
    except Exception as e:
        logger.error(f"[Calendar] Event creation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Calendar API error: {e}")

    # 5. Save event_id back to the message
    await db_update("messages",
                    match={"id": body.message_id, "user_id": user["id"]},
                    data={"calendar_event_id": created_event["id"]})

    logger.info(f"[Calendar] Event created for user {user['id']}: {created_event['id']}")
    return {
        "status": "created",
        "event_id": created_event["id"],
        "event_link": created_event.get("htmlLink", ""),
        "summary": created_event.get("summary", ""),
    }


@router.get("/events")
async def get_events(user: dict = Depends(get_current_user)):
    """Get upcoming Google Calendar events (next 7 days)."""
    prefs_list = await db_select("notification_prefs", filters={"user_id": user["id"]})
    if not prefs_list or not prefs_list[0].get("gmail_token"):
        return {"events": [], "message": "Google Calendar not connected"}
    prefs = prefs_list[0]

    try:
        token_data = json.loads(decrypt_token(prefs["gmail_token"]))
    except Exception:
        return {"events": []}

    creds = _get_credentials(token_data)
    if creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
        except Exception:
            return {"events": []}

    service = build("calendar", "v3", credentials=creds, cache_discovery=False)
    now = datetime.now(timezone.utc)
    week_later = now + timedelta(days=7)
    try:
        events_result = service.events().list(
            calendarId="primary",
            timeMin=now.isoformat(),
            timeMax=week_later.isoformat(),
            maxResults=20,
            singleEvents=True,
            orderBy="startTime",
        ).execute()
        events = events_result.get("items", [])
    except Exception as e:
        logger.error(f"[Calendar] Events list failed: {e}")
        events = []

    return {"events": events}
