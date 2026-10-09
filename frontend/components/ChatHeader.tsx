"use client";

import { useEffect, useState } from "react";
import { Phone, ShieldCheck, Video } from "lucide-react";
import Avatar from "@/components/Avatar";
import { toast } from "@/components/Toast";
import { formatLastSeen } from "@/lib/time";
import type { Conversation } from "@/types";
import styles from "./ChatHeader.module.css";

type Props = {
  conversation: Conversation;
  onOpenDetails?: () => void; // groups: clicking the name opens Group info
  onSafetyNumber?: () => void; // direct chats: the (mock) safety number dialog
};

const callsComingSoon = () => toast("Calls are coming soon");

export default function ChatHeader({ conversation, onOpenDetails, onSafetyNumber }: Props) {
  // Re-render every minute so "Last seen 5 min ago" doesn't go stale.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  let subtitle = "";
  if (conversation.type === "group") subtitle = `${conversation.member_count} ${conversation.member_count === 1 ? "member" : "members"}`;
  else if (conversation.other_online) subtitle = "Online";
  else if (conversation.other_last_seen_at) subtitle = formatLastSeen(conversation.other_last_seen_at, now);

  return (
    <header className={styles.header}>
      <button
        className={styles.title}
        onClick={onOpenDetails}
        disabled={!onOpenDetails}
        aria-label={onOpenDetails ? "Group details" : undefined}
        title={onOpenDetails ? "Group details" : undefined}
      >
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
      </button>
      <button className={styles.iconButton} title="Video call" aria-label="Video call" onClick={callsComingSoon}>
        <Video size={20} />
      </button>
      <button className={styles.iconButton} title="Voice call" aria-label="Voice call" onClick={callsComingSoon}>
        <Phone size={18} />
      </button>
      {onSafetyNumber && (
        <button
          className={styles.iconButton}
          title="View safety number"
          aria-label="View safety number"
          onClick={onSafetyNumber}
        >
          <ShieldCheck size={18} />
        </button>
      )}
    </header>
  );
}
