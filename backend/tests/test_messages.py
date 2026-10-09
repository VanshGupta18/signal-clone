import pytest

from seed import seed
from tests.conftest import auth_header, login

ALICE, BOB, DAVE = "+15550000001", "+15550000002", "+15550000004"


@pytest.fixture
def seeded(db):
    with db:
        seed(db)
    return db


def conversation_id(client, token, name):
    convs = client.get("/api/conversations", headers=auth_header(token)).json()
    return next(c["id"] for c in convs if c["name"] == name)


def send(ws, conv_id, content, client_id, **extra):
    ws.send_json({"type": "message:send", "conversation_id": conv_id, "content": content, "client_id": client_id, **extra})
    return ws.receive_json()


def count(db, sql, *params):
    return db.execute(sql, params).fetchone()[0]


def test_send_persists_message_receipts_and_activity(client, seeded):
    alice = login(client, ALICE)
    group = conversation_id(client, alice["token"], "Weekend Hike")
    with client.websocket_connect(f"/ws?token={alice['token']}") as ws:
        reply = send(ws, group, "  Bring water\nand snacks  ", "c-1", sender_id=999)  # sender_id is ignored

    assert reply["type"] == "message:ack" and reply["client_id"] == "c-1"
    message = reply["message"]
    assert message["sender_id"] == alice["user"]["id"]
    assert message["content"] == "Bring water\nand snacks"
    assert message["status"] == "sent" and message["client_id"] == "c-1"

    # Same shape as history, and it's the newest message there.
    history = client.get(f"/api/conversations/{group}/messages", headers=auth_header(alice["token"])).json()
    assert history[-1] == message

    # One 'sent' receipt per other member (group has 4 members), none for the sender.
    receipts = seeded.execute("SELECT user_id, status FROM message_receipts WHERE message_id = ?", (message["id"],)).fetchall()
    assert len(receipts) == 3 and all(r["status"] == "sent" for r in receipts)
    assert alice["user"]["id"] not in [r["user_id"] for r in receipts]
    assert count(seeded, "SELECT updated_at FROM conversations WHERE id = ?", group) == message["created_at"]


def test_duplicate_client_id_returns_same_message(client, seeded):
    alice = login(client, ALICE)
    direct = conversation_id(client, alice["token"], "Bob Smith")
    before = count(seeded, "SELECT COUNT(*) FROM messages"), count(seeded, "SELECT COUNT(*) FROM message_receipts")
    with client.websocket_connect(f"/ws?token={alice['token']}") as ws:
        first = send(ws, direct, "hello", "retry-1")
    with client.websocket_connect(f"/ws?token={alice['token']}") as ws:  # reconnect and retry
        second = send(ws, direct, "hello", "retry-1")
    assert second == first
    after = count(seeded, "SELECT COUNT(*) FROM messages"), count(seeded, "SELECT COUNT(*) FROM message_receipts")
    assert after == (before[0] + 1, before[1] + 1)


def test_non_member_cannot_send(client, seeded):
    alice = login(client, ALICE)
    direct = conversation_id(client, alice["token"], "Bob Smith")
    dave = login(client, DAVE)
    before = count(seeded, "SELECT COUNT(*) FROM messages")
    with client.websocket_connect(f"/ws?token={dave['token']}") as ws:
        for conv_id in (direct, 9999):
            reply = send(ws, conv_id, "sneaky", f"x-{conv_id}")
            assert reply == {"type": "error", "client_id": f"x-{conv_id}", "detail": "Conversation not found"}
    assert count(seeded, "SELECT COUNT(*) FROM messages") == before


def test_empty_and_oversized_content_rejected(client, seeded):
    alice = login(client, ALICE)
    direct = conversation_id(client, alice["token"], "Bob Smith")
    before = count(seeded, "SELECT COUNT(*) FROM messages")
    with client.websocket_connect(f"/ws?token={alice['token']}") as ws:
        assert send(ws, direct, "   \n ", "e-1")["type"] == "error"
        assert send(ws, direct, "x" * 4001, "e-2")["type"] == "error"
        assert send(ws, direct, "x" * 4000, "e-3")["type"] == "message:ack"  # limit itself is fine
    assert count(seeded, "SELECT COUNT(*) FROM messages") == before + 1


def test_list_reflects_sent_message(client, seeded):
    alice = login(client, ALICE)
    headers = auth_header(alice["token"])
    direct = conversation_id(client, alice["token"], "Bob Smith")  # last in the seeded order
    with client.websocket_connect(f"/ws?token={alice['token']}") as ws:
        send(ws, direct, "lunch again?", "l-1")

    convs = client.get("/api/conversations", headers=headers).json()
    assert convs[0]["id"] == direct
    assert convs[0]["last_message"]["content"] == "lunch again?"
    assert convs[0]["last_message"]["sender_id"] == alice["user"]["id"]

    # Bob sees it as unread after a reload (live delivery is milestone 5).
    bob = login(client, BOB)
    bob_convs = client.get("/api/conversations", headers=auth_header(bob["token"])).json()
    assert next(c for c in bob_convs if c["id"] == direct)["unread_count"] == 1


def test_message_history_supports_cursor_pages(client, seeded):
    alice = login(client, ALICE)
    direct = conversation_id(client, alice["token"], "Bob Smith")
    headers = auth_header(alice["token"])
    with client.websocket_connect(f"/ws?token={alice['token']}") as ws:
        for index in range(3):
            send(ws, direct, f"page-{index}", f"page-{index}")

    page = client.get(f"/api/conversations/{direct}/messages?limit=2", headers=headers).json()
    assert page["has_more"] is True
    assert [message["content"] for message in page["messages"]] == ["page-1", "page-2"]
    older = client.get(
        f"/api/conversations/{direct}/messages?limit=2&before_id={page['next_before_id']}",
        headers=headers,
    ).json()
    assert older["messages"][-1]["content"] == "page-0"
    assert older["has_more"] is True


def test_ws_send_acks_before_turso_push_rest_writes_push_first(client, seeded, monkeypatch):
    """D84: chat events are acked right after the local commit, then synced; REST writes sync first."""
    import threading
    import time

    from app import database

    pushes = []
    real_push = database._push
    monkeypatch.setattr(database, "_push", lambda: (pushes.append("rest"), real_push()))
    alice = login(client, ALICE)  # REST write (new session row): pushed before the response
    assert pushes == ["rest"]
    direct = conversation_id(client, alice["token"], "Bob Smith")

    # A "slow Turso": the push blocks until the test has received the ack. If the ack waited
    # for the push, it could only arrive after the 3s timeout.
    acked = threading.Event()
    monkeypatch.setattr(database, "_push", lambda: (acked.wait(3), pushes.append("ws"), real_push()))
    with client.websocket_connect(f"/ws?token={alice['token']}") as ws:
        started = time.perf_counter()
        reply = send(ws, direct, "fast ack", "c-fast")
        elapsed = time.perf_counter() - started
        acked.set()
        ws.send_json({"type": "typing:start", "conversation_id": direct})  # no write: no push
    assert reply["type"] == "message:ack"
    assert elapsed < 1, f"ack waited for the Turso push ({elapsed:.1f}s)"
    assert pushes == ["rest", "ws"] and database._unpushed is False
