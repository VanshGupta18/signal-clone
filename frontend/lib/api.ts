// Base URL of the FastAPI backend; set NEXT_PUBLIC_API_URL in production.
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}
