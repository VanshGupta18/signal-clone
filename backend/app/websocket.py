import json

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, ValidationError

from app.auth import user_for_token
from app.database import db
from app.messages import (
    NOW, mark_delivered, mark_read, member_ids, peer_ids, require_member, send_message, tick_updates,
)

router = APIRouter()

# Connection manager: user_id -> that user's open sockets (one per tab/device).
# ponytail: in-memory, so it only works with ONE backend process (D25); several instances need pub/sub (e.g. Redis).
connections: dict[int, set[WebSocket]] = {}


def is_online(user_id: int) -> bool:
    """Online = at least one open socket."""
    return user_id in connections


async def send_to(user_ids, event: dict, skip: WebSocket | None = None) -> None:
    """Push an event to every open socket of these users (except `skip`)."""
    for user_id in user_ids:
        for ws in list(connections.get(user_id, ())):  # copy: the set can change while we await
            if ws is skip:
                continue
            try:
                await ws.send_json(event)
            except Exception:  # socket already closing; its own handler unregisters it
                pass


# Client payloads. No user/sender fields anywhere: identity is always the socket's session.
class SendIn(BaseModel):
    conversation_id: int
    content: str
    client_id: str = Field(min_length=1, max_length=100)


class DeliveredIn(BaseModel):
    message_ids: list[int] = Field(default=[], max_length=500)
    up_to_id: int = 0  # catch-up: everything up to the newest message the client loaded


class ConversationIn(BaseModel):
    conversation_id: int


def error(client_id: str | None, detail: str) -> dict:
    return {"type": "error", "client_id": client_id, "detail": detail}


def receipt_pushes(conn, message_ids: list[int]) -> list:
    """One receipt:update per sender, carrying each message's recomputed ticks (D42)."""
    return [
        ([sender_id], {"type": "receipt:update", "messages": updates})
        for sender_id, updates in tick_updates(conn, message_ids).items()
    ]


def handle_event(user_id: int, text: str) -> tuple[dict | None, list]:
    """One client event in. Runs in a worker thread (it takes the DB lock).

    Returns (reply for this socket or None, pushes). A push is (user_ids, event) and goes
    to those users' sockets except this one, so a user's other tabs stay in sync.
    Errors become an `error` reply; the socket stays open.
    """
    try:
        event = json.loads(text)
    except ValueError:
        return error(None, "Invalid JSON"), []
    if not isinstance(event, dict):
        return error(None, "Invalid event"), []
    client_id = event.get("client_id") if isinstance(event.get("client_id"), str) else None
    kind = event.get("type")

    try:
        if kind == "message:send":
            body = SendIn.model_validate(event)
            with db() as conn:
                message, created = send_message(conn, user_id, body.conversation_id, body.content, body.client_id)
                # A retry of a saved message (created=False) is only re-acked: everyone already got message:new.
                members = member_ids(conn, body.conversation_id) if created else []
            # Ack first (reply), then message:new to the other members and my other tabs.
            pushes = [(members, {"type": "message:new", "message": message})] if created else []
            return {"type": "message:ack", "client_id": body.client_id, "message": message}, pushes

        if kind == "message:delivered":
            body = DeliveredIn.model_validate(event)
            with db() as conn:
                changed = mark_delivered(conn, user_id, body.message_ids, body.up_to_id)
                return None, receipt_pushes(conn, changed)

        if kind == "conversation:read":
            body = ConversationIn.model_validate(event)
            with db() as conn:
                moved, changed = mark_read(conn, user_id, body.conversation_id)
                pushes = receipt_pushes(conn, changed)
            if not moved and not changed:
                return None, pushes
            # Tell all my tabs (this one too) so they reload the list and the badge clears.
            done = {"type": "conversation:read", "conversation_id": body.conversation_id}
            return done, [([user_id], done), *pushes]

        if kind in ("typing:start", "typing:stop"):
            body = ConversationIn.model_validate(event)
            with db() as conn:
                require_member(conn, body.conversation_id, user_id)
                others = [m for m in member_ids(conn, body.conversation_id) if m != user_id]
            return None, [(others, {"type": kind, "conversation_id": body.conversation_id, "user_id": user_id})]
    except ValidationError:
        return error(client_id, f"Invalid {kind} payload"), []
    except HTTPException as exc:
        return error(client_id, exc.detail), []

    return error(client_id, "Unknown event type"), []


def _lookup_user(token: str):
    with db() as conn:
        return user_for_token(conn, token)


def _peers(user_id: int) -> list[int]:
    with db() as conn:
        return peer_ids(conn, user_id)


def _went_offline(user_id: int) -> tuple[list[int], str]:
    with db() as conn:
        with conn:
            last_seen_at = conn.execute(
                f"UPDATE users SET last_seen_at = {NOW} WHERE id = ? RETURNING last_seen_at", (user_id,)
            ).fetchone()["last_seen_at"]
        return peer_ids(conn, user_id), last_seen_at


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = ""):
    # Browsers can't set headers on WebSockets, so the token comes in the query
    # string. Never log it: the RedactTokens filter in main.py strips it from uvicorn's logs.
    # DB access runs in a thread so the global DB lock never blocks the event loop.
    user = await run_in_threadpool(_lookup_user, token) if token else None
    await websocket.accept()
    if user is None:
        # Accept first, then close: closing before accept() rejects the HTTP handshake,
        # and browsers then only see a generic 1006 instead of our 4401.
        await websocket.close(code=4401)  # app-defined "unauthorized" close code
        return

    user_id = user["id"]
    sockets = connections.setdefault(user_id, set())
    sockets.add(websocket)
    if len(sockets) == 1:  # first tab: went online
        presence = {"type": "presence:update", "user_id": user_id, "online": True, "last_seen_at": user["last_seen_at"]}
        await send_to(await run_in_threadpool(_peers, user_id), presence)

    try:
        while True:
            text = await websocket.receive_text()
            reply, pushes = await run_in_threadpool(handle_event, user_id, text)
            # Persisted (and pushed to Turso) before anything goes out.
            if reply is not None:
                await websocket.send_json(reply)
            for user_ids, event in pushes:
                await send_to(user_ids, event, skip=websocket)
    except WebSocketDisconnect:
        pass
    finally:
        sockets.discard(websocket)
        if not sockets:  # last tab closed: offline, remember when
            del connections[user_id]
            peers, last_seen_at = await run_in_threadpool(_went_offline, user_id)
            if not is_online(user_id):  # skip if a new tab connected while we were writing
                presence = {"type": "presence:update", "user_id": user_id, "online": False, "last_seen_at": last_seen_at}
                await send_to(peers, presence)
