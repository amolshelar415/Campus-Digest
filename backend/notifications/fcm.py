"""
Firebase Cloud Messaging — Push Notifications
Uses Firebase Admin SDK (free tier, 10M pushes/month).
"""
import firebase_admin
from firebase_admin import credentials, messaging
from core.config import settings
import logging

logger = logging.getLogger(__name__)

_initialized = False


import os

def _init_firebase():
    global _initialized
    if not _initialized:
        if not os.path.exists(settings.FIREBASE_CREDENTIALS_PATH):
            logger.warning(f"Firebase credentials file not found at {settings.FIREBASE_CREDENTIALS_PATH}. Push notifications disabled.")
            return
        try:
            cred = credentials.Certificate(settings.FIREBASE_CREDENTIALS_PATH)
            firebase_admin.initialize_app(cred)
            _initialized = True
        except Exception as e:
            logger.error(f"Firebase init error: {e}")


async def send_push(fcm_token: str, title: str, body: str,
                    data: dict | None = None) -> bool:
    """Send a single push notification to a device."""
    _init_firebase()
    if not fcm_token:
        return False
    try:
        message = messaging.Message(
            notification=messaging.Notification(title=title, body=body),
            data=data or {},
            token=fcm_token,
            android=messaging.AndroidConfig(priority="high"),
            apns=messaging.APNSConfig(
                payload=messaging.APNSPayload(
                    aps=messaging.Aps(sound="default")
                )
            ),
            webpush=messaging.WebpushConfig(
                notification=messaging.WebpushNotification(
                    title=title,
                    body=body,
                    icon="/icon-192.png",
                )
            ),
        )
        messaging.send(message)
        return True
    except Exception as e:
        logger.error(f"FCM push failed: {e}")
        return False


async def send_push_batch(tokens: list[str], title: str, body: str) -> None:
    """Send to multiple devices (up to 500 at once via FCM multicast)."""
    _init_firebase()
    if not tokens:
        return
    try:
        message = messaging.MulticastMessage(
            notification=messaging.Notification(title=title, body=body),
            tokens=tokens[:500],
        )
        response = messaging.send_each_for_multicast(message)
        logger.info(f"FCM batch: {response.success_count} sent, "
                    f"{response.failure_count} failed")
    except Exception as e:
        logger.error(f"FCM batch error: {e}")
