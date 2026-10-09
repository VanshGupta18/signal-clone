"use client";

import { useState } from "react";
import { Users } from "lucide-react";
import Dialog from "@/components/Dialog";
import MemberPicker from "@/components/MemberPicker";
import PersonRow from "@/components/PersonRow";
import { toast } from "@/components/Toast";
import { api } from "@/lib/api";
import { usePeople } from "@/lib/people";
import type { Conversation, Person } from "@/types";
import dialogStyles from "./Dialog.module.css";
import styles from "./People.module.css";

type Props = {
  onClose: () => void;
  onOpen: (conversation: Conversation) => void; // the direct chat / new group to select
};

// The compose button's dialog: pick a person (opens or creates the direct chat),
// or "New group": pick members, then name it.
export default function NewChatDialog({ onClose, onOpen }: Props) {
  const [step, setStep] = useState<"person" | "members" | "name">("person");
  const [query, setQuery] = useState("");
  const { people, searching, refresh } = usePeople(query);
  const [selected, setSelected] = useState<Person[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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

  const openChat = (person: Person) =>
    run(async () => {
      onOpen(await api<Conversation>("/api/conversations/direct", { method: "POST", body: JSON.stringify({ user_id: person.id }) }));
    });

  const addContact = (person: Person) =>
    run(async () => {
      await api("/api/contacts", { method: "POST", body: JSON.stringify({ user_id: person.id }) });
      toast(`${person.display_name} added to contacts`);
      refresh();
    });

  const createGroup = () =>
    run(async () => {
      const body = JSON.stringify({ name, member_ids: selected.map((p) => p.id) });
      onOpen(await api<Conversation>("/api/conversations/groups", { method: "POST", body }));
      toast(`Group "${name.trim()}" created`);
    });

  const button = dialogStyles.button;
  const primary = `${dialogStyles.button} ${dialogStyles.primary}`;

  if (step === "members") {
    return (
      <Dialog
        title="Add members"
        onClose={onClose}
        footer={
          <>
            <button className={button} onClick={() => setStep("person")}>
              Back
            </button>
            <button className={primary} disabled={selected.length === 0} onClick={() => setStep("name")}>
              Next
            </button>
          </>
        }
      >
        <MemberPicker selected={selected} onChange={setSelected} />
      </Dialog>
    );
  }

  if (step === "name") {
    return (
      <Dialog
        title="Name this group"
        onClose={onClose}
        footer={
          <>
            <button className={button} onClick={() => setStep("members")}>
              Back
            </button>
            <button className={primary} disabled={busy || !name.trim()} onClick={createGroup}>
              Create
            </button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && name.trim()) createGroup();
          }}
        >
          <input
            className={styles.input}
            placeholder="Group name (required)"
            aria-label="Group name"
            maxLength={50}
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-autofocus
          />
        </form>
        <p className={styles.section}>
          {selected.length} member{selected.length === 1 ? "" : "s"}: {selected.map((p) => p.display_name).join(", ")}
        </p>
        {error && <p className={styles.error}>{error}</p>}
      </Dialog>
    );
  }

  return (
    <Dialog title="New chat" onClose={onClose}>
      <input
        className={styles.search}
        placeholder="Search name or number"
        aria-label="Search name or number"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        data-autofocus
      />
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.list}>
        <button className={styles.action} onClick={() => setStep("members")}>
          <span className={styles.actionIcon}>
            <Users size={18} />
          </span>
          New group
        </button>
        <div className={styles.section}>{searching ? "Search results" : "Contacts"}</div>
        {people.map((p) => (
          <PersonRow key={p.id} person={p} subtitle={p.phone} onClick={() => !busy && openChat(p)}>
            {!p.is_contact && (
              <button
                className={styles.smallButton}
                onClick={() => addContact(p)}
                disabled={busy}
                aria-label={`Add ${p.display_name} to contacts`}
              >
                Add contact
              </button>
            )}
          </PersonRow>
        ))}
        {people.length === 0 && (
          <p className={styles.empty}>{searching ? "No people found" : "No contacts yet. Search by name or number."}</p>
        )}
      </div>
    </Dialog>
  );
}
