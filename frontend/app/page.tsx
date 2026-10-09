"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import Avatar from "@/components/Avatar";
import ChatHeader from "@/components/ChatHeader";
import ComingSoon from "@/components/ComingSoon";
import ConversationList from "@/components/ConversationList";
import GroupDetails from "@/components/GroupDetails";
import MessageComposer from "@/components/MessageComposer";
import MessageList, { EncryptionNotice } from "@/components/MessageList";
import NavRail, { type Tab } from "@/components/NavRail";
import NewChatDialog from "@/components/NewChatDialog";
import SafetyNumberDialog from "@/components/SafetyNumberDialog";
import Settings from "@/components/Settings";
import Toaster, { toast } from "@/components/Toast";
import { api, clearToken, getToken } from "@/lib/api";
import { connect, disconnect, sendEvent, sendMessage, subscribe } from "@/lib/socket";
import type { Conversation, Message, ServerEvent, User } from "@/types";
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
  const [tab, setTab] = useState<Tab>("chats");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // The chat actually on screen. While Settings/Calls/Stories is shown nothing is open, so
  // nothing gets marked read; the selection comes back with the Chats tab.
  const openId = tab === "chats" ? selectedId : null;
  const [messages, setMessages] = useState<Message[]>([]); // server history of the open chat
  // My messages not yet acked by the server ("sending"/"failed"), across all chats,
  // so switching chats doesn't lose them.
  const [pending, setPending] = useState<Message[]>([]);
  const [error, setError] = useState("");
  const [typing, setTyping] = useState<Typing[]>([]); // who is typing where (others only)
  const typingTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [showNewChat, setShowNewChat] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showSafety, setShowSafety] = useState(false);
  // Latest list, for toast texts that need a chat name after it left the list.
  const conversationsRef = useRef<Conversation[]>([]);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);
  const offline = useRef(false); // socket dropped: toast once, not on every retry
  const [membersVersion, setMembersVersion] = useState(0); // bump = Group info refetches its members

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
    if (openId === null) return;
    let stale = false; // ignore a slow response if the user already clicked another chat
    loadMessages(openId)
      .then((list) => !stale && setMessages(list))
      .catch((err: Error) => !stale && setError(err.message));
    markRead(openId);
    return () => {
      stale = true;
    };
  }, [openId]);

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
    // Changes made by someone else; my own actions toast where I did them.
    function toastMemberUpdate(event: Extract<ServerEvent, { type: "member:update" }>, list: Conversation[]) {
      if (event.actor_id === myId) return;
      const name = (list.find((c) => c.id === event.conversation_id) ??
        conversationsRef.current.find((c) => c.id === event.conversation_id))?.name ?? "a group";
      if (event.removed_user_id === myId) toast(`You were removed from ${name}`);
      else if (event.added_user_ids?.includes(myId!)) toast(`You were added to ${name}`);
      else if (event.removed_user_id === event.actor_id) toast(`Someone left ${name}`);
      else toast(`Members updated in ${name}`);
    }
    const reloadList = () => loadList().then(setConversations).catch(() => {});

    // Coming back to the tab with a chat open = reading it.
    function onVisibilityChange() {
      if (openId !== null) markRead(openId);
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    const unsubscribe = subscribe((event) => {
      switch (event.type) {
        case "socket:close":
          if (!offline.current) toast("Connection lost. Reconnecting…");
          offline.current = true;
          break;
        case "socket:open":
          if (offline.current) toast("Connected");
          offline.current = false;
          // (Re)connected: reload everything we may have missed, then tell the server our
          // client now has every message up to the newest one it loaded (offline catch-up).
          loadList()
            .then((list) => {
              setConversations(list);
              const newest = Math.max(0, ...list.map((c) => c.last_message?.id ?? 0));
              sendEvent({ type: "message:delivered", up_to_id: newest });
            })
            .catch(() => {});
          if (openId !== null) {
            loadMessages(openId).then(setMessages).catch(() => {});
            markRead(openId);
          }
          break;
        case "message:ack": {
          const saved = event.message;
          setPending((list) => list.filter((m) => m.client_id !== event.client_id));
          if (saved.conversation_id === openId) {
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
          if (message.conversation_id === openId) {
            setMessages((list) => (list.some((m) => m.id === message.id) ? list : [...list, message]));
            if (message.sender_id !== myId) markRead(openId);
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
        case "presence:update": // header + list + Group info show the server's online/last-seen
          setMembersVersion((v) => v + 1);
          reloadList();
          break;
        case "conversation:read": // badge cleared (this tab or another of mine)
          reloadList();
          break;
        case "conversation:new": // a chat I'm in was created
        case "member:update": // members changed; maybe I was added or removed
          if (event.conversation_id === openId) setMembersVersion((v) => v + 1);
          loadList()
            .then((list) => {
              if (event.type === "member:update") toastMemberUpdate(event, list);
              setConversations(list);
              // Removed (or left in another tab): close the chat.
              if (openId !== null && !list.some((c) => c.id === openId)) closeChat();
            })
            .catch(() => {});
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
          toast(`Message not sent: ${event.detail}`);
          break;
      }
    });
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [openId, myId]);

  // Pending bubbles go after history; skip any the history already contains.
  const visibleMessages = useMemo(() => {
    const saved = new Set(messages.map((m) => m.client_id));
    return [...messages, ...pending.filter((m) => m.conversation_id === openId && !saved.has(m.client_id))];
  }, [messages, pending, openId]);

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
    setShowDetails(false);
    setShowSafety(false);
    setSelectedId(id);
  }

  function closeChat() {
    setSelectedId(null);
    setMessages([]);
    setShowDetails(false);
    setShowSafety(false);
  }

  // From New chat: the list must contain the chat before we select it.
  async function openConversation(conversation: Conversation) {
    setShowNewChat(false);
    setConversations(await loadList());
    select(conversation.id);
  }

  async function leftGroup() {
    const group = conversations.find((c) => c.id === selectedId);
    if (group) toast(`You left ${group.name}`);
    closeChat();
    setConversations(await loadList());
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
  const typingInSelected = typing.filter((t) => t.conversation_id === selectedId).map((t) => t.user_id);

  return (
    <div className={styles.app}>
      <NavRail me={me} tab={tab} onTab={setTab} onLogout={logout} />
      {tab === "settings" && <Settings me={me} onSaved={setMe} onBack={() => setTab("chats")} onLogout={logout} />}
      {(tab === "calls" || tab === "stories") && <ComingSoon tab={tab} />}
      {tab === "chats" && (
        <>
          <ConversationList
            conversations={conversations}
            selectedId={selectedId}
            myId={me.id}
            typingIn={new Set(typing.map((t) => t.conversation_id))}
            onSelect={select}
            onNewChat={() => setShowNewChat(true)}
          />
          <main className={styles.chat}>
            {selected ? (
              <>
                <ChatHeader
                  conversation={selected}
                  onOpenDetails={selected.type === "group" ? () => setShowDetails(true) : undefined}
                  onSafetyNumber={selected.type === "direct" ? () => setShowSafety(true) : undefined}
                />
                {selected.last_message === null && visibleMessages.length === 0 && typingInSelected.length === 0 ? (
                  // Brand-new chat: Signal shows who/what it is instead of an empty pane.
                  <div className={styles.intro}>
                    <Avatar
                      name={selected.name}
                      src={selected.avatar_url}
                      colorSeed={selected.other_user_id ?? selected.id}
                      size={80}
                    />
                    <h2>{selected.name}</h2>
                    {selected.type === "group" && <p>{selected.member_count} {selected.member_count === 1 ? "member" : "members"}</p>}
                    <p className={styles.introHint}>No messages yet. Say hi!</p>
                    <EncryptionNotice />
                  </div>
                ) : (
                  <MessageList
                    messages={visibleMessages}
                    myId={me.id}
                    isGroup={selected.type === "group"}
                    typingUserIds={typingInSelected}
                    onRetry={retry}
                  />
                )}
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
        </>
      )}
      {showNewChat && <NewChatDialog onClose={() => setShowNewChat(false)} onOpen={openConversation} />}
      {showDetails && selected?.type === "group" && (
        <GroupDetails
          conversation={selected}
          myId={me.id}
          version={membersVersion}
          onClose={() => setShowDetails(false)}
          onLeft={leftGroup}
        />
      )}
      {showSafety && selected?.type === "direct" && selected.other_user_id !== null && (
        <SafetyNumberDialog
          name={selected.name}
          myId={me.id}
          otherId={selected.other_user_id}
          onClose={() => setShowSafety(false)}
        />
      )}
      <Toaster />
    </div>
  );
}
