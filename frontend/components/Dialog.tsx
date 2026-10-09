"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import styles from "./Dialog.module.css";

type Props = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode; // action buttons, right-aligned
  width?: number;
};

// Native <dialog> + showModal(): the browser gives us the dimmed backdrop, the focus trap
// and Escape. Render it to open, unmount to close.
// Focus: React's autoFocus fires while the dialog is still closed (nothing is focusable yet),
// and showModal() then focuses the first button (Close). So mark the element to focus with
// `data-autofocus` and we focus it after opening.
export default function Dialog({ title, onClose, children, footer, width = 360 }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [title]); // multi-step flows reuse one Dialog: refocus when the step (title) changes

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      style={{ width }}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault(); // Escape: let the parent unmount us
        onClose();
      }}
      // A click whose target is the <dialog> itself landed on the backdrop (the card is a child).
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <div className={styles.card}>
        <header className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          <button className={styles.close} onClick={onClose} aria-label="Close" title="Close">
            <X size={20} />
          </button>
        </header>
        <div className={styles.body}>{children}</div>
        {footer && <footer className={styles.footer}>{footer}</footer>}
      </div>
    </dialog>
  );
}

type ConfirmProps = {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
};

// "Are you sure?" for destructive actions (remove member, leave group).
export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onClose }: ConfirmProps) {
  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className={styles.button} onClick={onClose}>
            Cancel
          </button>
          <button className={`${styles.button} ${styles.danger}`} onClick={onConfirm} data-autofocus>
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className={styles.message}>{message}</p>
    </Dialog>
  );
}
