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
from api import auth, messages, calendar, user_settings

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

    from notifications.scheduler_jobs import (
        poll_all_users,
        send_morning_digest,
        check_missed_opportunities,
        keepalive_supabase,
    )

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
    docs_url="/docs",    # Always show docs so you can test endpoints
    redoc_url="/redoc",
)

# ── CORS ──────────────────────────────────────────────────────────────
# Allow any Vercel preview URL, localhost, and your production frontend
frontend_url = settings.FRONTEND_URL.rstrip("/")
allowed_origins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "https://campus-digest.vercel.app",
    frontend_url,
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"https://campus-digest.*\.vercel\.app",  # all Vercel previews
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
    expose_headers=["Content-Type"],
)

# ── Routers ───────────────────────────────────────────────────────────
app.include_router(auth.router,          prefix="/api/auth",     tags=["Auth"])
app.include_router(messages.router,     prefix="/api/messages",  tags=["Messages"])
app.include_router(calendar.router,     prefix="/api/calendar",  tags=["Calendar"])
app.include_router(user_settings.router, prefix="/api/user",     tags=["User"])


# ── Health check ──────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}


@app.get("/")
async def root():
    return {"app": "Campus Digest API", "status": "running", "docs": "/docs"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", 8000)),
        reload=settings.DEBUG,
    )
