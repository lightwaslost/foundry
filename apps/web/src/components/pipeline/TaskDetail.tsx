import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import {
  ActivityIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  FileTextIcon,
  ImageIcon,
  Maximize2Icon,
  Minimize2Icon,
  GitBranchIcon,
  GitPullRequestIcon,
  PlayIcon,
  RotateCwIcon,
  XIcon,
} from "lucide-react";
import { useResizableWidth } from "~/hooks/useResizableWidth";
import { RightPanelResizeHandle } from "~/components/preview/RightPanelResizeHandle";
import { cn } from "~/lib/utils";
import {
  BUSY,
  NEEDS_HUMAN,
  PARK_REASON,
  STATE_LABEL,
  activeMs,
  ago,
  bannerFor,
  duration,
  initials,
  post,
  taskPrs,
  toneOf,
  type ArtifactMeta,
  type Detail,
  type GateRow,
  type Repo,
  type Run,
  type Task,
  type TokenNotice,
  type User,
  unauthorized,
  type CodeEvent,
  type CodeInfo,
  describeCodeEvent,
} from "./api";
import { ArtifactViewer, DiffView } from "./Artifact";
import { ConversationPanel } from "./Conversation";
import { GatePanel, QuestionsPanel } from "./HumanPanels";
import { ActiveTime, SEGMENT_TONE, Spine } from "./Spine";
import { NoteComposer, NotesList, useWorkspace } from "./Workspace";
import { StateBadge } from "./StateBadge";

/**
 * Everything about one task, in the order a person needs it.
 *
 * The order is the design. First what it is, in three lines that never wrap into
 * a paragraph. Then the one thing the task is waiting for, whether that is the
 * fourth attempt or the first — a reviewer should never scroll to find their own
 * to-do. Then the history, folded down to a row per run, because a stage that
 * finished two days ago has earned a line and not a card. Then the documents,
 * which are the actual output and used to exist only as buttons scattered
 * through the history. The box for a note is pinned to the foot throughout,
 * since "leave a note, then run" should not begin with a scroll.
 *
 * Dragged wide enough, the panel splits: the same column on the left, the
 * document being read on the right. Reading used to blank the task.
 */
const WIDE = 900;
/** Narrowest the reader may be dragged, and the least the column beside it keeps. */
const READER_MIN = 320;
const HISTORY_MIN = 380;
const READER_DEFAULT = 520;

