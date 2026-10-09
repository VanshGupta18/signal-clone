"""Message logic shared by REST (history) and the WebSocket (sending)."""
import turso
from fastapi import HTTPException

MAX_CONTENT_LENGTH = 4000  # characters, after stripping
STATUSES = ["sent", "delivered", "read"]  # receipt statuses, lowest first
NOW = "strftime('%Y-%m-%dT%H:%M:%SZ', 'now')"  # SQL for "now", same format as the schema defaults

# Ticks on a message (D42): the lowest receipt status across its recipients, as an index
# into STATUSES. The one place this aggregation lives (history, acks and receipt:update).
STATUS_RANK_SQL = """(SELECT MIN(CASE r.status WHEN 'sent' THEN 0 WHEN 'delivered' THEN 1 ELSE 2 END)
                        FROM message_receipts r WHERE r.message_id = m.id)"""


def require_member(conn: turso.Connection, conversation_id: int, user_id: int) -> None:
    """404 for both "doesn't exist" and "not a member", so ids can't be probed."""
    member = conn.execute(
        "SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?",
        (conversation_id, user_id),
    ).fetchone()
    if member is None:
        raise HTTPException(status_code=404, detail="Conversation not found")


def fetch_messages(conn: turso.Connection, my_id: int, where: str, params: tuple) -> list[dict]:
    """Messages as the API returns them. `where` is a fixed SQL fragment from this
    module's callers (never user input); values always go through `params`.

    For my own messages, status = the lowest receipt across recipients
    (direct: the one recipient; group: "read" only once everyone has read it).
    """
    rows = conn.execute(
        f"""
        SELECT m.id, m.conversation_id, m.sender_id, m.client_id, m.content, m.created_at,
               u.display_name AS sender_name, u.avatar_url AS sender_avatar_url,
               CASE WHEN m.sender_id = ? THEN {STATUS_RANK_SQL} END AS status_rank
          FROM messages m
          JOIN users u ON u.id = m.sender_id
         WHERE {where}
         ORDER BY m.id
        """,
        (my_id, *params),
    ).fetchall()

    messages = []
    for row in rows:
        status = None  # only my own messages carry ticks
        if row["sender_id"] == my_id:
            # No receipts (everyone else left the group) still means the server has it: "sent".
            status = STATUSES[row["status_rank"] or 0]
        messages.append({
            "id": row["id"],
            "conversation_id": row["conversation_id"],
            "sender_id": row["sender_id"],
            "sender_name": row["sender_name"],
            "sender_avatar_url": row["sender_avatar_url"],
            "client_id": row["client_id"],
            "content": row["content"],
            "created_at": row["created_at"],
            "status": status,
        })
    return messages


def send_message(conn: turso.Connection, sender_id: int, conversation_id: int, content: str, client_id: str) -> tuple[dict, bool]:
    """Validate, then persist message + receipts + activity time in one transaction.

    Returns (message, created). Idempotent: a retry with the same client_id returns the
    already-saved message with created=False and writes nothing.
    Raises HTTPException (404 non-member, 400 bad content).
    """
    require_member(conn, conversation_id, sender_id)
    content = content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Message is empty")
    if len(content) > MAX_CONTENT_LENGTH:
        raise HTTPException(status_code=400, detail=f"Message is longer than {MAX_CONTENT_LENGTH} characters")

    with conn:
        cursor = conn.execute(
            """INSERT INTO messages (conversation_id, sender_id, client_id, content) VALUES (?, ?, ?, ?)
               ON CONFLICT(sender_id, client_id) DO NOTHING""",
            (conversation_id, sender_id, client_id, content),
        )
        created = cursor.rowcount == 1
        if created:  # new message (0 = retry of one we already have)
            message_id = cursor.lastrowid
            # One 'sent' receipt per other current member.
            conn.execute(
                """INSERT INTO message_receipts (message_id, user_id)
                   SELECT ?, user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?""",
                (message_id, conversation_id, sender_id),
            )
            # Recent activity for the list order = this message's time.
            conn.execute(
                "UPDATE conversations SET updated_at = (SELECT created_at FROM messages WHERE id = ?) WHERE id = ?",
                (message_id, conversation_id),
            )

    message = fetch_messages(conn, sender_id, "m.sender_id = ? AND m.client_id = ?", (sender_id, client_id))[0]
    return message, created


