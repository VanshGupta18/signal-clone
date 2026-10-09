import pytest

from seed import seed
from tests.conftest import auth_header, login

ALICE, DAVE = "+15550000001", "+15550000004"


@pytest.fixture
def seeded(db):
    with db:
        seed(db)
    return db


def get(client, path, phone):
    return client.get(path, headers=auth_header(login(client, phone)["token"]))


def test_list_sorted_by_activity_with_unread_and_preview(client, seeded):
    convs = get(client, "/api/conversations", ALICE).json()
    assert [c["name"] for c in convs] == ["Weekend Hike", "Carol Diaz", "Bob Smith"]
    assert [c["unread_count"] for c in convs] == [1, 2, 0]
    assert convs[0]["last_message"]["content"] == "8 works. I'll bring snacks"
    assert convs[0]["last_message"]["sender_name"] == "Dave Patel"
    assert convs[0]["member_count"] == 4 and convs[0]["other_user_id"] is None
    assert convs[2]["last_message"]["content"] == "Thanks! Let me know if anything feels off"


def test_list_only_shows_my_conversations(client, seeded):
    convs = get(client, "/api/conversations", DAVE).json()
    assert [c["name"] for c in convs] == ["Weekend Hike"]


def test_non_member_cannot_read_messages(client, seeded):
    direct_ids = [c["id"] for c in get(client, "/api/conversations", ALICE).json() if c["type"] == "direct"]
    for conv_id in direct_ids:
        assert get(client, f"/api/conversations/{conv_id}/messages", DAVE).status_code == 404
    assert get(client, "/api/conversations/9999/messages", DAVE).status_code == 404
    assert client.get(f"/api/conversations/{direct_ids[0]}/messages").status_code == 401


def test_group_status_is_lowest_across_recipients(client, seeded):
    alice = login(client, ALICE)
    headers = auth_header(alice["token"])
    group = client.get("/api/conversations", headers=headers).json()[0]
    path = f"/api/conversations/{group['id']}/messages"
    messages = client.get(path, headers=headers).json()
    assert [m["id"] for m in messages] == sorted(m["id"] for m in messages)
    mine = [m for m in messages if m["sender_id"] == alice["user"]["id"]]
    assert mine and all(m["status"] == "read" for m in mine)
    assert all(m["status"] is None for m in messages if m not in mine)

    # One recipient falls back to delivered -> the whole message shows delivered.
    first = mine[0]["id"]
    bob, carol = 2, 3  # seed inserts Alice, Bob, Carol, Dave in order
    with seeded:
        seeded.execute("UPDATE message_receipts SET status = 'delivered' WHERE message_id = ? AND user_id = ?", (first, bob))
    assert client.get(path, headers=headers).json()[0]["status"] == "delivered"
    with seeded:
        seeded.execute("UPDATE message_receipts SET status = 'sent' WHERE message_id = ? AND user_id = ?", (first, carol))
    assert client.get(path, headers=headers).json()[0]["status"] == "sent"


def test_opening_messages_does_not_change_unread(client, seeded):
    token = login(client, ALICE)["token"]
    convs = client.get("/api/conversations", headers=auth_header(token)).json()
    client.get(f"/api/conversations/{convs[1]['id']}/messages", headers=auth_header(token))
    assert client.get("/api/conversations", headers=auth_header(token)).json()[1]["unread_count"] == 2


def test_list_preview_is_trimmed_but_history_is_not(client, seeded):
    token = login(client, ALICE)["token"]
    convs = client.get("/api/conversations", headers=auth_header(token)).json()
    bob_chat = next(c["id"] for c in convs if c["name"] == "Bob Smith")
    long_text = "x" * 250
    with client.websocket_connect(f"/ws?token={token}") as ws:
        ws.send_json({"type": "message:send", "conversation_id": bob_chat, "content": long_text, "client_id": "long-1"})
        while (event := ws.receive_json())["type"] != "message:ack":
            pass
    convs = client.get("/api/conversations", headers=auth_header(token)).json()
    assert convs[0]["id"] == bob_chat and convs[0]["last_message"]["content"] == "x" * 100
    history = client.get(f"/api/conversations/{bob_chat}/messages", headers=auth_header(token)).json()
    assert history[-1]["content"] == long_text
