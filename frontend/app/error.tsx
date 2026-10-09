"use client";

import { useEffect } from "react";
import styles from "./page.module.css";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className={styles.errorShell}>
      <h1>Signal needs a refresh</h1>
      <p>Something went wrong in this view, but your session is still safe.</p>
      <button type="button" onClick={reset}>Try again</button>
    </main>
  );
}
