"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, MessageCircle } from "lucide-react";
import Avatar from "@/components/Avatar";
import { api, friendlyError, getToken, setToken } from "@/lib/api";
import { resizeToDataUrl } from "@/lib/image";
import type { User } from "@/types";
import styles from "./login.module.css";

type Step = "phone" | "code" | "profile" | "done";

// The users backend/seed.py creates, for one-click demo logins. Keep in sync with seed.py.
// id = their user id in a freshly seeded database, used as the avatar color seed like in the app.
const DEMO_ACCOUNTS = [
  { id: 1, phone: "+15550000001", name: "Alice Johnson", note: "Group admin, with a few unread chats" },
  { id: 2, phone: "+15550000002", name: "Bob Smith", note: "Chatting with Alice, in Weekend Hike" },
  { id: 3, phone: "+15550000003", name: "Carol Diaz", note: "Unread messages waiting in the group" },
  { id: 4, phone: "+15550000004", name: "Dave Patel", note: "Only in the Weekend Hike group" },
  { id: 5, phone: "+15550000005", name: "Eve Moreau", note: "Brand new, no chats yet" },
];
const MOCK_OTP = "123456"; // backend accepts only this code (mock verification)

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [demoPhone, setDemoPhone] = useState<string | null>(null); // demo card being logged in
  const [demoError, setDemoError] = useState("");
  const [me, setMe] = useState<User | null>(null); // the logged-in user (avatar color, "You're all set")
  const fileInput = useRef<HTMLInputElement>(null);

  // Already logged in: skip onboarding.
  useEffect(() => {
    if (getToken()) router.replace("/");
  }, [router]);

  // Runs a request, showing a spinner state and any server error message.
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  function submitPhone() {
    return run(async () => {
      const res = await api<{ phone: string }>("/api/auth/request-code", {
        method: "POST",
        body: JSON.stringify({ phone }),
      });
      setPhone(res.phone); // normalized by the server, e.g. "+919876543210"
      // Demo accounts: pre-fill the (public) mock code so the demo login is one click.
      if (DEMO_ACCOUNTS.some((a) => a.phone === res.phone)) setCode(MOCK_OTP);
      setStep("code");
    });
  }

  // Logs in; new users go on to set up their profile, everyone else straight to their chats.
  async function verify(verifyPhone: string, otp: string) {
    const res = await api<{ token: string; is_new: boolean; user: User }>("/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({ phone: verifyPhone, otp }),
    });
    setToken(res.token);
    setMe(res.user);
    if (res.is_new) setStep("profile");
    else router.replace("/");
  }

  function submitCode() {
    return run(() => verify(phone, code));
  }

  // One click on a demo card: the same two requests as the form, with the public mock code.
  // On success the card stays busy until the app has loaded.
  async function demoLogin(demoNumber: string) {
    setDemoPhone(demoNumber);
    setDemoError("");
    setError("");
    try {
      await api("/api/auth/request-code", { method: "POST", body: JSON.stringify({ phone: demoNumber }) });
      await verify(demoNumber, MOCK_OTP);
    } catch (err) {
      setDemoError(friendlyError(err));
      setDemoPhone(null);
    }
  }

  function submitProfile() {
    return run(async () => {
      const display_name = `${firstName.trim()} ${lastName.trim()}`.trim();
      setMe(await api<User>("/api/me", { method: "PATCH", body: JSON.stringify({ display_name, avatar_url: avatar }) }));
      setStep("done");
    });
  }

  async function pickAvatar(file: File | undefined) {
    if (!file) return;
    try {
      setAvatar(await resizeToDataUrl(file, 128));
    } catch {
      setError("Couldn't use that image. Try a JPG or PNG.");
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        {step !== "done" && (
          <div className={styles.logo}>
            <MessageCircle size={36} strokeWidth={2.2} />
          </div>
        )}

        {step === "phone" && (
          <>
            <h1 className={styles.title}>Welcome to Signal</h1>
            <p className={styles.subtitle}>Fast, simple messaging. Jump into a demo account, or sign in with your number.</p>

            <h2 className={styles.sectionLabel}>Try a demo account</h2>
            <div className={styles.demoList}>
              {DEMO_ACCOUNTS.map((a) => (
                <button
                  key={a.phone}
                  type="button"
                  className={styles.demoCard}
                  onClick={() => demoLogin(a.phone)}
                  disabled={busy || demoPhone !== null}
                  aria-busy={demoPhone === a.phone}
                  aria-label={`Log in as ${a.name}`}
                >
                  <Avatar name={a.name} colorSeed={a.id} size={40} />
                  <span className={styles.demoText}>
                    <span className={styles.demoName}>{a.name}</span>
                    <span className={styles.demoNote}>{demoPhone === a.phone ? "Logging in…" : a.note}</span>
                  </span>
                  {demoPhone === a.phone && <span className={styles.spinner} aria-hidden="true" />}
                </button>
              ))}
            </div>
            {demoError && <p className={styles.error} role="alert">{demoError}</p>}

            <div className={styles.divider}><span>or use your phone number</span></div>

            <form onSubmit={(e) => { e.preventDefault(); submitPhone(); }}>
              <input
                className={styles.input}
                type="tel"
                placeholder="+1 555 000 0001"
                aria-label="Phone number"
                value={phone}
                onChange={(e) => { setPhone(e.target.value); setError(""); }}
                required
              />
              {error && <p className={styles.error} role="alert">{error}</p>}
              <button className={styles.button} disabled={busy || demoPhone !== null || !phone.trim()}>Next</button>
            </form>
          </>
        )}

        {step === "code" && (
          <form onSubmit={(e) => { e.preventDefault(); submitCode(); }}>
            <h1 className={styles.title}>Verification code</h1>
            <p className={styles.subtitle}>
              Enter the code we sent to {phone}.
              <br />
              <span className={styles.mock}>Demo mode: no SMS is sent. The code is 123456.</span>
            </p>
            <input
              className={styles.input}
              inputMode="numeric"
              maxLength={6}
              placeholder="Code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              autoFocus
            />
            {error && <p className={styles.error}>{error}</p>}
            <button className={styles.button} disabled={busy || code.length !== 6}>Continue</button>
            <button type="button" className={styles.link} onClick={() => { setStep("phone"); setCode(""); setError(""); }}>
              Wrong number?
            </button>
          </form>
        )}

        {step === "profile" && (
          <form onSubmit={(e) => { e.preventDefault(); submitProfile(); }}>
            <h1 className={styles.title}>Set up your profile</h1>
            <p className={styles.subtitle}>Your profile is visible to people you message.</p>
            <button type="button" className={styles.avatarPicker} onClick={() => fileInput.current?.click()}>
              <Avatar name={firstName || "?"} src={avatar} colorSeed={me?.id ?? 0} size={80} />
              <span className={styles.cameraBadge}><Camera size={16} /></span>
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => pickAvatar(e.target.files?.[0])}
            />
            <input
              className={styles.input}
              placeholder="First name (required)"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              autoFocus
              maxLength={25}
            />
            <input
              className={styles.input}
              placeholder="Last name (optional)"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              maxLength={24}
            />
            {error && <p className={styles.error}>{error}</p>}
            <button className={styles.button} disabled={busy || !firstName.trim()}>Next</button>
          </form>
        )}

        {step === "done" && me && (
          <div className={styles.done}>
            <Avatar name={me.display_name} src={me.avatar_url} colorSeed={me.id} size={80} />
            <h1 className={styles.title}>Welcome, {firstName.trim()}!</h1>
            <p className={styles.subtitle}>You&apos;re all set. Find friends by name or number and say hello.</p>
            <button type="button" className={styles.button} onClick={() => router.replace("/")} autoFocus>
              Start messaging
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
