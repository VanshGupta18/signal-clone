from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool

from app.auth import user_for_token
from app.database import db

router = APIRouter()


def _lookup_user(token: str):
    with db() as conn:
        return user_for_token(conn, token)


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = ""):
    # Browsers can't set headers on WebSockets, so the token comes in the query
    # string. Never log it (uvicorn runs with --no-access-log).
    # DB access runs in a thread so the global DB lock never blocks the event loop.
    user = await run_in_threadpool(_lookup_user, token) if token else None
    if user is None:
        await websocket.close(code=4401)  # app-defined "unauthorized" close code
        return

    await websocket.accept()
    try:
        # Milestone 2b: echo only, to prove auth + wss:// work in production.
        while True:
            data = await websocket.receive_json()
            await websocket.send_json({"type": "echo", "user_id": user["id"], "data": data})
    except WebSocketDisconnect:
        pass
