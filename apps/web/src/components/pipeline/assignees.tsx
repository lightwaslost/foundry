import { useSyncExternalStore } from "react";
import { API } from "./api";

/**
 * Who is working on what, for surfaces outside the Pipeline page.
 *
 * T3's sidebar knows a thread's branch and title; Foundry knows the person. The
 * bridge is the ticket, which Foundry puts in both — so the sidebar can show a face
 * beside a row without T3 learning anything about tasks.
 *
 * One poll for the whole app, shared through an external store: dozens of sidebar
 * rows subscribe, and none of them fetches. A 401 (nobody signed in to Foundry) is
 * an ordinary outcome, not an error — the avatars simply do not appear.
 */
export interface Assignee {
  id: string;
  name: string;
  login: string | null;
}

interface Snapshot {
  byTicket: ReadonlyMap<string, Assignee>;
}
const EMPTY: Snapshot = { byTicket: new Map() };

let snapshot: Snapshot = EMPTY;
let subscribers = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

const REFRESH_MS = 60_000;

async function load(): Promise<void> {
  try {
    const [tasksRes, usersRes] = await Promise.all([
      fetch(`${API}/api/tasks`, { credentials: "include" }),
      fetch(`${API}/api/users`, { credentials: "include" }),
    ]);
    if (!tasksRes.ok || !usersRes.ok) return; // signed out, or Foundry is down
    const { tasks } = (await tasksRes.json()) as {
      tasks: Array<{ ticket: string; assignee_id: string | null }>;
    };
    const { users } = (await usersRes.json()) as {
      users: Array<{ id: string; name: string; github_login: string | null }>;
    };
    const byId = new Map(users.map((u) => [u.id, u]));
    const byTicket = new Map<string, Assignee>();
    for (const t of tasks) {
      const u = t.assignee_id ? byId.get(t.assignee_id) : undefined;
      if (u)
        byTicket.set(t.ticket.toUpperCase(), { id: u.id, name: u.name, login: u.github_login });
    }
    snapshot = { byTicket };
    for (const l of listeners) l();
  } catch {
    // leave the last good snapshot in place
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (++subscribers === 1) {
    void load();
    timer = setInterval(() => void load(), REFRESH_MS);
  }
  return () => {
    listeners.delete(listener);
    if (--subscribers === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const getSnapshot = () => snapshot;

/** `FND-ABC123` out of a branch (`foundry/fnd-abc123`) or a title, whichever has it. */
export function ticketOf(source: { branch?: string | null; title?: string | null }): string | null {
  const m =
    /foundry\/(fnd-[a-z0-9]{6})/i.exec(source.branch ?? "") ??
    /\b(FND-[A-Z0-9]{6})\b/.exec(source.title ?? "");
  return m ? m[1]!.toUpperCase() : null;
}

export function useAssignee(source: {
  branch?: string | null;
  title?: string | null;
}): Assignee | null {
  const snap = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
  const ticket = ticketOf(source);
  return ticket ? (snap.byTicket.get(ticket) ?? null) : null;
}

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
