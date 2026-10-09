"""Bonus: reply/quote (messages.reply_to_id) and emoji reactions (message_reactions)."""
from contextlib import ExitStack

import turso

from app import database
from tests.conftest import auth_header, login
from tests.test_realtime import ALICE, BOB, CAROL, DAVE, conv_id, flush, open_sockets, seeded  # noqa: F401

EVE = "+15550000005"


def history(client, token, conversation_id):
    return client.get(f"/api/conversations/{conversation_id}/messages", headers=auth_header(token)).json()


def react(ws, message_id, emoji, *others):
    """The reply to my reaction:set; `others` = open sockets to drain of the broadcast."""
    ws.send_json({"type": "reaction:set", "message_id": message_id, "emoji": emoji})
    reply = ws.receive_json()
    if others:
        flush(ws, *others)
    return reply


def test_migration_adds_reply_column_and_reactions_table_to_an_old_database(tmp_path, monkeypatch):
    # The schema as it was before this feature: no reply_to_id, no message_reactions.
    reply_line = next(line for line in database.SCHEMA.splitlines() if "reply_to_id" in line)
    old_schema = database.SCHEMA.replace(reply_line + "\n", "").split("-- One reaction")[0]
    assert "reply_to_id" not in old_schema and "message_reactions" not in old_schema

    path = str(tmp_path / "old.db")
    old = turso.connect(path)
    old.executescript(old_schema)
    old.execute("INSERT INTO users (username, display_name) VALUES ('a', 'A')")
    old.execute("INSERT INTO conversations (type, direct_key, created_by) VALUES ('direct', '1:1', 1)")
    old.execute("INSERT INTO messages (conversation_id, sender_id, client_id, content) VALUES (1, 1, 'c1', 'old row')")
    old.commit()
    old.close()

    monkeypatch.setattr(database, "DB_PATH", path)
    database.init_db()
    database.close_db()
    database.init_db()  # idempotent: a second start doesn't try to add the column again
    try:
        conn = database._conn
        columns = [row["name"] for row in conn.execute("PRAGMA table_info(messages)").fetchall()]
        assert "reply_to_id" in columns
        row = conn.execute("SELECT content, reply_to_id FROM messages WHERE client_id = 'c1'").fetchone()
        assert (row["content"], row["reply_to_id"]) == ("old row", None)
        conn.execute("INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (1, 1, '👍')")
        conn.commit()
    finally:
        database.close_db()


def test_reply_is_validated_and_included_in_ack_new_and_history(client, seeded):
    alice, bob = login(client, ALICE), login(client, BOB)
    direct = conv_id(client, alice["token"], "Bob Smith")
    other = conv_id(client, alice["token"], "Carol Diaz")
    quoted = history(client, alice["token"], direct)[0]
    foreign = history(client, alice["token"], other)[0]
    with ExitStack() as stack:
        a, b = open_sockets(stack, client, alice, bob)

        def send(content, client_id, reply_to_id):
            a.send_json({"type": "message:send", "conversation_id": direct, "content": content,
                         "client_id": client_id, "reply_to_id": reply_to_id})
            return a.receive_json()

        # A message from another chat (even one I'm in) or a missing one can't be quoted.
        assert send("x", "r-bad", foreign["id"])["type"] == "error"
        assert send("x", "r-missing", 99999)["type"] == "error"

        ack = send("Replying", "r-1", quoted["id"])
        assert ack["type"] == "message:ack"
        expected = {"id": quoted["id"], "sender_id": quoted["sender_id"],
                    "sender_name": "Bob Smith", "content": quoted["content"]}
        assert ack["message"]["reply_to"] == expected
        assert ack["message"]["reactions"] == []
        _, on_b = flush(a, b)
        assert on_b == [{"type": "message:new", "message": ack["message"]}]

    newest = history(client, bob["token"], direct)[-1]
    assert newest["content"] == "Replying" and newest["reply_to"] == expected


def test_reply_quote_is_trimmed(client, seeded):
    alice = login(client, ALICE)
    direct = conv_id(client, alice["token"], "Bob Smith")
    with client.websocket_connect(f"/ws?token={alice['token']}") as ws:
        ws.send_json({"type": "message:send", "conversation_id": direct, "content": "y" * 300, "client_id": "long"})
        long_id = ws.receive_json()["message"]["id"]
        ws.send_json({"type": "message:send", "conversation_id": direct, "content": "re", "client_id": "re", "reply_to_id": long_id})
        assert ws.receive_json()["message"]["reply_to"]["content"] == "y" * 100