export function TaskDetail({
  task,
  detail,
  repos,
  users,
  envId,
  onChanged,
  onMove,
  onClose,
  maximized,
  onToggleMaximized,
  now,
}: {
  task: Task;
  detail: Detail | null;
  repos: Repo[];
  users: User[];
  envId: string | null;
  onChanged: () => void;
  onMove: (stage: string) => void;
  onClose: () => void;
  maximized: boolean;
  onToggleMaximized: () => void;
  now: number;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<
    { kind: "artifact"; meta: ArtifactMeta } | { kind: "diff"; fromId: string; toId: string } | null
  >(null);

  // Two columns is a property of the panel, not the window: it is dragged and
  // maximized independently, so it measures itself.
  const root = useRef<HTMLDivElement>(null);
  const [panelWidth, setPanelWidth] = useState(0);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setPanelWidth(entries[0]?.contentRect.width ?? 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const wide = panelWidth >= WIDE;

  // The reader is dragged from its own edge, remembered separately from the
  // width of the whole panel so widening a mockup does not move the board.
  // Before the first measurement the cap is deliberately absent: the hook
  // clamps its initial state once, and a stored width squashed against a
  // zero-width container would never come back.
  const { width: readerWidth, handlers: readerHandlers } = useResizableWidth({
    storageKey: "foundry:task-reader-width",
    defaultWidth: READER_DEFAULT,
    minWidth: READER_MIN,
    maxWidth:
      panelWidth === 0 ? Number.MAX_SAFE_INTEGER : Math.max(READER_MIN, panelWidth - HISTORY_MIN),
    edge: "left",
  });

  const ws = useWorkspace(task.id, onChanged);
  const opened = useRef<string | null>(null);
  useEffect(() => {
    opened.current = null;
    setView(null);
    setError(null);
  }, [task.id]);

  const act = async (path: string, body?: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const r = await post<{ error?: string }>(path, body);
    setBusy(false);
    if (!unauthorized(r) && r.error) setError(r.error);
    onChanged();
  };

  const runs = detail?.runs ?? [];
  const artifacts = detail?.artifacts ?? [];
  const gates = detail?.gates ?? [];
  const versionsOf = (stage: string) =>
    artifacts.filter((a) => a.stage === stage).sort((a, b) => a.version - b.version);

  const focus = focusRun(runs);
  const focusArtifact = focus ? artifacts.find((a) => a.id === focus.artifact_id) : undefined;
  const nowZone = useRef<HTMLDivElement>(null);

  // Side by side the reader is already on screen, so a document waiting on a
  // decision opens itself. Once. Closing it has to mean closed.
  useEffect(() => {
    if (!wide || view || !focus || !focusArtifact) return;
    if (!NEEDS_HUMAN.has(focus.state) || opened.current === focusArtifact.id) return;
    opened.current = focusArtifact.id;
    setView({ kind: "artifact", meta: focusArtifact });
  }, [wide, view, focus, focusArtifact]);

  const reader = view ? (
    view.kind === "artifact" ? (
      <ArtifactViewer
        meta={view.meta}
        versions={versionsOf(view.meta.stage)}
        onPickVersion={(meta) => setView({ kind: "artifact", meta })}
        onDiff={(fromId, toId) => setView({ kind: "diff", fromId, toId })}
        onClose={() => setView(null)}
      />
    ) : (
      <DiffView fromId={view.fromId} toId={view.toId} onClose={() => setView(null)} />
    )
  ) : null;

  const body = (
    <div className="min-h-0 flex-1 space-y-4 overflow-auto px-4 py-3 scrollbar-none">
      {error ? (
        <p className="rounded-lg border border-destructive/32 bg-destructive/8 px-3 py-2 text-xs text-destructive-foreground">
          {error}
        </p>
      ) : null}

      {runs.length === 0 ? (
        <StartCard
          task={task}
          busy={busy}
          onStart={() => void act(`/api/tasks/${task.id}/start`)}
        />
      ) : (
        <>
          <CodeLine code={detail?.code} />
          <TokenNotices notices={detail?.notices ?? []} />
          {focus ? (
            <div ref={nowZone}>
              <NowZone
                // hasDraft lives in NowZone; without this a draft from the stage you
                // were just looking at would still be claimed for the next one.
                key={focus.id}
                run={focus}
                gate={gates.find((g) => g.stage_run_id === focus.id && !g.decided_at)}
                artifact={focusArtifact}
                versions={versionsOf(focus.stage)}
                envId={envId}
                busy={busy}
                now={now}
                onOpenArtifact={(meta) => setView({ kind: "artifact", meta })}
                onDiff={(fromId, toId) => setView({ kind: "diff", fromId, toId })}
                onRetry={() => void act(`/api/runs/${focus.id}/retry`)}
                canFix={(() => {
                  const st = task.pipeline_snapshot;
                  const at = st.findIndex((x) => x.name === focus.stage);
                  return st.slice(0, Math.max(at, 0)).some((x) => x.output.kind === "pull_request");
                })()}
                onBuildOld={() => void act(`/api/runs/${focus.id}/retry`, { update: false })}
                steps={(detail?.activity ?? []).filter((e) => e.stage_run_id === focus.id)}
                onCancel={() => void act(`/api/runs/${focus.id}/cancel`)}
                onChanged={onChanged}
              />
            </div>
          ) : null}

          {detail?.activity?.length ? (
            <Fold title="Code activity" count={`${detail.activity.length}`}>
              <ol className="space-y-1 px-3 py-2 text-[12px]">
                {detail.activity.map((e) => (
                  <li key={e.id} className="flex gap-2">
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                      {new Date(e.created_at).toLocaleString([], {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span className="text-foreground">{describeCodeEvent(e)}</span>
                  </li>
                ))}
              </ol>
            </Fold>
          ) : null}
          <Fold title="History" count={`${runs.length} ${runs.length === 1 ? "run" : "runs"}`}>
            <ol>
              {runs.map((run) => (
                <HistoryRow
                  key={run.id}
                  run={run}
                  artifact={artifacts.find((a) => a.id === run.artifact_id)}
                  versions={versionsOf(run.stage)}
                  envId={envId}
                  now={now}
                  focused={run.id === focus?.id}
                  onGoToNow={() => nowZone.current?.scrollIntoView({ block: "nearest" })}
                  onOpenArtifact={(meta) => setView({ kind: "artifact", meta })}
                  onDiff={(fromId, toId) => setView({ kind: "diff", fromId, toId })}
                />
              ))}
            </ol>
          </Fold>
        </>
      )}

      <Documents
        task={task}
        artifacts={artifacts}
        users={users}
        now={now}
        onOpen={(meta) => setView({ kind: "artifact", meta })}
        onDiff={(fromId, toId) => setView({ kind: "diff", fromId, toId })}
      />

      <Fold
        title="Notes"
        count={
          ws.comments.length + ws.files.length > 0
            ? String(ws.comments.length + ws.files.length)
            : undefined
        }
      >
        <NotesList ws={ws} now={now} />
      </Fold>
    </div>
  );

  return (
    <div ref={root} className="flex h-full min-h-0 flex-col">
      <Header
        task={task}
        runs={runs}
        focus={focus}
        repos={repos}
        users={users}
        now={now}
        onChanged={onChanged}
        maximized={maximized}
        onToggleMaximized={onToggleMaximized}
        onClose={onClose}
        onMove={onMove}
      />

      {reader && !wide ? (
        <div className="flex min-h-0 flex-1 flex-col">{reader}</div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 flex-1 flex-col">
            {body}
            <NoteComposer ws={ws} />
          </div>
          {wide ? (
            <div
              className="relative flex min-h-0 shrink-0 flex-col border-l border-border/50"
              style={{ width: readerWidth }}
            >
              <RightPanelResizeHandle handlers={readerHandlers} />
              {reader ?? <ReaderIdle />}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * The run the panel is about: the newest one stopped on a person, or failing
 * that whatever is still moving. A task where every run has finished is waiting
 * for nobody and gets no zone at all.
 */
function focusRun(runs: Run[]): Run | null {
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i]!;
    if (NEEDS_HUMAN.has(r.state)) return r;
  }
  const last = runs.at(-1);
  if (!last) return null;
  const finished = last.state === "done" || last.state === "rejected" || last.state === "cancelled";
  return finished ? null : last;
}

// ── header ────────────────────────────────────────────────────────────────────

/**
 * Three lines, each answering one question: what is this, where is it, and the
 * facts you glance at. Everything read once rather than continuously — the
 * description, the whole branch name, an assignee's address, an exact time — is
 * behind About, because it used to share a wrapping mono line with the things
 * read constantly and made all of them harder to find.
 */
function Header({
  task,
  runs,
  focus,
  repos,
  users,
  now,
  maximized,
  onToggleMaximized,
  onClose,
  onMove,
  onChanged,
}: {
  task: Task;
  runs: Run[];
  focus: Run | null;
  repos: Repo[];
  users: User[];
  now: number;
  maximized: boolean;
  onToggleMaximized: () => void;
  onClose: () => void;
  onMove: (stage: string) => void;
  onChanged: () => void;
}) {
  const [about, setAbout] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const repo = repos.find((r) => r.id === task.repo_id);
  const unattached = repos.filter(
    (r) => r.clone_state === "cloned" && !(task.repo_ids ?? []).includes(r.id),
  );
  const addRepo = async (id: string) => {
    setAdding(id);
    const r = await post<{ error?: string }>(`/api/tasks/${task.id}/repos`, { repo_id: id });
    setAdding(null);
    if (!unauthorized(r) && !r.error) onChanged();
  };
  // Named in the order the task spans them, primary first.
  const spans = (task.repo_ids ?? []).map((id) => repos.find((r) => r.id === id)?.name ?? "?");
  const assignee = users.find((u) => u.id === task.assignee_id);
  // On the task itself, so they are there at every stage after the build opens them.
  const prs = taskPrs(runs);

  return (
    <header className="shrink-0 border-b border-border/50 py-3 pr-2 pl-4">
      <div className="flex items-start gap-2">
        <h2 className="min-w-0 flex-1 text-[15px] leading-snug font-semibold tracking-[-0.01em] text-foreground">
          {task.title}
        </h2>
        <span className="shrink-0 pt-0.5 font-mono text-[11px] text-muted-foreground">
          {task.ticket}
        </span>
        <Button
          size="xs"
          variant="ghost-muted"
          aria-label={maximized ? "Restore the panel width" : "Maximize the panel"}
          onClick={onToggleMaximized}
        >
          {maximized ? <Minimize2Icon /> : <Maximize2Icon />}
        </Button>
        <Button size="xs" variant="ghost-muted" aria-label="Close this task" onClick={onClose}>
          <XIcon />
        </Button>
      </div>

      <div className="mt-2 flex items-center gap-2 pr-2">
        <Spine
          className="w-32 shrink-0"
          stages={task.pipeline_snapshot}
          runs={runs}
          taskState={task.state}
        />
        <Menu>
          <MenuTrigger
            aria-label="Move this task to another stage"
            className="inline-flex h-5 items-center gap-1 rounded-md px-1.5 font-mono text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {task.state === "done" ? "shipped" : (task.stage ?? "—")}
            <ChevronDownIcon aria-hidden className="size-3 shrink-0 opacity-70" />
          </MenuTrigger>
          <MenuPopup align="start" side="bottom" className="min-w-44">
            {task.pipeline_snapshot.map((st) => (
              <MenuItem key={st.name} onClick={() => onMove(st.name)}>
                {st.name}
              </MenuItem>
            ))}
            <MenuItem onClick={() => onMove("shipped")}>shipped — close this task</MenuItem>
          </MenuPopup>
        </Menu>
        {focus ? <StateBadge state={focus.state} /> : null}
      </div>

      <div className="mt-1.5 flex items-center gap-2 pr-2 font-mono text-[11px] text-muted-foreground">
        <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">
          <span>{task.pipeline}</span>
          <span aria-hidden>·</span>
          {spans.length > 1 ? (
            <Tooltip>
              <TooltipTrigger render={<span className="truncate" />}>
                {spans.join("·")}
              </TooltipTrigger>
              <TooltipPopup side="bottom">
                One branch across {spans.length} repositories, with {spans[0]} as the main one. Each
                repository that changes gets its own pull request.
              </TooltipPopup>
            </Tooltip>
          ) : (
            <span className="truncate">{repo?.name ?? "—"}</span>
          )}
          <span aria-hidden>·</span>
          <GitBranchIcon aria-hidden className="size-3 shrink-0" />
          <span className="truncate">{task.branch}</span>
          <span aria-hidden>·</span>
          {assignee ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="grid size-4 shrink-0 place-items-center rounded-full bg-secondary text-[9px] font-medium text-secondary-foreground" />
                }
              >
                {initials(assignee.name)}
              </TooltipTrigger>
              <TooltipPopup side="bottom">
                {assignee.name} · {assignee.email}
              </TooltipPopup>
            </Tooltip>
          ) : (
            <span className="shrink-0 text-muted-foreground/70">unassigned</span>
          )}
          <span className="shrink-0 text-muted-foreground/70">{ago(task.created_at, now)}</span>
        </span>
        <Button
          size="xs"
          variant="ghost-muted"
          className="shrink-0"
          aria-expanded={about}
          onClick={() => setAbout((v) => !v)}
        >
          About
          <ChevronDownIcon aria-hidden className={cn("size-3", about && "rotate-180")} />
        </Button>
      </div>

      {prs.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 pr-2">
          {prs.map((pr) => (
            <Button
              key={pr.url}
              size="xs"
              variant="outline"
              render={<a href={pr.url} target="_blank" rel="noreferrer" />}
            >
              <GitPullRequestIcon /> {pr.label}
            </Button>
          ))}
        </div>
      ) : null}

      {about ? (
        <dl className="mt-2 mr-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-[12px]">
          <Fact label="Pipeline">{task.pipeline}</Fact>
          <Fact label={spans.length > 1 ? "Repositories" : "Repository"}>
            <span>{spans.length > 1 ? spans.join(", ") : (repo?.name ?? "—")}</span>
            {/* The set was chosen before anyone knew what the work touched. The agent
                can read all of these either way; this is what lets it write in one. */}
            {unattached.length ? (
              <span className="mt-1 flex flex-wrap items-center gap-1">
                {unattached.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    disabled={adding !== null}
                    className="rounded border border-border/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                    onClick={() => void addRepo(r.id)}
                    title={`Let this task change ${r.name} too`}
                  >
                    + {r.name}
                  </button>
                ))}
              </span>
            ) : null}
          </Fact>
          <Fact label="Branch">
            <span className="font-mono">{task.branch}</span>
          </Fact>
          <Fact label="Assignee">
            {assignee ? `${assignee.name} · ${assignee.email}` : "unassigned"}
          </Fact>
          <Fact label="Created">{new Date(task.created_at).toLocaleString()}</Fact>
          {task.description ? (
            <Fact label="Description">
              <span className="whitespace-pre-wrap">{task.description}</span>
            </Fact>
          ) : null}
        </dl>
      ) : null}
    </header>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 leading-[1.5] text-foreground/85">{children}</dd>
    </>
  );
}

// ── the one thing this task is waiting for ────────────────────────────────────

/**
 * The work shipped, so this is not a failure — but it shipped as Foundry rather
 * than as the person, and only they can fix that by re-scoping their own token.
 * One line per repository: a token refused for three of them is still one errand.
 */
function TokenNotices({ notices }: { notices: TokenNotice[] }) {
  const latest = new Map<string, TokenNotice>();
  for (const n of notices) latest.set(`${n.payload.login ?? ""}/${n.payload.repo ?? ""}`, n);
  if (latest.size === 0) return null;
  return (
    <div className="mb-3 flex flex-col gap-1.5">
      {[...latest.values()].map((n) => (
        <p
          key={n.id}
          className="rounded-md bg-warning-surface px-3 py-2 text-xs text-warning-foreground"
        >
          {n.payload.detail ??
            `GitHub refused @${n.payload.login}'s token for ${n.payload.repo}, so Foundry used its own.`}
        </p>
      ))}
    </div>
  );
}

function NowZone({
  run,
  gate,
  artifact,
  versions,
  envId,
  busy,
  now,
  onOpenArtifact,
  onDiff,
  onRetry,
  canFix,
  onBuildOld,
  steps,
  onCancel,
  onChanged,
}: {
  run: Run;
  gate: GateRow | undefined;
  artifact: ArtifactMeta | undefined;
  versions: ArtifactMeta[];
  envId: string | null;
  busy: boolean;
  now: number;
  onOpenArtifact: (meta: ArtifactMeta) => void;
  onDiff: (fromId: string, toId: string) => void;
  onRetry: () => void;
  /** Retry without bringing the task up to date: "build on the old version". */
  /** Whether a build comes before this stage. */
  canFix: boolean;
  onBuildOld: () => void;
  /** What Foundry did to the code for this run. */
  steps: CodeEvent[];
  onCancel: () => void;
  onChanged: () => void;
}) {
  // Reported up by ConversationPanel below, which is the only thing that reads the
  // worktree. Reset by the `key` on this section's call site when the focus changes.
  const [hasDraft, setHasDraft] = useState(false);
  const banner = bannerFor(run.state, hasDraft);
  const alarming = run.state === "parked";
  const wanted = NEEDS_HUMAN.has(run.state);

  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border",
        alarming ? "border-destructive/32" : wanted ? "border-warning/40" : "border-border/60",
      )}
    >
      <header
        className={cn(
          "flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2",
          alarming ? "bg-destructive/8" : wanted ? "bg-warning-surface" : "bg-card/40",
        )}
      >
        <span
          className={cn(
            "text-[10px] font-semibold tracking-[0.06em] uppercase",
            alarming
              ? "text-destructive-foreground"
              : wanted
                ? "text-warning-foreground"
                : "text-muted-foreground",
          )}
        >
          {banner}
        </span>
        <span className="text-[13px] font-medium text-foreground">{run.stage}</span>
        {run.attempt > 1 ? (
          <span className="font-mono text-[11px] text-muted-foreground">attempt {run.attempt}</span>
        ) : null}
        <StateBadge state={run.state} className="ml-auto" />
      </header>

      <div className="space-y-2 px-3 py-2.5">
        <RunMeta run={run} now={now} />

        {steps.length ? (
          <ul className="space-y-0.5 text-[12px] text-muted-foreground">
            {[...steps].reverse().map((e) => (
              <li key={e.id} className="flex gap-1.5">
                <span aria-hidden>·</span>
                <span>{describeCodeEvent(e)}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {/* A parked run still has a thread worth reading — that is usually the
            first thing you want — so the reason and the ways in sit together. */}
        {run.park_reason ? (
          <ParkNotice run={run} busy={busy} onRetry={onRetry} onBuildOld={onBuildOld} />
        ) : null}

        <RunActions
          run={run}
          artifact={artifact}
          versions={versions}
          envId={envId}
          busy={busy}
          onOpenArtifact={onOpenArtifact}
          onDiff={onDiff}
        >
          {run.state === "parked" ? (
            <Button size="xs" variant="outline" onClick={onRetry} disabled={busy}>
              <RotateCwIcon /> Run it again
            </Button>
          ) : null}
          {!wanted && run.state !== "done" ? (
            <Button size="xs" variant="ghost-muted" onClick={onCancel} disabled={busy}>
              <XIcon /> Stop
            </Button>
          ) : null}
        </RunActions>

        {/* The panels bring their own loud chrome, which would be a second card
            inside this one — the container already says how urgent this is. */}
        {run.state === "awaiting_answers" ? (
          <QuestionsPanel run={run} onAnswered={onChanged} className="border-0 bg-transparent" />
        ) : null}
        {run.state === "conversing" || (run.state === "running" && run.stage_interactive) ? (
          <ConversationPanel run={run} envId={envId} onChanged={onChanged} onDraft={setHasDraft} />
        ) : null}
        {gate ? (
          <GatePanel
            gate={gate}
            artifact={artifact}
            stale={run.stale_inputs}
            canFix={canFix}
            onDecided={onChanged}
            className="border-0 bg-transparent"
          />
        ) : null}
      </div>
    </section>
  );
}

/** Time, commit, tests, heartbeat — the four numbers that describe an attempt. */
function RunMeta({ run, now }: { run: Run; now: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
      <ActiveTime ms={activeMs(run, now)} timeoutMs={run.timeout_ms} />
      {run.head_sha ? <span>{run.head_sha.slice(0, 7)}</span> : null}
      {run.test_exit_code !== null ? (
        <span
          className={
            run.test_exit_code === 0 ? "text-success-foreground" : "text-destructive-foreground"
          }
        >
          tests {run.test_exit_code === 0 ? "passed" : `failed (${run.test_exit_code})`}
        </span>
      ) : null}
      {run.finished_at ? <span>{ago(run.finished_at, now)}</span> : null}
      {/* A working stage says "working" whether it is thinking or wedged. The only
          thing that tells them apart is whether its thread has moved recently, so
          that is shown rather than left in the database. */}
      {BUSY.has(run.state) && run.last_progress_at ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                className={cn(
                  "inline-flex items-center gap-1",
                  now - new Date(run.last_progress_at).getTime() > 120_000 &&
                    "text-warning-foreground",
                )}
              />
            }
          >
            <ActivityIcon aria-hidden className="size-3" />
            {ago(run.last_progress_at, now)}
          </TooltipTrigger>
          <TooltipPopup side="top">
            {
              "When this agent's thread last changed. A long silence usually means a wedged session, not deep thought."
            }
          </TooltipPopup>
        </Tooltip>
      ) : null}
    </div>
  );
}

function ParkNotice({
  run,
  busy = false,
  onRetry,
  onBuildOld,
}: {
  run: Run;
  busy?: boolean;
  /** Present where the run can be retried from: the clash choices show only there. */
  onRetry?: () => void;
  onBuildOld?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const park = run.park_reason ? (PARK_REASON[run.park_reason] ?? run.park_reason) : null;
  if (!park) return null;
  return (
    <div className="rounded-lg border border-destructive/24 bg-destructive/6 px-2.5 py-2">
      <p className="text-[13px] text-destructive-foreground">{park}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        Nothing retries on its own. Fix what caused it, then run this stage again.
      </p>
      {run.park_reason === "merge_conflict" && onRetry && onBuildOld ? (
        <ClashChoices run={run} busy={busy} onRetry={onRetry} onBuildOld={onBuildOld} />
      ) : null}
      {run.park_detail ? (
        <>
          <Button
            size="xs"
            variant="ghost-muted"
            className="mt-1 -ml-1.5"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Hide details" : "Show details"}
          </Button>
          {open ? (
            <pre className="mt-1 max-h-40 overflow-auto rounded-md border border-border/60 bg-background p-2 font-mono text-[10px] leading-4 whitespace-pre-wrap text-muted-foreground">
              {JSON.stringify(run.park_detail, null, 1).slice(0, 4000)}
            </pre>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** What you can open from a run: its document, what changed, its PR, its thread. */
function RunActions({
  run,
  artifact,
  versions,
  envId,
  busy = false,
  onOpenArtifact,
  onDiff,
  children,
}: {
  run: Run;
  artifact: ArtifactMeta | undefined;
  versions: ArtifactMeta[];
  envId: string | null;
  busy?: boolean | undefined;
  onOpenArtifact: (meta: ArtifactMeta) => void;
  onDiff: (fromId: string, toId: string) => void;
  children?: React.ReactNode;
}) {
  const prev =
    artifact && versions.length > 1
      ? (versions.find((v) => v.version === artifact.version - 1) ?? null)
      : null;
  // One per repository the build changed; an older backend only knows the primary's.
  const prs = run.prs?.length
    ? run.prs.map((p) => ({ url: p.url, label: `${p.repo} #${p.number}` }))
    : run.pr_url
      ? [{ url: run.pr_url, label: "Pull request" }]
      : [];
  if (!artifact && prs.length === 0 && !(run.t3_thread_id && envId) && !children) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {artifact ? (
        <Button
          size="xs"
          variant="outline"
          disabled={busy}
          onClick={() => onOpenArtifact(artifact)}
        >
          <FileTextIcon />
          {artifact.kind === "html" ? "Open the mockup" : "Read it"}
          {versions.length > 1 ? ` · v${artifact.version}` : ""}
        </Button>
      ) : null}
      {prev ? (
        <Button size="xs" variant="ghost-muted" onClick={() => onDiff(prev.id, artifact!.id)}>
          What changed
        </Button>
      ) : null}
      {prs.map((pr) => (
        <Button
          key={pr.url}
          size="xs"
          variant="outline"
          render={<a href={pr.url} target="_blank" rel="noreferrer" />}
        >
          <GitPullRequestIcon /> {pr.label}
        </Button>
      ))}
      {run.t3_thread_id && envId ? (
        <Button
          size="xs"
          variant="ghost-muted"
          render={
            <Link
              to="/$environmentId/$threadId"
              params={{ environmentId: envId, threadId: run.t3_thread_id }}
            />
          }
        >
          <ExternalLinkIcon /> Watch the agent
        </Button>
      ) : null}
      {children}
    </div>
  );
}

// ── history ───────────────────────────────────────────────────────────────────

/**
 * One run, one line. A finished stage is a fact, not a thing to act on, so it
 * gets the weight of a fact and opens up only when asked. The run the panel is
 * already showing above does not expand at all — it points back at itself
 * instead, rather than printing the same four buttons twice.
 */
function HistoryRow({
  run,
  artifact,
  versions,
  envId,
  now,
  focused,
  onGoToNow,
  onOpenArtifact,
  onDiff,
}: {
  run: Run;
  artifact: ArtifactMeta | undefined;
  versions: ArtifactMeta[];
  envId: string | null;
  now: number;
  focused: boolean;
  onGoToNow: () => void;
  onOpenArtifact: (meta: ArtifactMeta) => void;
  onDiff: (fromId: string, toId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const tone = toneOf(run.state);
  const expanded = open && !focused;

  return (
    <li>
      <button
        type="button"
        aria-expanded={focused ? undefined : open}
        onClick={() => (focused ? onGoToNow() : setOpen((v) => !v))}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent/50",
          focused && "bg-accent/40",
        )}
      >
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            SEGMENT_TONE[tone],
            tone === "busy" && "motion-safe:animate-pulse",
          )}
        />
        <span className="shrink-0 text-[13px] font-medium text-foreground">{run.stage}</span>
        {run.attempt > 1 ? (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            ×{run.attempt}
          </span>
        ) : null}
        <span
          className={cn(
            "truncate text-[12px]",
            tone === "attention"
              ? "text-warning-foreground"
              : tone === "failed"
                ? "text-destructive-foreground"
                : "text-muted-foreground",
          )}
        >
          {STATE_LABEL[run.state]}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-[10px] text-muted-foreground/80">
          <span className="tabular-nums">{duration(activeMs(run, now))}</span>
          {artifact ? <span>v{artifact.version}</span> : null}
          <span className="hidden sm:inline">{ago(run.finished_at ?? run.queued_at, now)}</span>
        </span>
        <ChevronRightIcon
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground/60 transition-transform",
            expanded && "rotate-90",
            focused && "-rotate-90",
          )}
        />
      </button>
      {expanded ? (
        <div className="space-y-2 border-l border-border/60 px-3 py-2 ml-3">
          <RunMeta run={run} now={now} />
          {run.park_reason ? <ParkNotice run={run} /> : null}
          <RunActions
            run={run}
            artifact={artifact}
            versions={versions}
            envId={envId}
            onOpenArtifact={onOpenArtifact}
            onDiff={onDiff}
          />
        </div>
      ) : null}
    </li>
  );
}

// ── documents ─────────────────────────────────────────────────────────────────

/**
 * What the task has actually produced, in pipeline order.
 *
 * These existed only as a button inside whichever run happened to write them,
 * which made "show me the PRD" a hunt through the history. A stage shows its
 * newest version; the older ones are one click away in the reader.
 */
function Documents({
  task,
  artifacts,
  users,
  now,
  onOpen,
  onDiff,
}: {
  task: Task;
  artifacts: ArtifactMeta[];
  users: User[];
  now: number;
  onOpen: (meta: ArtifactMeta) => void;
  onDiff: (fromId: string, toId: string) => void;
}) {
  const rows = task.pipeline_snapshot
    .map((stage) => {
      const versions = artifacts
        .filter((a) => a.stage === stage.name)
        .sort((a, b) => a.version - b.version);
      const latest = versions.at(-1);
      return latest ? { stage, versions, latest } : null;
    })
    .filter((r) => r !== null);
  if (rows.length === 0) return null;

  return (
    <Fold title="Documents" count={`${rows.length} ${rows.length === 1 ? "file" : "files"}`}>
      <ul>
        {rows.map(({ stage, versions, latest }) => {
          const author = latest.author_id
            ? (users.find((u) => u.id === latest.author_id)?.name ?? "a person")
            : null;
          const prev = versions.find((v) => v.version === latest.version - 1);
          return (
            <li key={stage.name} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onOpen(latest)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent/50"
              >
                {latest.kind === "html" ? (
                  <ImageIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <FileTextIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate font-mono text-[12px] text-foreground">
                  {stage.output.file ?? stage.name}
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-[10px] text-muted-foreground/80">
                  <span>v{latest.version}</span>
                  <span className="hidden sm:inline">{author ? `${author} edited` : "agent"}</span>
                  <span>{ago(latest.created_at, now)}</span>
                </span>
              </button>
              {prev ? (
                <Button
                  size="xs"
                  variant="ghost-muted"
                  className="shrink-0"
                  onClick={() => onDiff(prev.id, latest.id)}
                >
                  What changed
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Fold>
  );
}

// ── shared bits ───────────────────────────────────────────────────────────────

/** A titled section of the panel that can be folded away. */
function Fold({
  title,
  count,
  children,
}: {
  title: string;
  count?: string | undefined;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left"
      >
        <span className="text-[11px] font-semibold tracking-[0.04em] text-foreground/70 uppercase">
          {title}
        </span>
        {count ? (
          <span className="font-mono text-[10px] text-muted-foreground">{count}</span>
        ) : null}
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "ml-auto size-3.5 text-muted-foreground/60 transition-transform",
            !open && "-rotate-90",
          )}
        />
      </button>
      {open ? <div className="px-0 pt-0.5">{children}</div> : null}
    </section>
  );
}

/** The right-hand column with nothing open in it yet. */
function ReaderIdle() {
  return (
    <div className="grid min-h-0 flex-1 place-items-center px-6">
      <p className="max-w-64 text-center text-[13px] leading-[1.5] text-balance text-muted-foreground">
        Documents open here. Pick one from the list, or from the stage that wrote it.
      </p>
    </div>
  );
}

function StartCard({ task, busy, onStart }: { task: Task; busy: boolean; onStart: () => void }) {
  if (task.state !== "open") {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">This task is {task.state}.</p>
    );
  }
  // Start runs the stage the task is sitting in, which a person may have dragged it to.
  const stage = task.stage ?? task.pipeline_snapshot[0]?.name;
  const moved = task.stage !== task.pipeline_snapshot[0]?.name;
  return (
    <section className="rounded-xl border border-border/60 bg-card/40 px-3 py-3">
      <h3 className="text-[13px] font-medium text-foreground">Nothing has run yet</h3>
      <p className="mt-1 text-[13px] leading-[1.45] text-muted-foreground">
        Starting runs <span className="font-mono text-[12px]">{stage}</span> as an agent session on{" "}
        <span className="font-mono text-[12px]">{task.branch}</span>. It will ask you anything it
        needs before it writes.
        {moved ? " Drag the card to another column to run a different stage." : ""}
      </p>
      <Button size="sm" className="mt-2.5" onClick={onStart} disabled={busy}>
        {busy ? <Spinner /> : <PlayIcon />}Start {stage}
      </Button>
    </section>
  );
}

export { duration };

/**
 * Where the task's code started and whether Foundry keeps it up to date, always on
 * screen: an engineer should never have to guess what the branch is built on.
 */
function CodeLine({ code }: { code: CodeInfo | undefined }) {
  if (!code || code.repos.length === 0) return null;
  const bases = [...new Set(code.repos.map((r) => r.base))];
  const sha = (code.repos.find((r) => r.is_primary) ?? code.repos[0])?.base_sha;
  return (
    <p className="mx-2 mt-2 font-mono text-[11px] text-muted-foreground">
      <span className="text-foreground">Code</span> starts from {bases.join(" / ")}
      {sha ? ` (${sha.slice(0, 7)})` : ""} · branch {code.branch} ·{" "}
      {code.catch_up
        ? "brought up to date before each build"
        : "builds on the version it started from"}
    </p>
  );
}

/** A clash with the base: what clashed, that nothing changed, and the two ways on. */
function ClashChoices({
  run,
  busy,
  onRetry,
  onBuildOld,
}: {
  run: Run;
  busy: boolean;
  onRetry: () => void;
  onBuildOld: () => void;
}) {
  const detail = (run.park_detail ?? {}) as { repo?: string; files?: string[] };
  return (
    <div className="mt-1.5 space-y-1.5">
      <p className="text-[12px] text-foreground">
        Nothing was changed — the task is exactly as it was. The clashing files
        {detail.repo ? ` in ${detail.repo}` : ""}:
      </p>
      <ul className="font-mono text-[11px] text-muted-foreground">
        {(detail.files ?? []).map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-1.5">
        <Button size="xs" variant="outline" disabled={busy} onClick={onBuildOld}>
          Build on the old version
        </Button>
        <Button size="xs" variant="ghost-muted" disabled={busy} onClick={onRetry}>
          Try again
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        To keep the latest instead, resolve the clash on the branch (or ask an engineer), then try
        again.
      </p>
    </div>
  );
}
