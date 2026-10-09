"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import Avatar from "@/components/Avatar";
import ChatHeader from "@/components/ChatHeader";
import ComingSoon from "@/components/ComingSoon";
import ConversationList from "@/components/ConversationList";
import DemoGuide from "@/components/DemoGuide";
import GroupDetails from "@/components/GroupDetails";
import MessageComposer from "@/components/MessageComposer";
import MessageList, { EncryptionNotice } from "@/components/MessageList";
import NavRail, { type Tab } from "@/components/NavRail";
import NewChatDialog from "@/components/NewChatDialog";
import SafetyNumberDialog from "@/components/SafetyNumberDialog";
import Settings from "@/components/Settings";
import ShortcutsDialog from "@/components/ShortcutsDialog";
import Toaster, { toast } from "@/components/Toast";
import { api, clearToken, getToken } from "@/lib/api";
import { showNotification } from "@/lib/notifications";
import { useShortcuts } from "@/lib/shortcuts";
import { connect, disconnect, sendEvent, sendMessage, subscribe } from "@/lib/socket";
import type { Conversation, Message, MessagePage, ServerEvent, User } from "@/types";
import styles from "./page.module.css";

const TYPING_TIMEOUT_MS = 6000; // hide a typing indicator if no refresh arrives (senders refresh every 3s)

type Typing = { conversation_id: number; user_id: number };

// Preview, order, unread counts and presence stay server-derived: we just reload the list.
const loadList = () => api<Conversation[]>("/api/conversations");
const loadMessages = (id: number, beforeId?: number, signal?: AbortSignal) =>
  api<MessagePage>(`/api/conversations/${id}/messages?limit=50${beforeId ? `&before_id=${beforeId}` : ""}`, { signal });

// A history page is a snapshot from when the request ran. A message acked or received for that
// chat while the request was in flight has a higher id than the page's last one: keep it instead
// of wiping it off the screen (it would only come back after a reload).
function withNewer(conversationId: number, page: Message[], current: Message[]): Message[] {
  const lastId = page.length ? page[page.length - 1].id : 0;
  return [...page, ...current.filter((m) => m.conversation_id === conversationId && m.id > lastId)];
}

// Read = I'm actually looking at it: the chat is open and the tab is visible.
function markRead(conversationId: number) {
  if (document.visibilityState === "visible") sendEvent({ type: "conversation:read", conversation_id: conversationId });
}