def test_reaction_set_replace_toggle_off_one_per_user(client, seeded):
    alice, bob = login(client, ALICE), login(client, BOB)
    direct = conv_id(client, alice["token"], "Bob Smith")
    message_id = history(client, alice["token"], direct)[0]["id"]
    alice_id, bob_id = alice["user"]["id"], bob["user"]["id"]
    with ExitStack() as stack:
        a, b = open_sockets(stack, client, alice, bob)
        update = react(a, message_id, "👍", b)
        assert update == {"type": "reaction:update", "message_id": message_id, "conversation_id": direct,
                          "reactions": [{"emoji": "👍", "user_ids": [alice_id], "names": ["Alice Johnson"]}]}
        assert react(b, message_id, "👍", a)["reactions"] == [
            {"emoji": "👍", "user_ids": [alice_id, bob_id], "names": ["Alice Johnson", "Bob Smith"]}]
        # A different emoji replaces mine (still one row per user).
        assert [r["emoji"] for r in react(a, message_id, "😂", b)["reactions"]] == ["👍", "😂"]
        assert seeded.execute("SELECT COUNT(*) FROM message_reactions WHERE message_id = ? AND user_id = ?",
                              (message_id, alice_id)).fetchone()[0] == 1
        # The same emoji again toggles it off; null removes.
        assert react(a, message_id, "😂", b)["reactions"] == [{"emoji": "👍", "user_ids": [bob_id], "names": ["Bob Smith"]}]
        assert react(b, message_id, None, a)["reactions"] == []
        # Only the Signal set is accepted.
        assert react(a, message_id, "🦄", b)["type"] == "error"


def test_reaction_update_reaches_members_and_my_other_tabs_not_outsiders(client, seeded):
    alice, bob, dave = login(client, ALICE), login(client, BOB), login(client, DAVE)
    direct = conv_id(client, alice["token"], "Bob Smith")
    message_id = history(client, alice["token"], direct)[0]["id"]
    with ExitStack() as stack:
        a1, a2, b, d = open_sockets(stack, client, alice, alice, bob, dave)
        update = react(a1, message_id, "❤️")
        on_a1, on_a2, on_b, on_d = flush(a1, a2, b, d)
        assert on_a1 == [] and on_a2 == on_b == [update] and on_d == []

    assert history(client, bob["token"], direct)[0]["reactions"] == update["reactions"]


def test_non_member_and_removed_member_cannot_react_or_reply(client, seeded):
    alice, carol, eve = login(client, ALICE), login(client, CAROL), login(client, EVE)
    direct = conv_id(client, alice["token"], "Bob Smith")
    group = conv_id(client, alice["token"], "Weekend Hike")
    message_id = history(client, alice["token"], direct)[0]["id"]
    group_message = history(client, alice["token"], group)[0]["id"]
    with client.websocket_connect(f"/ws?token={eve['token']}") as ws:
        assert react(ws, message_id, "👍") == {"type": "error", "client_id": None, "detail": "Message not found"}

    # Carol leaves the group: she can no longer react to or reply in it.
    assert client.delete(f"/api/conversations/{group}/members/{carol['user']['id']}", headers=auth_header(carol["token"])).status_code == 204
    with client.websocket_connect(f"/ws?token={carol['token']}") as ws:
        assert react(ws, group_message, "👍")["type"] == "error"
        ws.send_json({"type": "message:send", "conversation_id": group, "content": "hi", "client_id": "c", "reply_to_id": group_message})
        assert ws.receive_json()["type"] == "error"
    assert seeded.execute("SELECT COUNT(*) FROM message_reactions WHERE message_id IN (?, ?) AND user_id IN (?, ?)",
                          (message_id, group_message, eve["user"]["id"], carol["user"]["id"])).fetchone()[0] == 0


def test_seed_history_includes_reply_and_reactions(client, seeded):
    alice = login(client, ALICE)
    direct = history(client, alice["token"], conv_id(client, alice["token"], "Bob Smith"))
    reply = next(m for m in direct if m["reply_to"])
    assert reply["reply_to"]["content"] == "Did you see the new design mockups?"
    assert reply["reactions"] == [{"emoji": "❤️", "user_ids": [alice["user"]["id"]], "names": ["Alice Johnson"]}]
    group = history(client, alice["token"], conv_id(client, alice["token"], "Weekend Hike"))
    assert any(r["emoji"] == "👍" and len(r["user_ids"]) == 2 for m in group for r in m["reactions"])
