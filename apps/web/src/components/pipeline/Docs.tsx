import { useEffect, useState, type ReactNode } from "react";
import {
  CheckIcon,
  ClockIcon,
  FileTextIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  MessageCircleQuestionIcon,
  PlayIcon,
  SlidersHorizontalIcon,
  TicketIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";

import {
  PARK_REASON,
  type Gate,
  type Question,
  type Run,
  type RunState,
  type SnapshotStage,
  type Task,
  type User,
} from "./api";
import { AttentionPanel, GateActions, QuestionFields } from "./HumanPanels";
import { Spine } from "./Spine";
import { StateBadge } from "./StateBadge";
import { TaskCard } from "./TaskCard";

/**
 * What a new engineer needs to know, kept where they already are.
 *
 * The rule this page follows: never draw a picture of the product. Every board
 * card, badge, spine and panel below is the real component with invented data,
 * so a change to the board changes the documentation with it. Only the arrows
 * and the file tree are drawn by hand, because nothing in the app owns them.
 */

// ── invented data ─────────────────────────────────────────────────────────────
const PROVIDER = { instanceId: "claudeAgent", model: "claude-sonnet-5" };

function stageDef(name: string, file: string | null, gate: Gate = "human", mins = 30) {
  return {
    name,
    output: file
      ? { file, kind: file.endsWith(".html") ? ("html" as const) : ("markdown" as const) }
      : { kind: "pull_request" as const },
    gate,
    skill: null,
    provider: PROVIDER,
    timeout_minutes: mins,
  } satisfies SnapshotStage;
}

const FEATURE = [
  stageDef("one-pager", "one-pager.md", "human", 20),
  stageDef("mockup", "mockup.html"),
  stageDef("prd", "prd.md"),
  stageDef("build", null, "auto", 90),
  stageDef("verify", "verification.md"),
];
const BUGFIX = [
  stageDef("prd", "prd.md"),
  stageDef("build", null, "auto", 90),
  stageDef("verify", "verification.md"),
];
const SPIKE = [stageDef("one-pager", "one-pager.md", "auto", 20)];

const PIPELINES: Array<{ name: string; stages: SnapshotStage[]; blurb: string }> = [
  {
    name: "feature",
    stages: FEATURE,
    blurb:
      "A product surface that does not exist yet. Starts with a conversation about what you actually want, and every document is reviewed before the next one is written.",
  },
  {
    name: "bugfix",
    stages: BUGFIX,
    blurb:
      "Known problem, known place. No one-pager and no mockup — straight to a technical PRD, the fix, and a second agent reading the diff against the spec.",
  },
  {
    name: "spike",
    stages: SPIKE,
    blurb:
      "You only want the thinking written down. One document, no gate, nothing built. Use it to decide whether the work is worth a feature run at all.",
  },
];

/** Fixed at module load: this page has no clock, and re-rendering must not move it. */
const NOW = Date.now();

const DEMO_USERS: User[] = [
  { id: "u1", name: "Navaneeth R", email: "", role: "member" },
  { id: "u2", name: "Suhel K", email: "", role: "member" },
];

let seq = 0;
function demoRun(stage: string, state: RunState, over: Partial<Run> = {}): Run {
  return {
    id: `demo-${++seq}`,
    stage,
    attempt: 1,
    state,
    t3_thread_id: null,
    queued_at: "",
    started_at: null,
    active_ms: 0,
    active_since: null,
    timeout_ms: 30 * 60_000,
    head_sha: null,
    artifact_id: null,
    pr_url: null,
    park_reason: null,
    park_detail: null,
    finished_at: null,
    test_exit_code: null,
    ...over,
  };
}

function demoTask(over: Partial<Task> & Pick<Task, "id" | "ticket" | "title">): Task {
  return {
    description: "",
    repo_id: "r1",
    pipeline: "feature",
    pipeline_snapshot: FEATURE,
    assignee_id: "u1",
    branch: `foundry/${over.ticket.toLowerCase()}`,
    stage: null,
    state: "open",
    created_at: new Date(NOW).toISOString(),
    ...over,
  };
}

/** Four cards, one per thing the board can be telling you. */
const BOARD: Array<{ task: Task; runs: Run[]; note: string }> = [
  {
    task: demoTask({
      id: "t1",
      ticket: "FND-4K2P",
      title: "Bulk export for campaign reports",
      stage: "prd",
    }),
    runs: [
      demoRun("one-pager", "done"),
      demoRun("mockup", "done"),
      demoRun("prd", "running", { active_ms: 7 * 60_000 }),
    ],
    note: "Working. Two stages behind it are approved, an agent is writing the PRD, nothing is asked of you.",
  },
  {
    task: demoTask({
      id: "t2",
      ticket: "FND-8QW1",
      title: "Creator payouts recap email",
      stage: "mockup",
      assignee_id: "u2",
    }),
    runs: [demoRun("one-pager", "done"), demoRun("mockup", "awaiting_gate")],
    note: "Stopped on a person. The amber rail and the border are the whole signal — a document is written and waiting to be approved.",
  },
  {
    task: demoTask({
      id: "t3",
      ticket: "FND-2LNB",
      title: "Gig milestone bonuses",
      stage: "build",
      pipeline: "bugfix",
      pipeline_snapshot: BUGFIX,
      repo_ids: ["r1", "r2"],
    }),
    runs: [
      demoRun("prd", "done"),
      demoRun("build", "parked", { park_reason: "tests_failed", attempt: 2 }),
    ],
    note: "Parked on its second attempt, and spanning two repositories on one branch — that is what the layers count means.",
  },
  {
    task: demoTask({
      id: "t4",
      ticket: "FND-MBP7",
      title: "Unlisted gigs",
      state: "done",
      assignee_id: null,
      created_at: new Date(NOW - 4 * 864e5).toISOString(),
    }),
    runs: FEATURE.map((s) => demoRun(s.name, "done")),
    note: "Shipped. Every segment filled, and the badge falls back to naming the pipeline it ran.",
  },
];

const DEMO_QUESTIONS: Question[] = [
  {
    id: "q1",
    stage_run_id: "demo",
    request_id: "demo",
    batch: 1,
    header: "Scope",
    question:
      "Should the export include campaigns that were cancelled before any creator was paid?",
    options: [
      { label: "Include them", description: "Row present, totals zero" },
      { label: "Exclude them", description: "Cancelled campaigns never appear" },
    ],
    multi_select: false,
    allow_custom: true,
    response_mode: null,
    answer: null,
    answered_by: null,
    source: "foundry",
  },
];

// ── page furniture ────────────────────────────────────────────────────────────
const SECTIONS = [
  { id: "what", title: "What this is" },
  { id: "board", title: "The board" },
  { id: "start", title: "Starting a task" },
  { id: "stage", title: "A stage, end to end" },
  { id: "you", title: "Where you come in" },
  { id: "git", title: "What lands in git" },
  { id: "stops", title: "When something stops" },
  { id: "change", title: "Changing a stage" },
] as const;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 space-y-3">
      <h2 className="text-[15px] font-medium tracking-[-0.01em] text-foreground">{title}</h2>
      <div className="space-y-3 text-[13px] leading-[1.65] text-muted-foreground">{children}</div>
    </section>
  );
}

