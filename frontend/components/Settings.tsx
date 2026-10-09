"use client";

import { useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Bell, Camera, CircleUser, Keyboard, Laptop, Lock, LogOut, Palette } from "lucide-react";
import Avatar from "@/components/Avatar";
import { toast } from "@/components/Toast";
import { api, friendlyError } from "@/lib/api";
import { resizeToDataUrl } from "@/lib/image";
import { notificationsEnabled, notificationsSupported, setNotificationsEnabled } from "@/lib/notifications";
import { getTheme, setTheme, type Theme } from "@/lib/theme";
import type { User } from "@/types";
import dialogStyles from "./Dialog.module.css";
import listStyles from "./ConversationList.module.css";
import styles from "./Panels.module.css";

type Props = {
  me: User;
  onSaved: (user: User) => void;
  onBack: () => void;
  onLogout: () => void;
  onShowShortcuts: () => void;
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
// Profile, Appearance and Desktop notifications work; the rest are clearly labeled placeholders.
export default function Settings({ me, onSaved, onBack, onLogout, onShowShortcuts }: Props) {
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
          <button className={styles.navItem} onClick={onShowShortcuts}>
            <Keyboard size={18} /> Keyboard shortcuts
          </button>
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
          {section === "notifications" && <Notifications />}
          {section === "appearance" && <Appearance />}
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

const THEMES: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

function Appearance() {
  const [theme, setThemeState] = useState(getTheme);
  function choose(value: Theme) {
    setTheme(value);
    setThemeState(value);
  }
  return (
    <>
      <h2 className={styles.sectionTitle}>Appearance</h2>
      <div className={styles.row} role="radiogroup" aria-label="Theme">
        <span className={styles.rowLabel}>
          <span>Theme</span>
          <span className={styles.hint}>System follows your computer&apos;s light or dark setting</span>
        </span>
        <span className={styles.choices}>
          {THEMES.map(({ value, label }) => (
            <label key={value} className={styles.choice}>
              <input type="radio" name="theme" checked={theme === value} onChange={() => choose(value)} />
              {label}
            </label>
          ))}
        </span>
      </div>
    </>
  );
}

function Notifications() {
  const supported = notificationsSupported();
  const [on, setOn] = useState(notificationsEnabled);
  const blocked = supported && Notification.permission === "denied";

  async function toggle(next: boolean) {
    const enabled = await setNotificationsEnabled(next);
    setOn(enabled);
    if (next && !enabled) toast("Notifications are blocked. Allow them in your browser's site settings.");
  }

  return (
    <>
      <h2 className={styles.sectionTitle}>Notifications</h2>
      <label className={styles.row}>
        <span className={styles.rowLabel}>
          <span>Desktop notifications</span>
          <span className={styles.hint}>
            {!supported
              ? "This browser doesn't support notifications"
              : blocked
                ? "Blocked in your browser's site settings"
                : "New messages while a chat isn't open on screen"}
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          className={styles.switch}
          checked={on}
          disabled={!supported}
          onChange={(e) => toggle(e.target.checked)}
          aria-label="Desktop notifications"
        />
      </label>
      <Toggle label="Notification sound" />
      <Toggle label="Show name and message" hint="Always shown in this demo" on />
    </>
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
      setError("Couldn't use that image. Try a JPG or PNG.");
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
      toast("Profile saved");
    } catch (err) {
      setError(friendlyError(err));
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
        <div className={styles.avatarEditor}>
          <Avatar name={name || "?"} src={avatar} colorSeed={me.id} size={80} />
          <button
            type="button"
            className={styles.cameraBadge}
            onClick={() => fileInput.current?.click()}
            aria-label="Choose profile photo"
            title="Choose profile photo"
          >
            <Camera size={16} />
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            void pickAvatar(e.target.files?.[0]);
            e.currentTarget.value = "";
          }}
        />
        {avatar && (
          <button
            type="button"
            className={styles.removePhoto}
            onClick={() => setAvatar(null)}
            disabled={busy}
          >
            Remove photo
          </button>
        )}
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
