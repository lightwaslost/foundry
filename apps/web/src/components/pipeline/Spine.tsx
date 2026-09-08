import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { duration, toneOf, STATE_LABEL, type Run, type SnapshotStage, type Tone } from "./api";

/**
 * The spine: one segment per stage of a task's frozen pipeline, in order.
 *
 * It is the only place on the board that shows a whole task at a glance, so it
 * carries state rather than decoration — a filled segment is finished work, the
 * lit one is where the task is now, and an amber segment means it is stopped on a
 * person. Segments are proportional to nothing: equal widths read as a process,
 * and the process is the point.
 */
const SEGMENT_TONE: Record<Tone, string> = {
  done: "bg-success/70",
  busy: "bg-primary",
  attention: "bg-warning",
  failed: "bg-destructive",
  idle: "bg-border",
};

export function Spine({
  stages,
  runs,
  taskState,
  className,
}: {
  stages: SnapshotStage[];
  runs: Run[];
  taskState: string;
  className?: string;
}) {
  // The newest run per stage decides that segment's tone.
  const latest = new Map<string, Run>();
  for (const r of runs) latest.set(r.stage, r);

  return (
    <div className={cn("flex items-center gap-[3px]", className)}>
      {stages.map((s) => {
        const run = latest.get(s.name);
        const tone: Tone = taskState === "done" ? "done" : run ? toneOf(run.state) : "idle";
        const label = run
          ? `${s.name} · ${STATE_LABEL[run.state]}${run.attempt > 1 ? ` · attempt ${run.attempt}` : ""}`
          : `${s.name} · not started`;
        return (
          <Tooltip key={s.name}>
            <TooltipTrigger
              render={
                <span
                  className={cn(
                    "h-[3px] flex-1 rounded-full transition-colors",
                    SEGMENT_TONE[tone],
                    tone === "busy" && "motion-safe:animate-pulse",
                    tone === "idle" && "bg-border/70",
                  )}
                />
              }
            />
            <TooltipPopup side="bottom">{label}</TooltipPopup>
          </Tooltip>
        );
      })}
    </div>
  );
}

/**
 * The same idea rotated for the detail panel: a rail with a node per run, so the
 * history of a task — including the attempts that were sent back — reads top to
 * bottom without a table.
 */
export function SpineNode({
  tone,
  last = false,
  children,
}: {
  tone: Tone;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex gap-3 pb-3 last:pb-0">
      <div className="flex w-3 shrink-0 flex-col items-center pt-2">
        <span
          className={cn(
            "size-2 shrink-0 rounded-full ring-3 ring-background",
            SEGMENT_TONE[tone],
            tone === "busy" && "motion-safe:animate-pulse",
          )}
        />
        {last ? null : <span className="mt-1 w-px flex-1 bg-border/70" />}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Elapsed working time, excluding everything spent waiting on a human. */
export function ActiveTime({ ms, timeoutMs }: { ms: number; timeoutMs: number }) {
  const share = timeoutMs > 0 ? Math.min(1, ms / timeoutMs) : 0;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "font-mono text-[11px] tabular-nums",
              share > 0.8 ? "text-warning-foreground" : "text-muted-foreground",
            )}
          />
        }
      >
        {duration(ms)}
      </TooltipTrigger>
      <TooltipPopup side="top">
        Working time, excluding any wait on a person · limit {duration(timeoutMs)}
      </TooltipPopup>
    </Tooltip>
  );
}
