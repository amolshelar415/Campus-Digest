"""
Telegram Group Reader (Bot API Mode)
Uses standard Telegram Bot API (getUpdates) to read messages from group.
No user account login or Telethon required!

Prerequisites:
1. Message @BotFather -> /setprivacy -> Select your bot -> Choose "Disable"
2. Add the bot as a member to your college Telegram group.
"""
import httpx
import logging
from datetime import datetime, timezone
from core.config import settings
from core.db import db_select, db_update

logger = logging.getLogger(__name__)

BOT_API_URL = f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}"


async def fetch_new_group_messages(user: dict) -> list[dict]:
    """
    Fetch new messages from the college Telegram group using Bot API getUpdates.
    Uses offset tracking to avoid re-reading old messages.
    """
    prefs_list = await db_select("notification_prefs", filters={"user_id": user["id"]})
    if not prefs_list:
        return []

    prefs = prefs_list[0]
    last_offset = prefs.get("last_tg_offset") or 0

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            params = {
                "offset": last_offset + 1 if last_offset else 0,
                "limit": 100,
                "allowed_updates": ["message"],
            }
            r = await client.get(f"{BOT_API_URL}/getUpdates", params=params)
            res = r.json()

            if not res.get("ok"):
                logger.error(f"Telegram Bot API error: {res}")
                return []

            updates = res.get("result", [])
            parsed = []
            new_max_offset = last_offset

            for update in updates:
                update_id = update["update_id"]
                new_max_offset = max(new_max_offset, update_id)

                msg = update.get("message") or update.get("channel_post")
                if not msg:
                    continue

                chat = msg.get("chat", {})
                chat_id = chat.get("id")

                # Filter to only messages from the specified college group (if configured)
                if settings.TELEGRAM_GROUP_ID and chat_id != settings.TELEGRAM_GROUP_ID:
                    continue

                text = msg.get("text") or msg.get("caption") or ""
                if not text.strip():
                    continue

                sender = msg.get("from", {})
                sender_name = sender.get("first_name", "") or chat.get("title", "Group Notice")
                if sender.get("last_name"):
                    sender_name += f" {sender['last_name']}"

                msg_date = msg.get("date")
                received_at = (
                    datetime.fromtimestamp(msg_date, tz=timezone.utc).isoformat()
                    if msg_date
                    else datetime.now(timezone.utc).isoformat()
                )

                parsed.append({
                    "user_id": user["id"],
                    "source": "telegram",
                    "raw_id": str(msg.get("message_id", update_id)),
                    "sender": sender_name.strip(),
                    "sender_domain": "telegram",
                    "subject": text[:80].strip(),
                    "body_text": text[:5000].strip(),
                    "received_at": received_at,
                    "category": "uncategorized",
                    "urgency": "low",
                })

            # Save highest update_id offset
            if new_max_offset > last_offset:
                await db_update(
                    "notification_prefs",
                    match={"user_id": user["id"]},
                    data={"last_tg_offset": new_max_offset}
                )

            logger.info(f"Fetched {len(parsed)} Telegram group messages via Bot API")
            return parsed

    except Exception as e:
        logger.error(f"Telegram Bot API fetch error: {e}")
        return []
