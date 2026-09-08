import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { Textarea } from "~/components/ui/textarea";
import { CheckIcon, MessageCircleQuestionIcon, PencilIcon, Undo2Icon, XIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import {
  API,
  call,
  post,
  unauthorized,
  type ArtifactMeta,
  type GateRow,
  type Question,
  type Run,
} from "./api";

/**
 * The two places a person is actually required. Both are deliberately loud and
 * both live inline with the run they belong to, so answering never means hunting
 * for context: the question sits under the stage that asked it, the gate under
 * the stage that produced the document.
 */
export function QuestionsPanel({ run, onAnswered }: { run: Run; onAnswered: () => void }) {
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string | string[]>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      void call<{ questions: Question[] }>(`/api/runs/${run.id}/questions`).then((r) => {
        if (live && !unauthorized(r)) setQuestions(r.questions);
      });
    load();
    const t = setInterval(load, 4000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [run.id]);

  const open = (questions ?? []).filter((q) => q.answer === null);
  if (open.length === 0) return null;

  const toggle = (q: Question, label: string) =>
    setDraft((d) => {
      if (!q.multi_select) return { ...d, [q.id]: label };
      const cur = Array.isArray(d[q.id]) ? (d[q.id] as string[]) : [];
      return {
        ...d,
        [q.id]: cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label],
      };
    });
  const picked = (q: Question, label: string) => {
    const v = draft[q.id];
    return Array.isArray(v) ? v.includes(label) : v === label;
  };
  const ready = open.every((q) => {
    const v = draft[q.id];
    return Array.isArray(v) ? v.length > 0 : typeof v === "string" && v.trim().length > 0;
  });

  const submit = async () => {
    setBusy(true);
    setErr(null);
    const r = await post<{ error?: string }>(`/api/runs/${run.id}/answers`, { answers: draft });
    setBusy(false);
    if (unauthorized(r)) return;
    if (r.error) return setErr(r.error);
    setDraft({});
    onAnswered();
  };

  return (
    <section className="rounded-xl border border-warning/32 bg-warning-surface">
      <header className="flex items-center gap-2 px-3 pt-2.5 pb-1">
        <MessageCircleQuestionIcon className="size-3.5 text-warning-foreground" />
        <h3 className="text-[13px] font-medium text-warning-foreground">
          {open.length === 1
            ? "The agent has a question"
            : `The agent has ${open.length} questions`}
        </h3>
        <span className="ml-auto text-[11px] text-muted-foreground">
          answerable here or in the thread
        </span>
      </header>
      <div className="space-y-3 px-3 pt-1 pb-3">
        {open.map((q) => (
          <div key={q.id} className="space-y-1.5">
            {q.header ? (
              <p className="text-[10px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                {q.header}
              </p>
            ) : null}
            <p className="text-[13px] leading-[1.45] text-foreground">{q.question}</p>
            {q.options.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {q.options.map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    title={o.description}
                    onClick={() => toggle(q, o.label)}
                    className={cn(
                      "rounded-md border px-2 py-1 text-left text-xs transition-colors",
                      picked(q, o.label)
                        ? "border-primary bg-primary/12 text-foreground"
                        : "border-input bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground",
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            ) : null}
            {q.options.length === 0 || q.allow_custom || q.response_mode === "message" ? (
              <Input
                size="sm"
                value={typeof draft[q.id] === "string" ? (draft[q.id] as string) : ""}
                placeholder={q.options.length === 0 ? "Your answer" : "…or write your own"}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, [q.id]: (e.target as HTMLInputElement).value }))
                }
              />
            ) : null}
            {q.multi_select ? (
              <p className="text-[11px] text-muted-foreground">Pick as many as apply.</p>
            ) : null}
          </div>
        ))}
        <div className="flex items-center gap-2">
          <Button size="xs" onClick={() => void submit()} disabled={busy || !ready}>
            {busy ? <Spinner /> : null}Send {open.length === 1 ? "answer" : "answers"}
          </Button>
          <span className="text-[11px] text-muted-foreground">
            The stage picks up where it left off.
          </span>
        </div>
        {err ? <p className="text-xs text-destructive-foreground">{err}</p> : null}
      </div>
    </section>
  );
}

