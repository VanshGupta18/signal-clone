// Base URL of the FastAPI backend; set NEXT_PUBLIC_API_URL in production.
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const TOKEN_KEY = "signal_token";
// GETs only, and long enough for a cold Render backend (~1 min to wake across retries).
// Writes never time out client-side: aborting a login/send mid-flight helps nobody.
const GET_TIMEOUT_MS = 30000;
const GET_RETRIES = 2;

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// Session is invalid or was logged out elsewhere (REST 401 / WebSocket 4401): start over.
export function expireSession() {
  clearToken();
  // Full reload on purpose: wipes all in-memory state of the old session. Not a component, so no router.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = "/login";
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body) headers.set("Content-Type", "application/json");

  const canRetry = (init.method ?? "GET").toUpperCase() === "GET";
  let lastError: unknown;

  for (let attempt = 0; attempt <= (canRetry ? GET_RETRIES : 0); attempt += 1) {
    const controller = new AbortController();
    // abort(reason) makes fetch reject with this Error (not an AbortError), so callers can
    // tell a timeout apart from their own cancellation.
    const timeout = canRetry ? setTimeout(() => controller.abort(new Error("Request timed out")), GET_TIMEOUT_MS) : undefined;
    const onAbort = () => controller.abort();
    init.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const res = await fetch(`${API_URL}${path}`, { ...init, headers, signal: controller.signal });
      if (res.status >= 500 && canRetry && attempt < GET_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
        continue;
      }

      if (res.status === 401) {
        expireSession();
        throw new Error("Session expired");
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(errorMessage(body) ?? `Request failed (${res.status})`);
      }
      return res.status === 204 ? (undefined as T) : res.json();
    } catch (error) {
      lastError = error;
      if (init.signal?.aborted) throw error;
      if (!canRetry || attempt >= GET_RETRIES) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    } finally {
      clearTimeout(timeout);
      init.signal?.removeEventListener("abort", onAbort);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Request failed");
}

// FastAPI errors are {detail: "msg"} or, for validation, {detail: [{msg: "Value error, msg"}]}.
function errorMessage(body: { detail?: unknown } | null): string | null {
  if (typeof body?.detail === "string") return body.detail;
  if (Array.isArray(body?.detail) && body.detail[0]?.msg) {
    return String(body.detail[0].msg).replace(/^Value error, /, "");
  }
  return null;
}

// Kinder wording for errors the browser or our wrapper produce (no connection, timeouts, 5xx).
// The backend's own `detail` messages are already written for people, so they pass through.
export function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  // Chrome "Failed to fetch", Safari "Load failed", Firefox "NetworkError…", our GET timeout.
  if (/failed to fetch|load failed|networkerror|timed out/i.test(message)) {
    return "Can't reach Signal right now. The server may be waking up, so try again in a moment.";
  }
  if (!message || /^Request failed \(5\d\d\)$/.test(message)) return "Something went wrong on our side. Please try again.";
  return message;
}
