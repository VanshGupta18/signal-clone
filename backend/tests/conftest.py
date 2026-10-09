import pytest
from fastapi.testclient import TestClient

from app import database
from app.main import app


@pytest.fixture
def db(tmp_path, monkeypatch):
    """Fresh SQLite file per test."""
    monkeypatch.setattr(database, "DB_PATH", str(tmp_path / "test.db"))
    database.init_db()
    yield database._conn  # raw connection; tests run one step at a time, so no lock needed
    database.close_db()


@pytest.fixture
def client(db):
    # No `with`: entering would run the app's startup and open a second connection.
    yield TestClient(app)


def login(client, phone="+15551234567"):
    res = client.post("/api/auth/verify", json={"phone": phone, "otp": "123456"})
    assert res.status_code == 200, res.text
    return res.json()


def auth_header(token):
    return {"Authorization": f"Bearer {token}"}
