import re

import turso
from fastapi import APIRouter, Depends
from pydantic import BaseModel, field_validator

from app.auth import get_current_user, public_user
from app.database import get_db

router = APIRouter(prefix="/api", tags=["users"])

MAX_AVATAR_CHARS = 200_000  # client resizes to 128x128 JPEG, ~10-20 KB


class ProfileIn(BaseModel):
    display_name: str | None = None
    avatar_url: str | None = None  # data:image/... URL, or null to remove

    @field_validator("display_name")
    @classmethod
    def check_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not 1 <= len(value) <= 50:
            raise ValueError("Name must be 1-50 characters")
        return value

    @field_validator("avatar_url")
    @classmethod
    def check_avatar(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if len(value) > MAX_AVATAR_CHARS or not re.match(r"data:image/(png|jpeg|webp);base64,", value):
            raise ValueError("Avatar must be a small PNG, JPEG or WebP image")
        return value


@router.get("/me")
def get_me(user: turso.Row = Depends(get_current_user)):
    return public_user(user)


@router.patch("/me")
def update_me(
    body: ProfileIn,
    user: turso.Row = Depends(get_current_user),
    conn: turso.Connection = Depends(get_db),
):
    # model_fields_set = fields the client actually sent, so {"avatar_url": null}
    # removes the avatar while omitting avatar_url leaves it alone.
    with conn:
        if body.display_name is not None:
            conn.execute("UPDATE users SET display_name = ? WHERE id = ?", (body.display_name, user["id"]))
        if "avatar_url" in body.model_fields_set:
            conn.execute("UPDATE users SET avatar_url = ? WHERE id = ?", (body.avatar_url, user["id"]))
    return public_user(conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone())
