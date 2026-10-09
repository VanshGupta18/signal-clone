"use client";

import { useLayoutEffect, useRef } from "react";
import Avatar from "@/components/Avatar";
import MessageBubble from "@/components/MessageBubble";
import { formatDay, isSameDay } from "@/lib/time";
import type { Message } from "@/types";
import styles from "./MessageList.module.css";

const GROUPING_WINDOW_MS = 5 * 60 * 1000;

type Props = {
  messages: Message[];
  myId: number;
  isGroup: boolean;
  typingUserIds: number[]; // others typing in this chat
  onRetry: (message: Message) => void;
};

// Consecutive messages from the same sender, on the same day, a few minutes apart
// form one visual run (tighter spacing, flattened inner corners).
function sameRun(a: Message | undefined, b: Message | undefined): boolean {
  if (!a || !b) return false;
  return (
    a.sender_id === b.sender_id &&
    isSameDay(a.created_at, b.created_at) &&
    Math.abs(Date.parse(b.created_at) - Date.parse(a.created_at)) < GROUPING_WINDOW_MS
  );
}

export default function MessageList({ messages, myId, isGroup, typingUserIds, onRetry }: Props) {
  const scroller = useRef<HTMLDivElement>(null);

  // Start at the newest message (before paint, so there's no visible jump).
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages, typingUserIds.length]);

  return (
    <div className={styles.scroller} ref={scroller}>
      <div className={styles.list}>
        {messages.map((message, i) => {
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const newDay = !prev || !isSameDay(prev.created_at, message.created_at);
          return (
            // client_id, not id: unsent messages have no id yet
            <div key={message.client_id}>
              {newDay && <div className={styles.day}>{formatDay(message.created_at)}</div>}
              <MessageBubble
                message={message}
                isOwn={message.sender_id === myId}
                isGroup={isGroup}
                joinsPrev={!newDay && sameRun(prev, message)}
                joinsNext={sameRun(message, next)}
                onRetry={() => onRetry(message)}
              />
            </div>
          );
        })}
        {typingUserIds.length > 0 && (
          <div className={styles.typingRow}>
            {/* Groups: avatars of who's typing, found via their latest message here. */}
            {isGroup &&
              typingUserIds.map((id) => {
                const sender = messages.findLast((m) => m.sender_id === id);
                return <Avatar key={id} name={sender?.sender_name ?? ""} src={sender?.sender_avatar_url} colorSeed={id} size={28} />;
              })}
            <div className={styles.typingBubble} aria-label="Typing">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
