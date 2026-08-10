import httpx
from core.config import settings

# Upstash Redis REST API — no redis-py needed (works on free Fly.io VM)
HEADERS = {
    "Authorization": f"Bearer {settings.UPSTASH_REDIS_TOKEN}",
    "Content-Type": "application/json",
}
BASE_URL = settings.UPSTASH_REDIS_URL


async def cache_get(key: str) -> str | None:
    async with httpx.AsyncClient() as client:
        r = await client.post(f"{BASE_URL}/get/{key}", headers=HEADERS)
        data = r.json()
        return data.get("result")


async def cache_set(key: str, value: str, ttl_seconds: int = 60) -> None:
    async with httpx.AsyncClient() as client:
        await client.post(
            f"{BASE_URL}/set/{key}/{value}/EX/{ttl_seconds}",
            headers=HEADERS
        )


async def cache_delete(key: str) -> None:
    async with httpx.AsyncClient() as client:
        await client.post(f"{BASE_URL}/del/{key}", headers=HEADERS)


async def cache_incr(key: str) -> int:
    async with httpx.AsyncClient() as client:
        r = await client.post(f"{BASE_URL}/incr/{key}", headers=HEADERS)
        return r.json().get("result", 0)


# ── Rate limiting helper ─────────────────────────────────────────────
async def is_rate_limited(user_id: str, action: str, limit: int = 10,
                           window_seconds: int = 60) -> bool:
    key = f"rl:{user_id}:{action}"
    count = await cache_incr(key)
    if count == 1:
        await cache_set(key, "1", ttl_seconds=window_seconds)
    return count > limit
