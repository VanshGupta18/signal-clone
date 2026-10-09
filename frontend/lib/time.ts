// Signal-style timestamps. All server times are ISO-8601 UTC; shown in the viewer's local time.

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

// Whole calendar days between `iso` and today (0 = today, 1 = yesterday).
function daysAgo(iso: string): number {
  return Math.round((startOfDay(new Date()) - startOfDay(new Date(iso))) / DAY_MS);
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Conversation list: "10:42 AM" today, "Tue" within the last week, else "Oct 2".
export function formatListTime(iso: string): string {
  const days = daysAgo(iso);
  if (days === 0) return formatTime(iso);
  if (days < 7) return new Date(iso).toLocaleDateString([], { weekday: "short" });
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

// Date separator in a chat: "Today", "Yesterday", else "Wed, Oct 7".
export function formatDay(iso: string): string {
  const days = daysAgo(iso);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Date(iso).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

// Chat header subtitle for someone offline: "Last seen 5 min ago", "... 3 hr ago", "... Tue".
export function formatLastSeen(iso: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60000);
  if (minutes < 1) return "Last seen just now";
  if (minutes < 60) return `Last seen ${minutes} min ago`;
  if (minutes < 24 * 60) return `Last seen ${Math.floor(minutes / 60)} hr ago`;
  return `Last seen ${formatListTime(iso)}`;
}

export function isSameDay(a: string, b: string): boolean {
  return startOfDay(new Date(a)) === startOfDay(new Date(b));
}
