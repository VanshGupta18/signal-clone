import turso
from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.database import get_db
from app.messages import fetch_messages, require_member
from app.websocket import is_online

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


@router.get("")
def list_conversations(user: turso.Row = Depends(get_current_user), conn: turso.Connection = Depends(get_db)):
    # One query for the whole list. `me` = my membership row (gives my read cursor);
    # `other` = the other person in a direct chat; `last` = the message with the highest id.
    rows = conn.execute(
        """
        SELECT c.id, c.type, c.name, c.updated_at,
               other.id AS other_user_id, other.display_name AS other_name, other.avatar_url AS other_avatar_url,
               other.last_seen_at AS other_last_seen_at,
               last.id AS last_id, last.content AS last_content, last.sender_id AS last_sender_id,
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
         WHERE me.user_id = ?
         ORDER BY c.updated_at DESC, c.id DESC
        """,
        (user["id"],),
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
