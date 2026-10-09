"""Milestone 5: live delivery, receipts, read cursor, typing, presence (several sockets at once)."""
from contextlib import ExitStack

import pytest

from seed import seed
from tests.conftest import auth_header, login

ALICE, BOB, CAROL, DAVE = "+15550000001", "+15550000002", "+15550000003", "+15550000004"
PROBE_REPLY = {"type": "error", "client_id": "probe", "detail": "Unknown event type"}


@pytest.fixture
def seeded(db):
    with db:
        seed(db)
    return db


def flush(*sockets):
    """Everything each socket has received so far. The probe round-trips through that
    socket's handler, so earlier pushes made by that handler have landed. Pass the
    socket that acted first, then the ones that should have received something."""
    received = []
    for ws in sockets:
        ws.send_json({"type": "probe", "client_id": "probe"})
        events = []
        while (event := ws.receive_json()) != PROBE_REPLY:
            events.append(event)
        received.append(events)
    return received


def open_sockets(stack, client, *users):
    sockets = [stack.enter_context(client.websocket_connect(f"/ws?token={u['token']}")) for u in users]
    flush(*sockets)
    flush(*sockets)  # second pass: presence pushes from later connects have landed too
    return sockets


def conv_id(client, token, name):
    convs = client.get("/api/conversations", headers=auth_header(token)).json()
    return next(c["id"] for c in convs if c["name"] == name)


def send(ws, conversation_id, content, client_id):
    ws.send_json({"type": "message:send", "conversation_id": conversation_id, "content": content, "client_id": client_id})
    reply = ws.receive_json()
    assert reply["type"] == "message:ack", reply
    return reply["message"]


def receipt(db, message_id, user_id):
    return db.execute(
        "SELECT status, delivered_at, read_at FROM message_receipts WHERE message_id = ? AND user_id = ?",
        (message_id, user_id),
    ).fetchone()


def test_message_new_goes_to_members_and_my_other_tabs_only(client, seeded):
    alice, bob, dave = login(client, ALICE), login(client, BOB), login(client, DAVE)
    direct = conv_id(client, alice["token"], "Bob Smith")
    with ExitStack() as stack:
        a1, a2, b, d = open_sockets(stack, client, alice, alice, bob, dave)
        message = send(a1, direct, "live?", "n-1")
        on_a1, on_a2, on_b, on_d = flush(a1, a2, b, d)
        assert on_a1 == []  # the sending tab only gets its ack
        assert on_a2 == on_b == [{"type": "message:new", "message": message}]
        assert on_d == []  # not a member

        # Idempotent replay: re-acked, but nobody gets a second message:new.
        assert send(a1, direct, "live?", "n-1") == message
        assert flush(a1, a2, b, d) == [[], [], [], []]


def test_delivered_then_read_updates_sender_and_never_downgrades(client, seeded):
    alice, bob = login(client, ALICE), login(client, BOB)
    direct = conv_id(client, alice["token"], "Bob Smith")
    with ExitStack() as stack:
        a, b = open_sockets(stack, client, alice, bob)
        message = send(a, direct, "ping", "d-1")
        flush(a, b)

        b.send_json({"type": "message:delivered", "message_ids": [message["id"]]})
        on_b, on_a = flush(b, a)
        assert on_b == []
        assert on_a == [{"type": "receipt:update", "messages": [{"id": message["id"], "conversation_id": direct, "status": "delivered"}]}]
        row = receipt(seeded, message["id"], bob["user"]["id"])
        assert row["status"] == "delivered" and row["delivered_at"] and row["read_at"] is None

        b.send_json({"type": "conversation:read", "conversation_id": direct})
        on_b, on_a = flush(b, a)
        assert on_b == [{"type": "conversation:read", "conversation_id": direct}]
        assert on_a == [{"type": "receipt:update", "messages": [{"id": message["id"], "conversation_id": direct, "status": "read"}]}]
        assert receipt(seeded, message["id"], bob["user"]["id"])["status"] == "read"
        cursor = seeded.execute(
            "SELECT last_read_message_id FROM conversation_members WHERE conversation_id = ? AND user_id = ?",
            (direct, bob["user"]["id"]),
        ).fetchone()[0]
        assert cursor == message["id"]

        # A late delivered (or a repeated read) changes nothing and notifies nobody.
        b.send_json({"type": "message:delivered", "message_ids": [message["id"]]})
        b.send_json({"type": "conversation:read", "conversation_id": direct})
        assert flush(b, a) == [[], []]
        assert receipt(seeded, message["id"], bob["user"]["id"])["status"] == "read"
        assert client.get(f"/api/conversations/{direct}/messages", headers=auth_header(alice["token"])).json()[-1]["status"] == "read"


