import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import {
  ExternalLinkIcon,
  FileTextIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  PlayIcon,
  RotateCwIcon,
  XIcon,
} from "lucide-react";
import { cn } from "~/lib/utils";
import {
  activeMs,
  ago,
  duration,
  initials,
  NEEDS_HUMAN,
  PARK_REASON,
  post,
  toneOf,
  unauthorized,
  type ArtifactMeta,
  type Detail,
  type Repo,
  type Run,
  type Task,
  type User,
} from "./api";
import { ArtifactViewer, DiffView } from "./Artifact";
import { GatePanel, QuestionsPanel } from "./HumanPanels";
import { ActiveTime, SpineNode } from "./Spine";
import { Workspace } from "./Workspace";
import { StateBadge } from "./StateBadge";

/**
 * Everything about one task, in the order a person needs it: what it is, then
 * what it is waiting for, then the history that explains how it got there.
 */
export function TaskDetail({
  task,
  detail,
  repo,
  users,
  envId,
  onChanged,
  now,
}: {
  task: Task;
  detail: Detail | null;
  repo: Repo | undefined;
  users: User[];
  envId: string | null;
  onChanged: () => void;
  now: number;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<
    { kind: "artifact"; meta: ArtifactMeta } | { kind: "diff"; fromId: string; toId: string } | null
  >(null);
  useEffect(() => {
    setView(null);
    setError(null);
  }, [task.id]);

  const act = async (path: string) => {
    setBusy(true);
    setError(null);
    const r = await post<{ error?: string }>(path);
    setBusy(false);
    if (!unauthorized(r) && r.error) setError(r.error);
    onChanged();
  };

  const runs = detail?.runs ?? [];
  const artifacts = detail?.artifacts ?? [];
  const gates = detail?.gates ?? [];
  const assignee = users.find((u) => u.id === task.assignee_id);
  const versionsOf = (stage: string) =>
    artifacts.filter((a) => a.stage === stage).sort((a, b) => a.version - b.version);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-border/50 px-4 py-3">
        <div className="flex items-start gap-2">
          <h2 className="min-w-0 flex-1 text-[15px] leading-snug font-semibold tracking-[-0.01em] text-foreground">
            {task.title}
          </h2>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
            {task.ticket}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-muted-foreground">
          <Badge variant="outline" size="sm">
            {task.pipeline}
          </Badge>
          {repo ? <span>{repo.name}</span> : null}
          <span className="inline-flex items-center gap-1">
            <GitBranchIcon className="size-3" />
            {task.branch}
          </span>
          {assignee ? (
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex items-center gap-1" />}>
                <span className="grid size-4 place-items-center rounded-full bg-secondary text-[9px] font-medium text-secondary-foreground">
                  {initials(assignee.name)}
                </span>
                {assignee.name}
              </TooltipTrigger>
              <TooltipPopup side="bottom">Assigned to {assignee.email}</TooltipPopup>
            </Tooltip>
          ) : (
            <span className="text-muted-foreground/70">unassigned</span>
          )}
          <span className="text-muted-foreground/70">· created {ago(task.created_at, now)}</span>
        </div>
        {task.description ? (
          <p className="mt-2 text-[13px] leading-[1.5] whitespace-pre-wrap text-muted-foreground">
            {task.description}
          </p>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-3">
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
          <ol className="pt-0.5">
            {runs.map((run, i) => {
              const gate = gates.find((g) => g.stage_run_id === run.id && !g.decided_at);
              const artifact = artifacts.find((a) => a.id === run.artifact_id);
              return (
                <SpineNode key={run.id} tone={toneOf(run.state)} last={i === runs.length - 1}>
                  <RunCard
                    run={run}
                    gate={gate}
                    artifact={artifact}
                    versions={versionsOf(run.stage)}
                    envId={envId}
                    busy={busy}
                    now={now}
                    onOpenArtifact={(meta) => setView({ kind: "artifact", meta })}
                    onDiff={(fromId, toId) => setView({ kind: "diff", fromId, toId })}
                    onRetry={() => void act(`/api/runs/${run.id}/retry`)}
                    onCancel={() => void act(`/api/runs/${run.id}/cancel`)}
                    onChanged={onChanged}
                  />
                </SpineNode>
              );
            })}
          </ol>
        )}

        <Workspace taskId={task.id} onChanged={onChanged} />

        {view?.kind === "artifact" ? (
          <ArtifactViewer
            meta={view.meta}
            versions={versionsOf(view.meta.stage)}
            onPickVersion={(meta) => setView({ kind: "artifact", meta })}
            onDiff={(fromId, toId) => setView({ kind: "diff", fromId, toId })}
            onClose={() => setView(null)}
          />
        ) : null}
        {view?.kind === "diff" ? (
          <DiffView fromId={view.fromId} toId={view.toId} onClose={() => setView(null)} />
        ) : null}
      </div>
    </div>
  );
}

