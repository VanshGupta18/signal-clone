# Decision log

Every non-obvious choice in this project, why it was made, and what it costs.
Newest decisions are added at the bottom of their section. Format: **Decision**, then *Why*, *Rejected*, *Trade-off*.

---

## Stack & code style

### D1. Next.js + FastAPI + SQLite + WebSockets
*Why:* Required by the assignment.
*Trade-off:* None to defend. It's the given stack.

### D2. Plain SQL, no ORM
*Why:* The schema is graded, and raw SQL keeps every query visible and explainable. Seven tables don't need an ORM's abstractions.
*Rejected:* SQLAlchemy / SQLModel. They add a layer to learn and defend, and they hide the SQL the evaluator wants to see.
*Trade-off:* Some repetition in queries, and no automatic migrations (we recreate the dev DB instead).

### D3. Frontend: plain React state, CSS Modules, `lucide-react` for icons
*Why:* The app's state is small (current user, conversations, open chat). CSS Modules give scoped styles with no extra tooling. One icon library keeps icons consistent and avoids emoji-as-icons.
*Rejected:* Redux/Zustand (not needed at this size), Tailwind (we're matching Signal's exact styling, so hand-written CSS is clearer).

---

## Database schema

### D4. One `conversations` table for direct and group chats, plus a `conversation_members` join table
*Why:* Membership, messages and authorization work the same way for both chat types. One code path means fewer bugs. `type` (`direct`/`group`) handles the few differences.
*Rejected:* Separate `direct_chats` and `groups` tables. That would duplicate every query and permission check.

### D5. `message_receipts` table, one row per (message, recipient)
*Why:* In a group, each recipient has their own delivered/read state. A single `status` column on `messages` can't represent "Bob read it, Carol hasn't".
*Trade-off:* More rows: a message to a 10-person group creates 9 receipts. That's fine at this scale.

### D6. `messages.id AUTOINCREMENT` is the only ordering. `last_read_message_id` is the read cursor.
*Why:* Ids strictly increase in insert order and are never reused, so "latest message", history order and "unread = id > my cursor" all use one number. `created_at` is for display only.
*Rejected:* Ordering by timestamp. Two messages can share a second, and clocks can disagree.

### D7. `direct_key = "<smaller_id>:<larger_id>"` with a UNIQUE constraint
*Why:* Prevents duplicate direct chats between the same two people, even when both click "new chat" at the same moment. The database enforces it, so we don't need locking code.

### D8. `UNIQUE(sender_id, client_id)` on messages
*Why:* Makes retries safe. The client generates a UUID per message. If the ack is lost and the client resends, the second insert hits the constraint and the server returns the existing message instead of creating a duplicate.

### D9. Timestamps stored as ISO-8601 UTC with a trailing `Z` (`2026-10-09T10:00:00Z`)
*Why:* SQLite's default `CURRENT_TIMESTAMP` gives `2026-10-09 10:00:00` with no timezone. Browsers parse that as *local* time, so every timestamp would be shifted by the viewer's UTC offset (5h30m in India).

### D10. Foreign keys switched on for every connection (`PRAGMA foreign_keys = ON`)
*Why:* SQLite ignores `REFERENCES` unless this is on. Without it, the schema's relationships are only decoration.

### D11. `CHECK` constraints for enums and invariants
*Why:* Values like `type`, `role` and `status` can only be valid ones, and a direct chat must have a `direct_key` while a group must have a name. Invalid data is rejected by the database itself, whatever code path wrote it.

---

## Auth

### D12. Phone number only, no usernames
*Why:* Signal's real onboarding is phone-based, and the assignment allows "phone or username". One identifier means one lookup path.

### D13. Register and login are one flow: `request-code` then `verify`
*Why:*
- `POST /auth/request-code` validates and normalizes the phone number. In a real app this is where the SMS would be sent. It exists so the *phone* screen can show "invalid number" instead of the error appearing on the code screen.
- `POST /auth/verify` checks the code, then logs in an existing user or creates a new one, and returns `is_new` so the client knows whether to show the profile step.

*Rejected:* Separate register and login endpoints. That's more code, and a "this number is already registered" error leaks which numbers have accounts.

### D14. Mock OTP: the code is always `123456`
*Why:* The assignment allows a mocked verification step. The UI says plainly that it's a demo code. Nothing claims an SMS was sent.

### D15. Server-side sessions with random tokens; only the SHA-256 hash is stored
*Why:*
- Logout must really end a session, so we delete the row. A stateless JWT can't be revoked like that.
- Storing only the hash means a leaked database file doesn't contain usable tokens.

*Rejected:* JWT. Revoking one needs a blocklist, which is just sessions with extra steps.

### D16. Token sent in an `Authorization: Bearer` header and kept in `localStorage`
*Why:* The frontend (Vercel) and backend (Render) are on different domains. Cross-site cookies there are fragile (SameSite rules, third-party cookie blocking).
*Trade-off:* An XSS bug could read the token. React escapes rendered text by default, which reduces that risk.

### D17. The user is always derived from the token, never from a request field
*Why:* Every authorization decision depends on knowing who is calling. `get_current_user` (REST) and `user_for_token` (WebSocket) are the only sources of identity. Any `user_id` a client sends is ignored. This is tested.

### D18. Wrong OTP returns 400, not 401
*Why:* The frontend treats any 401 as "session expired": it clears the token and goes to `/login`. A wrong code isn't a session problem.

