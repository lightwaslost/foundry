import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toastManager } from "~/components/ui/toast";
import { call, unauthorized, type Draft } from "./api";

/**
 * Tells you a conversation became a task.
 *
 * Nothing else can. A draft turns into a task on the server, seconds after the
 * agent emits its proposal — and at that moment you are in the T3 thread reading
 * that proposal, on a screen that knows nothing about Foundry. The board would
 * tell you, but the whole point is that you did not go back to it.
 *
 * So this lives in the chat layout rather than on the board, above the router
 * outlet, where it survives moving between the two. It watches for one specific
 * transition — a draft that was open now carrying a ticket — which is why it
 * records what it has seen before it can raise anything: on a fresh load every
 * draft is new to it, and every task created yesterday would announce itself.
 */
export function DraftWatcher() {
  const navigate = useNavigate();
  // Draft ids seen while still open. A ticket appearing on one of these is the
  // event; a ticket already there on first sight is just history.
  const open = useRef<Set<string> | null>(null);

  useEffect(() => {
    let live = true;

    const poll = async () => {
      const r = await call<{ drafts: Draft[] }>("/api/drafts");
      if (!live || unauthorized(r) || !Array.isArray(r.drafts)) return;

      const first = open.current === null;
      const seen = open.current ?? new Set<string>();

      for (const d of r.drafts) {
        if (!d.ticket) {
          seen.add(d.id);
          continue;
        }
        if (first || !seen.has(d.id)) continue; // never open in front of us — history
        seen.delete(d.id);

        const done = d.task_state === "done";
        // The conversation WAS the one-pager, so say that it landed — and say
        // where the task is now waiting, because the next thing you do is go to
        // the board and start that stage.
        toastManager.add({
          type: "success",
          title: `${d.ticket} created`,
          description: done
            ? "One-pager written. Nothing else was asked for, so the task is done."
            : d.task_stage
              ? `One-pager written. Waiting at ${d.task_stage} — open the board to start it.`
              : "One-pager written. Open the board to start it.",
          actionProps: {
            children: done ? "Read it" : "Open it",
            onClick: () =>
              void navigate({ to: "/pipeline", search: d.task_id ? { task: d.task_id } : {} }),
          },
          data: { actionVariant: "outline", hideCopyButton: true },
        });
      }
      open.current = seen;
    };

    void poll();
    const t = setInterval(() => void poll(), 10_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [navigate]);

  return null;
}
