"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";
import Avatar from "@/components/Avatar";
import MessageBubble from "@/components/MessageBubble";
import { toast } from "@/components/Toast";
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
  onReply: (message: Message) => void;
  onReact: (message: Message, emoji: string) => void;
  onLoadOlder?: () => void;
  hasOlder?: boolean;
  loadingOlder?: boolean;
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

export default function MessageList({
  messages, myId, isGroup, typingUserIds, onRetry, onReply, onReact, onLoadOlder, hasOlder, loadingOlder,
}: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  // Newest message id when the chat was opened. Only bubbles after it (just sent or received,
  // id 0 = still sending) slide in; the history and older pages appear without animation.
  const [openedAtId] = useState(() => Math.max(0, ...messages.map((m) => m.id)));
  const [highlightedId, setHighlightedId] = useState<number | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Clicking a quote scrolls to the original and pulses it. Only loaded messages can be
  // found; older ones would need paging back to them.
  function jumpTo(id: number) {
    const element = document.getElementById(`message-${id}`);
    if (!element) return toast("That message is further back. Scroll up to load it.");
    element.scrollIntoView({ block: "center", behavior: "smooth" });
    clearTimeout(highlightTimer.current);
    setHighlightedId(id);
    highlightTimer.current = setTimeout(() => setHighlightedId(null), 1600);
  }
  const initialScroll = useRef(true);
  const previousHeight = useRef(0);
  const previousCount = useRef(-1);
  const lastKey = useRef<string | undefined>(undefined); // newest message rendered so far
  const atBottom = useRef(true); // was the reader at the bottom before this update?

  // Start at the newest message (before paint, so there's no visible jump). Later, a new message
  // at the end scrolls into view if it's mine or the reader was already at the bottom.
  useLayoutEffect(() => {
    const element = scroller.current;
    const last = messages.at(-1);
    if (!element) return;
    if (messages.length === previousCount.current) return;
    if (initialScroll.current) {
      element.scrollTop = element.scrollHeight;
      initialScroll.current = false;
    } else if (loadingOlder) {
      element.scrollTop += element.scrollHeight - previousHeight.current;
    } else if (last && last.client_id !== lastKey.current && (atBottom.current || last.sender_id === myId)) {
      element.scrollTop = element.scrollHeight;
    }
    lastKey.current = last?.client_id;
    previousCount.current = messages.length;
    previousHeight.current = element.scrollHeight;
  }, [messages, loadingOlder, myId]);

  return (
    <div
      className={styles.scroller}
      ref={scroller}
      onScroll={(event) => {
        const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
        previousHeight.current = scrollHeight;
        atBottom.current = scrollHeight - scrollTop - clientHeight < 80;
        if (event.currentTarget.scrollTop < 80 && hasOlder && !loadingOlder) onLoadOlder?.();
      }}
    >
      <div className={styles.list}>
        {hasOlder && <div className={styles.day}>{loadingOlder ? "Loading older messages…" : "Scroll up for older messages"}</div>}
        <EncryptionNotice />
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
                myId={myId}
                isGroup={isGroup}
                joinsPrev={!newDay && sameRun(prev, message)}
                joinsNext={sameRun(message, next)}
                highlighted={message.id === highlightedId}
                animateIn={message.id === 0 || message.id > openedAtId}
                onRetry={() => onRetry(message)}
                onReply={() => onReply(message)}
                onReact={(emoji) => onReact(message, emoji)}
                onJumpToQuote={jumpTo}
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

// Where Signal says "Messages are end-to-end encrypted". We don't encrypt, so we say so (D80).
export function EncryptionNotice() {
  return (
    <p className={styles.encryption}>
      <Lock size={12} /> Encryption is simulated in this demo. Messages are not end-to-end encrypted.
    </p>
  );
}
