"use client";

import { useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Bell, Camera, CircleUser, Laptop, Lock, LogOut, Palette } from "lucide-react";
import Avatar from "@/components/Avatar";
import { toast } from "@/components/Toast";
import { api } from "@/lib/api";
import { resizeToDataUrl } from "@/lib/image";
import type { User } from "@/types";
import dialogStyles from "./Dialog.module.css";
import listStyles from "./ConversationList.module.css";
import styles from "./Panels.module.css";

type Props = {
  me: User;
  onSaved: (user: User) => void;
  onBack: () => void;
  onLogout: () => void;
};

const SECTIONS = [
  { id: "profile", label: "Profile", icon: CircleUser },
  { id: "privacy", label: "Privacy", icon: Lock },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "devices", label: "Linked devices", icon: Laptop },
] as const;

type Section = (typeof SECTIONS)[number]["id"];

// Signal Desktop's settings screen: section list on the left, the section on the right.
// Only Profile is functional; the rest are clearly labeled placeholders.
export default function Settings({ me, onSaved, onBack, onLogout }: Props) {
  const [section, setSection] = useState<Section>("profile");

  return (
    <>
      <section className={listStyles.pane}>
        <header className={listStyles.header}>
          <button className={listStyles.iconButton} onClick={onBack} aria-label="Back to chats" title="Back to chats">
            <ArrowLeft size={20} />
          </button>
          <h1 className={listStyles.title} style={{ flex: 1, marginLeft: 8 }}>
            Settings
          </h1>
        </header>
        <nav className={styles.nav} aria-label="Settings sections">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`${styles.navItem} ${section === id ? styles.navSelected : ""}`}
              aria-current={section === id ? "page" : undefined}
              onClick={() => setSection(id)}
            >
              <Icon size={18} /> {label}
            </button>
          ))}
          <button className={`${styles.navItem} ${styles.logout}`} onClick={onLogout}>
            <LogOut size={18} /> Log out
          </button>
        </nav>
      </section>
      <main className={styles.main}>
        <div className={styles.section}>
          {section === "profile" && <Profile me={me} onSaved={onSaved} />}
          {section === "privacy" && (
            <Placeholder title="Privacy">
              <Toggle label="Read receipts" hint="Always on in this demo" on />
              <Toggle label="Typing indicators" hint="Always on in this demo" on />
              <Toggle label="Show when you're online" hint="Always on in this demo" on />
            </Placeholder>
          )}
          {section === "notifications" && (
            <Placeholder title="Notifications">
              <Toggle label="Desktop notifications" />
              <Toggle label="Notification sound" />
              <Toggle label="Show name and message" />
            </Placeholder>
          )}
          {section === "appearance" && (
            <Placeholder title="Appearance">
              <Toggle label="Theme: Light" hint="The only theme for now" on />
              <Toggle label="Theme: Dark" />
              <Toggle label="Theme: System" />
            </Placeholder>
          )}
          {section === "devices" && (
            <Placeholder title="Linked devices">
              <p className={styles.hint}>
                Linking this computer to Signal on your phone is coming soon. In this demo you simply log in with your
                phone number in each browser.
              </p>
            </Placeholder>
          )}
        </div>
      </main>
    </>
  );
}

function Placeholder({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {children}
      <p className={styles.note}>Coming soon. These settings are placeholders and can&apos;t be changed yet.</p>
    </>
  );
}

// A disabled switch: shows the current (fixed) behavior, can't be toggled.
function Toggle({ label, hint, on = false }: { label: string; hint?: string; on?: boolean }) {
  return (
    <label className={styles.row}>
      <span className={styles.rowLabel}>
        <span>{label}</span>
        {hint && <span className={styles.hint}>{hint}</span>}
      </span>
      <span className={styles.soon}>Coming soon</span>
      <input type="checkbox" role="switch" className={styles.switch} checked={on} disabled readOnly aria-label={label} />
    </label>
  );
}

function Profile({ me, onSaved }: { me: User; onSaved: (user: User) => void }) {
  const [name, setName] = useState(me.display_name);
  const [avatar, setAvatar] = useState(me.avatar_url);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const changed = name.trim() !== me.display_name || avatar !== me.avatar_url;

  async function pickAvatar(file: File | undefined) {
    if (!file) return;
    try {
      setAvatar(await resizeToDataUrl(file, 128));
    } catch {
      setError("Couldn't read that image");
    }
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      const user = await api<User>("/api/me", {
        method: "PATCH",
        body: JSON.stringify({ display_name: name, avatar_url: avatar }),
      });
      onSaved(user);
      toast("Profile updated");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2 className={styles.sectionTitle}>Profile</h2>
      <form
        className={styles.profile}
        onSubmit={(e) => {
          e.preventDefault();
          if (changed && name.trim() && !busy) save();
        }}
      >
        <button
          type="button"
          className={styles.avatarButton}
          onClick={() => fileInput.current?.click()}
          aria-label="Change profile photo"
          title="Change profile photo"
        >
          <Avatar name={name || "?"} src={avatar} colorSeed={me.id} size={80} />
          <span className={styles.cameraBadge}>
            <Camera size={16} />
          </span>
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => pickAvatar(e.target.files?.[0])}
        />
        <label className={styles.field}>
          Name
          <input
            className={styles.input}
            aria-label="Profile name"
            value={name}
            maxLength={50}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className={styles.field}>
          Phone number
          <span className={styles.phone}>{me.phone}</span>
        </div>
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.actions}>
          <button
            className={`${dialogStyles.button} ${dialogStyles.primary}`}
            disabled={busy || !changed || !name.trim()}
          >
            Save
          </button>
        </div>
      </form>
    </>
  );
}
