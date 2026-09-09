import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { call, unauthorized } from "./api";

/**
 * Which piece of Foundry work this thread belongs to, shown beside its title.
 *
 * The board could always send you into the agent's thread; nothing sent you back.
 * Once you were reading the conversation you had lost the ticket it was about, and
 * the way back was the sidebar and your memory of the title.
 *
 * Threads Foundry never made get nothing at all -- most threads are not ours, and a
 * chip that said so on every one of them would be noise on someone else's screen.
 */
type Origin =
  | { kind: "task"; task_id: string; ticket: string; title: string; stage: string; attempt: number }
  | {
      kind: "draft";
      draft_id: string;
      title: string;
      task_id: string | null;
      ticket: string | null;
    };

export function TaskBacklink({ threadId }: { threadId: string }) {
  const [origin, setOrigin] = useState<Origin | null>(null);

  useEffect(() => {
    let live = true;
    setOrigin(null);
    void call<{ origin?: Origin | null }>(`/api/threads/${threadId}/origin`).then((r) => {
      if (live && !unauthorized(r)) setOrigin(r.origin ?? null);
    });
    return () => {
      live = false;
    };
  }, [threadId]);

  if (!origin) return null;

  // An intake conversation has no task until the agent has proposed one, so until
  // then the chip goes to the board rather than pretending there is a ticket.
  const taskId = origin.task_id;
  const label =
    origin.kind === "task"
      ? `${origin.ticket} · ${origin.stage}`
      : (origin.ticket ?? "Foundry intake");

  return (
    <Link
      to="/pipeline"
      {...(taskId ? { search: { task: taskId } } : {})}
      title={`Open ${label} on the board`}
      className="ml-2 hidden shrink-0 items-center gap-1 rounded border border-border/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground @md/header-actions:inline-flex"
    >
      {label}
    </Link>
  );
}
