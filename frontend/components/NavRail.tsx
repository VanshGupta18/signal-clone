"use client";

import { useState } from "react";
import { CircleDashed, CircleHelp, LogOut, MessageCircle, Phone, Settings } from "lucide-react";
import Avatar from "@/components/Avatar";
import type { User } from "@/types";
import styles from "./NavRail.module.css";

export type Tab = "chats" | "calls" | "stories" | "settings";

type Props = {
  me: User;
  tab: Tab;
  onTab: (tab: Tab) => void;
  onLogout: () => void;
  onDemoGuide: () => void;
};

// Signal's far-left tab bar. Calls and Stories are "Coming soon" placeholders.
export default function NavRail({ me, tab, onTab, onLogout, onDemoGuide }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const tabProps = (id: Tab, label: string) => ({
    className: `${styles.tab} ${tab === id ? styles.active : ""}`,
    title: label,
    "aria-label": label,
    "aria-current": tab === id ? ("page" as const) : undefined,
    onClick: () => onTab(id),
  });

  return (
    <nav className={styles.rail}>
      <button {...tabProps("chats", "Chats")}>
        <MessageCircle size={20} />
      </button>
      <button {...tabProps("calls", "Calls")}>
        <Phone size={20} />
      </button>
      <button {...tabProps("stories", "Stories")}>
        <CircleDashed size={20} />
      </button>

      <div className={styles.bottom}>
        <button
          className={styles.tab}
          title="Demo guide"
          aria-label="Demo guide"
          onClick={onDemoGuide}
        >
          <CircleHelp size={20} />
        </button>
        <button {...tabProps("settings", "Settings")}>
          <Settings size={20} />
        </button>
        <button className={styles.me} title={me.display_name} aria-label={`Account menu for ${me.display_name}`} onClick={() => setMenuOpen(!menuOpen)}>
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
