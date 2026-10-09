// Base URL of the FastAPI backend; set NEXT_PUBLIC_API_URL in production.
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const TOKEN_KEY = "signal_token";

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

  const res = await fetch(`${API_URL}${path}`, { ...init, headers });

  if (res.status === 401) {
    expireSession();
    throw new Error("Session expired");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(errorMessage(body) ?? `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

// FastAPI errors are {detail: "msg"} or, for validation, {detail: [{msg: "Value error, msg"}]}.
function errorMessage(body: { detail?: unknown } | null): string | null {
  if (typeof body?.detail === "string") return body.detail;
  if (Array.isArray(body?.detail) && body.detail[0]?.msg) {
    return String(body.detail[0].msg).replace(/^Value error, /, "");
  }
  return null;
}
