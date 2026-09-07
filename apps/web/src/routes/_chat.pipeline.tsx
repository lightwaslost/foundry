import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CheckIcon,
  CircleDotIcon,
  ExternalLinkIcon,
  PencilIcon,
  PlayIcon,
  RotateCwIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Foundry pipeline board — a page inside T3.
 *
 * Data comes from the Foundry service (proxied same-origin under /foundry-api),
 * which owns tasks, stage runs, artifacts and gates. T3 owns the agent threads;
 * each stage run links to its thread here, so "open the thread" is one click.
 * Gate actions (approve / revise) land with Foundry's M4 endpoints.
 */
const API = "/foundry-api";

type Stage = {
  name: string;
  kind: "markdown" | "html" | "pull_request";
  gate: "human" | "auto";
  provider: { instanceId: string; model: string };
  skill: string | null;
};
type PipelineDef = { name: string; description: string | null; stages: Stage[] };
type Repo = { id: string; name: string; default_branch: string; clone_state: string };
type User = { id: string; name: string; email: string; role: string };
type Task = {
  id: string;
  ticket: string;
  title: string;
  description: string;
  repo_id: string;
  pipeline: string;
  pipeline_snapshot: Array<{ name: string; output: { kind: string; file?: string }; gate: string }>;
  assignee_id: string | null;
  branch: string;
  stage: string | null;
  state: "open" | "done" | "rejected" | "cancelled";
  created_at: string;
};
type Run = {
  id: string;
  stage: string;
  attempt: number;
  state: string;
  t3_thread_id: string | null;
  queued_at: string;
  started_at: string | null;
  active_ms: number | string;
  active_since: string | null;
  timeout_ms: number;
  head_sha: string | null;
  artifact_id: string | null;
  pr_url: string | null;
  park_reason: string | null;
  park_detail: unknown;
  finished_at: string | null;
};
type Gate = {
  id: string;
  stage_run_id: string;
  stage: string;
  attempt: number;
  artifact_id: string | null;
  decision: string | null;
  decided_at: string | null;
};
type ArtifactMeta = {
  id: string;
  stage: string;
  version: number;
  author_id: string | null;
  kind: string;
  created_at: string;
};
type Detail = { runs: Run[]; gates: Gate[]; artifacts: ArtifactMeta[] };

async function call<T>(path: string, init?: RequestInit): Promise<T | { __unauthorized: true }> {
  const res = await fetch(`${API}${path}`, { credentials: "include", ...init });
  if (res.status === 401) return { __unauthorized: true };
  return (await res.json()) as T;
}
const unauthorized = (v: unknown): v is { __unauthorized: true } =>
  typeof v === "object" && v !== null && "__unauthorized" in v;

function SignIn({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`${API}/api/auth/login`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setBusy(false);
    if (res.ok) onDone();
    else setError("Invalid email or password.");
  };
  const cls =
    "border-input bg-popover focus-visible:border-primary h-9 w-full rounded-md border px-3 text-sm outline-none";
  return (
    <div className="flex h-full items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-xs space-y-3">
        <div>
          <h2 className="text-sm font-medium">Sign in to Foundry</h2>
          <p className="text-muted-foreground text-xs">Named account, 30-day session.</p>
        </div>
        <input
          type="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@airaa.xyz"
          className={cls}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className={cls}
        />
        {error ? <p className="text-destructive-foreground text-xs">{error}</p> : null}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? <Spinner /> : null}Continue
        </Button>
      </form>
    </div>
  );
}

const pillVariant = (state: string) =>
  state === "parked" || state === "rejected" || state === "cancelled"
    ? "destructive"
    : state === "awaiting_gate" || state === "awaiting_answers"
      ? "warning"
      : state === "done"
        ? "outline"
        : "secondary";
const busyState = (s: string) =>
  ["preparing", "questioning", "running", "collecting", "testing"].includes(s);

function StatePill({ state }: { state: string }) {
  return (
    <Badge variant={pillVariant(state) as never} className="gap-1 font-mono text-[10px]">
      {busyState(state) ? <Spinner className="size-2.5" /> : null}
      {state.replace("_", " ")}
    </Badge>
  );
}

