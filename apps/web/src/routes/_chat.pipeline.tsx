import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BellIcon, PlusIcon } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { SidebarInset } from "~/components/ui/sidebar";
import { Spinner } from "~/components/ui/spinner";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "~/components/WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "~/components/WorkspacePageContainer";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { isElectron } from "~/env";
import { cn } from "~/lib/utils";

import {
  ago,
  call,
  initials,
  NEEDS_HUMAN,
  post,
  toneOf,
  unauthorized,
  type Detail,
  type PipelineDef,
  type Repo,
  type Run,
  type Task,
  type User,
} from "~/components/pipeline/api";
import { Docs } from "~/components/pipeline/Docs";
import { NewTask } from "~/components/pipeline/NewTask";
import { PipelineSettings } from "~/components/pipeline/PipelineSettings";
import { Spine } from "~/components/pipeline/Spine";
import { StateBadge } from "~/components/pipeline/StateBadge";
import { TaskDetail } from "~/components/pipeline/TaskDetail";

/**
 * Foundry, as a page inside T3.
 *
 * The board is the whole product surface: tasks move left to right through the
 * stages of their pipeline, and the only thing competing for attention is what is
 * waiting on a person. T3 owns the agent sessions; Foundry (proxied same-origin
 * under /foundry-api) owns tasks, runs, artifacts, questions and gates.
 */
type Tab = "board" | "pipelines" | "docs";

function SignIn({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await post<{ error?: string }>("/api/auth/login", { email, password });
    setBusy(false);
    if (unauthorized(r) || (!unauthorized(r) && r.error))
      return setError("That email and password did not match.");
    onDone();
  };

  return (
    <div className="flex h-full items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-72 space-y-3">
        <div className="space-y-1">
          <h2 className="text-sm font-medium text-foreground">Sign in to Foundry</h2>
          <p className="text-[13px] text-muted-foreground">
            Your own account. The session lasts 30 days.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fnd-email">Email</Label>
          <Input
            id="fnd-email"
            type="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
            placeholder="you@rapidnode.xyz"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fnd-password">Password</Label>
          <Input
            id="fnd-password"
            type="password"
            value={password}
            onChange={(e) => setPassword((e.target as HTMLInputElement).value)}
          />
        </div>
        {error ? <p className="text-xs text-destructive-foreground">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? <Spinner /> : null}Continue
        </Button>
      </form>
    </div>
  );
}

function AccountMenu({ me, onSignedOut }: { me: User; onSignedOut: () => void }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const change = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    const r = await post<{ error?: string }>("/api/auth/password", {
      current_password: current,
      new_password: next,
    });
    setBusy(false);
    if (unauthorized(r)) return;
    if (r.error) return setErr(r.error);
    setCurrent("");
    setNext("");
    setMsg("Changed. Your other devices were signed out.");
  };

  return (
    <div className="relative">
      <Button size="xs" variant="ghost-muted" onClick={() => setOpen((v) => !v)}>
        <span className="grid size-4 place-items-center rounded-full bg-secondary text-[9px] font-medium text-secondary-foreground">
          {initials(me.name)}
        </span>
        {me.name}
      </Button>
      {open ? (
        <div className="absolute right-0 z-50 mt-1 w-68 rounded-xl border border-border/60 bg-popover p-3 shadow-lg">
          <p className="font-mono text-[11px] text-muted-foreground">{me.email}</p>
          <p className="mt-0.5 mb-2 text-[11px] text-muted-foreground">Signed in as {me.role}.</p>
          <div className="space-y-1.5">
            <Input
              size="sm"
              type="password"
              placeholder="Current password"
              value={current}
              onChange={(e) => setCurrent((e.target as HTMLInputElement).value)}
            />
            <Input
              size="sm"
              type="password"
              placeholder="New password (8+ characters)"
              value={next}
              onChange={(e) => setNext((e.target as HTMLInputElement).value)}
            />
            <Button
              size="xs"
              className="w-full"
              onClick={() => void change()}
              disabled={busy || !current || next.length < 8}
            >
              {busy ? <Spinner /> : null}Change password
            </Button>
          </div>
          {msg ? <p className="mt-2 text-[11px] text-success-foreground">{msg}</p> : null}
          {err ? <p className="mt-2 text-[11px] text-destructive-foreground">{err}</p> : null}
          <Button
            size="xs"
            variant="ghost-muted"
            className="mt-2 w-full"
            onClick={() => void post("/api/auth/logout").then(onSignedOut)}
          >
            Sign out
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function TaskCard({
  task,
  runs,
  users,
  selected,
  waiting,
  onSelect,
  now,
}: {
  task: Task;
  runs: Run[];
  users: User[];
  selected: boolean;
  waiting: Run | undefined;
  onSelect: () => void;
  now: number;
}) {
  const assignee = users.find((u) => u.id === task.assignee_id);
  const current = runs.at(-1);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group relative w-full rounded-xl border bg-card/40 px-3 py-2.5 text-left transition-colors",
        selected
          ? "border-primary/60 bg-card/70"
          : "border-border/60 hover:border-border hover:bg-card/60",
        waiting && "border-warning/40",
      )}
    >
      {waiting ? (
        <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-warning" />
      ) : null}
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 text-[13px] leading-snug font-medium text-foreground">
          {task.title}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {task.ticket.replace("FND-", "")}
        </span>
      </div>
      <Spine className="mt-2" stages={task.pipeline_snapshot} runs={runs} taskState={task.state} />
      <div className="mt-2 flex items-center gap-1.5">
        {waiting ? (
          <StateBadge state={waiting.state} />
        ) : current && task.state === "open" ? (
          <StateBadge state={current.state} />
        ) : (
          <Badge variant="outline" size="sm" className="font-mono">
            {task.pipeline}
          </Badge>
        )}
        {assignee ? (
          <span
            title={assignee.name}
            className="ml-auto grid size-4 shrink-0 place-items-center rounded-full bg-secondary text-[9px] font-medium text-secondary-foreground"
          >
            {initials(assignee.name)}
          </span>
        ) : (
          <span className="ml-auto text-[10px] text-muted-foreground/70">
            {ago(task.created_at, now)}
          </span>
        )}
      </div>
    </button>
  );
}

