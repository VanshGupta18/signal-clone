import { CircleDashed, Phone } from "lucide-react";
import Illustration from "@/components/Illustration";
import listStyles from "./ConversationList.module.css";
import styles from "./Panels.module.css";

// The Calls and Stories tabs: placeholders, as the assignment allows.
export default function ComingSoon({ tab }: { tab: "calls" | "stories" }) {
  const title = tab === "calls" ? "Calls" : "Stories";
  return (
    <>
      <section className={listStyles.pane}>
        <header className={listStyles.header}>
          <h1 className={listStyles.title}>{title}</h1>
        </header>
        <p className={styles.paneEmpty}>{tab === "calls" ? "No recent calls" : "No stories yet"}</p>
      </section>
      <main className={styles.main}>
        <div className={styles.placeholder}>
          <Illustration icon={tab === "calls" ? Phone : CircleDashed} size={96} />
          <h2>{title}</h2>
          <p>
            {tab === "calls"
              ? "Voice and video calls are coming soon. Until then, a message works great."
              : "Stories are coming soon. For now, share what's new in a chat."}
          </p>
        </div>
      </main>
    </>
  );
}
