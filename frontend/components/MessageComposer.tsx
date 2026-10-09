"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, SendHorizontal, Smile, X } from "lucide-react";
import { avatarTextColor } from "@/components/Avatar";
import { toast } from "@/components/Toast";
import { sendEvent } from "@/lib/socket";
import type { Message } from "@/types";
import styles from "./MessageComposer.module.css";

const TYPING_REFRESH_MS = 3000; // re-send typing:start at most this often while typing
const TYPING_IDLE_MS = 5000; // no keystrokes for this long = stopped typing
const EMOJIS = ["😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😉", "😍", "🥰", "😎", "🤔", "😢", "😭", "😡", "🤗", "👍", "👎", "👏", "🙌", "🙏", "💪", "🎉", "🔥", "✨", "✅", "💯", "🤝", "👋", "💙", "🌟"];

type Props = {
  conversationId: number;
  onSend: (content: string) => void;
  myId: number;
  replyTo: Message | null; // the message being replied to (quote bar above the input)
  onCancelReply: () => void;
};

// Keyed by conversation in the page, so one instance = one chat.
export default function MessageComposer({ conversationId, onSend, myId, replyTo, onCancelReply }: Props) {
  const [text, setText] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const emojiPicker = useRef<HTMLDivElement>(null);
  // Choosing Reply on a bubble puts the cursor here, ready to type.
  const replyId = replyTo?.id;
  useEffect(() => {
    if (replyId) input.current?.focus();
  }, [replyId]);
  const canSend = text.trim().length > 0;
  const typingSentAt = useRef(0); // when typing:start was last sent; 0 = not typing
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (!emojiPicker.current?.contains(event.target as Node)) setEmojiOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setEmojiOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

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

  function addEmoji(emoji: string) {
    const element = input.current;
    const start = element?.selectionStart ?? text.length;
    const end = element?.selectionEnd ?? text.length;
    const nextText = `${text.slice(0, start)}${emoji}${text.slice(end)}`;
    setText(nextText);
    setEmojiOpen(false);
    requestAnimationFrame(() => {
      element?.focus();
      const cursor = start + emoji.length;
      element?.setSelectionRange(cursor, cursor);
    });
  }

  function showComingSoon(feature: string) {
    toast(`${feature} are coming soon`);
  }

  return (
    <>
    {replyTo && (
      <div className={styles.quoteBar} role="group" aria-label={`Replying to ${replyTo.sender_id === myId ? "yourself" : replyTo.sender_name}`}>
        <div
          className={styles.quote}
          style={{ borderLeftColor: replyTo.sender_id === myId ? "var(--accent)" : avatarTextColor(replyTo.sender_id) }}
        >
          <span className={styles.quoteName}>{replyTo.sender_id === myId ? "You" : replyTo.sender_name}</span>
          <span className={styles.quoteText}>{replyTo.content}</span>
        </div>
        <button type="button" className={styles.iconButton} title="Cancel reply" aria-label="Cancel reply" onClick={onCancelReply}>
          <X size={18} />
        </button>
      </div>
    )}
    <form className={styles.composer} onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className={styles.inputWrap}>
        <div className={styles.emojiPicker} ref={emojiPicker}>
          <button
            type="button"
            className={styles.inlineIcon}
            title="Add emoji"
            aria-label="Add emoji"
            aria-expanded={emojiOpen}
            aria-controls="emoji-menu"
            onClick={() => setEmojiOpen((open) => !open)}
          >
            <Smile size={20} />
          </button>
          {emojiOpen && (
            <div id="emoji-menu" className={styles.emojiMenu} role="grid" aria-label="Emoji picker">
              {EMOJIS.map((emoji, index) => (
                <button
                  key={`${emoji}-${index}`}
                  type="button"
                  className={styles.emoji}
                  role="gridcell"
                  aria-label={`Insert ${emoji}`}
                  onClick={() => addEmoji(emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
        <textarea
          className={styles.input}
          placeholder="Message"
          rows={1}
          autoFocus
          ref={input}
          value={text}
          onChange={(e) => change(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter is a newline. isComposing: Enter that confirms IME input.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
            if (e.key === "Escape" && replyTo) onCancelReply();
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
    </>
  );
}