function PipelinePage() {
  const [needsAuth, setNeedsAuth] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>("board");
  const [me, setMe] = useState<User | null>(null);
  const [pipelines, setPipelines] = useState<PipelineDef[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [details, setDetails] = useState<Record<string, Detail>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [envId, setEnvId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const selRef = useRef<string | null>(null);
  selRef.current = selected;

  // A clock, so elapsed times move without refetching anything.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // T3's environment id, for deep links into the agent thread of a stage.
  useEffect(() => {
    void fetch("/.well-known/t3/environment", { credentials: "include" })
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
      setLoaded(true);
      return;
    }
    setNeedsAuth(false);
    setMe(meRes.user);
    const [p, r, u, t, m] = await Promise.all([
      call<{ pipelines: PipelineDef[]; skills: string[] }>("/api/pipelines"),
      call<{ repos: Repo[] }>("/api/repos"),
      call<{ users: User[] }>("/api/users"),
      call<{ tasks: Task[] }>("/api/tasks"),
      call<{ models: string[] }>("/api/models"),
    ]);
    if (!unauthorized(p)) {
      setPipelines(p.pipelines);
      setSkills(p.skills ?? []);
    }
    if (!unauthorized(r)) setRepos(r.repos);
    if (!unauthorized(u)) setUsers(u.users);
    if (!unauthorized(m)) setModels(m.models);
    if (!unauthorized(t)) {
      setTasks(t.tasks);
      // Runs for every open task: the board's state badges and spines come from
      // these, and there are only ever a handful of live tasks.
      const live = t.tasks.filter((x) => x.state === "open").slice(0, 40);
      const sel = selRef.current;
      const wanted = new Set(live.map((x) => x.id));
      if (sel) wanted.add(sel);
      const fetched = await Promise.all(
        [...wanted].map(async (id) => [id, await call<Detail>(`/api/tasks/${id}/runs`)] as const),
      );
      setDetails(
        Object.fromEntries(
          fetched.filter(([, d]) => !unauthorized(d)).map(([id, d]) => [id, d as Detail]),
        ),
      );
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const runsOf = useCallback((id: string) => details[id]?.runs ?? [], [details]);
  const waitingRun = useCallback(
    (id: string) => runsOf(id).find((r) => NEEDS_HUMAN.has(r.state)),
    [runsOf],
  );

  const waiting = useMemo(
    () => tasks.filter((t) => t.state === "open" && waitingRun(t.id)),
    [tasks, waitingRun],
  );
  const mine = useMemo(() => waiting.filter((t) => t.assignee_id === me?.id), [waiting, me]);

  const stageNames = useMemo(() => {
    const longest = pipelines.reduce<PipelineDef | null>(
      (acc, p) => (!acc || p.stages.length > acc.stages.length ? p : acc),
      null,
    );
    return longest?.stages.map((s) => s.name) ?? ["one-pager", "mockup", "prd", "build"];
  }, [pipelines]);

  const columns = useMemo(() => {
    const open = tasks.filter((t) => t.state === "open");
    return [
      ...stageNames.map((name) => ({ key: name, tasks: open.filter((t) => t.stage === name) })),
      { key: "shipped", tasks: tasks.filter((t) => t.state === "done") },
    ];
  }, [tasks, stageNames]);

  const task = tasks.find((t) => t.id === selected) ?? null;

  if (needsAuth) {
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
        <SignIn onDone={() => void refresh()} />
      </SidebarInset>
    );
  }

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <WorkspacePageHeader electron={isElectron}>
        <WorkspaceBreadcrumb ariaLabel="Foundry">
          <WorkspaceBreadcrumbItem>Foundry</WorkspaceBreadcrumbItem>
          <WorkspaceBreadcrumbSeparator />
          <WorkspaceBreadcrumbItem>
            {tab === "board" ? "Board" : tab === "pipelines" ? "Pipelines" : "How it works"}
          </WorkspaceBreadcrumbItem>
        </WorkspaceBreadcrumb>

        <div className="ml-auto flex items-center gap-1.5">
          {waiting.length > 0 ? (
            <Button
              size="xs"
              variant={mine.length > 0 ? "warning-outline" : "ghost-muted"}
              onClick={() => {
                setTab("board");
                setSelected((mine[0] ?? waiting[0])!.id);
              }}
            >
              <BellIcon />
              {mine.length > 0
                ? `${mine.length} waiting on you`
                : `${waiting.length} waiting on someone`}
            </Button>
          ) : null}
          <div className="flex items-center rounded-lg border border-border/60 p-0.5">
            {(["board", "pipelines", "docs"] as const).map((t) => (
              <Button
                key={t}
                size="xs"
                variant={tab === t ? "secondary" : "ghost-muted"}
                onClick={() => setTab(t)}
              >
                {t === "board" ? "Board" : t === "pipelines" ? "Pipelines" : "How it works"}
              </Button>
            ))}
          </div>
          {me ? (
            <AccountMenu
              me={me}
              onSignedOut={() => {
                setMe(null);
                setNeedsAuth(true);
              }}
            />
          ) : null}
        </div>
      </WorkspacePageHeader>

      {tab === "board" ? (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex items-center gap-2 px-5 pt-1 pb-3">
              <Button size="sm" onClick={() => setComposing((v) => !v)}>
                <PlusIcon /> New task
              </Button>
              <span className="text-[11px] text-muted-foreground">
                {tasks.filter((t) => t.state === "open").length} open ·{" "}
                {tasks.filter((t) => t.state === "done").length} shipped
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-5 pb-6">
              {composing ? (
                <div className="mb-4">
                  <NewTask
                    pipelines={pipelines}
                    repos={repos}
                    users={users}
                    skills={skills}
                    models={models}
                    me={me}
                    onCancel={() => setComposing(false)}
                    onCreated={(id) => {
                      setComposing(false);
                      setSelected(id);
                      void refresh();
                    }}
                  />
                </div>
              ) : null}

              {!loaded ? (
                <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>
              ) : tasks.length === 0 ? (
                <div className="mx-auto max-w-md py-16 text-center">
                  <h2 className="text-sm font-medium text-foreground">
                    Nothing in the pipeline yet
                  </h2>
                  <p className="mt-1 text-[13px] leading-[1.5] text-muted-foreground">
                    Create a task and an agent will write the one-pager. It will ask you anything it
                    needs before it starts.
                  </p>
                </div>
              ) : (
                <div className="flex gap-2.5">
                  {columns.map((col) => (
                    <div key={col.key} className="min-w-[142px] flex-1 space-y-2">
                      <div className="flex items-baseline gap-1.5 px-0.5">
                        <span className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                          {col.key}
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground/60">
                          {col.tasks.length || ""}
                        </span>
                      </div>
                      {col.tasks.map((t) => (
                        <TaskCard
                          key={t.id}
                          task={t}
                          runs={runsOf(t.id)}
                          users={users}
                          selected={selected === t.id}
                          waiting={waitingRun(t.id)}
                          onSelect={() => setSelected(t.id)}
                          now={now}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <aside className="hidden w-[440px] shrink-0 border-l border-border/50 bg-card/20 lg:block xl:w-[520px]">
            {task ? (
              <TaskDetail
                task={task}
                detail={details[task.id] ?? null}
                repo={repos.find((r) => r.id === task.repo_id)}
                users={users}
                envId={envId}
                now={now}
                onChanged={() => void refresh()}
              />
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center">
                <p className="max-w-56 text-[13px] leading-[1.5] text-muted-foreground">
                  Pick a task to see its stages, read what the agents wrote, and answer anything
                  they need.
                </p>
              </div>
            )}
          </aside>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <WorkspacePageContainer width={tab === "docs" ? "readable" : "wide"}>
            {tab === "pipelines" ? (
              <PipelineSettings
                pipelines={pipelines}
                skills={skills}
                models={models}
                users={users}
                canEdit={me?.role === "admin"}
                onSaved={() => void refresh()}
                now={now}
              />
            ) : (
              <Docs />
            )}
          </WorkspacePageContainer>
        </div>
      )}
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/pipeline")({ component: PipelinePage });

export { toneOf };
