"use client";

import { useEffect, useState } from "react";
import { Phone, Video } from "lucide-react";
import Avatar from "@/components/Avatar";
import { formatLastSeen } from "@/lib/time";
import type { Conversation } from "@/types";
import styles from "./ChatHeader.module.css";

export default function ChatHeader({ conversation }: { conversation: Conversation }) {
  // Re-render every minute so "Last seen 5 min ago" doesn't go stale.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  let subtitle = "";
  if (conversation.type === "group") subtitle = `${conversation.member_count} members`;
  else if (conversation.other_online) subtitle = "Online";
  else if (conversation.other_last_seen_at) subtitle = formatLastSeen(conversation.other_last_seen_at, now);

  return (
    <header className={styles.header}>
      <Avatar
        name={conversation.name}
        src={conversation.avatar_url}
        colorSeed={conversation.other_user_id ?? conversation.id}
        size={32}
      />
      <div className={styles.text}>
        <div className={styles.name}>{conversation.name}</div>
        {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
      </div>
      <button className={styles.iconButton} title="Video call" aria-label="Video call">
        <Video size={20} />
      </button>
      <button className={styles.iconButton} title="Voice call" aria-label="Voice call">
        <Phone size={18} />
      </button>
    </header>
  );
}
