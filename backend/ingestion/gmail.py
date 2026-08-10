"""
Gmail Ingestion Module
Fetches unread emails from a user's college Gmail account via Gmail API.
Uses stored OAuth tokens (encrypted in Supabase).
"""
import json
from datetime import datetime, timezone
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from core.db import db_select, db_update
from core.security import decrypt_token, encrypt_token
import base64, email as email_lib
import logging

logger = logging.getLogger(__name__)

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar.events",
    "openid", "email", "profile",
]


def _build_credentials(token_data: dict) -> Credentials:
    """Reconstruct Google Credentials from stored token dict."""
    return Credentials(
        token=token_data.get("access_token"),
        refresh_token=token_data.get("refresh_token"),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=token_data.get("client_id"),
        client_secret=token_data.get("client_secret"),
        scopes=SCOPES,
    )


def _decode_body(payload: dict) -> str:
    """Extract plain text body from Gmail message payload."""
    body = ""
    if "parts" in payload:
        for part in payload["parts"]:
            if part.get("mimeType") == "text/plain":
                data = part.get("body", {}).get("data", "")
                if data:
                    body = base64.urlsafe_b64decode(data).decode("utf-8", errors="ignore")
                    break
    else:
        data = payload.get("body", {}).get("data", "")
        if data:
            body = base64.urlsafe_b64decode(data).decode("utf-8", errors="ignore")
    return body.strip()


def _get_header(headers: list, name: str) -> str:
    for h in headers:
        if h["name"].lower() == name.lower():
            return h["value"]
    return ""


async def fetch_new_emails(user: dict) -> list[dict]:
    """
    Main ingestion function — called by scheduler every 5 minutes.
    Returns list of parsed email dicts ready to be classified + stored.
    """
    prefs_list = await db_select("notification_prefs", filters={"user_id": user["id"]})
    if not prefs_list:
        logger.warning(f"No prefs found for user {user['id']}")
        return []

    prefs = prefs_list[0]
    if not prefs.get("gmail_token"):
        logger.info(f"User {user['id']} has no Gmail token yet")
        return []

    # Decrypt stored token
    try:
        token_data = json.loads(decrypt_token(prefs["gmail_token"]))
    except Exception as e:
        logger.error(f"Token decrypt failed for user {user['id']}: {e}")
        return []

    creds = _build_credentials(token_data)

    # Refresh token if expired
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        # Save refreshed token back to DB
        token_data["access_token"] = creds.token
        await db_update(
            "notification_prefs",
            match={"user_id": user["id"]},
            data={"gmail_token": encrypt_token(json.dumps(token_data))}
        )

    service = build("gmail", "v1", credentials=creds, cache_discovery=False)

    # Build query — fetch since last known history ID, or last 24h
    last_history_id = prefs.get("last_gmail_id")
    query = "is:unread"

    try:
        if last_history_id:
            # Use Gmail history API for incremental fetch (efficient)
            history_response = service.users().history().list(
                userId="me",
                startHistoryId=last_history_id,
                historyTypes=["messageAdded"],
            ).execute()
            message_ids = []
            for record in history_response.get("history", []):
                for msg in record.get("messagesAdded", []):
                    message_ids.append(msg["message"]["id"])
        else:
            # First-time fetch: last 50 unread emails
            result = service.users().messages().list(
                userId="me", q=query, maxResults=50
            ).execute()
            message_ids = [m["id"] for m in result.get("messages", [])]

    except Exception as e:
        logger.error(f"Gmail list error for user {user['id']}: {e}")
        return []

    parsed_emails = []
    new_history_id = last_history_id

    for msg_id in message_ids:
        try:
            msg = service.users().messages().get(
                userId="me", id=msg_id, format="full"
            ).execute()

            headers = msg.get("payload", {}).get("headers", [])
            body = _decode_body(msg.get("payload", {}))
            sender = _get_header(headers, "From")
            subject = _get_header(headers, "Subject")
            date_str = _get_header(headers, "Date")

            # Parse sender domain
            sender_domain = ""
            if "<" in sender and "@" in sender:
                email_addr = sender.split("<")[-1].rstrip(">")
                sender_domain = email_addr.split("@")[-1] if "@" in email_addr else ""

            # Parse received date
            try:
                received_at = email_lib.utils.parsedate_to_datetime(date_str)
            except Exception:
                received_at = datetime.now(timezone.utc)

            parsed_emails.append({
                "user_id": user["id"],
                "source": "gmail",
                "raw_id": msg_id,
                "sender": sender,
                "sender_domain": sender_domain,
                "subject": subject,
                "body_text": body[:5000],  # Cap at 5000 chars
                "received_at": received_at.isoformat(),
                "category": "uncategorized",
                "urgency": "low",
            })

            # Track latest history ID
            msg_history_id = msg.get("historyId")
            if msg_history_id:
                new_history_id = msg_history_id

        except Exception as e:
            logger.error(f"Failed to parse email {msg_id}: {e}")
            continue

    # Save new history ID for next incremental poll
    if new_history_id != last_history_id:
        await db_update(
            "notification_prefs",
            match={"user_id": user["id"]},
            data={"last_gmail_id": new_history_id}
        )

    logger.info(f"Fetched {len(parsed_emails)} new emails for user {user['id']}")
    return parsed_emails
