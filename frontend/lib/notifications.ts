// Desktop notifications (D91). Shown only when the browser permission is granted AND the
// user hasn't switched them off in Settings (saved per browser, default on).
const PREF_KEY = "signal_notifications";

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationsEnabled(): boolean {
  return notificationsSupported() && Notification.permission === "granted" && localStorage.getItem(PREF_KEY) !== "off";
}

// The Settings switch. Turning it on asks for permission the first time; returns the new state.
export async function setNotificationsEnabled(on: boolean): Promise<boolean> {
  localStorage.setItem(PREF_KEY, on ? "on" : "off");
  if (on && Notification.permission === "default") await Notification.requestPermission();
  return notificationsEnabled();
}

// One notification per chat (tag): a newer message replaces the older one instead of stacking.
export function showNotification(title: string, body: string, conversationId: number, onClick: () => void) {
  if (!notificationsEnabled()) return;
  const notification = new Notification(title, { body, tag: `conversation-${conversationId}`, icon: "/icon.svg" });
  notification.onclick = () => {
    window.focus();
    onClick();
    notification.close();
  };
}
