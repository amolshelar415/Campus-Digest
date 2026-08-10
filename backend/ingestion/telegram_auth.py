"""
One-time script to authenticate Telethon with your Telegram account.
Run this ONCE locally before deploying:

    python ingestion/telegram_auth.py

This creates a `telegram_session.session` file.
Upload that file to Fly.io as a secret or persistent volume.
"""
import asyncio
from telethon import TelegramClient
from core.config import settings


async def main():
    print("=" * 50)
    print("Telegram Authentication — Run this ONCE")
    print("=" * 50)
    client = TelegramClient(
        "telegram_session",
        settings.TELEGRAM_API_ID,
        settings.TELEGRAM_API_HASH,
    )
    await client.start()
    me = await client.get_me()
    print(f"\n✅ Authenticated as: {me.first_name} ({me.phone})")
    print("Session file created: telegram_session.session")
    print("\nKeep this file secret — treat it like a password!")
    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
