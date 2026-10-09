import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, CheckCheck, CircleAlert, CircleDashed, Reply, SmilePlus } from "lucide-react";
import Avatar, { avatarTextColor } from "@/components/Avatar";
import { formatTime } from "@/lib/time";
import type { Message, MessageStatus } from "@/types";
import styles from "./MessageBubble.module.css";

// Signal's reaction set (the server accepts only these), with names for screen readers.
export const REACTIONS: [emoji: string, label: string][] = [
  ["❤️", "Love"],
  ["👍", "Thumbs up"],
  ["👎", "Thumbs down"],
  ["😂", "Laugh"],
  ["😮", "Surprised"],
  ["😢", "Sad"],
];
const reactionLabel = (emoji: string) => REACTIONS.find(([e]) => e === emoji)?.[1] ?? emoji;

type Props = {
  message: Message;
  myId: number;
  isGroup: boolean;
  joinsPrev: boolean; // previous bubble is from the same sender (same run)
  joinsNext: boolean;
  highlighted: boolean; // just jumped to from a quote
  onRetry: () => void; // only used for a failed send
  onReply: () => void;
  onReact: (emoji: string) => void; // the server toggles it off if it's already my reaction
  onJumpToQuote: (id: number) => void;
};

export default function MessageBubble({
  message, myId, isGroup, joinsPrev, joinsNext, highlighted, onRetry, onReply, onReact, onJumpToQuote,
}: Props) {
  const isOwn = message.sender_id === myId;
  // In groups, incoming runs get the sender's name on top and their avatar at the bottom.
  const showGroupChrome = isGroup && !isOwn;
  const failed = isOwn && message.status === "failed";
  const saved = message.id > 0; // pending bubbles can't be replied to or reacted to yet
  const [pickerOpen, setPickerOpen] = useState(false);
  const quote = message.reply_to;

  const classes = [
    styles.bubble,
    isOwn ? styles.outgoing : styles.incoming,
    joinsPrev ? styles.joinsPrev : "",
    joinsNext ? styles.joinsNext : "",
    highlighted ? styles.highlighted : "",
  ].join(" ");

  return (
    <div
      id={saved ? `message-${message.id}` : undefined}
      className={`${styles.row} ${isOwn ? styles.rowOut : ""} ${joinsNext && message.reactions.length === 0 ? styles.tight : ""}`}
    >
      {showGroupChrome && (
        <div className={styles.avatarSlot}>
          {!joinsNext && (
            <Avatar name={message.sender_name} src={message.sender_avatar_url} colorSeed={message.sender_id} size={28} />
          )}
        </div>
      )}
      {failed && (
        <button type="button" className={styles.retry} onClick={onRetry} title="Not sent. Click to retry." aria-label="Retry sending">
          <CircleAlert size={20} />
        </button>
      )}
      <div className={`${styles.stack} ${isOwn ? styles.stackOut : ""}`}>
        <div className={classes}>
          {showGroupChrome && !joinsPrev && (
            <div className={styles.sender} style={{ color: avatarTextColor(message.sender_id) }}>
              {message.sender_name}
            </div>
          )}
          {quote && (
            <button
              type="button"
              className={styles.quote}
              style={isOwn ? undefined : { borderLeftColor: avatarTextColor(quote.sender_id) }}
              onClick={() => onJumpToQuote(quote.id)}
              aria-label={`Quoted message from ${quote.sender_id === myId ? "you" : quote.sender_name}: ${quote.content}`}
            >
              <span className={styles.quoteName}>{quote.sender_id === myId ? "You" : quote.sender_name}</span>
              <span className={styles.quoteText}>{quote.content}</span>
            </button>
          )}
          <span className={styles.content}>{message.content}</span>
          <span className={styles.meta}>
            {failed ? "Not sent" : formatTime(message.created_at)}
            {isOwn && message.status && <StatusIcon status={message.status} />}
          </span>
        </div>
        {message.reactions.length > 0 && (
          <div className={styles.reactions}>
            {message.reactions.map((reaction) => {
              const mine = reaction.user_ids.includes(myId);
              const names = reaction.names.map((name, i) => (reaction.user_ids[i] === myId ? "You" : name)).join(", ");
              return (
                <button
                  key={reaction.emoji}
                  type="button"
                  className={`${styles.pill} ${mine ? styles.pillMine : ""}`}
                  title={names}
                  aria-pressed={mine}
                  aria-label={`${reactionLabel(reaction.emoji)} ${reaction.user_ids.length}: ${names}${mine ? ". Click to remove your reaction" : ""}`}
                  onClick={() => onReact(reaction.emoji)}
                >
                  <span aria-hidden="true">{reaction.emoji}</span>
                  {reaction.user_ids.length > 1 && <span className={styles.pillCount}>{reaction.user_ids.length}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {saved && (
        <div className={`${styles.actions} ${pickerOpen ? styles.actionsOpen : ""}`}>
          <button
            type="button"
            className={styles.action}
            title="React"
            aria-label="React"
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen((open) => !open)}
          >
            <SmilePlus size={18} />
          </button>
          <button type="button" className={styles.action} title="Reply" aria-label="Reply" onClick={onReply}>
            <Reply size={18} />
          </button>
          {pickerOpen && (
            <ReactionPicker
              alignEnd={isOwn}
              current={message.reactions.find((r) => r.user_ids.includes(myId))?.emoji}
              onPick={(emoji) => {
                setPickerOpen(false);
                onReact(emoji);
              }}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

// The 6 emoji in a small popover. Focus starts on the first one; ←/→ move, Escape or a
// click outside closes it (focus goes back to the React button).
function ReactionPicker({ alignEnd, current, onPick, onClose }: {
  alignEnd: boolean;
  current: string | undefined;
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); // latest onClose, so the effect below runs only on open/close
  useEffect(() => {
    close.current = onClose;
  });
  // Layout effect: its cleanup runs before the picker leaves the DOM, so we can still see focus in it.
  useLayoutEffect(() => {
    const picker = ref.current;
    const opener = picker?.parentElement?.querySelector<HTMLButtonElement>("[aria-label='React']");
    picker?.querySelector("button")?.focus();
    function outside(e: MouseEvent) {
      if (!picker?.parentElement?.contains(e.target as Node)) close.current();
    }
    document.addEventListener("mousedown", outside);
    return () => {
      document.removeEventListener("mousedown", outside);
      // Escape or a pick: focus was in the picker, give it back to React. A click elsewhere keeps its focus.
      if (picker?.contains(document.activeElement)) opener?.focus();
    };
  }, []);

  return (
    <div
      ref={ref}
      className={`${styles.picker} ${alignEnd ? styles.pickerEnd : ""}`}
      role="toolbar"
      aria-label="Choose a reaction"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          const buttons = [...e.currentTarget.querySelectorAll("button")];
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = (index + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next].focus();
        }
      }}
    >
      {REACTIONS.map(([emoji, label]) => (
        <button
          key={emoji}
          type="button"
          className={`${styles.pickerEmoji} ${emoji === current ? styles.pickerCurrent : ""}`}
          aria-label={emoji === current ? `${label} (your reaction, click to remove)` : `React with ${label}`}
          title={label}
          aria-pressed={emoji === current}
          onClick={() => onPick(emoji)}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

// Hollow circle = sending, one check = sent, two = delivered, two on a filled (solid) badge = read.
function StatusIcon({ status }: { status: MessageStatus }) {
  if (status === "sending") return <CircleDashed size={12} strokeWidth={2} aria-label="Sending" />;
  if (status === "failed") return null; // shown by the retry button instead
  if (status === "sent") return <Check size={14} strokeWidth={2} aria-label="Sent" />;
  if (status === "delivered") return <CheckCheck size={14} strokeWidth={2} aria-label="Delivered" />;
  return (
    <span className={styles.read} aria-label="Read">
      <CheckCheck size={12} strokeWidth={3} />
    </span>
  );
}
