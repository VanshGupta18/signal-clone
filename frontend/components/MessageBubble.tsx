import { Check, CheckCheck, CircleAlert, CircleDashed } from "lucide-react";
import Avatar, { avatarTextColor } from "@/components/Avatar";
import { formatTime } from "@/lib/time";
import type { Message, MessageStatus } from "@/types";
import styles from "./MessageBubble.module.css";

type Props = {
  message: Message;
  isOwn: boolean;
  isGroup: boolean;
  joinsPrev: boolean; // previous bubble is from the same sender (same run)
  joinsNext: boolean;
  onRetry: () => void; // only used for a failed send
};

export default function MessageBubble({ message, isOwn, isGroup, joinsPrev, joinsNext, onRetry }: Props) {
  // In groups, incoming runs get the sender's name on top and their avatar at the bottom.
  const showGroupChrome = isGroup && !isOwn;
  const failed = isOwn && message.status === "failed";

  const classes = [
    styles.bubble,
    isOwn ? styles.outgoing : styles.incoming,
    joinsPrev ? styles.joinsPrev : "",
    joinsNext ? styles.joinsNext : "",
  ].join(" ");

  return (
    <div className={`${styles.row} ${isOwn ? styles.rowOut : ""} ${joinsNext ? styles.tight : ""}`}>
      {showGroupChrome && (
        <div className={styles.avatarSlot}>
          {!joinsNext && (
            <Avatar name={message.sender_name} src={message.sender_avatar_url} colorSeed={message.sender_id} size={28} />
          )}
        </div>
      )}
      {failed && (
        <button className={styles.retry} onClick={onRetry} title="Not sent. Click to retry." aria-label="Retry sending">
          <CircleAlert size={20} />
        </button>
      )}
      <div className={classes}>
        {showGroupChrome && !joinsPrev && (
          <div className={styles.sender} style={{ color: avatarTextColor(message.sender_id) }}>
            {message.sender_name}
          </div>
        )}
        <span className={styles.content}>{message.content}</span>
        <span className={styles.meta}>
          {failed ? "Not sent" : formatTime(message.created_at)}
          {isOwn && message.status && <StatusIcon status={message.status} />}
        </span>
      </div>
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
