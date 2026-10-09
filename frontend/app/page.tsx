"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import ChatHeader from "@/components/ChatHeader";
import ConversationList from "@/components/ConversationList";
import MessageComposer from "@/components/MessageComposer";
import MessageList from "@/components/MessageList";
import NavRail from "@/components/NavRail";
import { api, clearToken, getToken } from "@/lib/api";
import { connect, disconnect, sendEvent, sendMessage, subscribe } from "@/lib/socket";
import type { Conversation, Message, User } from "@/types";
import styles from "./page.module.css";

const TYPING_TIMEOUT_MS = 6000; // hide a typing indicator if no refresh arrives (senders refresh every 3s)

type Typing = { conversation_id: number; user_id: number };

// Preview, order, unread counts and presence stay server-derived: we just reload the list.
const loadList = () => api<Conversation[]>("/api/conversations");
const loadMessages = (id: number) => api<Message[]>(`/api/conversations/${id}/messages`);

// Read = I'm actually looking at it: the chat is open and the tab is visible.
function markRead(conversationId: number) {
  if (document.visibilityState === "visible") sendEvent({ type: "conversation:read", conversation_id: conversationId });
}

export default function Home() {
  const router = useRouter();
  const [me, setMe] = useState<User | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]); // server history of the open chat
  // My messages not yet acked by the server ("sending"/"failed"), across all chats,
  // so switching chats doesn't lose them.
  const [pending, setPending] = useState<Message[]>([]);
  const [error, setError] = useState("");
  const [typing, setTyping] = useState<Typing[]>([]); // who is typing where (others only)
  const typingTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // Auth guard + initial data. A stale token gets a 401, and api() sends us to /login.
  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    Promise.all([api<User>("/api/me"), loadList()])
      .then(([user, list]) => {
        setMe(user);
        setConversations(list);
      })
      .catch((err: Error) => setError(err.message));
  }, [router]);

  // Load history whenever a different chat is opened, and mark it read.
  useEffect(() => {
    if (selectedId === null) return;
    let stale = false; // ignore a slow response if the user already clicked another chat
    loadMessages(selectedId)
      .then((list) => !stale && setMessages(list))
      .catch((err: Error) => !stale && setError(err.message));
    markRead(selectedId);
    return () => {
      stale = true;
    };
  }, [selectedId]);

  // One socket for the session, opened once we know the token is valid.
  const loggedIn = me !== null;
  useEffect(() => {
    if (!loggedIn) return;
    connect();
    return disconnect;
  }, [loggedIn]);

  const myId = me?.id;
  useEffect(() => {
    const timers = typingTimers.current;
    function stopTyping(conversationId: number, userId: number) {
      const key = `${conversationId}:${userId}`;
      clearTimeout(timers.get(key));
      timers.delete(key);
      setTyping((list) => list.filter((t) => t.conversation_id !== conversationId || t.user_id !== userId));
    }
    function startTyping(conversationId: number, userId: number) {
      const key = `${conversationId}:${userId}`;
      clearTimeout(timers.get(key));
      timers.set(key, setTimeout(() => stopTyping(conversationId, userId), TYPING_TIMEOUT_MS));
      setTyping((list) =>
        list.some((t) => t.conversation_id === conversationId && t.user_id === userId)
          ? list
          : [...list, { conversation_id: conversationId, user_id: userId }],
      );
    }
    const reloadList = () => loadList().then(setConversations).catch(() => {});

    // Coming back to the tab with a chat open = reading it.
    function onVisibilityChange() {
      if (selectedId !== null) markRead(selectedId);
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    const unsubscribe = subscribe((event) => {
      switch (event.type) {
        case "socket:open":
          // (Re)connected: reload everything we may have missed, then tell the server our
          // client now has every message up to the newest one it loaded (offline catch-up).
          loadList()
            .then((list) => {
              setConversations(list);
              const newest = Math.max(0, ...list.map((c) => c.last_message?.id ?? 0));
              sendEvent({ type: "message:delivered", up_to_id: newest });
            })
            .catch(() => {});
          if (selectedId !== null) {
            loadMessages(selectedId).then(setMessages).catch(() => {});
            markRead(selectedId);
          }
          break;
        case "message:ack": {
          const saved = event.message;
          setPending((list) => list.filter((m) => m.client_id !== event.client_id));
          if (saved.conversation_id === selectedId) {
            setMessages((list) => (list.some((m) => m.id === saved.id) ? list : [...list, saved]));
          }
          reloadList();
          break;
        }
        case "message:new": {
          // Someone else's message, or mine from another tab.
          const message = event.message;
          if (message.sender_id !== myId) {
            sendEvent({ type: "message:delivered", message_ids: [message.id] }); // my client has it
            stopTyping(message.conversation_id, message.sender_id);
          }
          if (message.conversation_id === selectedId) {
            setMessages((list) => (list.some((m) => m.id === message.id) ? list : [...list, message]));
            if (message.sender_id !== myId) markRead(selectedId);
          }
          reloadList();
          break;
        }
        case "receipt:update":
          setMessages((list) =>
            list.map((m) => {
              const update = event.messages.find((u) => u.id === m.id);
              return update ? { ...m, status: update.status } : m;
            }),
          );
          break;
        case "conversation:read": // badge cleared (this tab or another of mine)
        case "presence:update": // header + list show the server's online/last-seen
          reloadList();
          break;
        case "typing:start":
          startTyping(event.conversation_id, event.user_id);
          break;
        case "typing:stop":
          stopTyping(event.conversation_id, event.user_id);
          break;
        case "error":
          if (!event.client_id) return console.warn("WebSocket error:", event.detail);
          setPending((list) => list.map((m) => (m.client_id === event.client_id ? { ...m, status: "failed" } : m)));
          break;
      }
    });
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [selectedId, myId]);

  // Pending bubbles go after history; skip any the history already contains.
  const visibleMessages = useMemo(() => {
    const saved = new Set(messages.map((m) => m.client_id));
    return [...messages, ...pending.filter((m) => m.conversation_id === selectedId && !saved.has(m.client_id))];
  }, [messages, pending, selectedId]);

  function send(content: string) {
    if (!me || selectedId === null) return;
    const message: Message = {
      id: 0, // not saved yet; the ack brings the real id
      conversation_id: selectedId,
      sender_id: me.id,
      sender_name: me.display_name,
      sender_avatar_url: me.avatar_url,
      client_id: crypto.randomUUID(),
      content,
      created_at: new Date().toISOString(),
      status: "sending",
    };
    setPending((list) => [...list, message]);
    sendMessage({ conversation_id: message.conversation_id, content, client_id: message.client_id });
  }

  // Same client_id, so the server can never store it twice.
  function retry(message: Message) {
    setPending((list) => list.map((m) => (m.client_id === message.client_id ? { ...m, status: "sending" } : m)));
    sendMessage({ conversation_id: message.conversation_id, content: message.content, client_id: message.client_id });
  }

  function select(id: number) {
    if (id === selectedId) return;
    setMessages([]); // don't flash the previous chat's messages
    setSelectedId(id);
  }

  async function logout() {
    disconnect();
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    clearToken();
    router.replace("/login");
  }

  if (error) return <p className={styles.error}>{error}</p>;
  if (!me) return null;

  const selected = conversations.find((c) => c.id === selectedId);

  return (
    <div className={styles.app}>
      <NavRail me={me} onLogout={logout} />
      <ConversationList
        conversations={conversations}
        selectedId={selectedId}
        myId={me.id}
        typingIn={new Set(typing.map((t) => t.conversation_id))}
        onSelect={select}
      />
      <main className={styles.chat}>
        {selected ? (
          <>
            <ChatHeader conversation={selected} />
            <MessageList
              messages={visibleMessages}
              myId={me.id}
              isGroup={selected.type === "group"}
              typingUserIds={typing.filter((t) => t.conversation_id === selected.id).map((t) => t.user_id)}
              onRetry={retry}
            />
            <MessageComposer key={selected.id} conversationId={selected.id} onSend={send} />
          </>
        ) : (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>
              <MessageCircle size={40} />
            </div>
            <h2>Welcome to Signal</h2>
            <p>Select a chat to start messaging.</p>
          </div>
        )}
      </main>
    </div>
  );
}
