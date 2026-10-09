import hashlib
import secrets

import turso
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.database import get_db

bearer = HTTPBearer(auto_error=False)


def hash_token(token: str) -> str:
    # Only the hash is stored, so a leaked DB file doesn't leak usable sessions.
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(conn: turso.Connection, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    conn.execute("INSERT INTO sessions (user_id, token_hash) VALUES (?, ?)", (user_id, hash_token(token)))
    return token


def user_for_token(conn: turso.Connection, token: str) -> turso.Row | None:
    """Shared by REST (below) and, later, the WebSocket handshake."""
    return conn.execute(
        "SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ?",
        (hash_token(token),),
    ).fetchone()


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    conn: turso.Connection = Depends(get_db),
) -> turso.Row:
    """The only way a handler learns who the caller is: from the session token, never from the request body."""
    user = user_for_token(conn, credentials.credentials) if credentials else None
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


def public_user(row: turso.Row) -> dict:
    return {
        "id": row["id"],
        "phone": row["phone"],
        "display_name": row["display_name"],
        "avatar_url": row["avatar_url"],
        "last_seen_at": row["last_seen_at"],
    }