function Rail({ task, currentRun }: { task: Task; currentRun: Run | undefined }) {
  const stages = task.pipeline_snapshot;
  const at = stages.findIndex((s) => s.name === task.stage);
  return (
    <div className="mt-2 flex gap-[3px]">
      {stages.map((s, i) => {
        const done = task.state === "done" || i < at || (i === at && currentRun?.state === "done");
        const cls = done
          ? "bg-primary"
          : i === at
            ? currentRun?.state === "parked"
              ? "bg-destructive"
              : "bg-primary/45"
            : "bg-border";
        return (
          <span key={s.name} title={s.name} className={`h-[3px] flex-1 rounded-full ${cls}`} />
        );
      })}
    </div>
  );
}

function markdown(src: string): ReactNode {
  return src.split("\n").map((line, i) => {
    const h = /^(#{1,3})\s+(.*)/.exec(line);
    if (h) {
      const d = h[1]?.length ?? 1;
      return (
        <p
          key={i}
          className={`${d === 1 ? "text-base" : d === 2 ? "text-sm" : "text-xs"} text-foreground mt-3 mb-1 font-semibold`}
        >
          {h[2] ?? ""}
        </p>
      );
    }
    if (/^\s*[-*]\s+/.test(line))
      return (
        <p key={i} className="text-muted-foreground ml-4 text-sm">
          • {line.replace(/^\s*[-*]\s+/, "")}
        </p>
      );
    if (!line.trim()) return null;
    return (
      <p key={i} className="text-muted-foreground my-1 text-sm">
        {line}
      </p>
    );
  });
}

function NewTask({
  pipelines,
  repos,
  users,
  onCreated,
}: {
  pipelines: PipelineDef[];
  repos: Repo[];
  users: User[];
  onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pipeline, setPipeline] = useState(pipelines[0]?.name ?? "feature");
  const [repo, setRepo] = useState(repos.find((r) => r.clone_state === "cloned")?.id ?? "");
  const [assignee, setAssignee] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!repo && repos.length) setRepo(repos.find((r) => r.clone_state === "cloned")?.id ?? "");
  }, [repos, repo]);
  useEffect(() => {
    if (!pipelines.some((p) => p.name === pipeline) && pipelines[0]) setPipeline(pipelines[0].name);
  }, [pipelines, pipeline]);
  const sel = "border-input bg-popover h-9 rounded-md border px-2 text-sm";
  const submit = async () => {
    if (!title.trim() || !repo) return;
    setBusy(true);
    setErr(null);
    const r = await call<{ task?: Task; error?: string }>("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title,
        description,
        pipeline,
        repo_id: repo,
        assignee_id: assignee || null,
      }),
    });
    setBusy(false);
    if (unauthorized(r)) return;
    if (r.error) {
      setErr(r.error);
      return;
    }
    setTitle("");
    setDescription("");
    onCreated(r.task!.id);
  };
  return (
    <div className="bg-popover mb-4 rounded-md border p-3">
      <div className="flex flex-wrap gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What do you want to build?"
          className="border-input bg-background focus-visible:border-primary h-9 min-w-[240px] flex-1 rounded-md border px-3 text-sm outline-none"
        />
        <select value={pipeline} onChange={(e) => setPipeline(e.target.value)} className={sel}>
          {pipelines.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name} · {p.stages.length} stage{p.stages.length === 1 ? "" : "s"}
            </option>
          ))}
        </select>
        <select value={repo} onChange={(e) => setRepo(e.target.value)} className={sel}>
          {repos.map((r) => (
            <option key={r.id} value={r.id} disabled={r.clone_state !== "cloned"}>
              {r.name}
              {r.clone_state !== "cloned" ? ` (${r.clone_state})` : ""}
            </option>
          ))}
        </select>
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={sel}>
          <option value="">unassigned</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <Button onClick={() => void submit()} disabled={busy || !title.trim() || !repo}>
          {busy ? <Spinner /> : null}Create
        </Button>
      </div>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Context for the agent: who has the problem, what exists today, what 'done' looks like."
        rows={2}
        className="border-input bg-background focus-visible:border-primary mt-2 w-full rounded-md border px-3 py-2 text-sm outline-none"
      />
      {err ? <p className="text-destructive-foreground mt-2 text-xs">{err}</p> : null}
    </div>
  );
}

