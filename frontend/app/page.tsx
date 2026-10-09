"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

// Temporary milestone-1 page: proves the frontend can reach the backend.
export default function Home() {
  const [status, setStatus] = useState("checking…");

  useEffect(() => {
    api<{ status: string }>("/api/health")
      .then((data) => setStatus(data.status))
      .catch((err) => setStatus(`unreachable (${err.message})`));
  }, []);

  return <main style={{ padding: 24 }}>Backend: {status}</main>;
}