export default function Home() {
  const router = useRouter();
  const [me, setMe] = useState<User | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [conversationError, setConversationError] = useState("");
  const [tab, setTab] = useState<Tab>("chats");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // The chat actually on screen. While Settings/Calls/Stories is shown nothing is open, so
  // nothing gets marked read; the selection comes back with the Chats tab.
  const openId = tab === "chats" ? selectedId : null;
  const [messages, setMessages] = useState<Message[]>([]); // server history of the open chat
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messageError, setMessageError] = useState("");
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // My messages not yet acked by the server ("sending"/"failed"), across all chats,
  // so switching chats doesn't lose them.
  const [pending, setPending] = useState<Message[]>([]);
  const [replyTo, setReplyTo] = useState<Message | null>(null); // quote bar in the composer
  const [error, setError] = useState("");
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "offline">("connecting");
  const [typing, setTyping] = useState<Typing[]>([]); // who is typing where (others only)
  const typingTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const listRefreshRef = useRef<Promise<Conversation[]> | null>(null);
  const listRefreshQueued = useRef(false);
  const [showNewChat, setShowNewChat] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showSafety, setShowSafety] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showDemoGuide, setShowDemoGuide] = useState(false);
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
    Promise.allSettled([api<User>("/api/me"), loadList()]).then(([userResult, listResult]) => {
      if (userResult.status === "rejected") {
        setError(userResult.reason instanceof Error ? userResult.reason.message : "Couldn't load your account");
        return;
      }
      setMe(userResult.value);
      if (listResult.status === "fulfilled") {
        setConversations(listResult.value);
        setConversationError("");
      } else {
        setConversationError("Couldn't load conversations.");
      }
    }).finally(() => setLoadingConversations(false));
  }, [router]);

  // Load history whenever a different chat is opened, and mark it read.
  useEffect(() => {
    if (openId === null) return;
    const controller = new AbortController();
    loadMessages(openId, undefined, controller.signal)
      .then((page) => {
        setMessages((current) => withNewer(openId, page.messages, current));
        setHistoryCursor(page.next_before_id);
        setHasOlder(page.has_more);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setMessageError(`Couldn't load messages: ${err.message}`);
      })
      .finally(() => setLoadingMessages(false));
    markRead(openId);
    return () => controller.abort();
  }, [openId]);

  function retryHistory() {
    if (openId === null) return;
    setMessages([]);
    setHistoryCursor(null);
    setHasOlder(false);
    setMessageError("");
    setLoadingMessages(true);
    loadMessages(openId)
      .then((page) => {
        setMessages((current) => withNewer(openId, page.messages, current));
        setHistoryCursor(page.next_before_id);
        setHasOlder(page.has_more);
      })
      .catch((err: Error) => setMessageError(`Couldn't load messages: ${err.message}`))
      .finally(() => setLoadingMessages(false));
  }

  async function loadOlder() {
    if (openId === null || !historyCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await loadMessages(openId, historyCursor);
      setMessages((current) => [...page.messages, ...current]);
      setHistoryCursor(page.next_before_id);
      setHasOlder(page.has_more);
    } catch (err) {
      toast(`Couldn't load older messages: ${err instanceof Error ? err.message : "request failed"}`);
    } finally {
      setLoadingOlder(false);
    }
  }

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
    // `knownName` is read when the event arrives: after the reload a removed user's list no
    // longer contains the group, so its name must come from the list as it was before.
    function toastMemberUpdate(event: Extract<ServerEvent, { type: "member:update" }>, list: Conversation[], knownName?: string) {
      if (event.actor_id === myId) return;
      const name = knownName ?? list.find((c) => c.id === event.conversation_id)?.name ?? "a group";
      if (event.removed_user_id === myId) toast(`You were removed from ${name}`);
      else if (event.added_user_ids?.includes(myId!)) toast(`You were added to ${name}`);
      else if (event.removed_user_id === event.actor_id) toast(`Someone left ${name}`);
      else toast(`Members updated in ${name}`);
    }
    const reloadList = (): Promise<Conversation[]> => {
      listRefreshQueued.current = true;
      if (listRefreshRef.current) return listRefreshRef.current;

      const refresh = async (): Promise<Conversation[]> => {
        let latest = conversationsRef.current;
        while (listRefreshQueued.current) {
          listRefreshQueued.current = false;
          try {
            latest = await loadList();
            conversationsRef.current = latest;
            setConversations(latest);
          } catch {
            // Keep the last known list; the next server event or reconnect retries it.
          }
        }
        return latest;
      };
      const request = refresh().finally(() => {
        listRefreshRef.current = null;
      });
      listRefreshRef.current = request;
      return request;
    };

    // Coming back to the tab with a chat open = reading it.
    function onVisibilityChange() {
      if (openId !== null) markRead(openId);
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    const unsubscribe = subscribe((event) => {
      switch (event.type) {
        case "socket:connecting":
          setConnectionStatus("connecting");
          break;
        case "socket:close":
          setConnectionStatus("offline");
          if (!offline.current) toast("Connection lost. Reconnecting…");
          offline.current = true;
          break;
        case "socket:open":
          setConnectionStatus("connected");
          if (offline.current) toast("Connected");
          offline.current = false;
          // (Re)connected: reload everything we may have missed, then tell the server our
          // client now has every message up to the newest one it loaded (offline catch-up).
          reloadList()
            .then((list) => {
              const newest = Math.max(0, ...list.map((c) => c.last_message?.id ?? 0));
              sendEvent({ type: "message:delivered", up_to_id: newest });
            })
            .catch(() => {});
          if (openId !== null) {
            loadMessages(openId).then((page) => {
              setMessages((current) => withNewer(openId, page.messages, current));
              setHistoryCursor(page.next_before_id);
              setHasOlder(page.has_more);
            }).catch(() => {});
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
          // Desktop notification, unless it's mine or I'm looking at that chat right now.
          const onScreen = message.conversation_id === openId && document.visibilityState === "visible";
          if (message.sender_id !== myId && !onScreen) {
            const chat = conversationsRef.current.find((c) => c.id === message.conversation_id);
            const isGroup = chat?.type === "group";
            showNotification(
              isGroup ? chat.name : message.sender_name,
              isGroup ? `${message.sender_name}: ${message.content}` : message.content,
              message.conversation_id,
              () => openFromNotification.current(message.conversation_id),
            );
          }
          reloadList();
          break;
        }
        case "reaction:update": // someone (maybe me in another tab) reacted in a chat I'm in
          setMessages((list) => list.map((m) => (m.id === event.message_id ? { ...m, reactions: event.reactions } : m)));
          break;
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
          // Group presence is rendered by GroupDetails; only refresh the list when
          // this user is the visible peer in a direct conversation.
          if (conversationsRef.current.some((conversation) => conversation.other_user_id === event.user_id)) {
            reloadList();
          }
          break;
        case "conversation:read": // badge cleared (this tab or another of mine)
          reloadList();
          break;
        case "conversation:new": // a chat I'm in was created
        case "member:update": // members changed; maybe I was added or removed
          if (event.conversation_id === openId) setMembersVersion((v) => v + 1);
          const knownName = conversationsRef.current.find((c) => c.id === event.conversation_id)?.name;
          reloadList()
            .then((list) => {
              if (event.type === "member:update") toastMemberUpdate(event, list, knownName);
              // Removed (or left in another tab): close the chat.
              if (openId !== null && !conversationsRef.current.some((c) => c.id === openId)) closeChat();
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
      reply_to: replyTo && {
        id: replyTo.id,
        sender_id: replyTo.sender_id,
        sender_name: replyTo.sender_name,
        content: replyTo.content.slice(0, 100),
      },
      reactions: [],
    };
    setPending((list) => [...list, message]);
    setReplyTo(null);
    sendMessage({ conversation_id: message.conversation_id, content, client_id: message.client_id, reply_to_id: replyTo?.id });
  }

  // The server decides: a new emoji adds/replaces mine, my current one toggles it off.
  // Fire-and-forget: the pill changes when reaction:update comes back (offline = nothing happens).
  function react(message: Message, emoji: string) {
    sendEvent({ type: "reaction:set", message_id: message.id, emoji });
  }

  // Same client_id, so the server can never store it twice.
  function retry(message: Message) {
    setPending((list) => list.map((m) => (m.client_id === message.client_id ? { ...m, status: "sending" } : m)));
    sendMessage({
      conversation_id: message.conversation_id,
      content: message.content,
      client_id: message.client_id,
      reply_to_id: message.reply_to?.id,
    });
  }

  function select(id: number) {
    if (id === selectedId) return;
    setMessages([]); // don't flash the previous chat's messages
    setLoadingMessages(true);
    setMessageError("");
    setHistoryCursor(null);
    setHasOlder(false);
    setShowDetails(false);
    setShowSafety(false);
    setReplyTo(null);
    setSelectedId(id);
  }

  // Clicking a notification opens its chat (a ref: the socket handler above outlives renders).
  const openFromNotification = useRef<(id: number) => void>(() => {});
  useEffect(() => {
    openFromNotification.current = (id: number) => {
      setTab("chats");
      select(id);
    };
  });

  // Keyboard shortcuts (lib/shortcuts.ts). Alt+↑/↓ walk the list in its on-screen order.
  useShortcuts((action) => {
    if (action === "newChat") setShowNewChat(true);
    if (action === "settings") setTab("settings");
    if (action === "shortcuts") setShowShortcuts(true);
    if (action === "search") {
      flushSync(() => setTab("chats")); // render the list first so its search box exists
      document.getElementById("chat-search")?.focus();
    }
    if ((action === "previousChat" || action === "nextChat") && tab === "chats" && conversations.length > 0) {
      const index = conversations.findIndex((c) => c.id === selectedId);
      const step = action === "nextChat" ? 1 : -1;
      const next = index === -1 ? 0 : Math.min(Math.max(index + step, 0), conversations.length - 1);
      select(conversations[next].id);
    }
  });

  function closeChat() {
    setSelectedId(null);
    setReplyTo(null);
    setMessages([]);
    setHistoryCursor(null);
    setHasOlder(false);
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
    // A full navigation clears the login route's in-memory step state. Client-side
    // routing can preserve the previous OTP step when logging out and back in.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/login";
  }

  if (error) return <p className={styles.error}>{error}</p>;
  if (!me) return <div className={styles.loadingShell}><div className={styles.loadingPulse} />Loading Signal…</div>;

  const selected = conversations.find((c) => c.id === selectedId);
  const typingInSelected = typing.filter((t) => t.conversation_id === selectedId).map((t) => t.user_id);

  return (
    <div className={styles.app} data-chat-open={openId === null ? "false" : "true"}>
      <NavRail me={me} tab={tab} onTab={setTab} onLogout={logout} onDemoGuide={() => setShowDemoGuide(true)} />
      {tab === "settings" && <Settings me={me} onSaved={setMe} onBack={() => setTab("chats")} onLogout={logout} onShowShortcuts={() => setShowShortcuts(true)} />}
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
            mobileHidden={selectedId !== null}
            loading={loadingConversations}
            error={conversationError}
            onRetry={() => window.location.reload()}
          />
          <main className={styles.chat}>
            {selected ? (
              <>
                <ChatHeader
                  conversation={selected}
                  onOpenDetails={selected.type === "group" ? () => setShowDetails(true) : undefined}
                  onSafetyNumber={selected.type === "direct" ? () => setShowSafety(true) : undefined}
                  onBack={closeChat}
                  connectionStatus={connectionStatus}
                />
                {loadingMessages ? (
                  <div className={styles.historyLoading} aria-label="Loading messages">
                    {[0, 1, 2, 3].map((item) => <div className={styles.historySkeleton} key={item} />)}
                  </div>
                ) : messageError ? (
                  <div className={styles.inlineError}>
                    <p>{messageError}</p>
                    <button onClick={retryHistory}>Retry</button>
                  </div>
                ) : selected.last_message === null && visibleMessages.length === 0 && typingInSelected.length === 0 ? (
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
                    onReply={setReplyTo}
                    onReact={react}
                    onLoadOlder={loadOlder}
                    hasOlder={hasOlder}
                    loadingOlder={loadingOlder}
                  />
                )}
                <MessageComposer
                  key={selected.id}
                  conversationId={selected.id}
                  onSend={send}
                  myId={me.id}
                  replyTo={replyTo}
                  onCancelReply={() => setReplyTo(null)}
                />
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
      {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}
      {showDemoGuide && <DemoGuide onClose={() => setShowDemoGuide(false)} />}
      <Toaster />
    </div>
  );
}
