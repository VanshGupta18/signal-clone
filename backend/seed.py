"""Seed demo data.  Usage:  python seed.py [--reset]

Without --reset it does nothing if users already exist (safe to run on every deploy).
Demo logins: any phone below + code 123456.
"""
import sys
import uuid
from datetime import datetime, timedelta, timezone

from app.database import close_db, db, init_db

USERS = {
    "alice": ("+15550000001", "Alice Johnson"),
    "bob": ("+15550000002", "Bob Smith"),
    "carol": ("+15550000003", "Carol Diaz"),
    "dave": ("+15550000004", "Dave Patel"),
    "eve": ("+15550000005", "Eve Moreau"),  # nobody's contact, in no chats: demo "New chat" search + Add contact
}

# messages: (sender, text, minutes_ago). unread: member -> how many of the last
# messages they haven't read yet (those must be from other people).
# replies: message index -> index of the message it quotes. reactions: (message index, member, emoji).
CONVERSATIONS = [
    {
        "type": "direct",
        "members": ["alice", "bob"],
        "messages": [
            ("bob", "Hey Alice! Are we still on for lunch tomorrow?", 1500),
            ("alice", "Yes! 12:30 at the usual place?", 1490),
            ("bob", "Perfect. I'll grab a table.", 1485),
            ("alice", "Did you see the new design mockups?", 95),
            ("bob", "Just did, they look great", 90),
            ("alice", "Thanks! Let me know if anything feels off", 88),
        ],
        "unread": {},
        "replies": {4: 3},  # "Just did, ..." quotes "Did you see the new design mockups?"
        "reactions": [(4, "alice", "❤️")],
    },
    {
        "type": "direct",
        "members": ["alice", "carol"],
        "messages": [
            ("alice", "Carol, can you send me the report when it's ready?", 300),
            ("carol", "Sure, finishing it up now", 290),
            ("carol", "Just sent it to your email", 20),
            ("carol", "Let me know if you have questions", 19),
        ],
        "unread": {"alice": 2},
    },
    {
        "type": "group",
        "name": "Weekend Hike",
        "admin": "alice",
        "members": ["alice", "bob", "carol", "dave"],
        "messages": [
            ("alice", "Who's up for a hike this Saturday?", 2900),
            ("dave", "Count me in!", 2880),
            ("carol", "Me too. Which trail?", 2870),
            ("alice", "Thinking the ridge loop, about 10 km", 2860),
            ("bob", "Sounds good. Meet at 8?", 45),
            ("dave", "8 works. I'll bring snacks", 10),
        ],
        "unread": {"alice": 1, "carol": 2},
        "reactions": [(3, "bob", "👍"), (3, "dave", "👍"), (1, "alice", "😂")],
    },
]


def iso(minutes_ago: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).strftime("%Y-%m-%dT%H:%M:%SZ")


def seed(conn) -> None:
    ids = {}
    for key, (phone, name) in USERS.items():
        ids[key] = conn.execute("INSERT INTO users (phone, display_name) VALUES (?, ?)", (phone, name)).lastrowid

    # Everyone except Eve has everyone else (except Eve) as a contact.
    regulars = [user_id for key, user_id in ids.items() if key != "eve"]
    for a in regulars:
        for b in regulars:
            if a != b:
                conn.execute("INSERT INTO contacts (user_id, contact_user_id) VALUES (?, ?)", (a, b))

    for conv in CONVERSATIONS:
        member_ids = [ids[m] for m in conv["members"]]
        first_at = iso(conv["messages"][0][2] + 10)
        last_at = iso(conv["messages"][-1][2])
        if conv["type"] == "direct":
            low, high = sorted(member_ids)
            conv_id = conn.execute(
                "INSERT INTO conversations (type, direct_key, created_by, created_at, updated_at) VALUES ('direct', ?, ?, ?, ?)",
                (f"{low}:{high}", member_ids[0], first_at, last_at),
            ).lastrowid
        else:
            conv_id = conn.execute(
                "INSERT INTO conversations (type, name, created_by, created_at, updated_at) VALUES ('group', ?, ?, ?, ?)",
                (conv["name"], ids[conv["admin"]], first_at, last_at),
            ).lastrowid

        message_ids = []
        for i, (sender, text, minutes_ago) in enumerate(conv["messages"]):
            quoted = conv.get("replies", {}).get(i)
            message_ids.append(conn.execute(
                "INSERT INTO messages (conversation_id, sender_id, client_id, content, created_at, reply_to_id) VALUES (?, ?, ?, ?, ?, ?)",
                (conv_id, ids[sender], str(uuid.uuid4()), text, iso(minutes_ago), None if quoted is None else message_ids[quoted]),
            ).lastrowid)
        for i, member, emoji in conv.get("reactions", []):
            conn.execute(
                "INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)",
                (message_ids[i], ids[member], emoji, iso(conv["messages"][i][2] - 1)),
            )

        for member in conv["members"]:
            unread = conv["unread"].get(member, 0)
            read_ids = message_ids[: len(message_ids) - unread]
            role = "admin" if member == conv.get("admin") else "member"
            conn.execute(
                "INSERT INTO conversation_members (conversation_id, user_id, role, joined_at, last_read_message_id) VALUES (?, ?, ?, ?, ?)",
                (conv_id, ids[member], role, first_at, read_ids[-1] if read_ids else 0),
            )
            # Receipts agree with the read cursor: read up to it, delivered after it.
            for message_id, (sender, _, minutes_ago) in zip(message_ids, conv["messages"]):
                if sender == member:
                    continue
                if message_id in read_ids:
                    conn.execute(
                        "INSERT INTO message_receipts (message_id, user_id, status, delivered_at, read_at) VALUES (?, ?, 'read', ?, ?)",
                        (message_id, ids[member], iso(minutes_ago), iso(minutes_ago)),
                    )
                else:
                    conn.execute(
                        "INSERT INTO message_receipts (message_id, user_id, status, delivered_at) VALUES (?, ?, 'delivered', ?)",
                        (message_id, ids[member], iso(minutes_ago)),
                    )


def main() -> None:
    init_db()
    with db() as conn:
        already_seeded = conn.execute("SELECT 1 FROM users LIMIT 1").fetchone() is not None
        if "--reset" in sys.argv or not already_seeded:
            with conn:  # one transaction: a failed seed leaves the DB untouched
                # Delete children before parents so foreign keys are never violated.
                for table in ["message_reactions", "message_receipts", "messages", "conversation_members", "conversations", "contacts", "sessions", "users"]:
                    conn.execute(f"DELETE FROM {table}")
                seed(conn)
    close_db()

    if "--reset" not in sys.argv and already_seeded:
        print("Database already has users; use --reset to wipe and reseed.")
        return
    print("Seeded. Log in with any of these phones and code 123456:")
    for phone, name in USERS.values():
        print(f"  {phone}  {name}")


if __name__ == "__main__":
    main()
