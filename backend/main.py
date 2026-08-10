"""
Campus Digest — FastAPI Monolith Entry Point
Single app handles: API, background scheduling, all services.
"""
import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from core.config import settings
from api import auth, messages

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler(timezone="Asia/Kolkata")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """App startup: init scheduler. Shutdown: stop scheduler."""
    logger.info("🚀 Campus Digest API starting up...")

    # Import jobs here to avoid circular imports
    from notifications.scheduler_jobs import (
        poll_all_users,
        send_morning_digest,
        check_missed_opportunities,
        keepalive_supabase,
    )

    # ── Schedule all background jobs ─────────────────────────────────
    scheduler.add_job(
        poll_all_users,
        IntervalTrigger(minutes=settings.POLL_INTERVAL_MINUTES),
        id="poll_emails",
        name="Poll Gmail + Telegram",
        replace_existing=True,
    )
    scheduler.add_job(
        send_morning_digest,
        CronTrigger(hour=settings.DIGEST_HOUR, minute=settings.DIGEST_MINUTE),
        id="morning_digest",
        name="Daily Telegram Digest",
        replace_existing=True,
    )
    scheduler.add_job(
        check_missed_opportunities,
        IntervalTrigger(hours=settings.MISSED_ALERT_HOURS),
        id="missed_checker",
        name="Missed Opportunity Checker",
        replace_existing=True,
    )
    scheduler.add_job(
        keepalive_supabase,
        IntervalTrigger(days=3),
        id="db_keepalive",
        name="Supabase Keepalive",
        replace_existing=True,
    )

    scheduler.start()
    logger.info(f"✅ Scheduler started with {len(scheduler.get_jobs())} jobs")

    yield   # App runs here

    scheduler.shutdown(wait=False)
    logger.info("Scheduler stopped.")


# ── App Instance ─────────────────────────────────────────────────────
app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    description="Smart Academic Notification Aggregator — Backend API",
    lifespan=lifespan,
    docs_url="/docs" if settings.DEBUG else None,   # Hide docs in production
    redoc_url=None,
)

# ── CORS ──────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://campus-digest.vercel.app",
        # Add your Vercel preview URLs here too
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

# ── Routers ───────────────────────────────────────────────────────────
app.include_router(auth.router,     prefix="/api/auth",     tags=["Auth"])
app.include_router(messages.router, prefix="/api/messages", tags=["Messages"])


# ── Health check (Fly.io uses this) ──────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}


@app.get("/")
async def root():
    return {"app": "Campus Digest API", "status": "running"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", 8000)),
        reload=settings.DEBUG,
    )
