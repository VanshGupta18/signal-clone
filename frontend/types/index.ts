export type User = {
  id: number;
  phone: string;
  display_name: string;
  avatar_url: string | null;
  last_seen_at: string | null;
};

// GET /api/contacts, GET /api/users/search
export type Person = User & { is_contact: boolean };

// GET /api/conversations/{id}/members
export type Member = {
  id: number;
  display_name: string;
  avatar_url: string | null;
  phone: string;
  role: "admin" | "member";
  online: boolean;
};

// "sending" and "failed" exist only in the browser (not yet acked by the server);
// the rest are server receipt statuses.
export type MessageStatus = "sending" | "failed" | "sent" | "delivered" | "read";

// GET /api/conversations
export type Conversation = {
  id: number;
  type: "direct" | "group";
  name: string; // group name, or the other person's display name
  avatar_url: string | null;
  other_user_id: number | null; // direct only
  other_online: boolean | null; // direct only
  other_last_seen_at: string | null; // direct only; null = never connected
  member_count: number;
  unread_count: number;
  updated_at: string;
  last_message: {
    id: number;
    content: string;
    sender_id: number;
    sender_name: string;
    created_at: string;
  } | null;
};

// GET /api/conversations/{id}/messages
export type Message = {
  id: number;
  conversation_id: number;
  sender_id: number;
  sender_name: string;
  sender_avatar_url: string | null;
  client_id: string;
  content: string;
  created_at: string;
  status: MessageStatus | null; // only set on my own messages
  reply_to: QuotedMessage | null; // the message this one replies to
  reactions: Reaction[];
};
// A quoted message, as carried inside the reply (content trimmed to 100 chars by the server).
export type QuotedMessage = { id: number; sender_id: number; sender_name: string; content: string };
// One emoji on a message and who reacted with it (one reaction per person per message).
export type Reaction = { emoji: string; user_ids: number[]; names: string[] };
export type MessagePage = {
  messages: Message[];
  has_more: boolean;
  next_before_id: number | null;
};

// WebSocket: client -> server
export type SendPayload = { conversation_id: number; content: string; client_id: string; reply_to_id?: number };
export type ClientEvent =
  | { type: "message:delivered"; message_ids?: number[]; up_to_id?: number }
  | { type: "conversation:read" | "typing:start" | "typing:stop"; conversation_id: number }
  // My reaction: a new emoji adds/replaces it, my current emoji or null removes it.
  | { type: "reaction:set"; message_id: number; emoji: string | null };

// WebSocket: server -> client. Socket lifecycle events are local: lib/socket.ts emits them.
// on every (re)connect / drop.
export type ServerEvent =
  | { type: "socket:connecting" | "socket:open" | "socket:close" }
  | { type: "message:ack"; client_id: string; message: Message }
  | { type: "message:new"; message: Message }
  // Recomputed ticks of my messages (lowest status across recipients, computed by the server).
  | { type: "receipt:update"; messages: { id: number; conversation_id: number; status: MessageStatus }[] }
  | { type: "reaction:update"; message_id: number; conversation_id: number; reactions: Reaction[] }
  | { type: "conversation:read"; conversation_id: number } // I read it (maybe in another tab)
  | { type: "typing:start" | "typing:stop"; conversation_id: number; user_id: number }
  | { type: "presence:update"; user_id: number; online: boolean; last_seen_at: string | null }
  // A chat I'm in was created / its members changed (I may have been removed): reload the list.
  | { type: "conversation:new"; conversation_id: number }
  // actor_id / added_user_ids / removed_user_id only choose the toast text.
  | { type: "member:update"; conversation_id: number; actor_id: number; added_user_ids?: number[]; removed_user_id?: number }
  | { type: "error"; client_id: string | null; detail: string };
