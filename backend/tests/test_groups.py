"""Milestone 6: user search, contacts, creating direct chats and groups, membership management."""
from contextlib import ExitStack

import pytest

from seed import seed
from tests.conftest import auth_header, login
from tests.test_realtime import conv_id, flush, open_sockets, send

ALICE, BOB, CAROL, DAVE, EVE = "+15550000001", "+15550000002", "+15550000003", "+15550000004", "+15550000005"


@pytest.fixture
def seeded(db):
    with db:
        seed(db)
    return db


@pytest.fixture
def users(client, seeded):
    return {name: login(client, phone) for name, phone in
            [("alice", ALICE), ("bob", BOB), ("carol", CAROL), ("dave", DAVE), ("eve", EVE)]}


def call(client, method, path, who, **kwargs):
    return client.request(method, path, headers=auth_header(who["token"]), **kwargs)


def uid(who):
    return who["user"]["id"]


def count(db, sql, *params):
    return db.execute(sql, params).fetchone()[0]


def test_search_excludes_me_and_flags_contacts(client, users):
    alice = users["alice"]
    assert call(client, "GET", "/api/users/search?q=a", alice).json() == []  # too short
    names = {p["display_name"]: p["is_contact"] for p in call(client, "GET", "/api/users/search?q=E", alice).json()}
    assert names == {}  # one char after strip
    found = call(client, "GET", "/api/users/search?q=ev", alice).json()
    assert [(p["display_name"], p["is_contact"]) for p in found] == [("Eve Moreau", False)]
    by_phone = call(client, "GET", "/api/users/search?q=555-0000", alice).json()
    assert alice["user"]["id"] not in [p["id"] for p in by_phone]
    assert {p["display_name"]: p["is_contact"] for p in by_phone} == {
        "Bob Smith": True, "Carol Diaz": True, "Dave Patel": True, "Eve Moreau": False}
    assert client.get("/api/users/search?q=ev").status_code == 401


def test_contacts_add_is_idempotent_and_validated(client, users):
    alice, eve = users["alice"], users["eve"]
    assert [p["display_name"] for p in call(client, "GET", "/api/contacts", alice).json()] == ["Bob Smith", "Carol Diaz", "Dave Patel"]
    for _ in range(2):
        res = call(client, "POST", "/api/contacts", alice, json={"user_id": uid(eve)})
        assert res.status_code == 200 and res.json()["is_contact"] is True
    assert len(call(client, "GET", "/api/contacts", alice).json()) == 4
    assert call(client, "GET", "/api/contacts", eve).json() == []  # contacts are one-way
    assert call(client, "POST", "/api/contacts", alice, json={"user_id": uid(alice)}).status_code == 400
    assert call(client, "POST", "/api/contacts", alice, json={"user_id": 9999}).status_code == 404


def test_direct_chat_is_created_once(client, users, seeded):
    alice, eve = users["alice"], users["eve"]
    first = call(client, "POST", "/api/conversations/direct", alice, json={"user_id": uid(eve)})
    assert first.status_code == 200
    chat = first.json()
    assert chat["type"] == "direct" and chat["name"] == "Eve Moreau" and chat["member_count"] == 2
    # Second call, from either side, hits the UNIQUE direct_key and returns the same chat.
    assert call(client, "POST", "/api/conversations/direct", alice, json={"user_id": uid(eve)}).json()["id"] == chat["id"]
    assert call(client, "POST", "/api/conversations/direct", eve, json={"user_id": uid(alice)}).json()["id"] == chat["id"]
    assert count(seeded, "SELECT COUNT(*) FROM conversations WHERE type = 'direct'") == 3
    assert count(seeded, "SELECT COUNT(*) FROM conversation_members WHERE conversation_id = ?", chat["id"]) == 2
    # Existing seeded chat is returned, not duplicated.
    bob_chat = call(client, "POST", "/api/conversations/direct", alice, json={"user_id": uid(users["bob"])}).json()
    assert bob_chat["id"] == conv_id(client, alice["token"], "Bob Smith") and bob_chat["last_message"] is not None
    assert call(client, "POST", "/api/conversations/direct", alice, json={"user_id": uid(alice)}).status_code == 400
    assert call(client, "POST", "/api/conversations/direct", alice, json={"user_id": 9999}).status_code == 404


