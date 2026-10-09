import turso
from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, field_validator

from app.auth import get_current_user, get_current_user_released
from app.database import db, get_db
from app.messages import fetch_messages, member_ids, require_member
from app.websocket import is_online, receipt_pushes, send_to

router = APIRouter(prefix="/api/conversations", tags=["conversations"])

# Create / add / remove are async handlers: the DB work runs in a thread (it takes the
# global DB lock), and only after it's committed and the lock is released do we await
# the WebSocket pushes. Their auth dependency releases the lock too (D69).


class DirectIn(BaseModel):
    user_id: int


class GroupIn(BaseModel):
    name: str
    member_ids: list[int] = Field(max_length=256)

    @field_validator("name")
    @classmethod
    def check_name(cls, value: str) -> str:
        value = value.strip()
        if not 1 <= len(value) <= 50:
            raise ValueError("Group name must be 1-50 characters")
        return value


class MembersIn(BaseModel):
    user_ids: list[int] = Field(min_length=1, max_length=256)


def require_users_exist(conn: turso.Connection, user_ids: list[int]) -> None:
    placeholders = ",".join("?" * len(user_ids))
    found = conn.execute(f"SELECT COUNT(*) FROM users WHERE id IN ({placeholders})", tuple(user_ids)).fetchone()[0]
    if found != len(set(user_ids)):
        raise HTTPException(status_code=404, detail="User not found")


