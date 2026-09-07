import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { createFileRoute } from "@tanstack/react-router";
import { CheckIcon, CircleDotIcon, ExternalLinkIcon, RotateCwIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Foundry pipeline board.
 *
 * The board's data lives in the Foundry service, not in T3's store — T3 has no
 * concept of a task with staged artifacts and human gates. Traefik proxies
 * Foundry under /foundry-api on this host so the calls are same-origin and the
 * session cookie just works.
 */
const API = "/foundry-api";

type StageMeta = { name: string; kind: string };
type Task = {
  id: string;
  title: string;
  stage: string | null;
  state: string;
  attempt: number;
  error: string | null;
  running: boolean;
};
type BoardState = { stages: StageMeta[]; tasks: Task[] };
type Artifact = { stage: string; kind: string; version: number; author: string; content: string };
type StageRow = {
  name: string;
  kind: string;
  hasArtifact: boolean;
  decision: string | null;
  current: boolean;
};
type Detail = {
  task: Task;
  view: string | null;
  stages: StageRow[];
  artifact: Artifact | null;
  versions: { version: number; author: string }[];
  log: string;
};

async function call<T>(path: string, init?: RequestInit): Promise<T | { __unauthorized: true }> {
  const res = await fetch(`${API}${path}`, { credentials: "include", ...init });
  if (res.status === 401) return { __unauthorized: true };
  return (await res.json()) as T;
}
const isUnauthorized = (v: unknown): v is { __unauthorized: true } =>
  typeof v === "object" && v !== null && "__unauthorized" in v;

/** Signed-out state. Foundry owns its own session; we just collect the password. */
function SignIn({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`${API}/login`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (res.ok) onDone();
    else setError("That password is not right.");
  };

  return (
    <div className="flex h-full items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-xs space-y-3">
        <div>
          <h2 className="text-sm font-medium">Connect to Foundry</h2>
          <p className="text-muted-foreground text-xs">
            The pipeline service holds its own session.
          </p>
        </div>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Foundry password"
          className="border-input bg-popover focus-visible:border-primary h-9 w-full rounded-md border px-3 text-sm outline-none"
        />
        {error ? <p className="text-destructive-foreground text-xs">{error}</p> : null}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? <Spinner /> : null}
          Continue
        </Button>
      </form>
    </div>
  );
}

function StatePill({ task }: { task: Task }) {
  const label = task.running ? "running" : task.state.replace("_", " ");
  const variant =
    task.state === "failed" || task.state === "rejected"
      ? "destructive"
      : task.state === "awaiting_gate"
        ? "warning"
        : "secondary";
  return (
    <Badge variant={variant as never} className="gap-1 font-mono text-[10px]">
      {task.running ? <Spinner className="size-2.5" /> : null}
      {label}
    </Badge>
  );
}

/** Four-segment progress rail — how far this task has travelled. */
function Rail({ stages, task }: { stages: StageMeta[]; task: Task }) {
  const at = stages.findIndex((s) => s.name === task.stage);
  return (
    <div className="mt-2 flex gap-[3px]">
      {stages.map((stage, i) => {
        const done = task.state === "done" || i < at;
        const now = i === at;
        return (
          <span
            key={stage.name}
            className={`h-[3px] flex-1 rounded-full ${
              done ? "bg-primary" : now ? "bg-primary/45" : "bg-border"
            }`}
          />
        );
      })}
    </div>
  );
}

