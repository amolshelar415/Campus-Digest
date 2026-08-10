"""
ML Classifier — TF-IDF + Logistic Regression
Classifies college emails/messages into 4 categories.
Lightweight enough to run in 256MB RAM (Fly.io free tier).
"""
try:
    import joblib
    from sklearn.pipeline import Pipeline
    HAS_SKLEARN = True
except ImportError:
    HAS_SKLEARN = False
    joblib = None
    Pipeline = None

from core.config import settings

logger = logging.getLogger(__name__)

CATEGORIES = ["placement", "faculty", "department", "spam"]

# ── Spam detection rules (fast, rule-based) ─────────────────────────
SPAM_KEYWORDS = [
    "guaranteed internship", "pay now", "limited seats", "enroll now",
    "certificate course", "click here to claim", "offer expires",
    "100% placement", "register fee", "fee payment", "money back",
    "limited time offer", "exclusive offer", "join our batch",
    "online course discount", "get certified", "job guaranteed",
]

TRUSTED_DOMAINS = [
    # Add your college domain(s) here
    "clg.edu.in", "college.edu", "ac.in",
]

NON_COLLEGE_DOMAINS = ["gmail.com", "yahoo.com", "hotmail.com",
                        "outlook.com", "rediffmail.com"]

# ── Urgency keywords ─────────────────────────────────────────────────
HIGH_URGENCY_KEYWORDS = [
    "today", "urgent", "mandatory", "compulsory", "last chance",
    "closes today", "form closes", "deadline today", "immediate",
    "by tonight", "by end of day", "today only",
]

MEDIUM_URGENCY_KEYWORDS = [
    "this week", "deadline", "submit by", "register before",
    "last date", "before", "don't miss", "important",
]


def is_spam_rule(text: str, sender_domain: str) -> bool:
    """Fast rule-based spam detection (runs before ML classifier)."""
    text_lower = text.lower()
    if any(kw in text_lower for kw in SPAM_KEYWORDS):
        return True
    if (sender_domain in NON_COLLEGE_DOMAINS and
            not any(kw in text_lower for kw in ["tpo", "placement", "internship drive"])):
        return True
    return False


def score_urgency(text: str, deadline=None) -> str:
    """Returns 'high', 'medium', or 'low' based on keywords + deadline."""
    from datetime import datetime, timezone, timedelta
    text_lower = text.lower()

    if deadline:
        now = datetime.now(timezone.utc)
        try:
            if isinstance(deadline, str):
                import dateparser
                deadline = dateparser.parse(deadline, settings={"RETURN_AS_TIMEZONE_AWARE": True})
            if deadline and (deadline - now) <= timedelta(hours=24):
                return "high"
            elif deadline and (deadline - now) <= timedelta(days=7):
                return "medium"
        except Exception:
            pass

    if any(kw in text_lower for kw in HIGH_URGENCY_KEYWORDS):
        return "high"
    if any(kw in text_lower for kw in MEDIUM_URGENCY_KEYWORDS):
        return "medium"
    return "low"


def load_model():
    """Load trained model from disk. Returns None if not trained yet."""
    if not HAS_SKLEARN or joblib is None:
        return None
    clf_path = settings.ML_CLASSIFIER_PATH
    if os.path.exists(clf_path):
        return joblib.load(clf_path)
    logger.warning("Classifier model not found. Run `python ml/train.py` first.")
    return None


def classify(text: str, sender: str = "", sender_domain: str = "") -> dict:
    """
    Classify a single message.
    Returns: {"category": str, "confidence": float}
    """
    full_text = f"{sender} {text}"

    # Step 1: Fast spam rule check
    if is_spam_rule(text, sender_domain):
        return {"category": "spam", "confidence": 0.95}

    # Step 2: ML classifier
    model = load_model()
    if model:
        try:
            proba = model.predict_proba([full_text])[0]
            idx = proba.argmax()
            return {
                "category": CATEGORIES[idx],
                "confidence": round(float(proba[idx]), 3),
            }
        except Exception as e:
            logger.error(f"Classifier error: {e}")

    # Step 3: Fallback — keyword-based classification
    text_lower = text.lower()
    if any(w in text_lower for w in ["placement", "internship", "tpo", "drive", "aptitude", "offer letter"]):
        return {"category": "placement", "confidence": 0.6}
    if any(w in text_lower for w in ["assignment", "quiz", "lecture", "attendance", "grade", "marks", "faculty"]):
        return {"category": "faculty", "confidence": 0.6}
    if any(w in text_lower for w in ["department", "timetable", "schedule", "notice", "circular", "exam"]):
        return {"category": "department", "confidence": 0.6}
    return {"category": "department", "confidence": 0.4}
