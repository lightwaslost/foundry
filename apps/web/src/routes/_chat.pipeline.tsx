import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BellIcon, MessageSquareIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Label } from "~/components/ui/label";
import { Dialog, DialogPopup } from "~/components/ui/dialog";
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
  BUSY,
  call,
  del,
  initials,
  NEEDS_HUMAN,
  patch,
  post,
  toneOf,
  unauthorized,
  type Detail,
  type Draft,
  type DraftView,
  type Catalogue,
  type Repo,
  type Task,
  type User,
} from "~/components/pipeline/api";
import { Docs } from "~/components/pipeline/Docs";
import { NewTask } from "~/components/pipeline/NewTask";
import { StageManager } from "~/components/pipeline/StageManager";
import { TaskCard } from "~/components/pipeline/TaskCard";
import { AiraaLoader } from "~/components/pipeline/AiraaLoader";
import { GithubIdentity } from "~/components/pipeline/GithubIdentity";
import { PreviewPanelShell } from "~/components/preview/PreviewPanelShell";
import { ServerMonitor } from "~/components/pipeline/ServerMonitor";
import { TaskDetail } from "~/components/pipeline/TaskDetail";

/**
 * Foundry, as a page inside T3.
 *
 * The board is the whole product surface: tasks move left to right through the
 * stages of their pipeline, and the only thing competing for attention is what is
 * waiting on a person. T3 owns the agent sessions; Foundry (proxied same-origin
 * under /foundry-api) owns tasks, runs, artifacts, questions and gates.
 */
type Tab = "board" | "stages" | "docs" | "monitor";