def test_read_clears_unread_badge(client, seeded):
    alice = login(client, ALICE)
    carol_chat = conv_id(client, alice["token"], "Carol Diaz")  # seeded with 2 unread for Alice
    with ExitStack() as stack:
        a, a2 = open_sockets(stack, client, alice, alice)
        a.send_json({"type": "conversation:read", "conversation_id": carol_chat})
        # Both tabs hear about it (so both reload the list); Carol is offline, nothing to push.
        assert flush(a, a2) == [[{"type": "conversation:read", "conversation_id": carol_chat}]] * 2
    convs = client.get("/api/conversations", headers=auth_header(alice["token"])).json()
    assert next(c for c in convs if c["id"] == carol_chat)["unread_count"] == 0


def test_can_only_mark_my_own_receipts(client, seeded):
    alice, bob, dave = login(client, ALICE), login(client, BOB), login(client, DAVE)
    group = conv_id(client, alice["token"], "Weekend Hike")
    direct = conv_id(client, alice["token"], "Bob Smith")
    with ExitStack() as stack:
        a, b, d = open_sockets(stack, client, alice, bob, dave)
        message = send(a, group, "hike!", "o-1")
        dm = send(a, direct, "just bob", "o-2")
        flush(a, b, d)
        # Dave acks everything he can name, including a message in a chat he isn't in.
        d.send_json({"type": "message:delivered", "message_ids": [message["id"], dm["id"]], "up_to_id": 10**9})
        d.send_json({"type": "conversation:read", "conversation_id": direct})
        on_d, on_a = flush(d, a)
        assert on_d == [{"type": "error", "client_id": None, "detail": "Conversation not found"}]
        assert on_a == [{"type": "receipt:update", "messages": [{"id": message["id"], "conversation_id": group, "status": "sent"}]}]
    assert receipt(seeded, message["id"], dave["user"]["id"])["status"] == "delivered"
    assert receipt(seeded, message["id"], bob["user"]["id"])["status"] == "sent"
    assert receipt(seeded, dm["id"], bob["user"]["id"])["status"] == "sent"


def test_group_ticks_are_the_lowest_status_across_recipients(client, seeded):
    alice, bob, carol, dave = (login(client, p) for p in (ALICE, BOB, CAROL, DAVE))
    group = conv_id(client, alice["token"], "Weekend Hike")
    with ExitStack() as stack:
        a, b, c, d = open_sockets(stack, client, alice, bob, carol, dave)
        message = send(a, group, "who's driving?", "g-1")
        flush(a, b, c, d)

        def ticks_after(ws, event):
            ws.send_json(event)
            _, on_a = flush(ws, a)
            return on_a[-1]["messages"][0]["status"]

        assert ticks_after(b, {"type": "conversation:read", "conversation_id": group}) == "sent"
        assert ticks_after(c, {"type": "message:delivered", "message_ids": [message["id"]]}) == "sent"
        assert ticks_after(d, {"type": "message:delivered", "message_ids": [message["id"]]}) == "delivered"
        assert ticks_after(c, {"type": "conversation:read", "conversation_id": group}) == "delivered"
        assert ticks_after(d, {"type": "conversation:read", "conversation_id": group}) == "read"