def test_create_group_one_transaction_with_roles(client, users, seeded):
    alice, bob, carol = users["alice"], users["bob"], users["carol"]
    res = call(client, "POST", "/api/conversations/groups", alice,
               json={"name": "  Book Club ", "member_ids": [uid(bob), uid(carol), uid(bob), uid(alice)]})
    assert res.status_code == 200
    group = res.json()
    assert group["name"] == "Book Club" and group["type"] == "group" and group["member_count"] == 3
    assert group["last_message"] is None and group["unread_count"] == 0
    roles = dict(seeded.execute(
        "SELECT user_id, role FROM conversation_members WHERE conversation_id = ?", (group["id"],)).fetchall())
    assert roles == {uid(alice): "admin", uid(bob): "member", uid(carol): "member"}
    # It's at the top of Bob's list (newest activity).
    assert call(client, "GET", "/api/conversations", bob).json()[0]["id"] == group["id"]

    groups_before = count(seeded, "SELECT COUNT(*) FROM conversations")
    for body in [{"name": "  ", "member_ids": [uid(bob)]}, {"name": "x" * 51, "member_ids": [uid(bob)]},
                 {"name": "Solo", "member_ids": [uid(alice)]}, {"name": "Solo", "member_ids": []}]:
        assert call(client, "POST", "/api/conversations/groups", alice, json=body).status_code in (400, 422)
    # Unknown member: nothing is written (no half-created group).
    assert call(client, "POST", "/api/conversations/groups", alice,
                json={"name": "Ghosts", "member_ids": [uid(bob), 9999]}).status_code == 404
    assert count(seeded, "SELECT COUNT(*) FROM conversations") == groups_before


def test_members_list_is_members_only(client, users):
    alice, dave, eve = users["alice"], users["dave"], users["eve"]
    hike = conv_id(client, alice["token"], "Weekend Hike")
    members = call(client, "GET", f"/api/conversations/{hike}/members", dave).json()
    assert [(m["display_name"], m["role"]) for m in members] == [
        ("Alice Johnson", "admin"), ("Bob Smith", "member"), ("Carol Diaz", "member"), ("Dave Patel", "member")]
    assert set(members[0]) == {"id", "display_name", "avatar_url", "phone", "role", "online"}
    assert call(client, "GET", f"/api/conversations/{hike}/members", eve).status_code == 404


def test_add_and_remove_are_admin_only(client, users, seeded):
    alice, bob, carol, eve = users["alice"], users["bob"], users["carol"], users["eve"]
    hike = conv_id(client, alice["token"], "Weekend Hike")
    path = f"/api/conversations/{hike}/members"
    assert call(client, "POST", path, bob, json={"user_ids": [uid(eve)]}).status_code == 403
    assert call(client, "DELETE", f"{path}/{uid(carol)}", bob).status_code == 403
    assert call(client, "POST", path, eve, json={"user_ids": [uid(eve)]}).status_code == 404  # non-member
    assert call(client, "DELETE", f"{path}/{uid(carol)}", eve).status_code == 404
    assert call(client, "DELETE", f"{path}/{uid(eve)}", alice).status_code == 404  # not a member to remove
    direct = conv_id(client, alice["token"], "Bob Smith")
    assert call(client, "DELETE", f"/api/conversations/{direct}/members/{uid(bob)}", alice).status_code == 400
    assert call(client, "POST", f"/api/conversations/{direct}/members", alice, json={"user_ids": [uid(eve)]}).status_code == 400

    # Admin adds Eve (and an existing member, skipped). Old history is visible, but not unread.
    added = call(client, "POST", path, alice, json={"user_ids": [uid(eve), uid(bob)]})
    assert added.status_code == 200 and len(added.json()) == 5
    assert len(call(client, "GET", f"{path.replace('members', 'messages')}", eve).json()) == 6
    assert next(c for c in call(client, "GET", "/api/conversations", eve).json() if c["id"] == hike)["unread_count"] == 0

    assert call(client, "DELETE", f"{path}/{uid(eve)}", alice).status_code == 204
    assert uid(eve) not in [m["id"] for m in call(client, "GET", path, alice).json()]