const TAB_LABEL: Record<Tab, string> = {
  board: "Board",
  stages: "Stages",
  docs: "How it works",
  monitor: "Server monitor",
};

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
        <div className="absolute right-0 z-50 mt-1 max-h-[70vh] w-76 overflow-y-auto rounded-xl border border-border/60 bg-popover p-3 shadow-lg">
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
          <GithubIdentity />
          <Button
            size="xs"
            variant="ghost-muted"
            className="mt-3 w-full"
            onClick={() => void post("/api/auth/logout").then(onSignedOut)}
          >
            Sign out
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function PipelinePage() {
  const [needsAuth, setNeedsAuth] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>("board");
  const [me, setMe] = useState<User | null>(null);
  const [catalogue, setCatalogue] = useState<Catalogue>({
    stages: [],
    version: 0,
    updated_by: null,
    updated_at: null,
  });
  const [skills, setSkills] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [details, setDetails] = useState<Record<string, Detail>>({});
  const { task: taskFromUrl } = Route.useSearch();
  const [selected, setSelected] = useState<string | null>(taskFromUrl ?? null);
  const [maximized, setMaximized] = useState(false);
  const [composing, setComposing] = useState(false);
  // Conversations that have not become tasks yet. They become tasks on their own:
  // the agent's proposal IS the submit, so there is nothing to confirm here.
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [envId, setEnvId] = useState<string | null>(null);
  // Router navigation rather than a hand-built URL: the path is checked against the
  // generated route tree, so a wrong one is a compile error rather than a 404 page —
  // which is how it was wrong twice. It is also a client-side move, so no full reload
  // can hand you a stale bundle in the middle of the handoff.
  const navigate = useNavigate();
  const goToThread = (threadId: string | null | undefined) => {
    if (!envId || !threadId) return;
    void navigate({ to: "/$environmentId/$threadId", params: { environmentId: envId, threadId } });
  };
  const [now, setNow] = useState(() => Date.now());
  const [query, setQuery] = useState("");
  const [filterAssignee, setFilterAssignee] = useState<string | null>(null);
  const [filterRepo, setFilterRepo] = useState<string | null>(null);
  const [dragTask, setDragTask] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  const composerDirty = useRef(false);
  /** One way out of the composer, whichever of its three faces you were looking at. */
  const closeComposer = () => {
    composerDirty.current = false;
    setComposing(false);
  };

  /** A draft only ever lives in its thread — that is where the conversation is. */
  const openDraft = async (id: string) => {
    const r = await call<DraftView>(`/api/drafts/${id}`);
    if (unauthorized(r)) return;
    goToThread(r.draft.thread_id);
  };

  const selRef = useRef<string | null>(null);
  selRef.current = selected;

  // The sheet used to close itself on Escape; an inline panel has to do it.
  // Ignored while a dialog or menu is open — those close themselves first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("[role=dialog],[role=menu],[role=listbox]")) return;
      if (selRef.current === null) return;
      e.preventDefault();
      setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
    const [p, r, u, t, m, d] = await Promise.all([
      call<Catalogue & { skills: string[] }>("/api/stages"),
      call<{ repos: Repo[] }>("/api/repos"),
      call<{ users: User[] }>("/api/users"),
      call<{ tasks: Task[] }>("/api/tasks"),
      call<{ models: string[] }>("/api/models"),
      call<{ drafts: Draft[] }>("/api/drafts"),
    ]);
    if (!unauthorized(d)) setDrafts(d.drafts);
    if (!unauthorized(p)) {
      setCatalogue({
        // An older backend answers /api/stages with a 404 body, not a catalogue.
        // Guarded here rather than at each reader: the board, the New Task ticks
        // and the Stages tab all map over this, and one of them white-screened
        // production when the two repos deployed out of step.
        stages: Array.isArray(p.stages) ? p.stages : [],
        version: p.version,
        updated_by: p.updated_by,
        updated_at: p.updated_at,
      });
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

  /** Dropping a card moves the task. It never starts anything — Start does that. */
  const move = useCallback(
    async (taskId: string, stage: string) => {
      const before = tasks;
      setMoveError(null);
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                stage: stage === "shipped" ? t.stage : stage,
                state: stage === "shipped" ? ("done" as const) : ("open" as const),
              }
            : t,
        ),
      );
      const r = await patch<{ error?: string }>(`/api/tasks/${taskId}/stage`, { stage });
      if (unauthorized(r)) return;
      if (r.error) {
        setTasks(before); // the server refused; put it back where it was
        setMoveError(r.error);
        return;
      }
      void refresh();
    },
    [tasks, refresh],
  );

  const stageNames = useMemo(() => catalogue.stages.map((s) => s.name), [catalogue.stages]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter(
      (t) =>
        (!q || t.title.toLowerCase().includes(q) || t.ticket.toLowerCase().includes(q)) &&
        (!filterAssignee || t.assignee_id === filterAssignee) &&
        (!filterRepo || t.repo_id === filterRepo),
    );
  }, [tasks, query, filterAssignee, filterRepo]);

  const columns = useMemo(() => {
    const open = visible.filter((t) => t.state === "open");
    return [
      ...stageNames.map((name) => ({ key: name, tasks: open.filter((t) => t.stage === name) })),
      { key: "shipped", tasks: visible.filter((t) => t.state === "done") },
    ];
  }, [visible, stageNames]);
  const filtered = visible.length !== tasks.length;

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
          <WorkspaceBreadcrumbItem>{TAB_LABEL[tab]}</WorkspaceBreadcrumbItem>
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
            {(["board", "stages", "docs", "monitor"] as const).map((t) => (
              <Button
                key={t}
                size="xs"
                variant={tab === t ? "secondary" : "ghost-muted"}
                onClick={() => setTab(t)}
              >
                {TAB_LABEL[t]}
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
          {/* Maximizing the reader takes the board's width entirely, the way T3's
              own right panel does — the column goes to zero rather than fighting
              the panel for flex space. */}
          <div
            className={cn(
              "flex min-h-0 min-w-0 flex-col overflow-hidden",
              maximized && task ? "w-0 flex-none" : "flex-1",
            )}
          >
            <div className="flex flex-wrap items-center gap-2 px-5 pt-1 pb-3">
              <Button size="sm" onClick={() => setComposing((v) => !v)}>
                <PlusIcon /> New task
              </Button>
              {/* Conversations that have not become tasks yet. Nothing else on the
                  board points at them, so a draft you navigated away from would
                  otherwise be findable only by its thread URL. */}
              {drafts
                .filter((d) => !d.ticket)
                .map((d) => (
                  <span
                    key={d.id}
                    className="inline-flex max-w-64 items-center gap-1 rounded-md border border-dashed border-border/70 pr-1 text-[12px] text-muted-foreground"
                  >
                    <button
                      type="button"
                      onClick={() => void openDraft(d.id)}
                      title="Draft — open the conversation, or confirm what it proposed"
                      className="inline-flex min-w-0 items-center gap-1.5 rounded-l-md py-1 pl-2 hover:text-foreground"
                    >
                      <MessageSquareIcon aria-hidden className="size-3.5 shrink-0" />
                      <span className="truncate">{d.title}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Discard draft ${d.title}`}
                      title="Discard — a draft holds no ticket and no branch"
                      onClick={() => {
                        if (!window.confirm(`Discard "${d.title}"? The conversation goes with it.`))
                          return;
                        void del(`/api/drafts/${d.id}`).then(() => refresh());
                      }}
                      className="shrink-0 rounded p-0.5 hover:text-foreground"
                    >
                      <XIcon aria-hidden className="size-3" />
                    </button>
                  </span>
                ))}
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  size="sm"
                  value={query}
                  placeholder="Search"
                  onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
                  className="w-40 pl-7"
                />
              </div>
              <Button
                size="xs"
                variant={filterAssignee ? "secondary" : "ghost-muted"}
                onClick={() => setFilterAssignee(filterAssignee ? null : (me?.id ?? null))}
              >
                Mine
              </Button>
              {repos.length > 1 ? (
                <Select
                  value={filterRepo ?? "__all"}
                  onValueChange={(v) => setFilterRepo(v === "__all" ? null : String(v))}
                >
                  <SelectTrigger size="sm" aria-label="Filter by repository" className="w-44">
                    <SelectValue>
                      {repos.find((r) => r.id === filterRepo)?.name ?? "All repositories"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup alignItemWithTrigger={false}>
                    <SelectItem value="__all">All repositories</SelectItem>
                    {repos.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              ) : null}
              {filtered ? (
                <Button
                  size="xs"
                  variant="ghost-muted"
                  onClick={() => {
                    setQuery("");
                    setFilterAssignee(null);
                    setFilterRepo(null);
                  }}
                >
                  <XIcon /> Clear
                </Button>
              ) : null}
              <span className="text-[11px] text-muted-foreground">
                {visible.filter((t) => t.state === "open").length} open ·{" "}
                {visible.filter((t) => t.state === "done").length} shipped
                {filtered ? ` · ${tasks.length - visible.length} hidden` : ""}
              </span>
              {moveError ? (
                <span className="text-[11px] text-destructive-foreground">{moveError}</span>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 scrollbar-none">
              {!loaded ? (
                <AiraaLoader className="py-16" label="Loading the board" />
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
                <div className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-2 scrollbar-none [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]">
                  {columns.map((col) => (
                    <div
                      key={col.key}
                      onDragOver={(e) => {
                        if (!dragTask) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        setDropTarget(col.key);
                      }}
                      onDragLeave={() => setDropTarget((d) => (d === col.key ? null : d))}
                      onDrop={(e) => {
                        e.preventDefault();
                        const id = e.dataTransfer.getData("text/plain") || dragTask;
                        setDropTarget(null);
                        setDragTask(null);
                        if (id) void move(id, col.key);
                      }}
                      className={cn(
                        "w-[200px] shrink-0 space-y-2 rounded-xl xl:w-[228px]",
                        dropTarget === col.key &&
                          "bg-primary/6 outline-2 outline-dashed outline-primary/40",
                      )}
                    >
                      <div className="flex items-baseline gap-1.5 px-0.5">
                        <span className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                          {col.key}
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground/60">
                          {col.tasks.length || ""}
                        </span>
                      </div>
                      {col.tasks.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-border/50 px-3 py-4 text-center text-[11px] text-muted-foreground/50">
                          {dragTask ? "drop here" : "nothing here"}
                        </div>
                      ) : null}
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
                          movable={!runsOf(t.id).some((r) => BUSY.has(r.state))}
                          dragging={dragTask === t.id}
                          onDragStart={() => setDragTask(t.id)}
                          onDragEnd={() => {
                            setDragTask(null);
                            setDropTarget(null);
                          }}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* A document is the deliverable of most stages, so the panel that reads
              them is sized like T3's own diff and file panels — an inline column
              you can drag wider and maximize — not a fixed 600px sheet. */}
          {task ? (
            <PreviewPanelShell
              mode="inline"
              maximized={maximized}
              widthStorageKey="foundry:task-panel-width"
              defaultWidth={
                typeof window === "undefined" ? 720 : Math.floor(window.innerWidth * 0.52)
              }
            >
              <TaskDetail
                task={task}
                detail={details[task.id] ?? null}
                repos={repos}
                users={users}
                envId={envId}
                now={now}
                maximized={maximized}
                onToggleMaximized={() => setMaximized((v) => !v)}
                onClose={() => setSelected(null)}
                onChanged={() => void refresh()}
                onMove={(stage) => void move(task.id, stage)}
              />
            </PreviewPanelShell>
          ) : null}
        </div>
      ) : tab === "monitor" ? (
        <ServerMonitor />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <WorkspacePageContainer width="wide">
            {tab === "stages" ? (
              <StageManager
                catalogue={catalogue}
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
      <Dialog
        open={composing}
        onOpenChange={(open) => {
          // Escape, the backdrop and the close button all land here; the composer
          // owns the "you have typed something" question, so ask it once, here.
          if (
            !open &&
            composerDirty.current &&
            !window.confirm("Discard this task? What you have typed will be lost.")
          )
            return;
          if (!open) closeComposer();
          else setComposing(open);
        }}
      >
        <DialogPopup className="max-w-4xl p-0" aria-label="New task">
          <NewTask
            onTalk={async (title, repoId, assigneeId, files) => {
              const r = await post<{ draft?: Draft; error?: string }>("/api/drafts", {
                title,
                repo_id: repoId,
                assignee_id: assigneeId,
              });
              if (unauthorized(r)) return "your session expired — sign in again";
              if (r.error || !r.draft) return r.error ?? "could not start the conversation";
              const id = r.draft.id;
              // Files go up before the thread opens, so the agent has them on turn one.
              for (const f of files) {
                const bytes = new Uint8Array(await f.arrayBuffer());
                let bin = "";
                for (const b of bytes) bin += String.fromCharCode(b);
                const up = await post<{ error?: string }>(`/api/drafts/${id}/attachments`, {
                  filename: f.name,
                  data_base64: btoa(bin),
                });
                if (!unauthorized(up) && up.error) return `${f.name}: ${up.error}`;
              }
              const started = await post<{ draft?: Draft; error?: string }>(
                `/api/drafts/${id}/start`,
              );
              if (unauthorized(started)) return "your session expired — sign in again";
              if (started.error || !started.draft?.thread_id)
                return started.error ?? "could not open the conversation";
              composerDirty.current = false;
              closeComposer();
              goToThread(started.draft.thread_id);
              return null;
            }}
            catalogue={catalogue}
            repos={repos}
            users={users}
            me={me}
            onDirtyChange={(d) => {
              composerDirty.current = d;
            }}
            onCancel={closeComposer}
            onCreated={(id) => {
              closeComposer();
              setSelected(id);
              void refresh();
            }}
          />
        </DialogPopup>
      </Dialog>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/pipeline")({
  // `?task=<id>` opens that task's panel. Links to a task were already being
  // shared — and silently landing on the board with nothing selected, because
  // nothing read the parameter.
  // The key is omitted rather than set to undefined, so every other link to
  // /pipeline stays valid without passing a search object.
  validateSearch: (raw: Record<string, unknown>): { task?: string } =>
    typeof raw.task === "string" ? { task: raw.task } : {},
  component: PipelinePage,
});

export { toneOf };
