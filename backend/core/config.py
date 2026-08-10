from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ── App ────────────────────────────────────────────────────────
    APP_NAME: str = "Campus Digest API"
    DEBUG: bool = False
    SECRET_KEY: str = "default_secret_key_change_in_production"

    # ── Supabase ───────────────────────────────────────────────────
    SUPABASE_URL: str = ""
    SUPABASE_ANON_KEY: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""

    # ── Frontend ──────────────────────────────────────────────────
    FRONTEND_URL: str = "http://localhost:3000"

    # ── Google OAuth + APIs ────────────────────────────────────────
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/api/auth/callback"

    # ── Telegram ──────────────────────────────────────────────────
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_API_ID: int = 0
    TELEGRAM_API_HASH: str = ""
    TELEGRAM_GROUP_ID: int = 0

    # ── Firebase FCM ──────────────────────────────────────────────
    FIREBASE_CREDENTIALS_PATH: str = "firebase-credentials.json"

    # ── Upstash Redis ─────────────────────────────────────────────
    UPSTASH_REDIS_URL: str = ""
    UPSTASH_REDIS_TOKEN: str = ""

    # ── ML ────────────────────────────────────────────────────────
    ML_CLASSIFIER_PATH: str = "ml/models/classifier.pkl"
    ML_VECTORIZER_PATH: str = "ml/models/vectorizer.pkl"

    # ── Scheduler ─────────────────────────────────────────────────
    POLL_INTERVAL_MINUTES: int = 5
    DIGEST_HOUR: int = 9                # 9 AM local time
    DIGEST_MINUTE: int = 0
    MISSED_ALERT_HOURS: int = 4        # escalate if high-urgency unread > 4h

    # ── JWT ───────────────────────────────────────────────────────
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7   # 7 days


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
