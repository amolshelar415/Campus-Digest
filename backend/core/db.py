import logging
from supabase import create_client, Client
from core.config import settings

logger = logging.getLogger(__name__)

_supabase: Client | None = None


def get_db() -> Client:
    global _supabase
    if _supabase is None:
        url = settings.SUPABASE_URL.strip().strip('"').strip("'")
        key = settings.SUPABASE_SERVICE_ROLE_KEY.strip().strip('"').strip("'")
        anon_key = settings.SUPABASE_ANON_KEY.strip().strip('"').strip("'")

        if not key:
            key = anon_key

        if not url or not key:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) must be configured.")

        try:
            _supabase = create_client(url, key)
        except Exception as e:
            logger.warning(f"[DB] Failed to init Supabase with service role key: {e}. Trying anon key...")
            if anon_key and anon_key != key:
                _supabase = create_client(url, anon_key)
            else:
                raise e

    return _supabase


# ── Convenience wrappers ────────────────────────────────────────────

async def db_insert(table: str, data: dict) -> dict:
    db = get_db()
    result = db.table(table).insert(data).execute()
    return result.data[0] if result.data else {}


async def db_upsert(table: str, data: dict, on_conflict: str = "id") -> dict:
    db = get_db()
    result = db.table(table).upsert(data, on_conflict=on_conflict).execute()
    return result.data[0] if result.data else {}


async def db_select(table: str, filters: dict | None = None,
                    order: str | None = None, limit: int = 100) -> list:
    db = get_db()
    query = db.table(table).select("*")
    if filters:
        for col, val in filters.items():
            query = query.eq(col, val)
    if order:
        query = query.order(order, desc=True)
    if limit:
        query = query.limit(limit)
    result = query.execute()
    return result.data or []


async def db_update(table: str, match: dict, data: dict) -> dict:
    db = get_db()
    query = db.table(table).update(data)
    for col, val in match.items():
        query = query.eq(col, val)
    result = query.execute()
    return result.data[0] if result.data else {}


async def db_keepalive():
    """Prevents Supabase free-tier from pausing (runs every 3 days)."""
    db = get_db()
    db.table("users").select("id").limit(1).execute()
    logger.info("[DB] Supabase keepalive ping sent ✓")
