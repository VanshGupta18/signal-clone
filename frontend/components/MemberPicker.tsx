"use client";

import { useState } from "react";
import { X } from "lucide-react";
import Avatar from "@/components/Avatar";
import PersonRow from "@/components/PersonRow";
import { usePeople } from "@/lib/people";
import type { Person } from "@/types";
import styles from "./People.module.css";

type Props = {
  selected: Person[];
  onChange: (selected: Person[]) => void;
  excludeIds?: number[]; // e.g. people already in the group
};

// Pick several people: search box, chips for who's selected, checkbox list.
// Used for "New group" and the group's "Add members".
export default function MemberPicker({ selected, onChange, excludeIds = [] }: Props) {
  const [query, setQuery] = useState("");
  const { people, searching } = usePeople(query);
  const visible = people.filter((p) => !excludeIds.includes(p.id));

  function toggle(person: Person) {
    onChange(selected.some((p) => p.id === person.id) ? selected.filter((p) => p.id !== person.id) : [...selected, person]);
  }

  return (
    <>
      <input
        className={styles.search}
        placeholder="Search name or number"
        aria-label="Search name or number"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        data-autofocus
      />
      {selected.length > 0 && (
        <div className={styles.chips}>
          {selected.map((p) => (
            <span key={p.id} className={styles.chip}>
              <Avatar name={p.display_name} src={p.avatar_url} colorSeed={p.id} size={20} />
              {p.display_name}
              <button onClick={() => toggle(p)} aria-label={`Remove ${p.display_name}`} title="Remove">
                <X size={14} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className={styles.list}>
        <div className={styles.section}>{searching ? "Search results" : "Contacts"}</div>
        {visible.map((p) => (
          <PersonRow
            key={p.id}
            person={p}
            subtitle={p.phone}
            checked={selected.some((s) => s.id === p.id)}
            onClick={() => toggle(p)}
          />
        ))}
        {visible.length === 0 && (
          <p className={styles.empty}>{searching ? "No people found" : "No contacts to add. Search by name or number."}</p>
        )}
      </div>
    </>
  );
}