type DiffPayload = {
  from: { id: string; version: number; author_id: string | null };
  to: { id: string; version: number; author_id: string | null };
  diff: {
    hunks: Array<{ lines: Array<{ type: "ctx" | "add" | "del"; text: string }> }>;
    added: number;
    deleted: number;
  };
};

/** Unified diff between two versions of the same artifact. */
function DiffView({
  fromId,
  toId,
  onClose,
}: {
  fromId: string;
  toId: string;
  onClose: () => void;
}) {
  const [d, setD] = useState<DiffPayload | null>(null);
  useEffect(() => {
    void call<DiffPayload>(`/api/artifacts/${toId}/diff?against=${fromId}`).then((r) => {
      if (!unauthorized(r)) setD(r);
    });
  }, [fromId, toId]);
  if (!d) return <p className="text-muted-foreground text-xs">Loading diff…</p>;
  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center justify-between font-mono text-[11px]">
        <span className="text-muted-foreground">
          v{d.from.version} {d.from.author_id ? "(edited)" : "(agent)"} → v{d.to.version}{" "}
          {d.to.author_id ? "(edited)" : "(agent)"} ·{" "}
          <span className="text-primary">+{d.diff.added}</span>{" "}
          <span className="text-destructive-foreground">−{d.diff.deleted}</span>
        </span>
        <Button size="xs" variant="ghost-muted" onClick={onClose}>
          close
        </Button>
      </div>
      <pre className="bg-background max-h-[40vh] overflow-auto rounded-md border p-2 font-mono text-[11px] leading-5">
        {d.diff.hunks.length === 0 ? "(no changes)" : null}
        {d.diff.hunks.map((h, i) => (
          <div key={i} className={i > 0 ? "border-t pt-1 mt-1" : ""}>
            {h.lines.map((l, j) => (
              <div
                key={j}
                className={
                  l.type === "add"
                    ? "bg-primary/10 text-foreground"
                    : l.type === "del"
                      ? "bg-destructive/10 text-muted-foreground line-through"
                      : "text-muted-foreground"
                }
              >
                {l.type === "add" ? "+ " : l.type === "del" ? "- " : "  "}
                {l.text}
              </div>
            ))}
          </div>
        ))}
      </pre>
    </div>
  );
}

/**
 * The human gate for one stage run. Four decisions; every one is attributed and
 * decided exactly once server-side (a second click gets a 409, not a second run).
 */
