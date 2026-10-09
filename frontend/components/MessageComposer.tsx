"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, SendHorizontal, Smile } from "lucide-react";
import { toast } from "@/components/Toast";
import { sendEvent } from "@/lib/socket";
import styles from "./MessageComposer.module.css";

const TYPING_REFRESH_MS = 3000; // re-send typing:start at most this often while typing
const TYPING_IDLE_MS = 5000; // no keystrokes for this long = stopped typing

type Props = {
  conversationId: number;
  onSend: (content: string) => void;
};

// Keyed by conversation in the page, so one instance = one chat.
export default function MessageComposer({ conversationId, onSend }: Props) {
  const [text, setText] = useState("");
  const canSend = text.trim().length > 0;
  const typingSentAt = useRef(0); // when typing:start was last sent; 0 = not typing
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function stopTyping() {
    clearTimeout(idleTimer.current);
    if (typingSentAt.current) {
      typingSentAt.current = 0;
      sendEvent({ type: "typing:stop", conversation_id: conversationId });
    }
  }

  function change(value: string) {
    setText(value);
    if (!value.trim()) return stopTyping();
    if (Date.now() - typingSentAt.current > TYPING_REFRESH_MS) {
      typingSentAt.current = Date.now();
      sendEvent({ type: "typing:start", conversation_id: conversationId });
    }
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  }

  // Switching chats unmounts this composer: stop typing in the old one.
  const stopOnUnmount = useRef(stopTyping);
  useEffect(() => {
    stopOnUnmount.current = stopTyping;
  });
  useEffect(() => () => stopOnUnmount.current(), []);

  function submit() {
    if (!canSend) return;
    onSend(text.trim());
    setText("");
    stopTyping();
  }

  function showComingSoon(feature: string) {
    toast(`${feature} are coming soon`);
  }

  return (
    <form className={styles.composer} onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className={styles.inputWrap}>
        <button
          type="button"
          className={styles.inlineIcon}
          title="Emoji picker coming soon"
          aria-label="Emoji picker coming soon"
          onClick={() => showComingSoon("Emojis")}
        >
          <Smile size={20} />
        </button>
        <textarea
          className={styles.input}
          placeholder="Message"
          rows={1}
          autoFocus
          value={text}
          onChange={(e) => change(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter is a newline. isComposing: Enter that confirms IME input.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
      </div>
      {canSend ? (
        <button className={styles.send} title="Send" aria-label="Send">
          <SendHorizontal size={18} />
        </button>
      ) : (
        <button
          type="button"
          className={styles.iconButton}
          title="Voice messages coming soon"
          aria-label="Voice messages coming soon"
          onClick={() => showComingSoon("Voice messages")}
        >
          <Mic size={20} />
        </button>
      )}
    </form>
  );
}