### D19. Sessions never expire
*Trade-off:* Acceptable for a demo; logout still revokes them. A real app would add `expires_at` and check it in `user_for_token`.

---

## API

### D20. CORS allows any origin (`*`)
*Why:* CORS protects *cookies* that browsers attach automatically. Our auth is an explicit header a foreign site can't obtain, so allowing any origin exposes nothing. It also means no per-environment origin list to misconfigure.

### D21. `PATCH /me` uses "fields the client sent" semantics
*Why:* `{"avatar_url": null}` removes the avatar, while leaving `avatar_url` out keeps it. Pydantic's `model_fields_set` tells these two cases apart.

### D22. Avatars are stored as data URLs in `users.avatar_url`, resized in the browser to 128×128 JPEG
*Why:* There's no file storage, and a resized avatar is about 3–20 KB. The backend accepts only `data:image/png|jpeg|webp` up to 200 KB, so `javascript:` URLs and huge uploads are rejected.
*Rejected:* An upload endpoint plus object storage. It would be another service for a feature that doesn't need it.

### D23. `/api/health` runs `SELECT 1`
*Why:* The health check also proves the database is reachable, not just that the web server is up. Render uses it to decide whether a deploy is healthy.

---

## Real-time

### D24. WebSocket auth via `?token=` in the URL; close code `4401` when invalid
*Why:* Browsers can't set headers on WebSocket connections. The token is validated against `sessions` before the socket is accepted. uvicorn runs with `--no-access-log` so URLs, and therefore tokens, never reach the logs.

### D25. One in-memory connection manager (user → sockets) in a single backend process
*Why:* It's the simplest correct design for one server instance.
*Trade-off:* It doesn't scale to several instances; that would need shared pub/sub such as Redis. This is the main reason the backend isn't on Vercel (D27).

---

## Hosting & database engine

### D26. Frontend on Vercel, backend on Render (free plan), database on Turso Cloud (free plan)
*Why:* Everything is free, and the architecture stays unchanged.
- **Render free** runs one long-lived process with WebSockets. That's exactly what D25 needs.
- **Turso** is SQLite-compatible, so the schema and SQL stay pure SQLite, which the assignment requires.

*Trade-off:* Render's free tier sleeps after 15 minutes idle and takes about a minute to wake. Open the backend URL before a demo; the README must say so.

### D27. Rejected: hosting the backend on Vercel
*Why not:*
- Vercel Functions have a read-only filesystem except a temporary `/tmp`, so a SQLite file can't persist.
- WebSockets on Vercel (public beta since mid-2026) pin each connection to one of possibly many instances, so our in-memory fan-out (D25) would miss users on other instances. Fixing that needs Redis.
- Connections are also cut at the function time limit.

All-Vercel would mean three services plus a real-time rewrite on a beta feature.

### D28. Rejected: SQLite file on the host's own disk
*Why not:* Render free, Koyeb free and Hugging Face Spaces free all have temporary disks, so the database would be wiped on every restart, sleep or deploy. Persistent disks need paid plans.

### D29. Python driver: `pyturso`, not `libsql`
*Why:* We tested both. `pyturso` behaves like `sqlite3` for everything we use: `turso.Row` (named columns), `turso.IntegrityError`, `lastrowid`, `rowcount`, `with conn:` transactions and foreign keys. `libsql` returns plain tuples and raises `ValueError` for constraint errors, which would mean rewriting every query result and error handler. Turso's docs also recommend `pyturso` for new projects. The same driver runs locally (plain file) and in production (synced), so tests exercise the production code path.

### D30. Production: local SQLite file synced to Turso Cloud (`push()` after each request)
*Why:* `pyturso` has no "remote only" mode. It keeps a local file and syncs it, which fits a host with a temporary disk:
- On boot, it downloads the database from Turso if the local file is empty.
- After each request, it pushes local changes to Turso.
- Reads are local and fast.

### D31. The push happens before the HTTP response is sent
*Why:* "Persist, then acknowledge" is a core rule. We verified that FastAPI runs a `yield` dependency's cleanup before sending the response, so a client only sees success once the write is in Turso Cloud.
*Trade-off:* Every request waits for one push round-trip. If that latency becomes a problem, push only when something changed.

### D32. One shared database connection behind a global lock
*Why:* We tested `pyturso` with concurrent connections. It fails with "database is locked" and has no busy-timeout like `sqlite3`. One connection guarded by `threading.Lock` passed 400 concurrent operations across 16 threads in 27 ms, including rollbacks.
*Trade-off:* All database work runs one operation at a time. Queries take microseconds, so that's fine for a demo. WebSocket handlers must reach the DB via `run_in_threadpool` so waiting for the lock never blocks the event loop.
*Supersedes:* The original plan of one connection per request with WAL plus `busy_timeout`.

### D33. `pyturso` locks the database file to one process
*Consequence:* Stop the backend before running `seed.py` locally. The `sqlite3` CLI can read the file only while the backend is stopped. In production the start command runs `seed.py` first, then uvicorn, so they never overlap.

### D34. The seed script is idempotent and runs on every production start
*Why:* With no users, it seeds. With users, it does nothing. `--reset` wipes and reseeds in one transaction. A fresh deploy is usable immediately, and redeploys never wipe real data.

---

## Process

### D35. Deploy early (milestone 2b), before building the main UI
*Why:* WebSockets over `wss://`, CORS, persistence and auth problems often only appear in production. Finding them on day 1 is cheap; finding them at the deadline isn't.
