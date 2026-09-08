import { Badge } from "~/components/ui/badge";
import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/utils";
import { BUSY, STATE_LABEL, toneOf, type RunState } from "./api";

const VARIANT = {
  done: "success",
  busy: "info",
  attention: "warning",
  failed: "error",
  idle: "secondary",
} as const;

/** One run's state, in the same language the board uses everywhere else. */
export function StateBadge({ state, className }: { state: RunState; className?: string }) {
  const tone = toneOf(state);
  return (
    <Badge variant={VARIANT[tone]} size="sm" className={cn("gap-1 font-mono", className)}>
      {BUSY.has(state) ? <Spinner className="size-2.5" /> : null}
      {STATE_LABEL[state]}
    </Badge>
  );
}
