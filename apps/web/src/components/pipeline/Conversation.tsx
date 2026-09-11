import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { CheckIcon, MessageSquareIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { Link } from "@tanstack/react-router";
import { call, post, unauthorized, type Run } from "./api";

interface Draft {
  file: string;
  bytes: number;
}

/**
 * A stage that is a conversation.
 *
 * The conversation happens in T3, where the context is: that is where people read
 * what the agent did and answer it, so there is no reply box here -- a second place
 * to type into a conversation you have to open anyway was only ever a detour. This
 * says whether the agent is waiting on you and what it asked, takes you straight to
 * the thread, and holds the one thing only Foundry can do: accept what was written.
 * Accepting stays a separate act, because "I think I have enough" and "yes, that is
 * right" are not the same claim.
 */
export function ConversationPanel({
  run,
  envId,
  onChanged,
  onDraft,
}: {
  run: Run;
  envId: string | null;
  onChanged: () => void;
  /** Whether the deliverable exists in the worktree yet. The banner above this panel
   *  needs it and cannot work it out: artifacts are only created once you accept, so
   *  asking the artifacts says "nothing written" loudest at the moment something is. */
  onDraft?: (exists: boolean) => void;
}) {
  // What the agent said when it last stopped -- its question, usually at the end.
  const [said, setSaid] = useState<string | null>(null);
  // Whether the agent has written its deliverable yet — read from the worktree, not
  // from an artifact, because artifacts are only created once you accept.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Held in a ref so an inline arrow at the call site does not restart the poll
  // interval on every render of the parent.
  const onDraftRef = useRef(onDraft);
  onDraftRef.current = onDraft;

  const waiting = run.state === "conversing";

  useEffect(() => {
    let live = true;
    const load = () =>
      void call<{ said?: string | null; draft: Draft | null }>(
        `/api/runs/${run.id}/conversation`,
      ).then((r) => {
        if (live && !unauthorized(r)) {
          setSaid(r.said ?? null);
          setDraft(r.draft);
          onDraftRef.current?.(r.draft !== null);
        }
      });
    load();
    const t = setInterval(load, waiting ? 8000 : 3000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [run.id, waiting]);

  const finish = async () => {
    setBusy(true);
    setErr(null);
    const r = await post<{ error?: string }>(`/api/runs/${run.id}/finish`);
    setBusy(false);
    if (unauthorized(r)) return;
    if (r.error) return setErr(r.error);
    onChanged();
  };

  // Its last lines, where the question is: enough to know what it wants before you open it.
  const asked = (said ?? "")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim())
    .slice(-8)
    .join("\n");

  return (
    <div className="rounded-lg border border-border/60 bg-card/30">
      <div className="flex items-center gap-2 border-b border-border/50 px-2.5 py-2">
        <MessageSquareIcon aria-hidden className="size-3.5 text-muted-foreground" />
        <span className="text-[13px] font-medium text-foreground">
          {waiting ? "The agent is waiting on you" : "The agent is working"}
        </span>
      </div>
      <div className="space-y-2 px-2.5 py-2">
        {waiting && asked ? (
          <p className="max-h-40 overflow-y-auto border-l-2 border-border pl-2 text-[12px] leading-snug whitespace-pre-wrap text-muted-foreground">
            {asked}
          </p>
        ) : (
          <p className="text-[12px] leading-snug text-muted-foreground">
            {waiting
              ? "It asked something in the conversation."
              : "It stops and waits whenever it needs you, and Slack tells you when it does."}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {envId && run.t3_thread_id ? (
            <Button
              size="xs"
              render={
                <Link
                  to="/$environmentId/$threadId"
                  params={{ environmentId: envId, threadId: run.t3_thread_id }}
                />
              }
            >
              <MessageSquareIcon /> Open the conversation
            </Button>
          ) : null}
          <Button
            size="xs"
            variant={draft ? "outline" : "ghost-muted"}
            onClick={() => void finish()}
            disabled={!waiting || busy}
            title={
              draft
                ? `Accept ${draft.file} and move on`
                : "The agent has not written anything yet — you can still finish, but there will be no document"
            }
          >
            {busy ? <Spinner /> : <CheckIcon />}Looks right
          </Button>
          <span
            className={cn(
              "ml-auto text-[11px]",
              draft ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {draft ? `${draft.file} is ready to read` : "nothing written yet"}
          </span>
        </div>
        {err ? <p className="text-[11px] text-destructive-foreground">{err}</p> : null}
      </div>
    </div>
  );
}
