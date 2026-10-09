import sqlite3

import pytest
from fastapi.testclient import TestClient

from app import database
from app.main import app


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DB_PATH", str(tmp_path / "test.db"))
    database.init_db()
    conn = database.connect()
    yield conn
    conn.close()


def test_health(db):
    with TestClient(app) as client:
        assert client.get("/api/health").json() == {"status": "ok"}


def test_foreign_keys_enforced(db):
    with pytest.raises(sqlite3.IntegrityError):
        db.execute("INSERT INTO sessions (user_id, token) VALUES (999, 't')")


def test_duplicate_client_id_rejected(db):
    db.execute("INSERT INTO users (username, display_name) VALUES ('a', 'A')")
    db.execute("INSERT INTO conversations (type, direct_key, created_by) VALUES ('direct', '1:1', 1)")
    insert = "INSERT INTO messages (conversation_id, sender_id, client_id, content) VALUES (1, 1, 'c1', 'hi')"
    db.execute(insert)
    with pytest.raises(sqlite3.IntegrityError):
        db.execute(insert)


def test_duplicate_direct_key_rejected(db):
    db.execute("INSERT INTO users (username, display_name) VALUES ('a', 'A')")
    insert = "INSERT INTO conversations (type, direct_key, created_by) VALUES ('direct', '1:2', 1)"
    db.execute(insert)
    with pytest.raises(sqlite3.IntegrityError):
        db.execute(insert)
