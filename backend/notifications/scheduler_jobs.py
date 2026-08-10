"""
APScheduler Background Jobs
All scheduled tasks: polling, digest, missed-opportunity checker, keepalive.
"""
import logging
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)


async def poll_all_users():
    """
    Main polling job — runs every 5 minutes.
    Fetches new emails + Telegram messages for all users.
    Classifies and stores them.
    """
    from core.db import db_select, db_insert, db_upsert
    from ingestion.gmail import fetch_new_emails
    from ingestion.telegram import fetch_new_group_messages
    from ingestion.deduplication import deduplicate
    from ml.classifier import classify, score_urgency
    from ml.deadline_extractor import extract_deadline
    from notifications.fcm import send_push
    from notifications.telegram_bot import send_alert

    users = await db_select("users")
    logger.info(f"[Scheduler] Polling for {len(users)} users")

    for user in users:
        try:
            # 1. Fetch new messages from both sources
            gmail_msgs = await fetch_new_emails(user)
            tg_msgs = await fetch_new_group_messages(user)
            all_new = gmail_msgs + tg_msgs

            if not all_new:
                continue

            # 2. Get recent messages for deduplication check
            recent = await db_select(
                "messages",
                filters={"user_id": user["id"]},
                order="received_at",
                limit=50
            )
            unique_msgs = deduplicate(all_new, recent)

            # 3. Classify + extract deadline + store each message
            prefs_list = await db_select("notification_prefs",
                                          filters={"user_id": user["id"]})
            prefs = prefs_list[0] if prefs_list else {}

            for msg in unique_msgs:
                # Classify
                result = classify(
                    f"{msg.get('subject', '')} {msg.get('body_text', '')}",
                    sender=msg.get("sender", ""),
                    sender_domain=msg.get("sender_domain", ""),
                )
                msg["category"] = result["category"]
                msg["confidence"] = result["confidence"]

                # Extract deadline
                deadline = extract_deadline(
                    f"{msg.get('subject', '')} {msg.get('body_text', '')}"
                )
                msg["deadline"] = deadline.isoformat() if deadline else None

                # Score urgency
                msg["urgency"] = score_urgency(
                    f"{msg.get('subject', '')} {msg.get('body_text', '')}",
                    deadline=deadline
                )

                # Store in DB (UNIQUE constraint handles duplicates safely)
                try:
                    stored = await db_upsert(
                        "messages",
                        msg,
                        on_conflict="user_id,source,raw_id"
                    )
                except Exception as e:
                    logger.warning(f"DB upsert skipped (duplicate?): {e}")
                    continue

                # 4. Notify if high urgency
                if msg["urgency"] == "high" and msg["category"] != "spam":
                    subject = msg.get("subject", "Urgent update")
                    now = datetime.now(timezone.utc)
                    hour = now.hour

                    # DND check
                    dnd_start = prefs.get("dnd_start", "23:00")
                    dnd_end = prefs.get("dnd_end", "08:00")
                    dnd_start_h = int(dnd_start.split(":")[0]) if dnd_start else 23
                    dnd_end_h = int(dnd_end.split(":")[0]) if dnd_end else 8
                    in_dnd = (hour >= dnd_start_h) or (hour < dnd_end_h)

                    if not in_dnd:
                        # FCM push
                        if prefs.get("fcm_token"):
                            await send_push(
                                prefs["fcm_token"],
                                title="⚡ Urgent — Campus Digest",
                                body=subject[:80],
                                data={"message_id": str(stored.get("id", ""))}
                            )
                        # Telegram alert
                        if prefs.get("telegram_chat_id") and prefs.get("tg_digest"):
                            await send_alert(
                                prefs["telegram_chat_id"],
                                subject=subject,
                                urgency="high",
                                deadline=msg.get("deadline")
                            )

        except Exception as e:
            logger.error(f"Poll error for user {user.get('id')}: {e}")


async def send_morning_digest():
    """
    Daily 9 AM digest via Telegram bot.
    Sends summary of all unread messages from last 24h.
    """
    from core.db import db_select
    from notifications.telegram_bot import send_digest
    from datetime import timezone

    users = await db_select("users")
    yesterday = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()

    for user in users:
        prefs_list = await db_select("notification_prefs",
                                      filters={"user_id": user["id"]})
        prefs = prefs_list[0] if prefs_list else {}

        if not prefs.get("tg_digest") or not prefs.get("telegram_chat_id"):
            continue

        # Get unread messages from last 24h (excluding spam)
        from core.db import get_db
        db = get_db()
        result = (db.table("messages")
                  .select("*")
                  .eq("user_id", user["id"])
                  .eq("is_read", False)
                  .eq("is_dismissed", False)
                  .neq("category", "spam")
                  .gte("received_at", yesterday)
                  .order("urgency", desc=True)
                  .limit(20)
                  .execute())

        messages = result.data or []
        if messages:
            await send_digest(prefs["telegram_chat_id"], messages)
            logger.info(f"Digest sent to user {user['id']} ({len(messages)} msgs)")


async def check_missed_opportunities():
    """
    Escalation checker — runs every 4 hours.
    If a high-urgency message is unread for >4h, send another alert.
    """
    from core.db import db_select, get_db
    from notifications.fcm import send_push
    from notifications.telegram_bot import send_alert

    cutoff = (datetime.now(timezone.utc) - timedelta(hours=4)).isoformat()
    users = await db_select("users")

    for user in users:
        from core.db import get_db
        db = get_db()
        result = (db.table("messages")
                  .select("*")
                  .eq("user_id", user["id"])
                  .eq("urgency", "high")
                  .eq("is_read", False)
                  .eq("is_dismissed", False)
                  .lte("received_at", cutoff)
                  .execute())

        missed = result.data or []
        if not missed:
            continue

        prefs_list = await db_select("notification_prefs",
                                      filters={"user_id": user["id"]})
        prefs = prefs_list[0] if prefs_list else {}

        for msg in missed[:3]:  # alert at most 3 missed items
            subject = msg.get("subject", "Unread urgent message")
            logger.info(f"Escalating unread high-urgency for user {user['id']}: {subject[:50]}")
            if prefs.get("fcm_token"):
                await send_push(
                    prefs["fcm_token"],
                    title="⚠️ You missed an urgent update!",
                    body=subject[:80],
                )
            if prefs.get("telegram_chat_id"):
                await send_alert(prefs["telegram_chat_id"], subject, urgency="high")


async def keepalive_supabase():
    """Prevents Supabase free tier from pausing (runs every 3 days)."""
    from core.db import db_keepalive
    await db_keepalive()
