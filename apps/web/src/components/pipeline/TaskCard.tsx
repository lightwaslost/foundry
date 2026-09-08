import { LayersIcon } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";

import { ago, initials, type Run, type Task, type User } from "./api";
import { Spine } from "./Spine";
import { StateBadge } from "./StateBadge";

/**
 * One task on the board.
 *
 * It lives in its own file rather than in the route because the 'How it works'
 * tab renders the real card with invented data — a picture of the board that
 * cannot drift from the board. Everything it needs arrives as props; it fetches
 * nothing, which is what makes that possible.
 */
export function TaskCard({
  task,
  runs,
  users,
  selected,
  waiting,
  onSelect,
  now,
  movable,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  task: Task;
  runs: Run[];
  users: User[];
  selected: boolean;
  waiting: Run | undefined;
  onSelect: () => void;
  now: number;
  movable: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const assignee = users.find((u) => u.id === task.assignee_id);
  const current = runs.at(-1);
  return (
    <button
      type="button"
      onClick={onSelect}
      draggable={movable}
      onDragStart={(e) => {
        if (!movable) return e.preventDefault();
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", task.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      title={movable ? "Drag to another stage" : "Running — stop it before moving it"}
      className={cn(
        "group relative w-full rounded-xl border bg-card/40 px-3 py-2.5 text-left transition-colors",
        selected
          ? "border-primary/60 bg-card/70"
          : "border-border/60 hover:border-border hover:bg-card/60",
        waiting && "border-warning/40",
        movable && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-40",
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
        {(task.repo_ids?.length ?? 0) > 1 ? (
          <span
            title={`Spans ${task.repo_ids!.length} repositories on one branch`}
            className="inline-flex shrink-0 items-center gap-0.5 font-mono text-[10px] text-muted-foreground"
          >
            <LayersIcon aria-hidden className="size-3" />
            {task.repo_ids!.length}
          </span>
        ) : null}
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
