"use client";

import Dialog from "@/components/Dialog";
import styles from "./DemoGuide.module.css";

type Props = {
  onClose: () => void;
};

const STEPS = [
  "Log in as Alice, then open Bob in a second browser or private window.",
  "Type, send a message, and verify typing plus sent, delivered, and read ticks.",
  "Disconnect Bob, send from Alice, reconnect, and verify offline catch-up.",
  "Open Weekend Hike with Alice, Bob, and Carol to try group messaging.",
  "Open Group info to test member roles, admin actions, and removal protection.",
  "Refresh or restart the backend to verify that messages and groups persist.",
];

export default function DemoGuide({ onClose }: Props) {
  return (
    <Dialog title="Demo guide" onClose={onClose} width={480}>
      <p className={styles.intro}>
        A short path through the requirements. The guide is optional and does not change the chat experience.
      </p>

      <h3 className={styles.heading}>Try the demo</h3>
      <ol className={styles.steps}>
        {STEPS.map((step) => <li key={step}>{step}</li>)}
      </ol>

      <section className={styles.accounts} aria-labelledby="demo-accounts-title">
        <h3 id="demo-accounts-title" className={styles.heading}>Demo accounts</h3>
        <p><strong>Alice</strong> · +15550000001 · direct chats and group admin</p>
        <p><strong>Bob</strong> · +15550000002 · group member</p>
        <p><strong>Carol</strong> · +15550000003 · unread messages and group member</p>
        <p className={styles.code}>Verification code: <strong>123456</strong></p>
      </section>

      <details className={styles.notes}>
        <summary>Developer notes</summary>
        <ul>
          <li>FastAPI serves REST endpoints for auth, profiles, contacts, conversations, history, and groups.</li>
          <li>SQLite stores users, memberships, messages, and per-recipient delivery/read receipts.</li>
          <li>WebSockets carry messages, typing, presence, membership updates, and receipt updates.</li>
          <li>Messages are persisted before acknowledgement, and client IDs make retries idempotent.</li>
          <li>Backend membership checks enforce group permissions; the UI only reflects those rules.</li>
          <li>Encryption, safety numbers, calls, stories, and linked devices are simulated or placeholders.</li>
        </ul>
      </details>
    </Dialog>
  );
}
