import os
import sqlite3

DB_PATH = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "..", "signal.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE,
    phone         TEXT UNIQUE,
    display_name  TEXT NOT NULL,
    avatar_url    TEXT,
    last_seen_at  TEXT,
    created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (username IS NOT NULL OR phone IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token       TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contacts (
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, contact_user_id),
    CHECK (user_id != contact_user_id)
);

CREATE TABLE IF NOT EXISTS conversations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT NOT NULL CHECK (type IN ('direct', 'group')),
    name        TEXT,
    direct_key  TEXT UNIQUE,
    created_by  INTEGER NOT NULL REFERENCES users(id),
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ((type = 'direct' AND direct_key IS NOT NULL) OR (type = 'group' AND name IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id       INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role                  TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    joined_at             TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
    created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
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


def connect() -> sqlite3.Connection:
    # One connection per request. check_same_thread=False because FastAPI may
    # run sync dependencies and handlers on different threadpool threads.
    conn = sqlite3.connect(DB_PATH, timeout=5, check_same_thread=False)  # timeout = busy wait on locks
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")  # off by default in SQLite
    return conn


def get_db():
    """FastAPI dependency: yields a connection and always closes it."""
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


def init_db() -> None:
    conn = connect()
    conn.execute("PRAGMA journal_mode = WAL")  # persistent setting; readers don't block the writer
    conn.executescript(SCHEMA)
    conn.close()
