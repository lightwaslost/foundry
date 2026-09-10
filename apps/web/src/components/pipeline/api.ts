/**
 * The Foundry service, seen from inside T3.
 *
 * Foundry is proxied same-origin under /foundry-api (Traefik in production, a tiny
 * node proxy in local development), so these are plain same-origin fetches carrying
 * Foundry's own session cookie. A 401 is not an error here — it means "show the
 * sign-in form" — so it is modelled in the return type rather than thrown.
 */
export const API = "/foundry-api";

export type Unauthorized = { __unauthorized: true };
export const unauthorized = (v: unknown): v is Unauthorized =>
  typeof v === "object" && v !== null && "__unauthorized" in v;

export async function call<T>(path: string, init?: RequestInit): Promise<T | Unauthorized> {
  const res = await fetch(`${API}${path}`, { credentials: "include", ...init });
  if (res.status === 401) return { __unauthorized: true };
  return (await res.json()) as T;
}

export const post = <T>(path: string, body?: unknown) =>
  call<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

export const put = <T>(path: string, body: unknown) =>
  call<T>(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export const del = <T>(path: string) => call<T>(path, { method: "DELETE" });

// ── shapes ────────────────────────────────────────────────────────────────────
export type ArtifactKind = "markdown" | "html" | "pull_request";
export type Gate = "human" | "auto";

export interface StageDef {
  name: string;
  skill: string | null;
  provider: { instanceId: string; model: string };
  inputs: string[];
  output: { file?: string; kind: ArtifactKind };
  gate: Gate;
  timeout_minutes: number;
  prompt: string | null;
  questions: boolean;
  /** How hard the model thinks. Null means the provider's own default. */
  reasoning: string | null;
  tests: "required" | null;
}
/**
 * The one catalogue of stages, versioned. There used to be three pipelines; two
 * of them were subsets of the third, so "which pipeline" became "which stages" —
 * a per-task choice — and what a stage does became one shared setting.
 */
export interface Catalogue {
  stages: StageDef[];
  version: number;
  updated_by: string | null;
  updated_at: string | null;
}

export interface CatalogueVersion {
  version: number;
  note: string | null;
  updated_by: string | null;
  updated_at: string;
}
export interface Repo {
  id: string;
  name: string;
  default_branch: string;
  clone_state: string;
  test_command?: string | null;
}
export interface User {
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
}
/** The stage list frozen into a task at creation. */
export type SnapshotStage = Pick<
  StageDef,
  "name" | "output" | "gate" | "skill" | "provider" | "timeout_minutes"
> & { prompt?: string | null };

export interface Task {
  id: string;
  ticket: string;
  title: string;
  description: string;
  repo_id: string;
  /** Every repository the task may change, primary first. */
  repo_ids?: string[];
  pipeline: string;
  pipeline_snapshot: SnapshotStage[];
  assignee_id: string | null;
  branch: string;
  stage: string | null;
  state: "open" | "done" | "rejected" | "cancelled";
  created_at: string;
}

export type RunState =
  | "queued"
  | "preparing"
  | "questioning"
  | "awaiting_answers"
  | "running"
  | "conversing"
  | "collecting"
  | "testing"
  | "awaiting_gate"
  | "done"
  | "parked"
  | "rejected"
  | "cancelled";

export interface Run {
  id: string;
  stage: string;
  attempt: number;
  state: RunState;
  t3_thread_id: string | null;
  /** This stage's turn is a conversation with a person, not one shot. */
  stage_interactive?: boolean;
  /** When the agent's thread last changed. Absence of movement is the only signal
   *  a wedged session gives — nothing reports an error. */
  last_progress_at?: string | null;
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
  test_exit_code: number | null;
  /** Documents this run was built from that have a newer version now. An older backend sends none. */
  stale_inputs?: Array<{ stage: string; built_from: number; latest: number }>;
}
export interface GateRow {
  id: string;
  stage_run_id: string;
  stage: string;
  attempt: number;
  artifact_id: string | null;
  decision: string | null;
  feedback: string | null;
  decided_by: string | null;
  decided_at: string | null;
}
export interface ArtifactMeta {
  id: string;
  stage: string;
  version: number;
  author_id: string | null;
  kind: ArtifactKind;
  created_at: string;
}
export interface Question {
  id: string;
  stage_run_id: string;
  request_id: string;
  batch: number;
  header: string | null;
  question: string;
  options: Array<{ label: string; description?: string }>;
  multi_select: boolean;
  allow_custom: boolean;
  response_mode: string | null;
  answer: unknown | null;
  answered_by: string | null;
  source: "foundry" | "t3" | null;
}
/** Work that went through on the shared token because the assignee's own was refused. */
export interface TokenNotice {
  id: string;
  stage_run_id: string | null;
  payload: { repo?: string; login?: string; step?: string; detail?: string };
  created_at: string;
}
export interface Detail {
  runs: Run[];
  gates: GateRow[];
  artifacts: ArtifactMeta[];
  notices?: TokenNotice[];
}

export interface Comment {
  id: string;
  task_id: string;
  author_id: string | null;
  author: string | null;
  body: string;
  created_at: string;
}
/**
 * A conversation that has not become a task yet: the intake agent interviews you
 * in a T3 thread, then proposes the whole ticket. Nothing here is persisted state
 * the client has to advance — the server derives it from the thread on every read.
 */
export interface Draft {
  id: string;
  title: string;
  repo_id: string;
  assignee_id: string | null;
  created_by: string;
  thread_id: string | null;
  task_id: string | null;
  created_at: string;
  /** The task it became, once it has. Null while it is still a conversation. */
  ticket: string | null;
  task_state: string | null;
  /** Where that task is waiting — the stage after the one the conversation wrote. */
  task_stage: string | null;
}

/** What the agent hands back once it has enough. Shaped like the create body. */
export interface Proposal {
  title: string;
  description: string;
  stages: string[];
  /** The first stage's document, saved with the task so that stage never runs. */
  one_pager: string | null;
}

export interface DraftView {
  draft: Draft;
  /**
   * "thinking" while the agent has the turn, "waiting" when it is your move, and
   * "blocked" when it used its question tool — which only T3 can answer.
   */
  state: "thinking" | "waiting" | "blocked" | "error";
  messages: Array<{ role: string; text: string }>;
  proposal: Proposal | null;
  error: string | null;
  attachments: AttachmentMeta[];
}

export interface AttachmentMeta {
  id: string;
  task_id: string | null;
  uploaded_by: string | null;
  uploader: string | null;
  filename: string;
  mime: string;
  size: number;
  created_at: string;
}

/** One row of the Linear picker — no description, which can run to 10 KB. */
export interface LinearIssueRow {
  identifier: string;
  title: string;
  url: string;
  state: { name: string; type: string };
  assignee: { name: string } | null;
}
/** A ticket picked to start from. Its images are fetched by Foundry, not the browser. */
export interface LinearIssue {
  identifier: string;
  title: string;
  url: string;
  description: string;
  image_count: number;
}

/** What a picked ticket put into New Task, so unlinking or re-picking takes exactly that back out. */
export interface LinearFill {
  /** The title it filled in, or null when the person had already typed one. */
  title: string | null;
  /** What it added to the context box: the ticket body and its link. */
  block: string;
}

type Fields = { title: string; description: string };

/**
 * Fill New Task from a ticket. Nothing typed is overwritten: an empty title takes
 * the ticket's, and typed context gets the ticket below it.
 */
export function applyLinear(
  cur: Fields,
  issue: Pick<LinearIssue, "title" | "description" | "url">,
): Fields & { fill: LinearFill } {
  const block = [issue.description.trim(), `Linear: ${issue.url}`].filter(Boolean).join("\n\n");
  const title = cur.title.trim() ? null : issue.title.slice(0, 200);
  return {
    title: title ?? cur.title,
    description: cur.description.trim() ? `${cur.description.trimEnd()}\n\n${block}` : block,
    fill: { title, block },
  };
}

/**
 * Take a ticket's text back out, leaving what the person typed. A title they
 * changed, or a ticket block they edited, is theirs now and stays.
 */
export function removeLinear(cur: Fields, fill: LinearFill): Fields {
  const at = cur.description.lastIndexOf(fill.block);
  const before = cur.description.slice(0, Math.max(at, 0)).trim();
  const after = cur.description.slice(at + fill.block.length).trim();
  return {
    title: fill.title !== null && cur.title === fill.title ? "" : cur.title,
    description: at === -1 ? cur.description : [before, after].filter(Boolean).join("\n\n"),
  };
}

/** What a person may change per stage — for a whole pipeline or for one task. */
export interface StageOverride {
  prompt?: string;
  skill?: string | null;
  model?: string;
  instanceId?: string;
  /** null puts the stage back on the provider's own default. */
  reasoning?: string | null;
  gate?: Gate;
  timeout_minutes?: number;
  questions?: boolean;
}

// ── presentation helpers ──────────────────────────────────────────────────────
export const BUSY: ReadonlySet<RunState> = new Set([
  "preparing",
  "questioning",
  "running",
  "collecting",
  "testing",
]);
/** States where the run is stopped, waiting for a person to act. */
export const NEEDS_HUMAN: ReadonlySet<RunState> = new Set([
  "awaiting_answers",
  "conversing",
  "awaiting_gate",
  "parked",
]);

export type Tone = "idle" | "busy" | "attention" | "done" | "failed";

export function toneOf(state: RunState): Tone {
  if (state === "done") return "done";
  if (state === "parked" || state === "rejected" || state === "cancelled") return "failed";
  if (state === "awaiting_gate" || state === "awaiting_answers" || state === "conversing")
    return "attention";
  if (BUSY.has(state)) return "busy";
  return "idle";
}

export const STATE_LABEL: Record<RunState, string> = {
  queued: "queued",
  preparing: "preparing",
  questioning: "asking",
  awaiting_answers: "needs answers",
  running: "working",
  conversing: "your turn",
  collecting: "collecting",
  testing: "testing",
  awaiting_gate: "needs review",
  done: "done",
  parked: "parked",
  rejected: "rejected",
  cancelled: "cancelled",
};

/**
 * What this run wants from you, in the words of the thing you are about to do.
 *
 * Three different states all said "Waiting on you", which is the one fact the
 * reader already had — they opened the task because something was waiting. So a
 * mid-interview one-pager read exactly like a finished one asking to be signed off.
 *
 * `conversing` splits on whether the deliverable exists yet: a conversation with a
 * draft in it is a review, one without is still an interview. `hasDraft` comes from
 * the worktree via /api/runs/:id/conversation — NOT from `artifacts`, which are
 * created by collection and therefore do not exist until after you accept.
 *
 * Deliberately not STATE_LABEL. That one is total over RunState, lower-case and
 * noun-shaped, sized for a history row beside a duration; this covers only the four
 * states with a move in them, is sentence-case and imperative, and needs data a
 * history row does not carry. Same states, different question.
 */
export function bannerFor(state: RunState, hasDraft: boolean): string {
  switch (state) {
    case "awaiting_gate":
      return "Ready for your decision";
    case "awaiting_answers":
      return "Needs your answers to start";
    case "conversing":
      return hasDraft ? "Draft ready — reply or accept" : "Answer to continue";
    case "parked":
      return "Stopped";
    default:
      return "Working";
  }
}

/** Why a run parked, in words a person can act on. */
export const PARK_REASON: Record<string, string> = {
  timeout: "Ran past its time limit",
  turn_error: "The agent's session failed",
  setup_failed: "The repository could not install its dependencies",
  token_rate_limited: "Claude usage limit reached",
  token_auth_failed: "The Claude credential was rejected",
  question_state_lost: "The agent session that asked the question is gone",
  stalled: "The agent went quiet without failing",
  dispatch_rejected: "T3 refused the command",
  t3_unreachable: "T3 could not be reached",
  unexpected_approval: "The agent asked for a permission it should not need",
  output_missing: "The agent finished without writing its deliverable",
  output_unchanged: "The rerun produced the same output as before",
  git_commit_failed: "The commit failed",
  tests_failed: "Tests failed",
  tests_timeout: "Tests ran too long",
  git_push_failed: "The branch could not be pushed",
  pr_create_failed: "The pull request could not be opened",
  prepare_failed: "The worktree could not be prepared",
  no_healthy_token: "No usable Claude credential",
};

export function duration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Active time so far, counting the open interval — the same rule the server uses. */
export function activeMs(run: Pick<Run, "active_ms" | "active_since">, now: number): number {
  const base = Number(run.active_ms ?? 0);
  return run.active_since ? base + Math.max(0, now - new Date(run.active_since).getTime()) : base;
}

export function ago(iso: string | null, now: number): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export const patch = <T>(path: string, body: unknown) =>
  call<T>(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export const formatBytes = (n: number): string =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${Math.round(n / 1024)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`;

export const initials = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";
