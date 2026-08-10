"""
Telegram Bot — Personal Digest Sender
Uses python-telegram-bot to send messages to students' personal Telegram.
"""
import logging
from telegram import Bot
from telegram.constants import ParseMode
from core.config import settings

logger = logging.getLogger(__name__)

_bot: Bot | None = None


def get_bot() -> Bot:
    global _bot
    if _bot is None:
        _bot = Bot(token=settings.TELEGRAM_BOT_TOKEN)
    return _bot


URGENCY_EMOJI = {"high": "🔴", "medium": "🟡", "low": "🔵"}
CATEGORY_EMOJI = {"placement": "🎓", "faculty": "📚", "department": "🏫", "spam": "⚠️"}


async def send_digest(telegram_chat_id: int, messages: list[dict]) -> bool:
    """
    Send a daily digest summary to a student's personal Telegram chat.
    Groups messages by urgency level.
    """
    if not telegram_chat_id or not messages:
        return False

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)

    high = [m for m in messages if m.get("urgency") == "high"]
    medium = [m for m in messages if m.get("urgency") == "medium"]
    low = [m for m in messages if m.get("urgency") == "low"
           and m.get("category") != "spam"]

    lines = [f"📬 *Campus Digest* — {now.strftime('%b %d, %Y')}", ""]

    if high:
        lines.append(f"🔴 *Act Now* ({len(high)})")
        for m in high[:5]:     # max 5 items per section
            deadline = f" — _deadline: {m['deadline']}_" if m.get("deadline") else ""
            lines.append(f"• {m.get('subject', 'No subject')[:60]}{deadline}")
        lines.append("")

    if medium:
        lines.append(f"🟡 *This Week* ({len(medium)})")
        for m in medium[:5]:
            lines.append(f"• {m.get('subject', 'No subject')[:60]}")
        lines.append("")

    if low:
        lines.append(f"🔵 *For Reference* ({len(low)})")
        for m in low[:3]:
            lines.append(f"• {m.get('subject', 'No subject')[:60]}")
        lines.append("")

    lines.append("🌐 [Open Dashboard](https://campus-digest.vercel.app)")

    text = "\n".join(lines)
    try:
        bot = get_bot()
        await bot.send_message(
            chat_id=telegram_chat_id,
            text=text,
            parse_mode=ParseMode.MARKDOWN,
            disable_web_page_preview=True,
        )
        return True
    except Exception as e:
        logger.error(f"Telegram digest error for chat {telegram_chat_id}: {e}")
        return False


async def send_alert(telegram_chat_id: int, subject: str,
                     urgency: str = "high", deadline: str | None = None) -> bool:
    """Send a single urgent alert message."""
    if not telegram_chat_id:
        return False
    emoji = URGENCY_EMOJI.get(urgency, "🔔")
    deadline_text = f"\n⏰ Deadline: *{deadline}*" if deadline else ""
    text = (f"{emoji} *Urgent Update*\n\n"
            f"{subject[:120]}"
            f"{deadline_text}\n\n"
            f"[Open →](https://campus-digest.vercel.app)")
    try:
        bot = get_bot()
        await bot.send_message(
            chat_id=telegram_chat_id,
            text=text,
            parse_mode=ParseMode.MARKDOWN,
        )
        return True
    except Exception as e:
        logger.error(f"Telegram alert error: {e}")
        return False
