"use client";

import { useEffect, useRef } from "react";

// Signal Desktop-style keyboard shortcuts (D90): one keydown listener on the window.
// "Mod" = Cmd on a Mac, Ctrl elsewhere.
export type ShortcutAction = "newChat" | "search" | "previousChat" | "nextChat" | "settings" | "shortcuts";

export const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

// Shown in the Keyboard shortcuts dialog. "Mod" is replaced by ⌘ or Ctrl when shown.
export const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["Mod", "N"], label: "Start a new chat" },
  { keys: ["Mod", "Alt", "N"], label: "Start a new chat (when the browser keeps Mod+N)" },
  { keys: ["Mod", "F"], label: "Search chats (also Mod+K)" },
  { keys: ["Alt", "↑"], label: "Previous chat" },
  { keys: ["Alt", "↓"], label: "Next chat" },
  { keys: ["Mod", ","], label: "Open Settings" },
  { keys: ["Mod", "/"], label: "Show keyboard shortcuts" },
  { keys: ["Esc"], label: "Close a dialog, clear the search" },
];

function actionFor(e: KeyboardEvent): ShortcutAction | null {
  const mod = isMac() ? e.metaKey : e.ctrlKey;
  // e.code, not e.key: on a Mac, Alt changes the character (Alt+N types "˜").
  if (mod && e.code === "KeyN") return "newChat";
  if (mod && (e.code === "KeyF" || e.code === "KeyK")) return "search";
  if (mod && e.key === ",") return "settings";
  if (mod && (e.key === "/" || e.key === "?")) return "shortcuts";
  // Alt+arrows work even while typing a message, like in Signal; no other modifiers.
  if (e.altKey && !mod && !e.shiftKey && e.key === "ArrowUp") return "previousChat";
  if (e.altKey && !mod && !e.shiftKey && e.key === "ArrowDown") return "nextChat";
  return null;
}

// Every shortcut above uses a modifier, so plain typing in an input is never hijacked.
// While a modal dialog is open the page behind it is inert, so shortcuts are ignored.
export function useShortcuts(run: (action: ShortcutAction) => void) {
  const latest = useRef(run); // the listener is added once; always call the latest handler
  useEffect(() => {
    latest.current = run;
  });
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (document.querySelector("dialog[open]")) return;
      const action = actionFor(e);
      if (!action) return;
      e.preventDefault();
      latest.current(action);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
