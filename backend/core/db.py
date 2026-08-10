from supabase import create_client, Client
from core.config import settings

# Supabase client — service role (bypasses RLS for server-side ops)
# We enforce data isolation manually via user_id filters
_supabase: Client | None = None


def get_db() -> Client:
    global _supabase
    if _supabase is None:
        _supabase = create_client(
            settings.SUPABASE_URL,
            settings.SUPABASE_SERVICE_ROLE_KEY,
        )
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
    print("[DB] Supabase keepalive ping sent ✓")
