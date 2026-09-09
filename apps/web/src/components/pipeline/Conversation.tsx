import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { Textarea } from "~/components/ui/textarea";
import { CheckIcon, MessageSquareIcon, SendIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { Link } from "@tanstack/react-router";
import { call, post, unauthorized, type Run } from "./api";

interface Draft {
  file: string;
  bytes: number;
}

interface Turn {
  body: string;
  author: string | null;
  created_at: string;
  message_id: string | null;
}

/**
 * Talking to a stage instead of filling in a form.
 *
 * The one-pager stage asked eighteen of the twenty-five questions this system has
 * ever asked, one at a time, each one a separate interruption. Here the stage stays
 * open and the conversation happens while the context is still loaded.
 *
 * Two things this deliberately does not do. It does not show the agent's replies —
 * those live in the T3 thread, which is a better transcript than anything repeated
 * here, and the link goes straight to it. And it does not end the conversation on
 * the agent's say-so: the agent proposes by writing the document, and accepting it
 * is a separate act, because "I think I have enough" and "yes, that is right" are
 * not the same claim.
 */
export function ConversationPanel({
  run,
  envId,
  onChanged,
}: {
  run: Run;
  envId: string | null;
  onChanged: () => void;
}) {
  const [turns, setTurns] = useState<Turn[] | null>(null);
  // Whether the agent has written its deliverable yet — read from the worktree, not
  // from an artifact, because artifacts are only created once you accept.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState<"say" | "finish" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const waiting = run.state === "conversing";

  useEffect(() => {
    let live = true;
    const load = () =>
      void call<{ turns: Turn[]; draft: Draft | null }>(`/api/runs/${run.id}/conversation`).then(
        (r) => {
          if (live && !unauthorized(r)) {
            setTurns(r.turns);
            setDraft(r.draft);
          }
        },
      );
    load();
    // While the agent has the turn, its reply is what we are waiting for.
    const t = setInterval(load, waiting ? 8000 : 3000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [run.id, waiting]);

  const say = async () => {
    const text = reply.trim();
    if (!text) return;
    setBusy("say");
    setErr(null);
    const r = await post<{ error?: string }>(`/api/runs/${run.id}/say`, { text });
    setBusy(null);
    if (unauthorized(r)) return;
    if (r.error) return setErr(r.error);
    setReply("");
    onChanged();
  };

  const finish = async () => {
    setBusy("finish");
    setErr(null);
    const r = await post<{ error?: string }>(`/api/runs/${run.id}/finish`);
    setBusy(null);
    if (unauthorized(r)) return;
    if (r.error) return setErr(r.error);
    onChanged();
  };

  return (
    <div className="rounded-lg border border-border/60 bg-card/30">
      <div className="flex items-center gap-2 border-b border-border/50 px-2.5 py-2">
        <MessageSquareIcon aria-hidden className="size-3.5 text-muted-foreground" />
        <span className="text-[13px] font-medium text-foreground">
          {waiting ? "Your turn" : "The agent is replying"}
        </span>
        {envId && run.t3_thread_id ? (
          <Link
            to="/$environmentId/$threadId"
            params={{ environmentId: envId, threadId: run.t3_thread_id }}
            className="ml-auto font-mono text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            read the thread
          </Link>
        ) : null}
      </div>

      {turns === null ? (
        <div className="px-2.5 py-3">
          <Spinner />
        </div>
      ) : (
        <div className="max-h-56 space-y-1.5 overflow-y-auto px-2.5 py-2 scrollbar-none">
          {turns.length === 0 ? (
            <p className="text-[12px] leading-snug text-muted-foreground">
              The agent has asked its first questions in the thread. Answer here and it carries on.
            </p>
          ) : (
            turns.map((t, i) => (
              <div key={`${t.created_at}-${i}`} className="text-[12px] leading-snug">
                <span className="font-medium text-foreground">{t.author ?? "someone"}</span>
                <span
                  className={cn(
                    "ml-1.5 whitespace-pre-wrap",
                    t.message_id ? "text-muted-foreground" : "text-muted-foreground/60 italic",
                  )}
                >
                  {t.body}
                </span>
                {t.message_id ? null : (
                  <span className="ml-1 text-[10px] text-muted-foreground/60">(sending…)</span>
                )}
              </div>
            ))
          )}
        </div>
      )}

      <div className="space-y-1.5 border-t border-border/50 px-2.5 py-2">
        <Textarea
          ref={box}
          size="sm"
          className="max-h-40"
          disabled={!waiting || busy !== null}
          placeholder={
            waiting
              ? "Answer, or tell it what to change. ⌘↵ to send."
              : "The agent has the turn — it will hand back when it stops."
          }
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void say();
            }
          }}
        />
        <div className="flex items-center gap-1.5">
          <Button
            size="xs"
            onClick={() => void say()}
            disabled={!waiting || busy !== null || !reply.trim()}
          >
            {busy === "say" ? <Spinner /> : <SendIcon />}Send
          </Button>
          <Button
            size="xs"
            variant={draft ? "default" : "ghost-muted"}
            onClick={() => void finish()}
            disabled={!waiting || busy !== null}
            title={
              draft
                ? `Accept ${draft.file} and move on`
                : "The agent has not written anything yet — you can still finish, but there will be no document"
            }
          >
            {busy === "finish" ? <Spinner /> : <CheckIcon />}Looks right
          </Button>
          <span className="ml-auto text-[11px] text-muted-foreground">
            {draft ? `${draft.file} is ready to read` : "nothing written yet"}
          </span>
        </div>
        {err ? <p className="text-[11px] text-destructive-foreground">{err}</p> : null}
      </div>
    </div>
  );
}
