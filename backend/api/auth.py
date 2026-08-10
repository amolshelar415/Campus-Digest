"""
Auth API Router
Handles Google OAuth login flow and JWT issuance.
"""
import json
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from google_auth_oauthlib.flow import Flow
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from core.config import settings
from core.security import create_access_token, encrypt_token
from core.db import db_select, db_upsert

router = APIRouter()

SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar.events",
]

CLIENT_CONFIG = {
    "web": {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "client_secret": settings.GOOGLE_CLIENT_SECRET,
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "redirect_uris": [settings.GOOGLE_REDIRECT_URI],
    }
}


def _build_flow() -> Flow:
    return Flow.from_client_config(
        CLIENT_CONFIG,
        scopes=SCOPES,
        redirect_uri=settings.GOOGLE_REDIRECT_URI,
    )


@router.get("/login")
async def login():
    """Redirect to Google OAuth consent screen."""
    flow = _build_flow()
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",    # force refresh_token
    )
    return RedirectResponse(url=auth_url)


@router.get("/callback")
async def oauth_callback(code: str, request: Request):
    """
    Handle Google OAuth callback.
    Exchanges code for tokens, creates/updates user, returns JWT.
    """
    try:
        flow = _build_flow()
        flow.fetch_token(code=code)
        credentials = flow.credentials

        # Verify ID token and extract user info
        id_info = id_token.verify_oauth2_token(
            credentials.id_token,
            google_requests.Request(),
            settings.GOOGLE_CLIENT_ID,
        )

        email = id_info.get("email", "")
        name = id_info.get("name", "")
        avatar = id_info.get("picture", "")

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"OAuth error: {e}")

    # Upsert user record
    user = await db_upsert("users", {
        "email": email,
        "name": name,
        "avatar_url": avatar,
    }, on_conflict="email")

    if not user:
        # Fetch existing user
        users = await db_select("users", filters={"email": email})
        if not users:
            raise HTTPException(status_code=500, detail="User creation failed")
        user = users[0]

    # Encrypt and store Gmail OAuth tokens
    token_data = {
        "access_token": credentials.token,
        "refresh_token": credentials.refresh_token,
        "client_id": settings.GOOGLE_CLIENT_ID,
        "client_secret": settings.GOOGLE_CLIENT_SECRET,
    }
    await db_upsert("notification_prefs", {
        "user_id": user["id"],
        "gmail_token": encrypt_token(json.dumps(token_data)),
    }, on_conflict="user_id")

    # Issue our JWT
    access_token = create_access_token({"sub": user["id"], "email": email})

    # Redirect frontend with token (or return JSON for API clients)
    frontend_url = settings.FRONTEND_URL
    return RedirectResponse(
        url=f"{frontend_url}/auth/callback?token={access_token}"
    )


@router.get("/me")
async def get_me(request: Request):
    """Return current user info from JWT."""
    from fastapi.security import HTTPBearer
    from core.dependencies import get_current_user
    from fastapi import Depends
    # This is used by frontend to verify session on load
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    from core.security import decode_access_token
    payload = decode_access_token(auth[7:])
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    users = await db_select("users", filters={"id": payload["sub"]})
    if not users:
        raise HTTPException(status_code=404, detail="User not found")
    return users[0]
