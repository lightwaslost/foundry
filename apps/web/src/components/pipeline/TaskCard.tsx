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
        "group flex w-full flex-col gap-2 rounded-xl border bg-card px-2.5 py-2.5 text-left transition-colors",
        selected
          ? "border-primary/60 ring-3 ring-primary/10"
          : "border-border/70 hover:border-border",
        waiting && !selected && "border-warning/60",
        movable && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-40",
      )}
    >
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 text-[13px] leading-snug font-medium text-foreground">
          {task.title}
        </span>
        <span className="shrink-0 pt-px text-[11px] text-muted-foreground tabular-nums">
          {task.ticket.replace("FND-", "")}
        </span>
      </div>
      <Spine bars stages={task.pipeline_snapshot} runs={runs} taskState={task.state} />
      <div className="flex items-center gap-1.5">
        {waiting ? (
          <StateBadge state={waiting.state} />
        ) : task.state === "done" ? (
          <Badge variant="success" size="sm">
            Shipped
          </Badge>
        ) : task.state !== "open" ? (
          <Badge variant="secondary" size="sm" className="capitalize">
            {task.state}
          </Badge>
        ) : current ? (
          <StateBadge state={current.state} />
        ) : (
          <Badge variant="secondary" size="sm">
            Not started
          </Badge>
        )}
        {(task.repo_ids?.length ?? 0) > 1 ? (
          <span
            title={`Spans ${task.repo_ids!.length} repositories on one branch`}
            className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground"
          >
            <LayersIcon aria-hidden className="size-3" />
            {task.repo_ids!.length}
          </span>
        ) : null}
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground/80 tabular-nums">
          {ago(current?.queued_at ?? task.created_at, now)}
        </span>
        {assignee ? (
          <span
            title={assignee.name}
            className="grid size-5 shrink-0 place-items-center rounded-full border border-border/70 bg-secondary text-[9px] font-medium text-secondary-foreground"
          >
            {initials(assignee.name)}
          </span>
        ) : null}
      </div>
    </button>
  );
}
