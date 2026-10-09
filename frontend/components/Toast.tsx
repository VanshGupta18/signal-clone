"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./Toast.module.css";

const TOAST_MS = 4000;
const MAX_TOASTS = 3;

type Item = { id: number; message: string };

// toast("...") from anywhere; the one <Toaster /> on the page shows it. Same listener
// pattern as lib/socket.ts, so no React context is needed.
const listeners = new Set<(message: string) => void>();
let nextId = 0;

export function toast(message: string) {
  listeners.forEach((listener) => listener(message));
}

// Signal-style dark pills, bottom-center, newest at the bottom, gone after 4 s.
export default function Toaster() {
  const [items, setItems] = useState<Item[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function show(message: string) {
      const id = ++nextId;
      setItems((list) => [...list, { id, message }].slice(-MAX_TOASTS));
      setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), TOAST_MS);
    }
    listeners.add(show);
    return () => {
      listeners.delete(show);
    };
  }, []);

  // A manual popover lives in the browser's top layer, so toasts also show above an open
  // modal <dialog>. Re-showing it moves it above a dialog opened after it.
  useEffect(() => {
    const stack = ref.current;
    if (!stack) return;
    if (stack.matches(":popover-open")) stack.hidePopover();
    if (items.length > 0) stack.showPopover();
  }, [items]);

  return (
    <div ref={ref} popover="manual" className={styles.stack} role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={styles.toast}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
