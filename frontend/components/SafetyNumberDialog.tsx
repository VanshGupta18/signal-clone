import Dialog from "@/components/Dialog";
import styles from "./People.module.css";

type Props = {
  name: string; // the other person
  myId: number;
  otherId: number;
  onClose: () => void;
};

// MOCK. Signal derives this from both people's identity keys; we have no keys, so it's
// 60 digits from a seeded generator over the two user ids: stable per pair, verifies nothing.
function mockSafetyNumber(a: number, b: number): string[] {
  let x = (Math.min(a, b) * 1000003 + Math.max(a, b)) % 2147483647 || 1;
  return Array.from({ length: 12 }, () => {
    x = (x * 48271) % 2147483647; // Park-Miller step; stays well inside exact integer range
    return String(x % 100000).padStart(5, "0");
  });
}

export default function SafetyNumberDialog({ name, myId, otherId, onClose }: Props) {
  const groups = mockSafetyNumber(myId, otherId);
  return (
    <Dialog title="Safety number" onClose={onClose} width={400}>
      <p className={styles.mockBadge}>Mock — not real encryption</p>
      <div className={styles.safetyNumber} aria-label="Mock safety number">
        {groups.map((g, i) => (
          <span key={i}>{g}</span>
        ))}
      </div>
      <p className={styles.muted}>
        In Signal, comparing this number with {name} proves your chat is end-to-end encrypted. This demo does not
        encrypt messages: the number is generated from your account IDs for display only.
      </p>
    </Dialog>
  );
}
