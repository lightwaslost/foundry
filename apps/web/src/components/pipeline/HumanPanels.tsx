import { useEffect, useState, type ReactNode } from "react";
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
/**
 * The chrome both panels share: a warning-toned card with a title, and room on
 * the right for a line of context. Exported because the 'How it works' tab shows
 * both panels with invented data, and a picture of the UI that is not the UI is
 * worse than no picture.
 */
export function AttentionPanel({
  icon,
  title,
  aside,
  className,
  children,
}: {
  icon?: ReactNode;
  title: ReactNode;
  aside?: ReactNode;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <section className={cn("rounded-xl border border-warning/32 bg-warning-surface", className)}>
      <header className="flex items-center gap-2 px-3 pt-2.5 pb-1">
        {icon}
        <h3 className="text-[13px] font-medium text-warning-foreground">{title}</h3>
        {aside ? <span className="ml-auto text-[11px] text-muted-foreground">{aside}</span> : null}
      </header>
      {children}
    </section>
  );
}

/** One question: its label, its options, and the free-text escape hatch. */
export function QuestionFields({
  q,
  value,
  onToggle,
  onType,
}: {
  q: Question;
  value: string | string[] | undefined;
  onToggle: (label: string) => void;
  onType: (v: string) => void;
}) {
  const picked = (label: string) =>
    Array.isArray(value) ? value.includes(label) : value === label;
  return (
    <div className="space-y-1.5">
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
              onClick={() => onToggle(o.label)}
              className={cn(
                "rounded-md border px-2 py-1 text-left text-xs transition-colors",
                picked(o.label)
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
          value={typeof value === "string" ? value : ""}
          placeholder={q.options.length === 0 ? "Your answer" : "…or write your own"}
          onChange={(e) => onType((e.target as HTMLInputElement).value)}
        />
      ) : null}
      {q.multi_select ? (
        <p className="text-[11px] text-muted-foreground">Pick as many as apply.</p>
      ) : null}
    </div>
  );
}

/** The four things a reviewer can do with a finished stage. */
export function GateActions({
  busy = false,
  hasArtifact = true,
  onApprove,
  onEdit,
  onRevise,
  onReject,
  onFix,
}: {
  busy?: boolean;
  hasArtifact?: boolean;
  onApprove: () => void;
  onEdit: () => void;
  onRevise: () => void;
  onReject: () => void;
  /** Present on a stage that reviews a build: send what it found back to the build. */
  onFix?: (() => void) | undefined;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Button size="xs" onClick={onApprove} disabled={busy || !hasArtifact}>
        <CheckIcon /> Approve
      </Button>
      <Button size="xs" variant="outline" onClick={onEdit} disabled={busy || !hasArtifact}>
        <PencilIcon /> Edit and approve
      </Button>
      <Button size="xs" variant="outline" onClick={onRevise} disabled={busy}>
        <Undo2Icon /> Send back
      </Button>
      {onFix ? (
        <Button size="xs" variant="outline" onClick={onFix} disabled={busy}>
          <Undo2Icon /> Fix these in build
        </Button>
      ) : null}
      <Button size="xs" variant="destructive-outline" onClick={onReject} disabled={busy}>
        <XIcon /> Reject
      </Button>
    </div>
  );
}

export function QuestionsPanel({
  run,
  onAnswered,
  className,
}: {
  run: Run;
  onAnswered: () => void;
  className?: string;
}) {
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
    <AttentionPanel
      icon={<MessageCircleQuestionIcon className="size-3.5 text-warning-foreground" />}
      title={
        open.length === 1 ? "The agent has a question" : `The agent has ${open.length} questions`
      }
      aside="answerable here or in the thread"
      className={className}
    >
      <div className="space-y-3 px-3 pt-1 pb-3">
        {open.map((q) => (
          <QuestionFields
            key={q.id}
            q={q}
            value={draft[q.id]}
            onToggle={(label) => toggle(q, label)}
            onType={(v) => setDraft((d) => ({ ...d, [q.id]: v }))}
          />
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
    </AttentionPanel>
  );
}

export function GatePanel({
  gate,
  artifact,
  stale,
  canFix = false,
  onDecided,
  className,
}: {
  gate: GateRow;
  artifact: ArtifactMeta | undefined;
  /** Earlier documents that changed after this stage was built from them. */
  stale?: Array<{ stage: string; built_from: number; latest: number }> | undefined;
  /** Whether a build comes before this stage, so its findings can go back to it. */
  canFix?: boolean;
  onDecided: () => void;
  className?: string;
}) {
  const [mode, setMode] = useState<"idle" | "revise" | "edit" | "reject">("idle");
  const [feedback, setFeedback] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const decide = async (
    decision: "approve" | "revise" | "reject" | "fix",
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
    <AttentionPanel
      title={`${
        artifact
          ? `Review the ${gate.stage}`
          : `The ${gate.stage} stage produced nothing — decide what happens`
      }${gate.attempt > 1 ? ` · attempt ${gate.attempt}` : ""}`}
      className={className}
    >
      <div className="px-3 pt-1 pb-3">
        {stale?.length ? (
          <p className="mb-2 rounded-md bg-warning-surface px-2.5 py-2 text-[12px] text-warning-foreground">
            {stale
              .map((s) => `Built from ${s.stage} v${s.built_from}; ${s.stage} is now v${s.latest}.`)
              .join(" ")}{" "}
            Send it back to rebuild from the latest, or approve it as it is.
          </p>
        ) : null}
        {mode === "idle" ? (
          <GateActions
            busy={busy}
            hasArtifact={Boolean(artifact)}
            onApprove={() => void decide("approve")}
            onEdit={() => void startEdit()}
            onRevise={() => setMode("revise")}
            onReject={() => setMode("reject")}
            onFix={canFix ? () => void decide("fix") : undefined}
          />
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
      </div>
    </AttentionPanel>
  );
}
