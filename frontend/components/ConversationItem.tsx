import Avatar from "@/components/Avatar";
import { formatListTime } from "@/lib/time";
import type { Conversation } from "@/types";
import styles from "./ConversationItem.module.css";

type Props = {
  conversation: Conversation;
  myId: number;
  selected: boolean;
  typing: boolean; // someone else is typing here
  onClick: () => void;
};

export default function ConversationItem({ conversation, myId, selected, typing, onClick }: Props) {
  const { last_message: last, unread_count } = conversation;

  // Signal-style prefix: "You: ..." for my messages, "Dave: ..." for others in a group.
  let prefix = "";
  if (last && last.sender_id === myId) prefix = "You: ";
  else if (last && conversation.type === "group") prefix = `${last.sender_name.split(" ")[0]}: `;

  return (
    <button type="button" className={`${styles.row} ${selected ? styles.selected : ""}`} onClick={onClick} aria-current={selected ? "page" : undefined}>
      <span className={styles.avatar}>
        <Avatar
          name={conversation.name}
          src={conversation.avatar_url}
          colorSeed={conversation.other_user_id ?? conversation.id}
          size={48}
        />
        {conversation.other_online && <span className={styles.online} aria-label="Online" />}
      </span>
      <div className={styles.body}>
        <div className={styles.line}>
          <span className={styles.name}>{conversation.name}</span>
          {last && <span className={styles.time}>{formatListTime(last.created_at)}</span>}
        </div>
        <div className={styles.line}>
          {typing ? (
            <span className={`${styles.preview} ${styles.typing}`}>typing…</span>
          ) : (
            <span className={`${styles.preview} ${unread_count > 0 ? styles.unreadPreview : ""}`}>
              {last ? prefix + last.content : ""}
            </span>
          )}
          {unread_count > 0 && <span className={styles.badge}>{unread_count}</span>}
        </div>
      </div>
    </button>
  );
}
