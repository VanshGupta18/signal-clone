"use client";

import { useRef, useState } from "react";
import { Search, SquarePen, X } from "lucide-react";
import ConversationItem from "@/components/ConversationItem";
import Illustration from "@/components/Illustration";
import type { Conversation } from "@/types";
import styles from "./ConversationList.module.css";

type Props = {
  conversations: Conversation[];
  selectedId: number | null;
  myId: number;
  typingIn: Set<number>; // conversation ids where someone is typing
  onSelect: (id: number) => void;
  onNewChat: () => void;
  mobileHidden?: boolean;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
};

export default function ConversationList({
  conversations,
  selectedId,
  myId,
  typingIn,
  onSelect,
  onNewChat,
  mobileHidden,
  loading,
  error,
  onRetry,
}: Props) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  // Client-side filter of the loaded list: chat name or last-message preview. People not
  // in a chat yet are found via New chat. Full history search is not implemented (D81).
  const q = query.trim().toLowerCase();
  const visible = conversations.filter(
    (c) => c.name.toLowerCase().includes(q) || (c.last_message?.content.toLowerCase().includes(q) ?? false),
  );

  return (
    <section className={`${styles.pane} ${mobileHidden ? styles.mobileHidden : ""}`}>
      <header className={styles.header}>
        <h1 className={styles.title}>Chats</h1>
        <button className={styles.iconButton} title="New chat" aria-label="New chat" onClick={onNewChat}>
          <SquarePen size={20} />
        </button>
      </header>

      <label className={styles.search}>
        <Search size={16} className={styles.searchIcon} />
        <input
          ref={input}
          id="chat-search"
          className={styles.searchInput}
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setQuery("")}
          aria-label="Search chats"
        />
        {query && (
          <button type="button" className={styles.clearButton} onClick={() => {
              setQuery("");
              input.current?.focus();
            }}
            aria-label="Clear search" title="Clear search">
            <X size={14} />
          </button>
        )}
      </label>

      <div className={styles.list}>
        {loading && (
          <div className={styles.loading} aria-label="Loading conversations">
            {[0, 1, 2, 3, 4].map((item) => <div className={styles.loadingRow} key={item} />)}
          </div>
        )}
        {!loading && error && (
          <div className={styles.errorState}>
            <p>{error}</p>
            <button type="button" onClick={onRetry}>Retry</button>
          </div>
        )}
        {!loading && !error && visible.map((conversation) => (
          <ConversationItem
            key={conversation.id}
            conversation={conversation}
            myId={myId}
            selected={conversation.id === selectedId}
            typing={typingIn.has(conversation.id)}
            onClick={() => onSelect(conversation.id)}
          />
        ))}
        {!loading && !error && visible.length === 0 && (
          <div className={styles.empty}>
            {q ? (
              <>
                <Illustration icon={Search} size={64} />
                <p className={styles.emptyTitle}>No results for &ldquo;{query.trim()}&rdquo;</p>
                <p>Try another name, or use New chat to find someone new.</p>
              </>
            ) : (
              <>
                <Illustration size={64} />
                <p className={styles.emptyTitle}>No chats yet</p>
                <p>Start a conversation and it&apos;ll show up here.</p>
                <button type="button" className={styles.emptyButton} onClick={onNewChat}>
                  Start a new chat
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
