import type { LucideIcon } from "lucide-react";
import styles from "./Illustration.module.css";

type Props = {
  icon?: LucideIcon; // no icon = two chat bubbles (Signal's "messages" art)
  size?: number;
};

// The small picture above empty states: a pale blue circle with a soft icon and two dots.
// Decorative only (aria-hidden); every color is a theme variable, so it follows dark mode.
export default function Illustration({ icon: Icon, size = 80 }: Props) {
  return (
    <div className={styles.circle} style={{ width: size, height: size }} aria-hidden="true">
      {Icon ? <Icon size={size * 0.42} strokeWidth={1.75} /> : <Bubbles size={size * 0.68} />}
      <span className={styles.dotLarge} />
      <span className={styles.dotSmall} />
    </div>
  );
}

// An incoming bubble behind an outgoing (blue) one with a typing "…".
function Bubbles({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64">
      <rect className={styles.incoming} x="4" y="10" width="38" height="26" rx="13" />
      <path className={styles.incoming} d="M10 30 6 42l14-8z" />
      <rect className={styles.outgoing} x="22" y="28" width="38" height="26" rx="13" />
      <path className={styles.outgoing} d="M54 48l4 12-14-8z" />
      <circle className={styles.dot} cx="32" cy="41" r="2.6" />
      <circle className={styles.dot} cx="41" cy="41" r="2.6" />
      <circle className={styles.dot} cx="50" cy="41" r="2.6" />
    </svg>
  );
}