const Term = ({ children }: { children: ReactNode }) => (
  <span className="rounded bg-muted px-1 py-px font-mono text-[12px] text-foreground">
    {children}
  </span>
);

const Strong = ({ children }: { children: ReactNode }) => (
  <strong className="font-medium text-foreground">{children}</strong>
);

/** The engineering detail, set apart so a reader can take it or leave it. */
function Internals({ children }: { children: ReactNode }) {
  return (
    <aside className="rounded-lg border-l-2 border-primary/40 bg-card/40 py-2 pr-3 pl-3 text-[12.5px] leading-[1.6]">
      <p className="mb-1 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground/70 uppercase">
        Under the hood
      </p>
      {children}
    </aside>
  );
}

/**
 * A frame around a real component running on invented data. `frozen` makes the
 * demo unclickable rather than disabled — a greyed-out button is a different
 * picture from the one the reader will meet on the board.
 */
function Demo({
  caption,
  frozen = false,
  className,
  children,
}: {
  caption?: ReactNode;
  frozen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <figure className="space-y-1.5">
      <div
        className={cn(
          "rounded-xl border border-dashed border-border/50 bg-background/50 p-3",
          className,
        )}
        {...(frozen ? { inert: true } : {})}
      >
        {children}
      </div>
      {caption ? (
        <figcaption className="text-[12px] leading-[1.5] text-muted-foreground/80">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

/** One step of the loop at the top of the page. */
function Step({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-foreground">
        <span className="text-muted-foreground [&_svg]:size-3.5">{icon}</span>
        <span className="text-[12px] font-medium">{title}</span>
      </div>
      <p className="mt-1 text-[11.5px] leading-[1.5] text-muted-foreground">{children}</p>
    </div>
  );
}

// ── the states of a run, in the order they happen ─────────────────────────────
const AUTOMATIC: Array<[RunState, string]> = [
  ["queued", "Waiting for a free slot — only so many agent sessions run at once."],
  [
    "preparing",
    "A git worktree is cut for the branch, and the approved documents from earlier stages are written into it.",
  ],
  [
    "questioning",
    "A read-only pre-flight turn whose only job is to surface what the agent would otherwise have to guess.",
  ],
  ["running", "The real turn. One shot: when it ends, nothing else runs."],
  ["collecting", "The deliverable is read out of the worktree and committed to the branch."],
  ["testing", "The repository's own test command. Build stages only."],
];
const WAITING: Array<[RunState, string]> = [
  ["awaiting_answers", "It asked you something and stopped."],
  ["conversing", "An interactive stage replied and it is your move."],
  ["awaiting_gate", "It wrote its document and stopped for a person to approve it."],
];
const ENDED: Array<[RunState, string]> = [
  ["done", "Approved, and the next stage is queued."],
  ["parked", "Something went wrong. It will not retry by itself."],
  ["rejected", "A person ended the task at a gate."],
  ["cancelled", "The task was stopped."],
];

function StateRow({ state, children }: { state: RunState; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2.5 py-1">
      <span className="w-[104px] shrink-0">
        <StateBadge state={state} />
      </span>
      <span className="text-[12.5px] leading-[1.55]">{children}</span>
    </div>
  );
}

// ── the page ──────────────────────────────────────────────────────────────────
export function Docs() {
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  const [answer, setAnswer] = useState<string | string[] | undefined>();

  useEffect(() => {
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        const first = SECTIONS.find((s) => seen.get(s.id));
        if (first) setActive(first.id);
      },
      { rootMargin: "-72px 0px -68% 0px" },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);

  return (
    <div className="grid grid-cols-1 gap-8 pb-10 lg:grid-cols-[minmax(0,1fr)_150px]">
      <div className="min-w-0 space-y-8">
        <Section id="what" title="What this is">
          <p>
            A ticket is carried through a fixed set of stages, and an agent does each one. Every
            stage is a real agent session you can open and watch. Everything a stage produces is
            committed to a branch, so the output of this pipeline is in your repository rather than
            locked inside a tool.
          </p>

          {/* Two rows of three rather than six across: the content column here is
              about 800px, and six cards with a minimum width cannot fit in it —
              they used to overflow under the table of contents. The numbering
              carries the order, so the arrows between them were decoration. */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Step icon={<TicketIcon />} title="1 · A ticket">
              You describe the work and pick a pipeline. Nothing runs until you press Start.
            </Step>
            <Step icon={<GitBranchIcon />} title="2 · A branch">
              One branch per ticket, <Term>foundry/&lt;ticket&gt;</Term>, with the same name in
              every repository the task touches.
            </Step>
            <Step icon={<PlayIcon />} title="3 · A stage runs">
              One agent thread per stage attempt, working in a git worktree of that branch.
            </Step>
            <Step icon={<FileTextIcon />} title="4 · A file lands">
              The deliverable is committed under <Term>specs/&lt;TICKET&gt;/</Term>.
            </Step>
            <Step icon={<CheckIcon />} title="5 · You approve">
              Approve, edit, or send it back. Approving queues the next stage — back to 3.
            </Step>
            <Step icon={<GitPullRequestIcon />} title="6 · A draft PR">
              The build stage pushes the branch and opens a draft pull request. Agents never merge.
            </Step>
          </div>

          <Internals>
            <p>
              Foundry never spawns an agent process itself. Every stage is a thread in T3 — this
              same application — dispatched over HTTP, which is why "Watch the agent" on any stage
              opens a session you can read and type into. One thread per stage <em>attempt</em>:
              sending a stage back gives it a fresh thread, not a longer one.
            </p>
          </Internals>
        </Section>

        <Section id="board" title="The board">
          <p>
            Columns are stages; a card sits in the column it is currently in. The three-part line
            across each card is its <Strong>spine</Strong> — one segment per stage of that task's
            pipeline, filled for finished work, lit for where it is now, amber when it is stopped on
            a person. Hover any segment to see which stage it is.
          </p>

          <Demo
            frozen
            className="flex flex-wrap gap-3"
            caption="Four real cards, invented data. Dragging a card moves the task to another stage; a running task refuses to move until you stop it."
          >
            {BOARD.map((b) => (
              <div key={b.task.id} className="w-[200px] shrink-0">
                <TaskCard
                  task={b.task}
                  runs={b.runs}
                  users={DEMO_USERS}
                  selected={false}
                  waiting={b.runs.find((r) =>
                    ["awaiting_gate", "awaiting_answers", "conversing", "parked"].includes(r.state),
                  )}
                  onSelect={() => {}}
                  now={NOW}
                  movable
                  dragging={false}
                  onDragStart={() => {}}
                  onDragEnd={() => {}}
                />
              </div>
            ))}
          </Demo>

          <ol className="space-y-1.5 pl-0">
            {BOARD.map((b) => (
              <li key={b.task.id} className="flex gap-2">
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70">
                  {b.task.ticket.replace("FND-", "")}
                </span>
                <span className="text-[12.5px] leading-[1.55]">{b.note}</span>
              </li>
            ))}
          </ol>

          <p>
            The count in the header — <Strong>waiting on you</Strong> — is the only number on this
            page worth watching. Clicking it opens the first task that is stopped on you.
          </p>
        </Section>

        <Section id="start" title="Starting a task">
          <p>
            <Strong>New task</Strong>, then say what you want built and give the agent the context
            it cannot look up: who has the problem, what exists today, what done looks like, and
            what you have already ruled out. Under-describing a task does not fail — it means the
            agent asks you more before it starts.
          </p>
          <p>Pick the pipeline that matches the work. The choice is frozen into the task:</p>

          <Demo
            className="space-y-3.5"
            caption="Each spine is the real board component, drawn from that pipeline's actual stages."
          >
            {PIPELINES.map((p) => (
              <div key={p.name} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" size="sm" className="font-mono">
                    {p.name}
                  </Badge>
                  <span className="flex flex-wrap gap-1 font-mono text-[10.5px] text-muted-foreground">
                    {p.stages.map((s, i) => (
                      <span key={s.name}>
                        {i > 0 ? <span className="mr-1 opacity-40">→</span> : null}
                        {s.name}
                        {s.gate === "auto" ? (
                          <span className="ml-0.5 text-muted-foreground/50">·auto</span>
                        ) : null}
                      </span>
                    ))}
                  </span>
                </div>
                <Spine
                  stages={p.stages}
                  runs={[]}
                  taskState="open"
                  className="max-w-[420px] opacity-70"
                />
                <p className="max-w-[560px] text-[12.5px] leading-[1.55]">{p.blurb}</p>
              </div>
            ))}
          </Demo>

          <Internals>
            <p>
              The pipeline is copied into the task as a <Term>pipeline_snapshot</Term> at creation.
              Editing a pipeline later never disturbs anything in flight — a task runs the stages it
              started with, for its whole life. Stages marked <Term>·auto</Term> have no human gate:
              they hand straight to the next stage.
            </p>
          </Internals>

          <p>
            Notes and files you add to a task are read by the agents on{" "}
            <Strong>every later run</Strong>, not just the next one, and they are attributed — so
            "Suhel decided X" carries differently from a passing remark. That is the cheapest way to
            steer a run without editing a prompt.
          </p>
        </Section>

        <Section id="stage" title="A stage, end to end">
          <p>
            Every stage moves through the same states. You will see these names on the board and in
            the run timeline, so they are worth reading once:
          </p>

          <Demo
            caption="Every badge here is the same component the board renders."
            className="space-y-3"
          >
            <div>
              <p className="mb-1 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground/70 uppercase">
                Runs without you
              </p>
              {AUTOMATIC.map(([s, d]) => (
                <StateRow key={s} state={s}>
                  {d}
                </StateRow>
              ))}
            </div>
            <div>
              <p className="mb-1 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground/70 uppercase">
                Stopped on a person
              </p>
              {WAITING.map(([s, d]) => (
                <StateRow key={s} state={s}>
                  {d}
                </StateRow>
              ))}
            </div>
            <div>
              <p className="mb-1 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground/70 uppercase">
                Over
              </p>
              {ENDED.map(([s, d]) => (
                <StateRow key={s} state={s}>
                  {d}
                </StateRow>
              ))}
            </div>
          </Demo>

          <p className="flex items-start gap-2">
            <ClockIcon aria-hidden className="mt-[3px] size-3.5 shrink-0 text-muted-foreground" />
            <span>
              Each stage has a working-time budget, and the clock only runs in the four states where
              an agent is actually working. Time spent waiting on you is free — a task can sit at a
              gate for a week without ever timing out. The elapsed figure on a run shows working
              time, not wall time, which is why it will look far smaller than you expect.
            </span>
          </p>

          <Internals>
            <p>
              The same rule applies to concurrency: a run waiting on a human gives its slot back, so
              one unanswered question cannot starve the queue. And nothing auto-retries — a failure
              parks and stays parked until a person looks at it.
            </p>
          </Internals>
        </Section>

        <Section id="you" title="Where you come in">
          <p>
            Two moments, both of which appear inline under the stage they belong to, and both of
            which also reach you in Slack.
          </p>

          <p>
            <Strong>A question.</Strong> An agent can stop and ask at any point, and by default each
            stage opens with a read-only pass whose only purpose is to get its questions out before
            it does any work. Answer here, or answer in the agent's thread — including from your
            phone. Whichever happens first, the stage resumes where it stopped. Answers carry into
            later attempts, so sending work back never means answering the same thing twice.
          </p>

          <Demo caption="The real panel — the options below are clickable. On the board, sending an answer resumes the run within seconds.">
            <AttentionPanel
              icon={<MessageCircleQuestionIcon className="size-3.5 text-warning-foreground" />}
              title="The agent has a question"
              aside="answerable here or in the thread"
            >
              <div className="space-y-3 px-3 pt-1 pb-3">
                <QuestionFields
                  q={DEMO_QUESTIONS[0]!}
                  value={answer}
                  onToggle={(label) => setAnswer(label)}
                  onType={(v) => setAnswer(v)}
                />
              </div>
            </AttentionPanel>
          </Demo>

          <p>
            <Strong>A gate.</Strong> When a stage produces its document, it stops. Read it, then
            pick one of four things:
          </p>

          <Demo
            frozen
            caption="Approve takes it as written · Edit and approve saves your text as a new version first · Send back reruns the stage with your feedback in front of the agent · Reject ends the task."
          >
            <AttentionPanel title="Review the prd">
              <div className="px-3 pt-1 pb-3">
                <GateActions
                  onApprove={() => {}}
                  onEdit={() => {}}
                  onRevise={() => {}}
                  onReject={() => {}}
                />
              </div>
            </AttentionPanel>
          </Demo>

          <p>
            Editing is usually faster than a round trip: your version is saved as a new revision and
            that is the version the next stage reads. Anyone can approve, and every decision is
            recorded against the person who made it.
          </p>

          <Internals>
            <p>
              A gate decides exactly once — a second decision on the same gate is refused rather
              than applied twice, which matters because the same gate can be open in Slack, on a
              phone and on a laptop at the same time. Human edits are stored as artifact versions
              with an author, so a diff between "what the agent wrote" and "what we shipped" is
              always available.
            </p>
          </Internals>
        </Section>

        <Section id="git" title="What lands in git">
          <p>
            Nothing here is stored only in a database. A task cuts one branch, and each stage
            commits its deliverable to it:
          </p>

          <Demo caption="A feature task after the build stage. Attachments you add to a task are written into the worktree too, which is how an agent reads a screenshot you dropped on the card.">
            <pre className="overflow-x-auto font-mono text-[11.5px] leading-[1.7] text-muted-foreground">
              {`foundry/fnd-4k2p            one branch, the same name in every repo it touches
└── specs/FND-4K2P/
    ├── one-pager.md        v1  the agent's
    ├── mockup.html         v2  v1 the agent's, v2 edited by a person at the gate
    ├── prd.md              v1
    ├── build-summary.md        what the build actually did, in its own words
    ├── verification.md         a second agent reading the diff against the PRD
    └── attachments/            what the team dropped on the card`}
            </pre>
          </Demo>

          <p>
            The build stage is the only one that writes code. It works in the same worktree, runs
            the repository's test command until it passes, pushes the branch, and opens a{" "}
            <Strong>draft</Strong> pull request with the assignee as reviewer. It never merges, and
            it never opens the PR itself — the pipeline does that once tests are green.
          </p>

          <Internals>
            <p>
              Worktrees live at <Term>/srv/worktrees/&lt;ticket&gt;</Term>, one per task, with a
              nested worktree per repository for tasks that span several. They survive a restart: if
              the service goes down mid-run, it reconciles against T3 on boot rather than starting
              the stage again.
            </p>
          </Internals>
        </Section>

        <Section id="stops" title="When something stops">
          <p>
            A stage that fails <Strong>parks</Strong>. It never retries by itself, because a silent
            retry on a failure nobody has seen burns the shared Claude subscription and hides the
            cause. The card says what happened in plain words and keeps the detail underneath.
          </p>

          <Demo
            frozen
            className="w-[200px]"
            caption="A parked card. The state is the badge; the reason is one line down, on the task itself."
          >
            <TaskCard
              task={BOARD[2]!.task}
              runs={BOARD[2]!.runs}
              users={DEMO_USERS}
              selected={false}
              waiting={BOARD[2]!.runs.find((r) => r.state === "parked")}
              onSelect={() => {}}
              now={NOW}
              movable
              dragging={false}
              onDragStart={() => {}}
              onDragEnd={() => {}}
            />
          </Demo>

          <p className="flex items-start gap-2">
            <TriangleAlertIcon
              aria-hidden
              className="mt-[3px] size-3.5 shrink-0 text-muted-foreground"
            />
            <span>Every reason a run can park, and what it means:</span>
          </p>

          <Demo caption="Generated from the same table the board reads, so this list cannot fall out of date.">
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[minmax(140px,auto)_1fr]">
              {Object.entries(PARK_REASON).map(([key, label]) => (
                <div key={key} className="contents">
                  <dt className="font-mono text-[11px] text-muted-foreground/70">{key}</dt>
                  <dd className="text-[12.5px] text-foreground/85">{label}</dd>
                </div>
              ))}
            </dl>
          </Demo>

          <p>
            The three you will actually meet: <Term>token_rate_limited</Term> means the shared
            subscription is capped — wait, then run the stage again. <Term>output_missing</Term>{" "}
            means the instructions were ambiguous enough that the agent finished without writing its
            file; send it back with feedback rather than retrying blind. <Term>tests_failed</Term>{" "}
            means the build compiled a plan the tests disagree with — read the run, then decide
            whether the PRD or the code is wrong.
          </p>
        </Section>

        <Section id="change" title="Changing a stage">
          <p className="flex items-start gap-2">
            <SlidersHorizontalIcon
              aria-hidden
              className="mt-[3px] size-3.5 shrink-0 text-muted-foreground"
            />
            <span>
              Every stage has five things you can change: its <Strong>instructions</Strong>, the{" "}
              <Strong>skill</Strong> it loads first, the <Strong>model</Strong>, whether a{" "}
              <Strong>person reviews</Strong> it, and its <Strong>time limit</Strong>. There are two
              places to change them and the difference matters.
            </span>
          </p>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-border/60 bg-card/40 px-3 py-2.5">
              <p className="text-[12px] font-medium text-foreground">For one task</p>
              <p className="mt-1 text-[12.5px] leading-[1.55]">
                In the composer, under "Adjust the stages for this task". Nobody else is affected,
                and the task keeps those settings for its whole life.
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-card/40 px-3 py-2.5">
              <p className="text-[12px] font-medium text-foreground">For everyone · admin</p>
              <p className="mt-1 text-[12.5px] leading-[1.55]">
                The <Strong>Pipelines</Strong> tab. Changes what future tasks run; anything already
                in flight is untouched. The JSON files in the repository stay the source you can
                always restore to.
              </p>
            </div>
          </div>

          <p>
            Your session lasts 30 days. Change your password from your name in the top right — that
            also signs out your other devices.
          </p>
        </Section>
      </div>

      <nav aria-label="On this page" className="hidden lg:block">
        <div className="sticky top-6 space-y-1 border-l border-border/60 pl-3">
          <p className="mb-1.5 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground/60 uppercase">
            On this page
          </p>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() =>
                document
                  .getElementById(s.id)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
              className={cn(
                "block w-full text-left text-[12px] leading-[1.5] transition-colors",
                active === s.id
                  ? "font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s.title}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
