"use client";

import { useEffect, useState } from "react";
import { LogOut, UserMinus, UserPlus } from "lucide-react";
import Avatar from "@/components/Avatar";
import Dialog, { ConfirmDialog } from "@/components/Dialog";
import MemberPicker from "@/components/MemberPicker";
import PersonRow from "@/components/PersonRow";
import { toast } from "@/components/Toast";
import { api } from "@/lib/api";
import type { Conversation, Member, Person } from "@/types";
import dialogStyles from "./Dialog.module.css";
import styles from "./People.module.css";

type Props = {
  conversation: Conversation;
  myId: number;
  version: number; // bumped by the page on member:update / presence:update -> refetch
  onClose: () => void;
  onLeft: () => void;
};

type Confirm = { kind: "remove"; member: Member } | { kind: "leave" } | null;

// Group info: members (admins first), and for admins add/remove. Anyone can leave.
// The buttons are only convenience: the backend enforces every rule.
export default function GroupDetails({ conversation, myId, version, onClose, onLeft }: Props) {
  const [members, setMembers] = useState<Member[]>([]);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Person[]>([]);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [error, setError] = useState("");
  const path = `/api/conversations/${conversation.id}/members`;

  useEffect(() => {
    api<Member[]>(path).then(setMembers).catch(() => {}); // 404 = I was removed; the page closes us
  }, [path, version]);

  const amAdmin = members.some((m) => m.id === myId && m.role === "admin");

  async function run(action: () => Promise<void>) {
    setError("");
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const addSelected = () =>
    run(async () => {
      setMembers(await api<Member[]>(path, { method: "POST", body: JSON.stringify({ user_ids: selected.map((p) => p.id) }) }));
      toast(selected.length === 1 ? `${selected[0].display_name} added` : `${selected.length} members added`);
      setSelected([]);
      setAdding(false);
    });

  const remove = (member: Member) =>
    run(async () => {
      setConfirm(null);
      await api(`${path}/${member.id}`, { method: "DELETE" });
      setMembers((list) => list.filter((m) => m.id !== member.id));
      toast(`${member.display_name} removed`);
    });

  const leave = () =>
    run(async () => {
      setConfirm(null);
      await api(`${path}/${myId}`, { method: "DELETE" });
      onLeft();
    });

  if (adding) {
    return (
      <Dialog
        title="Add members"
        onClose={() => setAdding(false)}
        footer={
          <>
            <button className={dialogStyles.button} onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button
              className={`${dialogStyles.button} ${dialogStyles.primary}`}
              disabled={selected.length === 0}
              onClick={addSelected}
            >
              Add
            </button>
          </>
        }
      >
        <MemberPicker selected={selected} onChange={setSelected} excludeIds={members.map((m) => m.id)} />
        {error && <p className={styles.error}>{error}</p>}
      </Dialog>
    );
  }

  return (
    <>
      <Dialog title="Group info" onClose={onClose} width={400}>
        <div className={styles.groupHead}>
          <Avatar name={conversation.name} src={conversation.avatar_url} colorSeed={conversation.id} size={80} />
          <h3 className={styles.groupName}>{conversation.name}</h3>
          <span className={styles.muted}>{members.length} {members.length === 1 ? "member" : "members"}</span>
        </div>
        {error && <p className={styles.error}>{error}</p>}
        {amAdmin && (
          <button className={styles.action} onClick={() => setAdding(true)}>
            <span className={styles.actionIcon}>
              <UserPlus size={18} />
            </span>
            Add members
          </button>
        )}
        <div className={styles.section}>Members</div>
        {members.map((m) => (
          <PersonRow key={m.id} person={m} subtitle={m.id === myId ? "You" : m.phone} online={m.online}>
            {m.role === "admin" && <span className={styles.label}>Admin</span>}
            {amAdmin && m.id !== myId && (
              <button
                className={styles.iconButton}
                onClick={() => setConfirm({ kind: "remove", member: m })}
                aria-label={`Remove ${m.display_name}`}
                title="Remove from group"
              >
                <UserMinus size={18} />
              </button>
            )}
          </PersonRow>
        ))}
        <button className={`${styles.action} ${styles.dangerAction}`} onClick={() => setConfirm({ kind: "leave" })}>
          <span className={styles.actionIcon}>
            <LogOut size={18} />
          </span>
          Leave group
        </button>
      </Dialog>

      {confirm?.kind === "remove" && (
        <ConfirmDialog
          title="Remove member?"
          message={`Remove ${confirm.member.display_name} from "${conversation.name}"? They will lose access to this group.`}
          confirmLabel="Remove"
          onConfirm={() => remove(confirm.member)}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm?.kind === "leave" && (
        <ConfirmDialog
          title="Leave group?"
          message={`You will no longer be able to send or receive messages in "${conversation.name}".`}
          confirmLabel="Leave"
          onConfirm={leave}
          onClose={() => setConfirm(null)}
        />
      )}
    </>
  );
}