function GatePanel({
  gate,
  artifact,
  onDecided,
}: {
  gate: Gate;
  artifact: ArtifactMeta | undefined;
  onDecided: () => void;
}) {
  const [mode, setMode] = useState<"idle" | "revise" | "edit">("idle");
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
    const r = await call<{ error?: string }>(`/api/gates/${gate.id}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, ...extra }),
    });
    setBusy(false);
    if (unauthorized(r)) return;
    if (r.error) {
      setErr(r.error);
      return;
    }
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
    <div className="border-warning/32 bg-warning-surface mt-2 rounded-md border p-2.5">
      <p className="text-warning-foreground mb-2 text-xs font-medium">
        Your decision: {gate.stage}
        {gate.attempt > 1 ? ` (attempt ${gate.attempt})` : ""}
        {!artifact ? " — the agent produced no output" : ""}
      </p>
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
            <PencilIcon /> Edit &amp; approve
          </Button>
          <Button size="xs" variant="outline" onClick={() => setMode("revise")} disabled={busy}>
            <Undo2Icon /> Revise
          </Button>
          <Button
            size="xs"
            variant="destructive-outline"
            onClick={() => {
              if (window.confirm("Reject this task? Its branch and worktree will be removed."))
                void decide("reject");
            }}
            disabled={busy}
          >
            <XIcon /> Reject
          </Button>
        </div>
      ) : null}
      {mode === "revise" ? (
        <div className="space-y-2">
          <textarea
            autoFocus
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={3}
            placeholder="What's wrong? The agent reruns this stage with your feedback in front of it."
            className="border-input bg-background focus-visible:border-primary w-full rounded-md border px-3 py-2 text-sm outline-none"
          />
          <div className="flex gap-1.5">
            <Button
              size="xs"
              onClick={() => void decide("revise", { feedback })}
              disabled={busy || !feedback.trim()}
            >
              Send back
            </Button>
            <Button size="xs" variant="ghost-muted" onClick={() => setMode("idle")}>
              cancel
            </Button>
          </div>
        </div>
      ) : null}
      {mode === "edit" && draft !== null ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={14}
            className="border-input bg-background focus-visible:border-primary w-full rounded-md border px-3 py-2 font-mono text-[12px] outline-none"
          />
          <div className="flex gap-1.5">
            <Button
              size="xs"
              onClick={() => void decide("approve", { content: draft })}
              disabled={busy || !draft.trim()}
            >
              <CheckIcon /> Save as v{(artifact?.version ?? 0) + 1} &amp; approve
            </Button>
            <Button size="xs" variant="ghost-muted" onClick={() => setMode("idle")}>
              cancel
            </Button>
          </div>
        </div>
      ) : null}
      {err ? <p className="text-destructive-foreground mt-2 text-xs">{err}</p> : null}
    </div>
  );
}

function PipelinePage() {
  const [needsAuth, setNeedsAuth] = useState(false);
  const [me, setMe] = useState<User | null>(null);
  const [pipelines, setPipelines] = useState<PipelineDef[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [viewArtifact, setViewArtifact] = useState<{ meta: ArtifactMeta; content: string } | null>(
    null,
  );
  const [envId, setEnvId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewDiff, setViewDiff] = useState<{ fromId: string; toId: string } | null>(null);
  const selRef = useRef<string | null>(null);
  selRef.current = selected;
  const versionsFor = (stage: string) =>
    (detail?.artifacts ?? [])
      .filter((a) => a.stage === stage)
      .sort((a, b) => a.version - b.version);

  // T3's own environment id, for thread deep links (/$environmentId/$threadId).
  useEffect(() => {
    fetch("/.well-known/t3/environment", { credentials: "include" })
      .then((r) => r.json())
      .then((d: { environmentId?: string; id?: string }) =>
        setEnvId(d.environmentId ?? d.id ?? null),
      )
      .catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    const meRes = await call<{ user: User }>("/api/auth/me");
    if (unauthorized(meRes)) {
      setNeedsAuth(true);
      return;
    }
    setNeedsAuth(false);
    setMe(meRes.user);
    const [p, r, u, t] = await Promise.all([
      call<{ pipelines: PipelineDef[] }>("/api/pipelines"),
      call<{ repos: Repo[] }>("/api/repos"),
      call<{ users: User[] }>("/api/users"),
      call<{ tasks: Task[] }>("/api/tasks"),
    ]);
    if (!unauthorized(p)) setPipelines(p.pipelines);
    if (!unauthorized(r)) setRepos(r.repos);
    if (!unauthorized(u)) setUsers(u.users);
    if (!unauthorized(t)) setTasks(t.tasks);
    const id = selRef.current;
    if (id) {
      const d = await call<Detail>(`/api/tasks/${id}/runs`);
      if (!unauthorized(d)) setDetail(d);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => {
      if (!busy) void refresh();
    }, 3000);
    return () => clearInterval(t);
  }, [refresh, busy]);

  const act = async (path: string) => {
    setBusy(true);
    const r = await call<{ error?: string }>(path, { method: "POST" });
    setBusy(false);
    if (!unauthorized(r) && r.error) window.alert(r.error);
    void refresh();
  };
  const openArtifact = async (meta: ArtifactMeta) => {
    const res = await fetch(`${API}/api/artifacts/${meta.id}?raw=1`, { credentials: "include" });
    setViewArtifact({ meta, content: await res.text() });
  };

  if (needsAuth) return <SignIn onDone={() => void refresh()} />;
  const task = tasks.find((t) => t.id === selected) ?? null;
  const currentRun = detail?.runs.at(-1);
  const stageNames = pipelines.find((p) => p.name === "feature")?.stages.map((s) => s.name) ?? [
    "one-pager",
    "mockup",
    "prd",
    "build",
  ];
  const columns = [
    ...stageNames.map((name) => ({
      key: name,
      tasks: tasks.filter((t) => t.state === "open" && t.stage === name),
    })),
    { key: "shipped", tasks: tasks.filter((t) => t.state === "done") },
  ];

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 overflow-hidden">
      <div className="min-w-0 flex-1 overflow-auto p-4">
        <div className="mb-3 flex items-center gap-3">
          <h1 className="text-foreground text-sm font-semibold">Pipeline</h1>
          <span className="text-muted-foreground font-mono text-[11px]">
            {me?.name} · {me?.role}
          </span>
        </div>
        <NewTask
          pipelines={pipelines}
          repos={repos}
          users={users}
          onCreated={(id) => {
            setSelected(id);
            void refresh();
          }}
        />
        <div className="flex gap-3 overflow-x-auto">
          {columns.map((col) => (
            <div key={col.key} className="min-w-[200px] flex-1">
              <div className="mb-2 flex items-baseline gap-2 px-1">
                <span className="text-muted-foreground text-[10px] font-semibold tracking-[0.08em] uppercase">
                  {col.key}
                </span>
                <span className="text-muted-foreground/60 font-mono text-[10px]">
                  {col.tasks.length || ""}
                </span>
              </div>
              {col.tasks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setSelected(t.id);
                    setViewArtifact(null);
                    setViewDiff(null);
                  }}
                  className={`bg-popover mb-2 w-full rounded-md border p-3 text-left transition-colors ${selected === t.id ? "border-primary" : "border-border hover:border-input"}`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-foreground line-clamp-2 text-[13px] font-medium">
                      {t.title}
                    </span>
                    <span className="text-muted-foreground shrink-0 font-mono text-[10px]">
                      {t.ticket}
                    </span>
                  </div>
                  <Rail task={t} currentRun={selected === t.id ? currentRun : undefined} />
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-muted-foreground font-mono text-[10px]">
                      {t.pipeline}
                    </span>
                    {t.assignee_id ? (
                      <span className="text-muted-foreground font-mono text-[10px]">
                        · {users.find((u) => u.id === t.assignee_id)?.name ?? "?"}
                      </span>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      <aside className="bg-popover w-[460px] max-w-[50%] shrink-0 overflow-auto border-l p-4">
        {!task ? (
          <p className="text-muted-foreground py-16 text-center text-sm">Select a task</p>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-foreground text-[15px] font-semibold">{task.title}</h2>
              <span className="text-muted-foreground font-mono text-[11px]">{task.ticket}</span>
            </div>
            <p className="text-muted-foreground mt-1 font-mono text-[11px]">
              {task.pipeline} · {repos.find((r) => r.id === task.repo_id)?.name} ·{" "}
              <code>{task.branch}</code>
            </p>
            {task.description ? (
              <p className="text-muted-foreground mt-2 text-xs whitespace-pre-wrap">
                {task.description}
              </p>
            ) : null}

            {!detail || detail.runs.length === 0 ? (
              task.state === "open" ? (
                <div className="mt-4">
                  <Button onClick={() => void act(`/api/tasks/${task.id}/start`)} disabled={busy}>
                    <PlayIcon /> Start pipeline
                  </Button>
                  <p className="text-muted-foreground mt-2 text-xs">
                    Runs the first stage as a T3 thread on <code>{task.branch}</code>.
                  </p>
                </div>
              ) : null
            ) : (
              <div className="mt-4 space-y-2">
                {detail.runs.map((r) => {
                  const gate = detail.gates.find((g) => g.stage_run_id === r.id);
                  const art = detail.artifacts.find((a) => a.id === r.artifact_id);
                  return (
                    <div key={r.id} className="rounded-md border p-2.5">
                      <div className="flex items-center gap-2">
                        {r.state === "done" ? (
                          <CheckIcon className="text-primary size-3.5" />
                        ) : busyState(r.state) ? (
                          <CircleDotIcon className="text-primary size-3.5" />
                        ) : null}
                        <span className="text-foreground text-sm font-medium">{r.stage}</span>
                        {r.attempt > 1 ? (
                          <span className="text-muted-foreground font-mono text-[10px]">
                            v{r.attempt}
                          </span>
                        ) : null}
                        <span className="ml-auto" />
                        <StatePill state={r.state} />
                      </div>
                      <div className="text-muted-foreground mt-1 flex flex-wrap gap-x-3 font-mono text-[10px]">
                        {r.head_sha ? <span>commit {r.head_sha.slice(0, 7)}</span> : null}
                        {r.active_ms ? (
                          <span>{Math.round(Number(r.active_ms) / 1000)}s active</span>
                        ) : null}
                        {r.park_reason ? (
                          <span className="text-destructive-foreground">{r.park_reason}</span>
                        ) : null}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {r.t3_thread_id ? (
                          envId ? (
                            <Link
                              to="/$environmentId/$threadId"
                              params={{ environmentId: envId, threadId: r.t3_thread_id }}
                              className="text-primary inline-flex items-center gap-1 text-xs hover:underline"
                            >
                              <ExternalLinkIcon className="size-3" /> Open thread
                            </Link>
                          ) : (
                            <span className="text-muted-foreground text-xs">
                              thread {r.t3_thread_id.slice(0, 8)}
                            </span>
                          )
                        ) : null}
                        {art ? (
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => void openArtifact(art)}
                          >
                            View {art.kind === "html" ? "mockup" : art.stage} v{art.version}
                          </Button>
                        ) : null}
                        {r.state === "parked" ? (
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => void act(`/api/runs/${r.id}/retry`)}
                            disabled={busy}
                          >
                            <RotateCwIcon /> Retry
                          </Button>
                        ) : null}
                        {busyState(r.state) || r.state === "queued" ? (
                          <Button
                            size="xs"
                            variant="ghost-muted"
                            onClick={() => {
                              if (window.confirm("Cancel this run?"))
                                void act(`/api/runs/${r.id}/cancel`);
                            }}
                            disabled={busy}
                          >
                            <XIcon /> Cancel
                          </Button>
                        ) : null}
                        {versionsFor(r.stage).length > 1 && art ? (
                          <Button
                            size="xs"
                            variant="ghost-muted"
                            onClick={() => {
                              const vs = versionsFor(r.stage);
                              const prev = vs.find((v) => v.version === art.version - 1) ?? vs[0]!;
                              setViewDiff(
                                prev.id === art.id ? null : { fromId: prev.id, toId: art.id },
                              );
                            }}
                          >
                            Diff v{art.version - 1}→v{art.version}
                          </Button>
                        ) : null}
                      </div>
                      {gate && !gate.decided_at ? (
                        <GatePanel gate={gate} artifact={art} onDecided={() => void refresh()} />
                      ) : null}
                      {r.park_reason && r.park_detail ? (
                        <pre className="text-muted-foreground bg-background mt-2 max-h-40 overflow-auto rounded border p-2 font-mono text-[10px] whitespace-pre-wrap">
                          {JSON.stringify(r.park_detail, null, 1).slice(0, 2000)}
                        </pre>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}

            {viewDiff ? (
              <DiffView
                fromId={viewDiff.fromId}
                toId={viewDiff.toId}
                onClose={() => setViewDiff(null)}
              />
            ) : null}

            {viewArtifact ? (
              <div className="mt-4">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-muted-foreground font-mono text-[11px]">
                    {viewArtifact.meta.stage} · v{viewArtifact.meta.version} ·{" "}
                    {viewArtifact.meta.author_id ? "edited" : "agent"}
                  </span>
                  <Button size="xs" variant="ghost-muted" onClick={() => setViewArtifact(null)}>
                    close
                  </Button>
                </div>
                {viewArtifact.meta.kind === "html" ? (
                  <iframe
                    title="mockup"
                    sandbox="allow-scripts"
                    srcDoc={viewArtifact.content}
                    className="h-[46vh] w-full rounded-md border bg-white"
                  />
                ) : (
                  <div className="bg-background max-h-[46vh] overflow-auto rounded-md border p-3">
                    {markdown(viewArtifact.content)}
                  </div>
                )}
              </div>
            ) : null}
          </>
        )}
      </aside>
    </div>
  );
}

export const Route = createFileRoute("/_chat/pipeline")({ component: PipelinePage });
