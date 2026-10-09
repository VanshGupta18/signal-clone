"use client";

import { useState } from "react";
import { Search, SquarePen } from "lucide-react";
import ConversationItem from "@/components/ConversationItem";
import type { Conversation } from "@/types";
import styles from "./ConversationList.module.css";

type Props = {
  conversations: Conversation[];
  selectedId: number | null;
  myId: number;
  typingIn: Set<number>; // conversation ids where someone is typing
  onSelect: (id: number) => void;
};

export default function ConversationList({ conversations, selectedId, myId, typingIn, onSelect }: Props) {
  const [query, setQuery] = useState("");
  // Client-side filter of the already-loaded list (contact search comes with the contacts feature).
  const visible = conversations.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <section className={styles.pane}>
      <header className={styles.header}>
        <h1 className={styles.title}>Chats</h1>
        <button className={styles.iconButton} title="New chat" aria-label="New chat">
          <SquarePen size={20} />
        </button>
      </header>

      <label className={styles.search}>
        <Search size={16} className={styles.searchIcon} />
        <input
          className={styles.searchInput}
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      <div className={styles.list}>
        {visible.map((conversation) => (
          <ConversationItem
            key={conversation.id}
            conversation={conversation}
            myId={myId}
            selected={conversation.id === selectedId}
            typing={typingIn.has(conversation.id)}
            onClick={() => onSelect(conversation.id)}
          />
        ))}
        {visible.length === 0 && (
          <p className={styles.empty}>{query ? `No results for "${query}"` : "No chats yet"}</p>
        )}
      </div>
    </section>
  );
}