def test_offline_recipient_catches_up_on_delivered_after_loading(client, seeded):
    alice, bob = login(client, ALICE), login(client, BOB)
    direct = conv_id(client, alice["token"], "Bob Smith")
    with ExitStack() as stack:
        (a,) = open_sockets(stack, client, alice)
        message = send(a, direct, "while you were out", "c-1")  # Bob is offline

        b = stack.enter_context(client.websocket_connect(f"/ws?token={bob['token']}"))
        flush(b, a)
        # Connecting alone is not delivery: Bob's client hasn't loaded anything yet.
        assert receipt(seeded, message["id"], bob["user"]["id"])["status"] == "sent"

        convs = client.get("/api/conversations", headers=auth_header(bob["token"])).json()
        newest = max(c["last_message"]["id"] for c in convs if c["last_message"])
        b.send_json({"type": "message:delivered", "up_to_id": newest})
        _, on_a = flush(b, a)
        assert on_a == [{"type": "receipt:update", "messages": [{"id": message["id"], "conversation_id": direct, "status": "delivered"}]}]
    assert receipt(seeded, message["id"], bob["user"]["id"])["status"] == "delivered"


def test_typing_relayed_to_other_members_only(client, seeded):
    alice, bob, carol, dave = (login(client, p) for p in (ALICE, BOB, CAROL, DAVE))
    group = conv_id(client, alice["token"], "Weekend Hike")
    direct = conv_id(client, alice["token"], "Bob Smith")
    with ExitStack() as stack:
        a, b, c, d = open_sockets(stack, client, alice, bob, carol, dave)
        a.send_json({"type": "typing:start", "conversation_id": direct})
        a.send_json({"type": "typing:stop", "conversation_id": direct})
        on_a, on_b, on_c, on_d = flush(a, b, c, d)
        assert on_a == on_c == on_d == []
        assert on_b == [
            {"type": "typing:start", "conversation_id": direct, "user_id": alice["user"]["id"]},
            {"type": "typing:stop", "conversation_id": direct, "user_id": alice["user"]["id"]},
        ]

        d.send_json({"type": "typing:start", "conversation_id": direct})  # Dave isn't in it
        on_d, on_a, on_b = flush(d, a, b)
        assert on_d == [{"type": "error", "client_id": None, "detail": "Conversation not found"}]
        assert on_a == on_b == []

        c.send_json({"type": "typing:start", "conversation_id": group})
        assert [len(events) for events in flush(c, a, b, d)] == [0, 1, 1, 1]


def test_presence_online_and_last_seen(client, seeded):
    alice, bob = login(client, ALICE), login(client, BOB)
    stranger = login(client, "+15559990002")  # shares no conversation with Bob
    direct = conv_id(client, alice["token"], "Bob Smith")
    with ExitStack() as stack:
        a, s = open_sockets(stack, client, alice, stranger)
        with client.websocket_connect(f"/ws?token={bob['token']}") as b:
            _, on_a, on_s = flush(b, a, s)
            assert on_a == [{"type": "presence:update", "user_id": bob["user"]["id"], "online": True, "last_seen_at": None}]
            assert on_s == []
            convs = client.get("/api/conversations", headers=auth_header(alice["token"])).json()
            assert next(c for c in convs if c["id"] == direct)["other_online"] is True

            # A second tab is not a new "online", and closing it is not "offline".
            with client.websocket_connect(f"/ws?token={bob['token']}") as b2:
                b2.close()
                flush(b)
            assert flush(a) == [[]]

            b.close()
            event = a.receive_json()  # waits for Bob's handler to finish going offline
        assert event["type"] == "presence:update" and event["online"] is False and event["last_seen_at"]
        stored = seeded.execute("SELECT last_seen_at FROM users WHERE id = ?", (bob["user"]["id"],)).fetchone()[0]
        assert stored == event["last_seen_at"]
        convs = client.get("/api/conversations", headers=auth_header(alice["token"])).json()
        chat = next(c for c in convs if c["id"] == direct)
        assert chat["other_online"] is False and chat["other_last_seen_at"] == stored
        assert flush(s) == [[]]
