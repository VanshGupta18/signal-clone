import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Person } from "@/types";

// People to pick from: my contacts, or search results once the query has 2+ characters.
export function usePeople(query: string) {
  const [people, setPeople] = useState<Person[]>([]);
  const [version, setVersion] = useState(0); // bump to refetch (e.g. after "Add contact")
  const q = query.trim();
  useEffect(() => {
    let stale = false;
    const path = q.length >= 2 ? `/api/users/search?q=${encodeURIComponent(q)}` : "/api/contacts";
    const timer = setTimeout(() => {
      api<Person[]>(path).then((list) => !stale && setPeople(list)).catch(() => {});
    }, q.length >= 2 ? 200 : 0); // small debounce while typing
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [q, version]);
  return { people, searching: q.length >= 2, refresh: () => setVersion((v) => v + 1) };
}
