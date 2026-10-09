export type User = {
  id: number;
  phone: string;
  display_name: string;
  avatar_url: string | null;
  last_seen_at: string | null;
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
};

// WebSocket: client -> server
export type SendPayload = { conversation_id: number; content: string; client_id: string };
export type ClientEvent =
  | { type: "message:delivered"; message_ids?: number[]; up_to_id?: number }
  | { type: "conversation:read" | "typing:start" | "typing:stop"; conversation_id: number };

// WebSocket: server -> client. "socket:open" is local: lib/socket.ts emits it on every (re)connect.
export type ServerEvent =
  | { type: "socket:open" }
  | { type: "message:ack"; client_id: string; message: Message }
  | { type: "message:new"; message: Message }
  // Recomputed ticks of my messages (lowest status across recipients, computed by the server).
  | { type: "receipt:update"; messages: { id: number; conversation_id: number; status: MessageStatus }[] }
  | { type: "conversation:read"; conversation_id: number } // I read it (maybe in another tab)
  | { type: "typing:start" | "typing:stop"; conversation_id: number; user_id: number }
  | { type: "presence:update"; user_id: number; online: boolean; last_seen_at: string | null }
  | { type: "error"; client_id: string | null; detail: string };
