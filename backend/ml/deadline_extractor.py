"""
Deadline Extractor
Parses deadline dates from email/message text using dateparser + regex.
Only extracts dates near trigger words to avoid false positives.
"""
import re
import dateparser
from datetime import datetime, timezone
import logging

logger = logging.getLogger(__name__)

TRIGGER_PHRASES = [
    "deadline", "last date", "last day", "due", "due on", "due by",
    "submit by", "submit before", "submission deadline", "closes on",
    "closes at", "form closes", "register before", "register by",
    "registration closes", "before", "by", "apply by", "apply before",
    "last date to", "on or before",
]

DATEPARSER_SETTINGS = {
    "PREFER_DATES_FROM": "future",
    "RETURN_AS_TIMEZONE_AWARE": True,
    "PREFER_DAY_OF_MONTH": "first",
    "DATE_ORDER": "DMY",     # Indian date format: DD/MM/YYYY
}


def _find_trigger_snippets(text: str) -> list[str]:
    """Extract text snippets near trigger phrases."""
    snippets = []
    text_lower = text.lower()
    for phrase in TRIGGER_PHRASES:
        idx = text_lower.find(phrase)
        if idx != -1:
            # 80 chars before and after trigger phrase
            start = max(0, idx - 10)
            end = min(len(text), idx + len(phrase) + 80)
            snippets.append(text[start:end])
    return snippets


def extract_deadline(text: str) -> datetime | None:
    """
    Extract the most relevant upcoming deadline from message text.
    Returns a timezone-aware datetime or None.
    """
    now = datetime.now(timezone.utc)
    candidates = []

    # Try trigger-phrase-based extraction first (more accurate)
    snippets = _find_trigger_snippets(text)
    for snippet in snippets:
        try:
            parsed = dateparser.parse(snippet, settings=DATEPARSER_SETTINGS)
            if parsed and parsed > now:
                candidates.append(parsed)
        except Exception:
            continue

    # Fallback: try regex patterns for common Indian date formats
    patterns = [
        r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b",   # DD/MM/YYYY or DD-MM-YYYY
        r"\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{4})\b",
        r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{1,2}),?\s+(\d{4})\b",
        r"\btoday\b",
        r"\btomorrow\b",
    ]
    for pattern in patterns:
        for match in re.finditer(pattern, text, re.IGNORECASE):
            try:
                parsed = dateparser.parse(match.group(), settings=DATEPARSER_SETTINGS)
                if parsed and parsed > now:
                    candidates.append(parsed)
            except Exception:
                continue

    if not candidates:
        return None

    # Return the earliest upcoming deadline
    return min(candidates)
