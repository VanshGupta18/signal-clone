"""Finding people and the contact list (the people offered in "New chat")."""
import re

import turso
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import get_current_user, public_user
from app.database import get_db

router = APIRouter(prefix="/api", tags=["contacts"])

SEARCH_LIMIT = 20

# Every person comes back with is_contact (mine), so the client knows whether to offer "Add".
PERSON_SQL = """SELECT u.*, EXISTS (SELECT 1 FROM contacts c WHERE c.user_id = ? AND c.contact_user_id = u.id) AS is_contact
                  FROM users u"""


def person(row: turso.Row) -> dict:
    return {**public_user(row), "is_contact": bool(row["is_contact"])}


class ContactIn(BaseModel):
    user_id: int


@router.get("/users/search")
def search_users(q: str = "", user: turso.Row = Depends(get_current_user), conn: turso.Connection = Depends(get_db)):
    """Name contains q (case-insensitive), or phone contains q's digits. Never me."""
    q = q.strip().lower()
    if len(q) < 2:
        return []
    digits = re.sub(r"\D", "", q)
    rows = conn.execute(
        f"""{PERSON_SQL}
             WHERE u.id != ? AND (instr(lower(u.display_name), ?) > 0 OR (? != '' AND instr(u.phone, ?) > 0))
             ORDER BY is_contact DESC, lower(u.display_name)
             LIMIT {SEARCH_LIMIT}""",
        (user["id"], user["id"], q, digits, digits),
    ).fetchall()
    return [person(row) for row in rows]


@router.get("/contacts")
def list_contacts(user: turso.Row = Depends(get_current_user), conn: turso.Connection = Depends(get_db)):
    rows = conn.execute(
        f"""{PERSON_SQL} JOIN contacts mine ON mine.contact_user_id = u.id AND mine.user_id = ?
             ORDER BY lower(u.display_name)""",
        (user["id"], user["id"]),
    ).fetchall()
    return [person(row) for row in rows]


@router.post("/contacts")
def add_contact(body: ContactIn, user: turso.Row = Depends(get_current_user), conn: turso.Connection = Depends(get_db)):
    """Idempotent: adding someone twice is fine."""
    if body.user_id == user["id"]:
        raise HTTPException(status_code=400, detail="You can't add yourself as a contact")
    if conn.execute("SELECT 1 FROM users WHERE id = ?", (body.user_id,)).fetchone() is None:
        raise HTTPException(status_code=404, detail="User not found")
    with conn:
        conn.execute(
            "INSERT INTO contacts (user_id, contact_user_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
            (user["id"], body.user_id),
        )
    return person(conn.execute(f"{PERSON_SQL} WHERE u.id = ?", (user["id"], body.user_id)).fetchone())
