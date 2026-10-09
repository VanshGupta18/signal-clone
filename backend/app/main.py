import logging
import re
import time
import uuid
from contextlib import asynccontextmanager

import turso
from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.database import close_db, get_db, init_db
from app import websocket
from app.routers import auth, contacts, conversations, users


class RedactTokens(logging.Filter):
    """uvicorn logs every WebSocket handshake ("WebSocket /ws?token=... [accepted]") even
    with --no-access-log. Rewrite those lines so session tokens never reach the logs."""

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        if "token=" in message:
            record.msg, record.args = re.sub(r"token=[^&\s\"]+", "token=[redacted]", message), ()
        return True


logging.getLogger("uvicorn.error").addFilter(RedactTokens())


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield
    close_db()


app = FastAPI(
    title="Signal Clone API",
    version="1.0.0",
    description=(
        "REST API of a Signal Desktop clone. Real-time events (sending, receipts, typing, presence, "
        "reactions) use the WebSocket at `/ws?token=<session token>`; see the README for the event list. "
        "Authenticate with `Authorization: Bearer <token>` from `POST /api/auth/verify` "
        "(mock verification: the code is always 123456)."
    ),
    lifespan=lifespan,
)


@app.middleware("http")
async def request_timing(request: Request, call_next):
    request_id = uuid.uuid4().hex[:12]
    started_at = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - started_at) * 1000
    response.headers["X-Request-ID"] = request_id
    response.headers["Server-Timing"] = f"app;dur={elapsed_ms:.1f}"
    if elapsed_ms > 500:
        logging.getLogger("app").warning(
            "slow_request request_id=%s method=%s path=%s status=%s duration_ms=%.1f",
            request_id, request.method, request.url.path, response.status_code, elapsed_ms,
        )
    return response

# Any origin is safe here: auth is an explicit Bearer header, never a cookie, so a
# foreign site can't make requests as the user (it doesn't have their token).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(contacts.router)
app.include_router(conversations.router)
app.include_router(websocket.router)


@app.get("/api/health/live")
def live():
    return {"status": "ok"}


@app.get("/api/health/ready")
def ready(conn: turso.Connection = Depends(get_db)):
    conn.execute("SELECT 1")  # proves the database is reachable, not just the web server
    return {"status": "ok"}


@app.get("/api/health")
def health(conn: turso.Connection = Depends(get_db)):
    conn.execute("SELECT 1")
    return {"status": "ok"}
