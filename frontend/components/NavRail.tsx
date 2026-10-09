"use client";

import { useState } from "react";
import { CircleDashed, LogOut, MessageCircle, Phone, Settings } from "lucide-react";
import Avatar from "@/components/Avatar";
import type { User } from "@/types";
import styles from "./NavRail.module.css";

type Props = {
  me: User;
  onLogout: () => void;
};

// Signal's far-left tab bar. Only Chats exists for now; Calls/Stories/Settings come later.
export default function NavRail({ me, onLogout }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav className={styles.rail}>
      <button className={`${styles.tab} ${styles.active}`} title="Chats" aria-label="Chats">
        <MessageCircle size={20} />
      </button>
      <button className={styles.tab} title="Calls" aria-label="Calls">
        <Phone size={20} />
      </button>
      <button className={styles.tab} title="Stories" aria-label="Stories">
        <CircleDashed size={20} />
      </button>

      <div className={styles.bottom}>
        <button className={styles.tab} title="Settings" aria-label="Settings">
          <Settings size={20} />
        </button>
        <button className={styles.me} title={me.display_name} onClick={() => setMenuOpen(!menuOpen)}>
          <Avatar name={me.display_name} src={me.avatar_url} colorSeed={me.id} size={28} />
        </button>
        {menuOpen && (
          <div className={styles.menu}>
            <div className={styles.menuName}>{me.display_name}</div>
            <div className={styles.menuPhone}>{me.phone}</div>
            <button className={styles.menuItem} onClick={onLogout}>
              <LogOut size={16} /> Log out
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
