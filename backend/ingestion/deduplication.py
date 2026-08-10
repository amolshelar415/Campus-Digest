"""
Cross-channel Deduplication
Detects when the same notice arrives on both Gmail AND Telegram.
Uses fuzzy text similarity — merges duplicates into a single message card.
"""
from fuzzywuzzy import fuzz
import logging

logger = logging.getLogger(__name__)

SIMILARITY_THRESHOLD = 75   # 0-100; 75 means 75% text overlap = duplicate


def _normalize(text: str) -> str:
    """Lowercase, strip whitespace, remove common filler words."""
    text = text.lower().strip()
    for word in ["please", "kindly", "dear students", "regards", "note:"]:
        text = text.replace(word, "")
    return " ".join(text.split())   # collapse multiple spaces


def deduplicate(new_messages: list[dict],
                existing_messages: list[dict]) -> list[dict]:
    """
    Filter out new_messages that are duplicates of existing_messages.
    Returns only genuinely new (non-duplicate) messages.

    Args:
        new_messages: Just-fetched messages (not yet in DB)
        existing_messages: Last 24h of messages already in DB for this user

    Returns:
        Filtered list of new_messages with duplicates removed
    """
    if not existing_messages:
        return new_messages

    unique = []
    for new_msg in new_messages:
        new_text = _normalize(
            f"{new_msg.get('subject', '')} {new_msg.get('body_text', '')}"
        )
        is_duplicate = False

        for existing in existing_messages:
            # Skip if same source (Gmail↔Gmail duplicates handled by raw_id UNIQUE constraint)
            if existing.get("source") == new_msg.get("source"):
                continue

            existing_text = _normalize(
                f"{existing.get('subject', '')} {existing.get('body_text', '')}"
            )
            score = fuzz.token_set_ratio(new_text, existing_text)
            if score >= SIMILARITY_THRESHOLD:
                logger.info(
                    f"Duplicate detected (score={score}): "
                    f"'{new_msg.get('subject', '')[:50]}' "
                    f"≈ '{existing.get('subject', '')[:50]}'"
                )
                is_duplicate = True
                break

        if not is_duplicate:
            unique.append(new_msg)

    removed = len(new_messages) - len(unique)
    if removed:
        logger.info(f"Deduplication: removed {removed} cross-channel duplicates")

    return unique