export function GatePanel({
  gate,
  artifact,
  onDecided,
}: {
  gate: GateRow;
  artifact: ArtifactMeta | undefined;
  onDecided: () => void;
}) {
  const [mode, setMode] = useState<"idle" | "revise" | "edit" | "reject">("idle");
  const [feedback, setFeedback] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const decide = async (
    decision: "approve" | "revise" | "reject",
    extra: Record<string, unknown> = {},
  ) => {
    setBusy(true);
    setErr(null);
    const r = await post<{ error?: string }>(`/api/gates/${gate.id}/decide`, {
      decision,
      ...extra,
    });
    setBusy(false);
    if (unauthorized(r)) return;
    if (r.error) return setErr(r.error);
    setMode("idle");
    onDecided();
  };
  const startEdit = async () => {
    if (!artifact) return;
    const res = await fetch(`${API}/api/artifacts/${artifact.id}?raw=1`, {
      credentials: "include",
    });
    setDraft(await res.text());
    setMode("edit");
  };

  return (
    <section className="rounded-xl border border-warning/32 bg-warning-surface px-3 py-2.5">
      <h3 className="mb-2 text-[13px] font-medium text-warning-foreground">
        {artifact
          ? `Review the ${gate.stage}`
          : `The ${gate.stage} stage produced nothing — decide what happens`}
        {gate.attempt > 1 ? ` · attempt ${gate.attempt}` : ""}
      </h3>

      {mode === "idle" ? (
        <div className="flex flex-wrap gap-1.5">
          <Button size="xs" onClick={() => void decide("approve")} disabled={busy || !artifact}>
            <CheckIcon /> Approve
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => void startEdit()}
            disabled={busy || !artifact}
          >
            <PencilIcon /> Edit and approve
          </Button>
          <Button size="xs" variant="outline" onClick={() => setMode("revise")} disabled={busy}>
            <Undo2Icon /> Send back
          </Button>
          <Button
            size="xs"
            variant="destructive-outline"
            onClick={() => setMode("reject")}
            disabled={busy}
          >
            <XIcon /> Reject
          </Button>
        </div>
      ) : null}

      {mode === "revise" ? (
        <div className="space-y-2">
          <Textarea
            size="sm"
            autoFocus
            className="max-h-[30vh] overflow-y-auto"
            value={feedback}
            placeholder="What is wrong with it? The stage runs again with this in front of the agent, keeping the answers it already has."
            onChange={(e) => setFeedback(e.target.value)}
          />
          <div className="flex gap-1.5">
            <Button
              size="xs"
              onClick={() => void decide("revise", { feedback })}
              disabled={busy || !feedback.trim()}
            >
              {busy ? <Spinner /> : null}Send back for another attempt
            </Button>
            <Button size="xs" variant="ghost-muted" onClick={() => setMode("idle")}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "reject" ? (
        <div className="space-y-2">
          <p className="text-[13px] text-foreground">
            Reject the whole task? Its worktree is removed and the branch deleted unless it has
            already been pushed.
          </p>
          <div className="flex gap-1.5">
            <Button
              size="xs"
              variant="destructive"
              onClick={() => void decide("reject", { feedback })}
              disabled={busy}
            >
              {busy ? <Spinner /> : null}Yes, reject it
            </Button>
            <Button size="xs" variant="ghost-muted" onClick={() => setMode("idle")}>
              Keep it
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "edit" && draft !== null ? (
        <div className="space-y-2">
          <Textarea
            value={draft}
            rows={16}
            onChange={(e) => setDraft(e.target.value)}
            className="max-h-[50vh] overflow-y-auto font-mono text-[12px]"
          />
          <div className="flex gap-1.5">
            <Button
              size="xs"
              onClick={() => void decide("approve", { content: draft })}
              disabled={busy || !draft.trim()}
            >
              {busy ? <Spinner /> : null}
              <CheckIcon /> Save as v{(artifact?.version ?? 0) + 1} and approve
            </Button>
            <Button size="xs" variant="ghost-muted" onClick={() => setMode("idle")}>
              Cancel
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Your edit becomes the version the next stage reads.
          </p>
        </div>
      ) : null}

      {err ? <p className="mt-2 text-xs text-destructive-foreground">{err}</p> : null}
    </section>
  );
}
