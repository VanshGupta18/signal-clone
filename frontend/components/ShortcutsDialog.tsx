import Dialog from "@/components/Dialog";
import { isMac, SHORTCUTS } from "@/lib/shortcuts";
import styles from "./People.module.css";

// The list from lib/shortcuts.ts, with Mac key symbols on a Mac ("Mod" = ⌘, Alt = ⌥).
export default function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const mac = isMac();
  const mod = mac ? "⌘" : "Ctrl";
  const show = (key: string) => (key === "Mod" ? mod : key === "Alt" && mac ? "⌥" : key);
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose} width={420}>
      <ul className={styles.shortcuts}>
        {SHORTCUTS.map(({ keys, label }) => (
          <li key={label}>
            <span>{label.replace("Mod", mod)}</span>
            <span className={styles.keys}>
              {keys.map((key) => (
                <kbd key={key}>{show(key)}</kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
