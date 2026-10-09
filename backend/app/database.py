import os
import threading
import time
import logging
from contextlib import contextmanager

import turso
import turso.sync

DB_PATH = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "..", "signal.db"))
# Set both in production to sync the database to Turso Cloud; unset locally = plain SQLite file.
# .strip(): a value pasted into a dashboard often carries a trailing newline, which is
# invalid inside an HTTP header and makes every Turso request fail.
TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL", "").strip()
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN", "").strip()

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
CREATE INDEX IF NOT EXISTS idx_members_user_read ON conversation_members(user_id, last_read_message_id);

CREATE TABLE IF NOT EXISTS messages (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id  INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id        INTEGER NOT NULL REFERENCES users(id),
    client_id        TEXT NOT NULL,
    content          TEXT NOT NULL CHECK (length(content) > 0),
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    reply_to_id      INTEGER REFERENCES messages(id) ON DELETE SET NULL,  -- quoted message, same conversation
    UNIQUE (sender_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_sender ON messages(conversation_id, sender_id, id);

CREATE TABLE IF NOT EXISTS message_receipts (
    message_id    INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status        TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read')),
    delivered_at  TEXT,
    read_at       TEXT,
    PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_receipts_user_status ON message_receipts(user_id, status);

-- One reaction per user per message, like Signal: a new emoji replaces the old one.
CREATE TABLE IF NOT EXISTS message_reactions (
    message_id  INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji       TEXT NOT NULL CHECK (length(emoji) <= 16),
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    PRIMARY KEY (message_id, user_id)
);
"""


_conn: turso.Connection | None = None
_lock = threading.Lock()
logger = logging.getLogger(__name__)


def _change_count() -> int:
    return _conn.execute("SELECT total_changes()").fetchone()[0]


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
    migrate(_conn)
    _conn.commit()
    _push()


def migrate(conn: turso.Connection) -> None:
    """Columns added after the first deploy. CREATE TABLE IF NOT EXISTS skips existing tables,
    so a database created by an older SCHEMA (production on Turso) gets them here. Idempotent."""
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(messages)").fetchall()}
    if "reply_to_id" not in columns:
        conn.execute("ALTER TABLE messages ADD COLUMN reply_to_id INTEGER REFERENCES messages(id) ON DELETE SET NULL")


def close_db() -> None:
    """Shutdown. Takes the lock like every other user of the connection: on shutdown, closing
    WebSockets still write last_seen_at from worker threads, and closing the connection under
    a running write crashes pyturso ("end_write_tx called while write lock not held")."""
    global _conn
    with _lock:
        if _conn is None:
            return
        if _unpushed:  # graceful shutdown (deploy, Render idle spin-down): don't strand commits
            try:
                _push()
            except Exception:
                logger.exception("turso_push_failed_on_shutdown")
        _conn.close()
        _conn = None


# True when local commits haven't reached Turso yet (see db(push_now=False)).
_unpushed = False


def _push() -> None:
    """Sync local commits to Turso Cloud. Caller holds _lock."""
    global _unpushed
    if TURSO_DATABASE_URL:
        _conn.push()  # several network round trips: ~0.5s near the DB, ~3s across continents
    _unpushed = False


def push_pending() -> None:
    """Push commits made with db(push_now=False). The WebSocket calls this right after replying,
    so a chat message is acked as soon as it's committed locally instead of waiting for Turso."""
    if not _unpushed:
        return
    with _lock:
        if _unpushed:
            try:
                _push()
            except Exception:  # network blip: _unpushed stays True, the next write/push retries
                logger.exception("turso_push_failed")


@contextmanager
def db(push_now: bool = True):
    """Exclusive use of the shared connection.

    After a write, `push_now=True` syncs to Turso before returning (REST: the response only
    goes out once the write is in the cloud). `push_now=False` leaves it to push_pending().

    ponytail: one connection + a global lock = every DB operation runs one at a time.
    Fine for a demo (queries take microseconds); a busier app would use a server DB.
    """
    global _unpushed
    waited_at = time.perf_counter()
    with _lock:
        if _conn is None:  # after close_db(): fail cleanly instead of crashing on a closed handle
            raise RuntimeError("database is closed")
        waited_ms = (time.perf_counter() - waited_at) * 1000
        if waited_ms > 25:
            logger.warning("db_lock_wait_ms=%.1f", waited_ms)
        started_at = time.perf_counter()
        changes_before = _change_count()
        try:
            yield _conn
        except BaseException:
            if _conn.in_transaction:  # handler failed mid-write without `with conn:`
                _conn.rollback()
            raise
        else:
            if _conn.in_transaction:  # handler returned without committing a write
                _conn.rollback()
            # Read-only requests should not wait on a network round-trip to Turso.
            # Writes still push before the request returns, preserving persistence
            # guarantees while avoiding a push storm during list/history reloads.
            if _change_count() != changes_before:
                _unpushed = True
                if push_now:
                    _push()
        finally:
            elapsed_ms = (time.perf_counter() - started_at) * 1000
            if elapsed_ms > 100:
                logger.warning("db_operation_ms=%.1f", elapsed_ms)


def get_db():
    """FastAPI dependency: the connection, held for the duration of one request."""
    with db() as conn:
        yield conn
