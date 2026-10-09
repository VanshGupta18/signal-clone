import turso
from concurrent.futures import ThreadPoolExecutor

import pytest
from app import database


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}
    assert client.get("/api/health/live").json() == {"status": "ok"}
    assert client.get("/api/health/ready").json() == {"status": "ok"}


def test_foreign_keys_enforced(db):
    with pytest.raises(turso.IntegrityError):
        db.execute("INSERT INTO sessions (user_id, token_hash) VALUES (999, 't')")


def test_duplicate_client_id_rejected(db):
    db.execute("INSERT INTO users (username, display_name) VALUES ('a', 'A')")
    db.execute("INSERT INTO conversations (type, direct_key, created_by) VALUES ('direct', '1:1', 1)")
    insert = "INSERT INTO messages (conversation_id, sender_id, client_id, content) VALUES (1, 1, 'c1', 'hi')"
    db.execute(insert)
    with pytest.raises(turso.IntegrityError):
        db.execute(insert)


def test_duplicate_direct_key_rejected(db):
    db.execute("INSERT INTO users (username, display_name) VALUES ('a', 'A')")
    insert = "INSERT INTO conversations (type, direct_key, created_by) VALUES ('direct', '1:2', 1)"
    db.execute(insert)
    with pytest.raises(turso.IntegrityError):
        db.execute(insert)


def test_concurrent_readers_share_the_database_safely(db):
    def read_one():
        with database.db() as conn:
            return conn.execute("SELECT 1").fetchone()[0]

    with ThreadPoolExecutor(max_workers=8) as pool:
        assert list(pool.map(lambda _: read_one(), range(32))) == [1] * 32