def my_membership(conn: turso.Connection, conversation_id: int, user_id: int) -> turso.Row:
    """My role + the conversation type. 404 if I'm not a member (D39)."""
    row = conn.execute(
        """SELECT m.role, c.type FROM conversation_members m JOIN conversations c ON c.id = m.conversation_id
            WHERE m.conversation_id = ? AND m.user_id = ?""",
        (conversation_id, user_id),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return row


def list_members(conn: turso.Connection, conversation_id: int) -> list[dict]:
    rows = conn.execute(
        """SELECT u.id, u.display_name, u.avatar_url, u.phone, m.role
             FROM conversation_members m JOIN users u ON u.id = m.user_id
            WHERE m.conversation_id = ?
            ORDER BY m.role = 'admin' DESC, lower(u.display_name)""",
        (conversation_id,),
    ).fetchall()
    return [
        {"id": r["id"], "display_name": r["display_name"], "avatar_url": r["avatar_url"], "phone": r["phone"],
         "role": r["role"], "online": is_online(r["id"])}
        for r in rows
    ]


@router.get("")
def list_conversations(user: turso.Row = Depends(get_current_user), conn: turso.Connection = Depends(get_db)):
    return conversation_list(conn, user["id"])


def conversation_list(conn: turso.Connection, user_id: int, only_id: int | None = None) -> list[dict]:
    """My conversations as list items (or just one, for create responses). One query:
    `me` = my membership row (gives my read cursor); `other` = the other person in a
    direct chat; `last` = the message with the highest id."""
    rows = conn.execute(
        """
        SELECT c.id, c.type, c.name, c.updated_at,
               other.id AS other_user_id, other.display_name AS other_name, other.avatar_url AS other_avatar_url,
               other.last_seen_at AS other_last_seen_at,
               -- Preview only: the list never needs a whole long message (history is untouched).
               last.id AS last_id, substr(last.content, 1, 100) AS last_content, last.sender_id AS last_sender_id,
               last.created_at AS last_created_at, sender.display_name AS last_sender_name,
               (SELECT COUNT(*) FROM messages unread
                 WHERE unread.conversation_id = c.id
                   AND unread.id > me.last_read_message_id
                   AND unread.sender_id != me.user_id) AS unread_count,
               (SELECT COUNT(*) FROM conversation_members cm WHERE cm.conversation_id = c.id) AS member_count
          FROM conversation_members me
          JOIN conversations c ON c.id = me.conversation_id
          LEFT JOIN conversation_members om
                 ON c.type = 'direct' AND om.conversation_id = c.id AND om.user_id != me.user_id
          LEFT JOIN users other ON other.id = om.user_id
          LEFT JOIN messages last ON last.id = (SELECT MAX(id) FROM messages WHERE conversation_id = c.id)
          LEFT JOIN users sender ON sender.id = last.sender_id
         WHERE me.user_id = ? AND (? IS NULL OR c.id = ?)
         ORDER BY c.updated_at DESC, c.id DESC
        """,
        (user_id, only_id, only_id),
    ).fetchall()

    return [
        {
            "id": row["id"],
            "type": row["type"],
            "name": row["name"] if row["type"] == "group" else row["other_name"],
            "avatar_url": row["other_avatar_url"],  # groups have no avatar yet
            "other_user_id": row["other_user_id"],  # null for groups
            # Presence of the other person (direct only); live changes come as presence:update.
            "other_online": is_online(row["other_user_id"]) if row["other_user_id"] else None,
            "other_last_seen_at": row["other_last_seen_at"],
            "member_count": row["member_count"],
            "unread_count": row["unread_count"],
            "updated_at": row["updated_at"],
            "last_message": None if row["last_id"] is None else {
                "id": row["last_id"],
                "content": row["last_content"],
                "sender_id": row["last_sender_id"],
                "sender_name": row["last_sender_name"],
                "created_at": row["last_created_at"],
            },
        }
        for row in rows
    ]


@router.get("/{conversation_id}/messages")
def list_messages(
    conversation_id: int,
    user: turso.Row = Depends(get_current_user),
    conn: turso.Connection = Depends(get_db),
):
    require_member(conn, conversation_id, user["id"])
    return fetch_messages(conn, user["id"], "m.conversation_id = ?", (conversation_id,))


def _open_direct(my_id: int, other_id: int) -> tuple[dict, bool]:
    if other_id == my_id:
        raise HTTPException(status_code=400, detail="You can't start a chat with yourself")
    low, high = sorted((my_id, other_id))
    with db() as conn:
        require_users_exist(conn, [other_id])
        with conn:  # one transaction: conversation + both members
            # direct_key is UNIQUE, so the database guarantees one chat per pair: if it
            # already exists (or a concurrent request just created it) nothing is inserted.
            cursor = conn.execute(
                "INSERT INTO conversations (type, direct_key, created_by) VALUES ('direct', ?, ?) ON CONFLICT(direct_key) DO NOTHING",
                (f"{low}:{high}", my_id),
            )
            created = cursor.rowcount == 1
            if created:
                conn.executemany(
                    "INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)",
                    [(cursor.lastrowid, my_id), (cursor.lastrowid, other_id)],
                )
        conversation_id = conn.execute("SELECT id FROM conversations WHERE direct_key = ?", (f"{low}:{high}",)).fetchone()["id"]
        return conversation_list(conn, my_id, conversation_id)[0], created


@router.post("/direct")
async def open_direct(body: DirectIn, user: turso.Row = Depends(get_current_user_released)):
    """The existing direct chat with this person, or a new one."""
    conversation, created = await run_in_threadpool(_open_direct, user["id"], body.user_id)
    if created:
        await send_to([user["id"], body.user_id], {"type": "conversation:new", "conversation_id": conversation["id"]})
    return conversation


def _create_group(my_id: int, name: str, requested_ids: list[int]) -> tuple[dict, list[int]]:
    others = sorted(set(requested_ids) - {my_id})  # dedupe; I'm added as admin anyway
    if not others:
        raise HTTPException(status_code=400, detail="Add at least one member")
    with db() as conn:
        require_users_exist(conn, others)
        with conn:  # one transaction: conversation + all members
            conversation_id = conn.execute(
                "INSERT INTO conversations (type, name, created_by) VALUES ('group', ?, ?)", (name, my_id)
            ).lastrowid
            conn.execute(
                "INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, 'admin')",
                (conversation_id, my_id),
            )
            conn.executemany(
                "INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)",
                [(conversation_id, other) for other in others],
            )
        return conversation_list(conn, my_id, conversation_id)[0], [my_id, *others]


@router.post("/groups")
async def create_group(body: GroupIn, user: turso.Row = Depends(get_current_user_released)):
    conversation, members = await run_in_threadpool(_create_group, user["id"], body.name, body.member_ids)
    await send_to(members, {"type": "conversation:new", "conversation_id": conversation["id"]})
    return conversation


@router.get("/{conversation_id}/members")
def get_members(conversation_id: int, user: turso.Row = Depends(get_current_user), conn: turso.Connection = Depends(get_db)):
    require_member(conn, conversation_id, user["id"])
    return list_members(conn, conversation_id)


def _add_members(my_id: int, conversation_id: int, user_ids: list[int]) -> tuple[list[dict], list[int]]:
    with db() as conn:
        mine = my_membership(conn, conversation_id, my_id)
        if mine["type"] != "group":
            raise HTTPException(status_code=400, detail="Only groups have members to add")
        if mine["role"] != "admin":
            raise HTTPException(status_code=403, detail="Only admins can add members")
        require_users_exist(conn, user_ids)
        added = sorted(set(user_ids) - set(member_ids(conn, conversation_id)))
        with conn:
            # Existing members are skipped. New members see the history (D71), but start
            # with everything already read, so old messages don't count as unread.
            conn.executemany(
                """INSERT INTO conversation_members (conversation_id, user_id, last_read_message_id)
                   VALUES (?, ?, (SELECT COALESCE(MAX(id), 0) FROM messages WHERE conversation_id = ?))
                   ON CONFLICT DO NOTHING""",
                [(conversation_id, uid, conversation_id) for uid in set(user_ids)],
            )
        return list_members(conn, conversation_id), added


@router.post("/{conversation_id}/members")
async def add_members(conversation_id: int, body: MembersIn, user: turso.Row = Depends(get_current_user_released)):
    members, added = await run_in_threadpool(_add_members, user["id"], conversation_id, body.user_ids)
    # New members' clients reload the list, so the group appears for them. actor_id and
    # added_user_ids only pick the toast text ("You were added to ..."), see D78.
    await send_to(
        [m["id"] for m in members],
        {"type": "member:update", "conversation_id": conversation_id, "actor_id": user["id"], "added_user_ids": added},
    )
    return members


def _remove_member(my_id: int, conversation_id: int, user_id: int) -> tuple[list[int], list]:
    with db() as conn:
        mine = my_membership(conn, conversation_id, my_id)
        if mine["type"] != "group":
            raise HTTPException(status_code=400, detail="You can't remove people from a direct chat")
        if user_id != my_id and mine["role"] != "admin":
            raise HTTPException(status_code=403, detail="Only admins can remove members")
        with conn:  # one transaction (D72)
            if conn.execute(
                "DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?", (conversation_id, user_id)
            ).rowcount == 0:
                raise HTTPException(status_code=404, detail="Member not found")
            # Their receipts go too, so senders' group ticks can still reach "read". Only the
            # unread ones can change a sender's ticks, so only those get a receipt:update.
            changed = [row["message_id"] for row in conn.execute(
                """DELETE FROM message_receipts
                    WHERE user_id = ? AND message_id IN (SELECT id FROM messages WHERE conversation_id = ?)
                RETURNING message_id, status""",
                (user_id, conversation_id),
            ).fetchall() if row["status"] != "read"]
            # Never leave a group without an admin: promote the longest-standing member.
            conn.execute(
                """UPDATE conversation_members SET role = 'admin'
                    WHERE conversation_id = ?
                      AND user_id = (SELECT user_id FROM conversation_members WHERE conversation_id = ? ORDER BY joined_at, user_id LIMIT 1)
                      AND NOT EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = ? AND role = 'admin')""",
                (conversation_id, conversation_id, conversation_id),
            )
        return member_ids(conn, conversation_id), receipt_pushes(conn, changed)


@router.delete("/{conversation_id}/members/{user_id}", status_code=204)
async def remove_member(conversation_id: int, user_id: int, user: turso.Row = Depends(get_current_user_released)):
    """Admin removes someone, or anyone removes themselves (= leave the group)."""
    remaining, pushes = await run_in_threadpool(_remove_member, user["id"], conversation_id, user_id)
    # The removed user hears it too: their client drops the chat from its list.
    await send_to(
        [*remaining, user_id],
        {"type": "member:update", "conversation_id": conversation_id, "actor_id": user["id"], "removed_user_id": user_id},
    )
    for user_ids, event in pushes:
        await send_to(user_ids, event)
    return Response(status_code=204)
