import { CircleDashed, Phone } from "lucide-react";
import listStyles from "./ConversationList.module.css";
import styles from "./Panels.module.css";

// The Calls and Stories tabs: placeholders, as the assignment allows.
export default function ComingSoon({ tab }: { tab: "calls" | "stories" }) {
  const title = tab === "calls" ? "Calls" : "Stories";
  const Icon = tab === "calls" ? Phone : CircleDashed;
  return (
    <>
      <section className={listStyles.pane}>
        <header className={listStyles.header}>
          <h1 className={listStyles.title}>{title}</h1>
        </header>
        <p className={styles.paneEmpty}>{tab === "calls" ? "No recent calls" : "No stories"}</p>
      </section>
      <main className={styles.main}>
        <div className={styles.placeholder}>
          <div className={styles.placeholderIcon}>
            <Icon size={40} />
          </div>
          <h2>{title}</h2>
          <p>{tab === "calls" ? "Voice and video calls are coming soon." : "Stories are coming soon."}</p>
        </div>
      </main>
    </>
  );
}
