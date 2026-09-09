import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { Textarea } from "~/components/ui/textarea";
import { ArrowRightIcon, PaperclipIcon, SendIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { call, post, unauthorized, type DraftView, type Proposal } from "./api";

/**
 * Talking a task into existence.
 *
 * The transcript is not stored here or on the Foundry side — it is the T3 thread,
 * read fresh on every poll — so this component holds no state the server does not
 * already know. What it is really waiting for is a proposal: once the agent has
 * enough it emits the whole ticket, and the button below hands that to the same
 * pane you would have filled in yourself, ticked the way it decided.
 */
export function DraftChat({
  draftId,
  envId,
  onPropose,
  onCancel,
}: {
  draftId: string;
  envId: string | null;
  onPropose: (view: DraftView, proposal: Proposal) => void;
  onCancel: () => void;
}) {
  const [view, setView] = useState<DraftView | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState<"say" | "attach" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const thinking = view?.state === "thinking";
  // Blocked is not your turn either: the agent opened a request only T3 can answer,
  // so the box stays shut and the error line points at the thread.
  const locked = thinking || view?.state === "blocked";
  const load = () =>
    call<DraftView>(`/api/drafts/${draftId}`).then((r) => {
      if (!unauthorized(r)) setView(r);
    });

  useEffect(() => {
    void load();
    // While the agent has the turn its reply is the thing being waited for; once it
    // is your move nothing changes until you type, so ask far less often.
    const t = setInterval(() => void load(), thinking ? 3000 : 10000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, thinking]);

  // Follow the conversation rather than making people scroll to find the reply.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [view?.messages.length, view?.state]);

  const say = async () => {
    const text = reply.trim();
    if (!text) return;
    setBusy("say");
    setErr(null);
    const r = await post<{ error?: string }>(`/api/drafts/${draftId}/say`, { text });
    setBusy(null);
    if (unauthorized(r)) return;
    if (r.error) return setErr(r.error);
    setReply("");
    // Show it as sent rather than waiting up to three seconds for the poll.
    setView((v) =>
      v ? { ...v, state: "thinking", messages: [...v.messages, { role: "user", text }] } : v,
    );
  };

  const attach = async (f: File) => {
    setBusy("attach");
    setErr(null);
    const buf = new Uint8Array(await f.arrayBuffer());
    let bin = "";
    for (const b of buf) bin += String.fromCharCode(b);
    const r = await post<{ error?: string }>(`/api/drafts/${draftId}/attachments`, {
      filename: f.name,
      data_base64: btoa(bin),
    });
    setBusy(null);
    if (unauthorized(r)) return;
    if (r.error) return setErr(r.error);
    await load();
  };

  const threadHref =
    envId && view?.draft.thread_id ? `/${envId}/thread/${view.draft.thread_id}` : null;

  return (
    <section className="flex max-h-[85vh] flex-col">
      <header className="shrink-0 px-4 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium tracking-[-0.005em] text-foreground">
            Talking it through
          </h2>
          {threadHref ? (
            <a
              href={threadHref}
              className="ml-auto font-mono text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              read the thread
            </a>
          ) : null}
        </div>
        <p className="text-[13px] text-muted-foreground">
          It can read the repository while you talk. Give it links, files, anything you have — it
          writes the brief and picks the stages.
        </p>
      </header>

      <div
        ref={scroller}
        className="min-h-40 flex-1 space-y-3 overflow-y-auto border-y border-border/50 px-4 py-3"
      >
        {view === null ? (
          <Spinner />
        ) : view.messages.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            Reading {view.draft.title} against the repository…
          </p>
        ) : (
          view.messages.map((m, i) => (
            <div key={i} className="space-y-0.5">
              <div className="font-mono text-[11px] text-muted-foreground">
                {m.role === "assistant" ? "agent" : "you"}
              </div>
              <div
                className={cn(
                  "text-[13px] leading-relaxed whitespace-pre-wrap",
                  m.role === "assistant" ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {/* The proposal block is machinery, not conversation: the next
                    screen renders it properly, so it is not repeated as JSON here. */}
                {m.text.replace(/```json[\s\S]*?```/g, "").trim() || "(proposed a task)"}
              </div>
            </div>
          ))
        )}
        {thinking ? (
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <Spinner />
            thinking…
          </div>
        ) : null}
        {view?.error ? (
          <p className="text-[12px] text-destructive-foreground">{view.error}</p>
        ) : null}
      </div>

      {view?.attachments.length ? (
        <div className="flex shrink-0 flex-wrap gap-1.5 px-4 pt-2">
          {view.attachments.map((a) => (
            <span
              key={a.id}
              className="rounded-md border border-border/60 px-2 py-1 font-mono text-[11px] text-muted-foreground"
            >
              {a.filename}
            </span>
          ))}
        </div>
      ) : null}

      <div className="shrink-0 space-y-1.5 px-4 py-3">
        <Textarea
          ref={box}
          size="sm"
          className="max-h-40"
          disabled={locked || busy !== null}
          placeholder={
            locked
              ? "The agent has the turn — it will hand back when it stops."
              : "Reply, paste links, or say what to change. ⌘↵ to send."
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
        {err ? <p className="text-[11px] text-destructive-foreground">{err}</p> : null}
      </div>

      <footer className="flex shrink-0 items-center gap-2 border-t border-border/50 px-4 py-3">
        <Button
          size="sm"
          variant={view?.proposal ? "ghost-muted" : "default"}
          onClick={() => void say()}
          disabled={locked || busy !== null || !reply.trim()}
        >
          {busy === "say" ? <Spinner /> : <SendIcon />}Send
        </Button>
        <input
          ref={file}
          type="file"
          className="hidden"
          accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (f) void attach(f);
          }}
        />
        <Button
          size="sm"
          variant="ghost-muted"
          onClick={() => file.current?.click()}
          disabled={busy !== null}
          title="Images and PDFs. The agent reads them."
        >
          {busy === "attach" ? <Spinner /> : <PaperclipIcon />}Attach
        </Button>
        {view?.proposal ? (
          <Button size="sm" onClick={() => onPropose(view, view.proposal!)}>
            <ArrowRightIcon />
            Use this
          </Button>
        ) : null}
        <Button size="sm" variant="ghost-muted" onClick={onCancel}>
          Cancel
        </Button>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {view?.proposal
            ? `${view.proposal.stages.length} stage${view.proposal.stages.length === 1 ? "" : "s"} proposed — review them next.`
            : "Nothing is created until you accept what it proposes."}
        </span>
      </footer>
    </section>
  );
}
