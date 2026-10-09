import logging
import re
from contextlib import asynccontextmanager

import turso
from fastapi import Depends, FastAPI
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


app = FastAPI(title="Signal Clone API", lifespan=lifespan)

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


@app.get("/api/health")
def health(conn: turso.Connection = Depends(get_db)):
    conn.execute("SELECT 1")  # proves the database is reachable, not just the web server
    return {"status": "ok"}
