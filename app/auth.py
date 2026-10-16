"""Authentication primitives: password hashing, server-side sessions, CSRF.

- Passwords: argon2id (argon2-cffi), with transparent re-hashing when parameters change.
- Sessions: random 256-bit token in an HttpOnly, SameSite=Lax cookie (Secure and
  `__Host-` prefixed in production). Only its SHA-256 is stored in the database,
  so a database leak does not reveal usable session tokens.
- CSRF: synchronizer token stored with the session, returned by /api/auth/me and
  required in the X-CSRF-Token header for every state-changing request; plus an
  Origin check when the browser sends one.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import re
import secrets
from dataclasses import dataclass
from urllib.parse import urlsplit

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .config import Settings
from .db import get_db
from .models import User, UserSession, as_utc, utcnow

_hasher = PasswordHasher()
# Used to keep login timing similar whether or not the email exists.
_DUMMY_HASH = _hasher.hash("timing-equaliser-not-a-real-password")

EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,189}\.[^@\s]{2,63}$")
COMMON_PASSWORDS = {
    "password",
    "password1",
    "password123",
    "12345678",
    "123456789",
    "1234567890",
    "qwertyuiop",
    "iloveyou",
    "11111111",
    "abc12345",
    "letmein123",
    "welcome123",
    "recipebot",
    "recipebot123",
    "admin12345",
    "passw0rd",
    "football1",
    "princess1",
    "sunshine1",
}


def normalize_email(email: str) -> str:
    return email.strip().lower()


def validate_email(email: str) -> str:
    email = normalize_email(email)
    if len(email) > 254 or not EMAIL_RE.match(email):
        raise ValueError("Enter a valid email address.")
    return email


def password_problems(password: str, email: str = "") -> str | None:
    if len(password) < 10:
        return "Use at least 10 characters."
    if len(password) > 128:
        return "Use at most 128 characters."
    if password.lower() in COMMON_PASSWORDS:
        return "That password is too common. Pick something more unique."
    if email and password.lower() == email.split("@")[0].lower():
        return "Don't use your email name as your password."
    return None


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(stored_hash: str | None, password: str) -> tuple[bool, str | None]:
    """Return (ok, new_hash_if_rehash_needed)."""
    try:
        _hasher.verify(stored_hash or _DUMMY_HASH, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False, None
    if stored_hash is None:
        return False, None
    return True, (_hasher.hash(password) if _hasher.check_needs_rehash(stored_hash) else None)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def cookie_name(settings: Settings) -> str:
    return "__Host-rb_session" if settings.cookie_secure else "rb_session"


@dataclass
class AuthContext:
    user: User
    session: UserSession


def create_session(db: Session, user: User, settings: Settings, response: Response) -> UserSession:
    # Opportunistic cleanup of this user's expired sessions.
    db.execute(delete(UserSession).where(UserSession.user_id == user.id, UserSession.expires_at < utcnow()))
    token = secrets.token_urlsafe(32)
    session = UserSession(
        id=_token_hash(token),
        user_id=user.id,
        csrf_token=secrets.token_urlsafe(24),
        expires_at=utcnow() + dt.timedelta(days=settings.session_days),
    )
    db.add(session)
    db.commit()
    response.set_cookie(
        cookie_name(settings),
        token,
        max_age=settings.session_days * 86400,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )
    return session


def clear_session_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(cookie_name(settings), path="/", secure=settings.cookie_secure, httponly=True, samesite="lax")


def _load(request: Request, db: Session) -> AuthContext | None:
    settings: Settings = request.app.state.settings
    token = request.cookies.get(cookie_name(settings))
    if not token or len(token) > 100:
        return None
    row = db.execute(
        select(UserSession, User).join(User, User.id == UserSession.user_id).where(UserSession.id == _token_hash(token))
    ).first()
    if row is None:
        return None
    session, user = row
    if as_utc(session.expires_at) <= utcnow():
        db.delete(session)
        db.commit()
        return None
    return AuthContext(user=user, session=session)


def optional_auth(request: Request, db: Session = Depends(get_db)) -> AuthContext | None:
    return _load(request, db)


def require_auth(request: Request, db: Session = Depends(get_db)) -> AuthContext:
    ctx = _load(request, db)
    if ctx is None:
        raise HTTPException(status_code=401, detail="Please sign in to continue.")
    return ctx


def check_origin(request: Request) -> None:
    """Reject cross-site browser requests. Same-origin or non-browser clients pass."""
    origin = request.headers.get("origin")
    if not origin:
        return
    settings: Settings = request.app.state.settings
    allowed = {f"{request.url.scheme}://{request.url.netloc}", *settings.allowed_origins}
    if settings.app_public_url:
        parts = urlsplit(settings.app_public_url)
        allowed.add(f"{parts.scheme}://{parts.netloc}")
    host = request.headers.get("host")
    if host:
        allowed |= {f"https://{host}", f"http://{host}"}
    if origin not in allowed:
        raise HTTPException(status_code=403, detail="Cross-site request blocked.")


def require_csrf(request: Request, ctx: AuthContext = Depends(require_auth)) -> AuthContext:
    """Use on every state-changing endpoint for signed-in users."""
    check_origin(request)
    supplied = request.headers.get("x-csrf-token", "")
    if not supplied or not hmac.compare_digest(supplied, ctx.session.csrf_token):
        raise HTTPException(
            status_code=403, detail="Your session token is missing or out of date. Refresh the page and try again."
        )
    return ctx