function markdown(src: string): ReactNode {
  // Deliberately minimal: artifacts are agent-written markdown, and pulling a
  // parser in for a preview pane is not worth the bundle.
  return src.split("\n").map((line, i) => {
    const heading = /^(#{1,3})\s+(.*)/.exec(line);
    if (heading) {
      const depth = heading[1]?.length ?? 1;
      const size = depth === 1 ? "text-base" : depth === 2 ? "text-sm" : "text-xs";
      return (
        <p key={i} className={`${size} text-foreground mt-3 mb-1 font-semibold`}>
          {heading[2] ?? ""}
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

function PipelinePage() {
  const [board, setBoard] = useState<BoardState | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [viewStage, setViewStage] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;

  const refresh = useCallback(async () => {
    const state = await call<BoardState>("/api/state");
    if (isUnauthorized(state)) {
      setNeedsAuth(true);
      return;
    }
    setNeedsAuth(false);
    setBoard(state);
    const id = selectedRef.current;
    if (id) {
      const query = viewStage ? `?stage=${viewStage}` : "";
      const d = await call<Detail>(`/api/tasks/${id}${query}`);
      if (!isUnauthorized(d)) setDetail(d);
    }
  }, [viewStage]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!busy) void refresh();
    }, 2500);
    return () => clearInterval(timer);
  }, [refresh, busy]);

  const start = async () => {
    if (!title.trim()) return;
    const created = await call<{ id: string }>("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: title.trim() }),
    });
    setTitle("");
    if (!isUnauthorized(created)) {
      setSelected(created.id);
      setViewStage(null);
    }
    void refresh();
  };

  const decide = async (decision: string, feedback?: string) => {
    if (!selected || busy) return;
    setBusy(true);
    const res = await call<{ error?: string }>(`/api/tasks/${selected}/gate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, feedback }),
    });
    setBusy(false);
    setViewStage(null);
    if (!isUnauthorized(res) && res.error) window.alert(res.error);
    void refresh();
  };

  if (needsAuth) return <SignIn onDone={() => void refresh()} />;
  if (!board)
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm">
        <Spinner /> Loading pipeline…
      </div>
    );

  const columns = [
    ...board.stages.map((stage) => ({
      key: stage.name,
      tasks: board.tasks.filter((t) => t.stage === stage.name && t.state !== "done"),
    })),
    { key: "shipped", tasks: board.tasks.filter((t) => t.state === "done") },
  ];
  const atGate = detail?.task.state === "awaiting_gate" && detail.view === detail.task.stage;

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-auto p-4">
        <div className="mb-4 flex max-w-2xl gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void start();
            }}
            placeholder="What do you want to build?"
            className="border-input bg-popover focus-visible:border-primary h-9 flex-1 rounded-md border px-3 text-sm outline-none"
          />
          <Button onClick={() => void start()}>Start</Button>
        </div>

        <div className="flex gap-3">
          {columns.map((column) => (
            <div key={column.key} className="min-w-0 flex-1">
              <div className="mb-2 flex items-baseline gap-2 px-1">
                <span className="text-muted-foreground text-[10px] font-semibold tracking-[0.08em] uppercase">
                  {column.key}
                </span>
                <span className="text-muted-foreground/60 font-mono text-[10px]">
                  {column.tasks.length || ""}
                </span>
              </div>
              {column.tasks.map((task) => (
                <button
                  key={task.id}
                  onClick={() => {
                    setSelected(task.id);
                    setViewStage(null);
                  }}
                  className={`bg-popover mb-2 w-full rounded-md border p-3 text-left transition-colors ${
                    selected === task.id ? "border-primary" : "border-border hover:border-input"
                  }`}
                >
                  <span className="text-foreground line-clamp-2 text-[13px] font-medium">
                    {task.title}
                  </span>
                  <Rail stages={board.stages} task={task} />
                  <span className="mt-2 flex">
                    <StatePill task={task} />
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      <aside className="bg-popover w-[440px] shrink-0 overflow-auto border-l p-4">
        {!detail ? (
          <p className="text-muted-foreground py-16 text-center text-sm">
            Select a task to review it
          </p>
        ) : (
          <>
            <h2 className="text-foreground text-[15px] font-semibold">{detail.task.title}</h2>
            <div className="mt-2 mb-3 flex items-center gap-2">
              <StatePill task={detail.task} />
              {detail.task.attempt > 1 ? (
                <span className="text-muted-foreground font-mono text-[10px]">
                  attempt {detail.task.attempt}
                </span>
              ) : null}
            </div>

            {detail.task.error ? (
              <p className="border-warning/32 bg-warning-surface text-warning-foreground mb-3 rounded-md border px-3 py-2 text-xs">
                {detail.task.error}
              </p>
            ) : null}

            <div className="mb-3 flex gap-1 border-b">
              {detail.stages.map((stage) => (
                <button
                  key={stage.name}
                  disabled={!stage.hasArtifact}
                  onClick={() => setViewStage(stage.name)}
                  className={`flex items-center gap-1 border-b-2 px-2 py-1.5 font-mono text-[11px] transition-colors ${
                    stage.name === detail.view
                      ? "border-primary text-foreground"
                      : "text-muted-foreground border-transparent"
                  } ${stage.hasArtifact ? "hover:text-foreground" : "opacity-40"}`}
                >
                  {stage.decision === "approve" ? (
                    <CheckIcon className="size-3" />
                  ) : stage.current ? (
                    <CircleDotIcon className="size-3" />
                  ) : null}
                  {stage.name}
                </button>
              ))}
            </div>

            {detail.artifact ? (
              detail.artifact.kind === "html" ? (
                <>
                  <iframe
                    title="mockup"
                    sandbox="allow-scripts"
                    src={`${API}/api/tasks/${detail.task.id}/artifact?stage=${detail.view}&version=${detail.artifact.version}`}
                    className="h-[46vh] w-full rounded-md border bg-white"
                  />
                  <a
                    href={`${API}/api/tasks/${detail.task.id}/artifact?stage=${detail.view}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground hover:text-foreground mt-1 inline-flex items-center gap-1 font-mono text-[11px]"
                  >
                    <ExternalLinkIcon className="size-3" /> open full size
                  </a>
                </>
              ) : (
                <div className="bg-background max-h-[46vh] overflow-auto rounded-md border p-3">
                  {markdown(detail.artifact.content)}
                </div>
              )
            ) : (
              <p className="text-muted-foreground bg-background rounded-md border py-10 text-center text-sm">
                {detail.task.running ? "Agent is working…" : "Nothing produced yet"}
              </p>
            )}

            {atGate ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button onClick={() => void decide("approve")} disabled={busy}>
                  Approve
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    const feedback = window.prompt("What should change?");
                    if (feedback?.trim()) void decide("revise", feedback);
                  }}
                >
                  Revise
                </Button>
              </div>
            ) : null}

            {detail.task.state === "failed" ? (
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => {
                  void call(`/api/tasks/${detail.task.id}/retry`, { method: "POST" }).then(refresh);
                }}
              >
                <RotateCwIcon /> Retry stage
              </Button>
            ) : null}

            <details className="mt-4">
              <summary className="text-muted-foreground cursor-pointer font-mono text-[11px]">
                Agent log
              </summary>
              <pre className="text-muted-foreground bg-background mt-2 max-h-56 overflow-auto rounded-md border p-2 font-mono text-[10px] whitespace-pre-wrap">
                {detail.log?.slice(-6000) || "(empty)"}
              </pre>
            </details>
          </>
        )}
      </aside>
    </div>
  );
}

export const Route = createFileRoute("/_chat/pipeline")({
  component: PipelinePage,
});
