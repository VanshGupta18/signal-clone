import os
import threading
from contextlib import contextmanager

import turso
import turso.sync

DB_PATH = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "..", "signal.db"))
# Set both in production to sync the database to Turso Cloud; unset locally = plain SQLite file.
TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL")
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")

# Timestamps are ISO-8601 UTC with a trailing Z so browsers parse them as UTC.
SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE,
    phone         TEXT UNIQUE,
    display_name  TEXT NOT NULL,
    avatar_url    TEXT,
    last_seen_at  TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    CHECK (username IS NOT NULL OR phone IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,  -- sha256 of the token; the raw token only lives on the client
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS contacts (
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    PRIMARY KEY (user_id, contact_user_id),
    CHECK (user_id != contact_user_id)
);

CREATE TABLE IF NOT EXISTS conversations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT NOT NULL CHECK (type IN ('direct', 'group')),
    name        TEXT,
    direct_key  TEXT UNIQUE,
    created_by  INTEGER NOT NULL REFERENCES users(id),
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    CHECK ((type = 'direct' AND direct_key IS NOT NULL) OR (type = 'group' AND name IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id       INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role                  TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    joined_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    last_read_message_id  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON conversation_members(user_id);

CREATE TABLE IF NOT EXISTS messages (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id  INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id        INTEGER NOT NULL REFERENCES users(id),
    client_id        TEXT NOT NULL,
    content          TEXT NOT NULL CHECK (length(content) > 0),
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    UNIQUE (sender_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, id);

CREATE TABLE IF NOT EXISTS message_receipts (
    message_id    INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status        TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read')),
    delivered_at  TEXT,
    read_at       TEXT,
    PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_receipts_user_status ON message_receipts(user_id, status);
"""


_conn: turso.Connection | None = None
_lock = threading.Lock()


def init_db() -> None:
    """Open the app's single connection and create tables. Called once at startup."""
    global _conn
    if TURSO_DATABASE_URL:
        # Production: local file kept in sync with Turso Cloud. On a fresh (wiped)
        # disk this first downloads the database from the cloud.
        _conn = turso.sync.connect(DB_PATH, remote_url=TURSO_DATABASE_URL, auth_token=TURSO_AUTH_TOKEN)
    else:
        _conn = turso.connect(DB_PATH)
    _conn.row_factory = turso.Row  # rows readable by column name: row["id"]
    _conn.execute("PRAGMA foreign_keys = ON")  # off by default in SQLite
    _conn.executescript(SCHEMA)
    _conn.commit()
    _push()


def close_db() -> None:
    global _conn
    if _conn is not None:
        _conn.close()
        _conn = None


def _push() -> None:
    if TURSO_DATABASE_URL:
        _conn.push()  # ponytail: pushes on every request; skip when nothing changed if latency matters


@contextmanager
def db():
    """Exclusive use of the shared connection.

    ponytail: one connection + a global lock = every DB operation runs one at a time.
    Fine for a demo (queries take microseconds); a busier app would use a server DB.
    """
    with _lock:
        try:
            yield _conn
        finally:
            if _conn.in_transaction:  # handler failed mid-write without `with conn:`
                _conn.rollback()
            _push()  # persist to the cloud before the response goes out


def get_db():
    """FastAPI dependency: the connection, held for the duration of one request."""
    with db() as conn:
        yield conn
