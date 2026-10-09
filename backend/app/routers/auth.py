import re

import turso
from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, field_validator

from app.auth import bearer, create_session, hash_token, public_user
from app.database import get_db

router = APIRouter(prefix="/api/auth", tags=["auth"])

# MOCK: no SMS is sent. Every phone number accepts this code.
MOCK_OTP = "123456"


class PhoneIn(BaseModel):
    phone: str

    @field_validator("phone")
    @classmethod
    def normalize_phone(cls, value: str) -> str:
        phone = re.sub(r"[\s\-().]", "", value)
        if not re.fullmatch(r"\+?\d{7,15}", phone):
            raise ValueError("Enter a valid phone number: 7-15 digits, with country code, e.g. +91 98765 43210")
        return phone if phone.startswith("+") else "+" + phone


class VerifyIn(PhoneIn):
    otp: str


@router.post("/request-code")
def request_code(body: PhoneIn):
    """MOCK: a real app would text the code here. We only validate the number
    so the phone step can show errors before moving to the code step."""
    return {"phone": body.phone}


@router.post("/verify")
def verify(body: VerifyIn, conn: turso.Connection = Depends(get_db)):
    """Login if the phone is registered, otherwise register it. Returns a session token."""
    if body.otp != MOCK_OTP:
        # 400, not 401: the client treats 401 as "your session expired".
        raise HTTPException(status_code=400, detail="Incorrect verification code")

    with conn:  # one transaction: user (if new) + session
        # ON CONFLICT DO NOTHING: two simultaneous first logins can't create two users.
        cursor = conn.execute(
            "INSERT INTO users (phone, display_name) VALUES (?, ?) ON CONFLICT(phone) DO NOTHING",
            (body.phone, body.phone),  # placeholder name until the profile step
        )
        is_new = cursor.rowcount == 1
        user = conn.execute("SELECT * FROM users WHERE phone = ?", (body.phone,)).fetchone()
        token = create_session(conn, user["id"])

    return {"token": token, "is_new": is_new, "user": public_user(user)}


@router.post("/logout", status_code=204)
def logout(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    conn: turso.Connection = Depends(get_db),
):
    if credentials:
        with conn:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (hash_token(credentials.credentials),))
    return Response(status_code=204)
