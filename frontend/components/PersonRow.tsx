import type { ReactNode } from "react";
import { Check } from "lucide-react";
import Avatar from "@/components/Avatar";
import styles from "./PersonRow.module.css";

type Props = {
  person: { id: number; display_name: string; avatar_url: string | null };
  subtitle?: string;
  online?: boolean;
  checked?: boolean; // set = a selectable row (round checkbox, like Signal's pickers)
  onClick?: () => void;
  children?: ReactNode; // trailing actions/labels, outside the clickable area
};

// One person in a list: avatar, name, subtitle. Used by New chat, the member picker and group details.
export default function PersonRow({ person, subtitle, online, checked, onClick, children }: Props) {
  const content = (
    <>
      <span className={styles.avatar}>
        <Avatar name={person.display_name} src={person.avatar_url} colorSeed={person.id} size={36} />
        {online && <span className={styles.online} aria-label="Online" />}
      </span>
      <span className={styles.text}>
        <span className={styles.name}>{person.display_name}</span>
        {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
      </span>
      {checked !== undefined && (
        <span className={`${styles.check} ${checked ? styles.checked : ""}`}>{checked && <Check size={14} />}</span>
      )}
    </>
  );

  return (
    <div className={styles.row}>
      {onClick ? (
        <button
          className={`${styles.main} ${styles.clickable}`}
          onClick={onClick}
          {...(checked !== undefined && { role: "checkbox", "aria-checked": checked })}
        >
          {content}
        </button>
      ) : (
        <div className={styles.main}>{content}</div>
      )}
      {children}
    </div>
  );
}