def test_leave_and_last_admin_handover(client, users, seeded):
    alice, bob, carol = users["alice"], users["bob"], users["carol"]
    hike = conv_id(client, alice["token"], "Weekend Hike")
    path = f"/api/conversations/{hike}/members"
    assert call(client, "DELETE", f"{path}/{uid(carol)}", carol).status_code == 204  # a member leaves
    # The only admin leaves: the longest-standing remaining member becomes admin.
    assert call(client, "DELETE", f"{path}/{uid(alice)}", alice).status_code == 204
    roles = {m["display_name"]: m["role"] for m in call(client, "GET", path, bob).json()}
    assert roles == {"Bob Smith": "admin", "Dave Patel": "member"}
    assert hike not in [c["id"] for c in call(client, "GET", "/api/conversations", alice).json()]
    assert call(client, "GET", f"/api/conversations/{hike}/messages", alice).status_code == 404


def test_removed_member_loses_access_and_ticks_are_unstuck(client, users, seeded):
    alice, bob, carol, dave = users["alice"], users["bob"], users["carol"], users["dave"]
    hike = conv_id(client, alice["token"], "Weekend Hike")
    with ExitStack() as stack:
        a, b, c, d = open_sockets(stack, client, alice, bob, carol, dave)
        message = send(a, hike, "who's in?", "r-1")
        flush(a, b, c, d)
        for ws in (b, c):
            ws.send_json({"type": "conversation:read", "conversation_id": hike})
            flush(ws)
        flush(a, b, c, d)
        # Dave never read it, so Alice's ticks are stuck at "sent" ... until Dave is removed.
        assert call(client, "DELETE", f"/api/conversations/{hike}/members/{uid(dave)}", alice).status_code == 204
        on_a, on_b, on_c, on_d = flush(a, b, c, d)
        update = {"type": "member:update", "conversation_id": hike, "actor_id": uid(alice), "removed_user_id": uid(dave)}
        assert on_b == on_c == on_d == [update]
        assert on_a == [update, {"type": "receipt:update", "messages": [{"id": message["id"], "conversation_id": hike, "status": "read"}]}]
        assert count(seeded, "SELECT COUNT(*) FROM message_receipts WHERE user_id = ? AND message_id = ?", uid(dave), message["id"]) == 0

        # Dave is out: history 404, sending and typing rejected over the socket.
        assert call(client, "GET", f"/api/conversations/{hike}/messages", dave).status_code == 404
        d.send_json({"type": "message:send", "conversation_id": hike, "content": "still here?", "client_id": "r-2"})
        assert d.receive_json() == {"type": "error", "client_id": "r-2", "detail": "Conversation not found"}
        d.send_json({"type": "typing:start", "conversation_id": hike})
        assert d.receive_json()["type"] == "error"


def test_create_and_add_push_to_the_right_users(client, users):
    alice, bob, carol, eve = users["alice"], users["bob"], users["carol"], users["eve"]
    with ExitStack() as stack:
        a, b, c, e = open_sockets(stack, client, alice, bob, carol, eve)
        group = call(client, "POST", "/api/conversations/groups", alice, json={"name": "Duo", "member_ids": [uid(bob)]}).json()
        on_a, on_b, on_c, on_e = flush(a, b, c, e)
        new = {"type": "conversation:new", "conversation_id": group["id"]}
        assert on_a == on_b == [new] and on_c == on_e == []

        direct = call(client, "POST", "/api/conversations/direct", alice, json={"user_id": uid(eve)}).json()
        assert flush(a, b, c, e) == [[{"type": "conversation:new", "conversation_id": direct["id"]}], [], [], [{"type": "conversation:new", "conversation_id": direct["id"]}]]
        call(client, "POST", "/api/conversations/direct", eve, json={"user_id": uid(alice)})  # existing: no push
        assert flush(a, b, c, e) == [[], [], [], []]

        call(client, "POST", f"/api/conversations/{group['id']}/members", alice, json={"user_ids": [uid(carol)]})
        update = {"type": "member:update", "conversation_id": group["id"], "actor_id": uid(alice), "added_user_ids": [uid(carol)]}
        assert flush(a, b, c, e) == [[update], [update], [update], []]