function StartCard({ task, busy, onStart }: { task: Task; busy: boolean; onStart: () => void }) {
  if (task.state !== "open") {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">This task is {task.state}.</p>
    );
  }
  return (
    <section className="rounded-xl border border-border/60 bg-card/40 px-3 py-3">
      <h3 className="text-[13px] font-medium text-foreground">Nothing has run yet</h3>
      <p className="mt-1 text-[13px] leading-[1.45] text-muted-foreground">
        Starting runs{" "}
        <span className="font-mono text-[12px]">{task.pipeline_snapshot[0]?.name}</span> as an agent
        session on <span className="font-mono text-[12px]">{task.branch}</span>. It will ask you
        anything it needs before it writes.
      </p>
      <Button size="sm" className="mt-2.5" onClick={onStart} disabled={busy}>
        {busy ? <Spinner /> : <PlayIcon />}Start the pipeline
      </Button>
    </section>
  );
}

function RunCard({
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
  onCancel,
  onChanged,
}: {
  run: Run;
  gate: import("./api").GateRow | undefined;
  artifact: ArtifactMeta | undefined;
  versions: ArtifactMeta[];
  envId: string | null;
  busy: boolean;
  now: number;
  onOpenArtifact: (meta: ArtifactMeta) => void;
  onDiff: (fromId: string, toId: string) => void;
  onRetry: () => void;
  onCancel: () => void;
  onChanged: () => void;
}) {
  const needsHuman = NEEDS_HUMAN.has(run.state);
  const park = run.park_reason ? (PARK_REASON[run.park_reason] ?? run.park_reason) : null;
  const [showDetail, setShowDetail] = useState(false);

  return (
    <div
      className={cn(
        "rounded-xl border bg-card/40",
        needsHuman ? "border-warning/32" : "border-border/60",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
        <span className="text-[13px] font-medium text-foreground">{run.stage}</span>
        {run.attempt > 1 ? (
          <span className="font-mono text-[11px] text-muted-foreground">attempt {run.attempt}</span>
        ) : null}
        <StateBadge state={run.state} className="ml-auto" />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-2 font-mono text-[11px] text-muted-foreground">
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
      </div>

      {park ? (
        <div className="mx-3 mb-2 rounded-lg border border-destructive/24 bg-destructive/6 px-2.5 py-2">
          <p className="text-[13px] text-destructive-foreground">{park}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Nothing retries on its own. Fix what caused it, then run this stage again.
          </p>
          {run.park_detail ? (
            <>
              <Button
                size="xs"
                variant="ghost-muted"
                className="mt-1 -ml-1.5"
                onClick={() => setShowDetail((v) => !v)}
              >
                {showDetail ? "Hide details" : "Show details"}
              </Button>
              {showDetail ? (
                <pre className="mt-1 max-h-40 overflow-auto rounded-md border border-border/60 bg-background p-2 font-mono text-[10px] leading-4 whitespace-pre-wrap text-muted-foreground">
                  {JSON.stringify(run.park_detail, null, 1).slice(0, 4000)}
                </pre>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2.5">
        {artifact ? (
          <Button size="xs" variant="outline" onClick={() => onOpenArtifact(artifact)}>
            <FileTextIcon />
            {artifact.kind === "html" ? "Open the mockup" : "Read it"}
            {versions.length > 1 ? ` · v${artifact.version}` : ""}
          </Button>
        ) : null}
        {versions.length > 1 && artifact ? (
          <Button
            size="xs"
            variant="ghost-muted"
            onClick={() => {
              const prev = versions.find((v) => v.version === artifact.version - 1) ?? versions[0]!;
              if (prev.id !== artifact.id) onDiff(prev.id, artifact.id);
            }}
          >
            What changed
          </Button>
        ) : null}
        {run.pr_url ? (
          <Button
            size="xs"
            variant="outline"
            render={<a href={run.pr_url} target="_blank" rel="noreferrer" />}
          >
            <GitPullRequestIcon /> Pull request
          </Button>
        ) : null}
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
        {run.state === "parked" ? (
          <Button size="xs" variant="outline" onClick={onRetry} disabled={busy}>
            <RotateCwIcon /> Run it again
          </Button>
        ) : null}
        {run.state !== "done" &&
        !NEEDS_HUMAN.has(run.state) &&
        run.state !== "rejected" &&
        run.state !== "cancelled" ? (
          <Button size="xs" variant="ghost-muted" onClick={onCancel} disabled={busy}>
            <XIcon /> Stop
          </Button>
        ) : null}
      </div>

      {run.state === "awaiting_answers" ? (
        <div className="px-2 pb-2">
          <QuestionsPanel run={run} onAnswered={onChanged} />
        </div>
      ) : null}
      {gate ? (
        <div className="px-2 pb-2">
          <GatePanel gate={gate} artifact={artifact} onDecided={onChanged} />
        </div>
      ) : null}
    </div>
  );
}

export { duration };