def member_ids(conn: turso.Connection, conversation_id: int) -> list[int]:
    rows = conn.execute("SELECT user_id FROM conversation_members WHERE conversation_id = ?", (conversation_id,))
    return [row["user_id"] for row in rows.fetchall()]


def peer_ids(conn: turso.Connection, user_id: int) -> list[int]:
    """Everyone who shares at least one conversation with this user (presence audience)."""
    rows = conn.execute(
        """SELECT DISTINCT user_id FROM conversation_members
            WHERE user_id != ? AND conversation_id IN (SELECT conversation_id FROM conversation_members WHERE user_id = ?)""",
        (user_id, user_id),
    )
    return [row["user_id"] for row in rows.fetchall()]


def mark_delivered(conn: turso.Connection, user_id: int, message_ids: list[int], up_to_id: int = 0) -> list[int]:
    """My client got these messages: my receipts move sent -> delivered (never down).

    `message_ids` = live acks for message:new; `up_to_id` = catch-up after the client
    loaded the conversation list (every message up to the newest one it saw).
    Only receipts with user_id = me can change. Returns the message ids that changed.
    """
    placeholders = ",".join("?" * len(message_ids)) or "NULL"  # IN (NULL) matches nothing
    with conn:
        rows = conn.execute(
            f"""UPDATE message_receipts SET status = 'delivered', delivered_at = {NOW}
                 WHERE user_id = ? AND status = 'sent' AND (message_id IN ({placeholders}) OR message_id <= ?)
             RETURNING message_id""",
            (user_id, *message_ids, up_to_id),
        ).fetchall()
    return [row["message_id"] for row in rows]


def mark_read(conn: turso.Connection, user_id: int, conversation_id: int) -> tuple[bool, list[int]]:
    """I opened the chat. One transaction: move my read cursor to the newest message
    (never backwards), then my receipts up to the cursor -> read (never down).
    Returns (cursor_moved, message ids whose receipt changed)."""
    require_member(conn, conversation_id, user_id)
    with conn:
        moved = conn.execute(
            """UPDATE conversation_members SET last_read_message_id = (SELECT MAX(id) FROM messages WHERE conversation_id = ?)
                WHERE conversation_id = ? AND user_id = ?
                  AND last_read_message_id < (SELECT COALESCE(MAX(id), 0) FROM messages WHERE conversation_id = ?)""",
            (conversation_id, conversation_id, user_id, conversation_id),
        ).rowcount == 1
        rows = conn.execute(
            f"""UPDATE message_receipts SET status = 'read', read_at = {NOW}, delivered_at = COALESCE(delivered_at, {NOW})
                 WHERE user_id = ? AND status != 'read' AND message_id IN (
                       SELECT m.id FROM messages m JOIN conversation_members me
                           ON me.conversation_id = m.conversation_id AND me.user_id = ?
                        WHERE m.conversation_id = ? AND m.id <= me.last_read_message_id)
             RETURNING message_id""",
            (user_id, user_id, conversation_id),
        ).fetchall()
    return moved, [row["message_id"] for row in rows]


def tick_updates(conn: turso.Connection, message_ids: list[int]) -> dict[int, list[dict]]:
    """The recomputed ticks (D42) of these messages, grouped by the sender who shows them."""
    if not message_ids:
        return {}
    placeholders = ",".join("?" * len(message_ids))
    rows = conn.execute(
        f"""SELECT m.id, m.conversation_id, m.sender_id, {STATUS_RANK_SQL} AS status_rank
              FROM messages m WHERE m.id IN ({placeholders})""",
        tuple(message_ids),
    ).fetchall()
    by_sender: dict[int, list[dict]] = {}
    for row in rows:
        by_sender.setdefault(row["sender_id"], []).append(
            {"id": row["id"], "conversation_id": row["conversation_id"], "status": STATUSES[row["status_rank"] or 0]}
        )
    return by_sender
