// The one WebSocket for the logged-in session: auto-reconnect, event listeners,
// and an outbox so messages sent while offline go out (same client_id) on reconnect.
import { API_URL, expireSession, getToken } from "@/lib/api";
import type { ClientEvent, SendPayload, ServerEvent } from "@/types";

const MIN_RETRY_MS = 1000;
const MAX_RETRY_MS = 10000;

let socket: WebSocket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryMs = MIN_RETRY_MS;
const listeners = new Set<(event: ServerEvent) => void>();
// message:send events not yet answered (ack or error), keyed by client_id.
// The server dedupes on client_id, so resending one that was saved is harmless.
const outbox = new Map<string, SendPayload>();

function transmit(payload: SendPayload) {
  socket?.send(JSON.stringify({ type: "message:send", ...payload }));
}

export function connect() {
  const token = getToken();
  if (!token || socket) return;
  listeners.forEach((listener) => listener({ type: "socket:connecting" }));
  // http://host -> ws://host, https://host -> wss://host
  const ws = new WebSocket(`${API_URL.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(token)}`);
  socket = ws;

  ws.onopen = () => {
    retryMs = MIN_RETRY_MS;
    outbox.forEach(transmit);
    // Lets the page refetch whatever it missed while disconnected.
    listeners.forEach((listener) => listener({ type: "socket:open" }));
  };

  ws.onmessage = (e) => {
    const event: ServerEvent = JSON.parse(e.data);
    if ((event.type === "message:ack" || event.type === "error") && event.client_id) {
      outbox.delete(event.client_id);
    }
    listeners.forEach((listener) => listener(event));
  };

  ws.onclose = (e) => {
    socket = null;
    if (e.code === 4401) {
      expireSession(); // reconnecting with this token would never succeed
      return;
    }
    listeners.forEach((listener) => listener({ type: "socket:close" }));
    // Exponential backoff: 1s, 2s, 4s, 8s, 10s, 10s ..., reset once a connection opens.
    retryTimer = setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
  };
}

// Skip the rest of the backoff (up to 10s) when someone is actually waiting: they just
// pressed send, or the browser says the network is back.
function reconnectNow() {
  if (socket || retryTimer === undefined) return; // already (re)connecting, or closed on purpose
  clearTimeout(retryTimer);
  retryTimer = undefined;
  retryMs = MIN_RETRY_MS;
  connect();
}
if (typeof window !== "undefined") window.addEventListener("online", reconnectNow);

export function disconnect() {
  clearTimeout(retryTimer);
  retryTimer = undefined;
  outbox.clear();
  if (socket) {
    socket.onclose = null; // closed on purpose: don't reconnect
    socket.close();
    socket = null;
  }
}

export function subscribe(listener: (event: ServerEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Sends now if connected; otherwise it waits in the outbox until the socket reopens.
export function sendMessage(payload: SendPayload) {
  outbox.set(payload.client_id, payload);
  if (socket?.readyState === WebSocket.OPEN) transmit(payload);
  else reconnectNow();
}

// Receipts, reads and typing: fire-and-forget. If offline they're dropped; the page
// re-sends delivered/read after the next (re)connect, and typing is throwaway anyway.
export function sendEvent(event: ClientEvent) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
}
