from datetime import datetime, timedelta, timezone
from jose import jwt, JWTError
from core.config import settings
from cryptography.fernet import Fernet
import base64, hashlib


# ── JWT ──────────────────────────────────────────────────────────────

def create_access_token(data: dict) -> str:
    payload = data.copy()
    payload["exp"] = datetime.now(timezone.utc) + timedelta(
        minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    return jwt.encode(payload, settings.SECRET_KEY,
                      algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.SECRET_KEY,
                          algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        return None


# ── Token encryption (for Gmail OAuth tokens stored in DB) ───────────

def _fernet() -> Fernet:
    # Derive a valid 32-byte Fernet key from SECRET_KEY
    key_bytes = hashlib.sha256(settings.SECRET_KEY.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key_bytes))


def encrypt_token(plain: str) -> str:
    return _fernet().encrypt(plain.encode()).decode()


def decrypt_token(encrypted: str) -> str:
    return _fernet().decrypt(encrypted.encode()).decode()
