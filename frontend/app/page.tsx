"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Avatar from "@/components/Avatar";
import { api, clearToken, getToken } from "@/lib/api";
import type { User } from "@/types";

// Temporary milestone-2 page: proves the session works. Replaced by the chat UI in milestone 3.
export default function Home() {
  const router = useRouter();
  const [me, setMe] = useState<User | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    // A stale/invalid token gets a 401 here, and api() sends us to /login.
    api<User>("/api/me").then(setMe).catch(() => {});
  }, [router]);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    clearToken();
    router.replace("/login");
  }

  if (!me) return null;

  return (
    <main style={{ padding: 24, display: "flex", alignItems: "center", gap: 12 }}>
      <Avatar name={me.display_name} src={me.avatar_url} colorSeed={me.id} size={48} />
      <div>
        <div>Signed in as <b>{me.display_name}</b></div>
        <div style={{ color: "#5e5e5e" }}>{me.phone}</div>
      </div>
      <button onClick={logout} style={{ marginLeft: 24 }}>Log out</button>
    </main>
  );
}
