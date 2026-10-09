import styles from "./page.module.css";

export default function Loading() {
  return (
    <main className={styles.loadingShell} aria-label="Loading Signal">
      <div className={styles.loadingPulse} />
      <p>Loading Signal…</p>
    </main>
  );
}
