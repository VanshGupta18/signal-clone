"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, MessageCircle } from "lucide-react";
import Avatar from "@/components/Avatar";
import { api, getToken, setToken } from "@/lib/api";
import { resizeToDataUrl } from "@/lib/image";
import type { User } from "@/types";
import styles from "./login.module.css";

type Step = "phone" | "code" | "profile";

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
      setError((err as Error).message);
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
      setStep("code");
    });
  }

  function submitCode() {
    return run(async () => {
      const res = await api<{ token: string; is_new: boolean; user: User }>("/api/auth/verify", {
        method: "POST",
        body: JSON.stringify({ phone, otp: code }),
      });
      setToken(res.token);
      if (res.is_new) setStep("profile");
      else router.replace("/");
    });
  }

  function submitProfile() {
    return run(async () => {
      const display_name = `${firstName.trim()} ${lastName.trim()}`.trim();
      await api<User>("/api/me", { method: "PATCH", body: JSON.stringify({ display_name, avatar_url: avatar }) });
      router.replace("/");
    });
  }

  async function pickAvatar(file: File | undefined) {
    if (!file) return;
    try {
      setAvatar(await resizeToDataUrl(file, 128));
    } catch {
      setError("Couldn't read that image");
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <MessageCircle size={36} strokeWidth={2.2} />
        </div>

        {step === "phone" && (
          <form onSubmit={(e) => { e.preventDefault(); submitPhone(); }}>
            <h1 className={styles.title}>Phone number</h1>
            <p className={styles.subtitle}>Enter your phone number to get started.</p>
            <input
              className={styles.input}
              type="tel"
              placeholder="+1 555 000 0001"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoFocus
              required
            />
            {error && <p className={styles.error}>{error}</p>}
            <button className={styles.button} disabled={busy || !phone.trim()}>Next</button>
          </form>
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
              <Avatar name={firstName || "?"} src={avatar} colorSeed={phone.length} size={80} />
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
      </div>
    </main>
  );
}
