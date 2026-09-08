import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { initialsOf, useAssignee } from "./assignees";

/**
 * The face beside a thread: whose ticket this is.
 *
 * Falls back to initials, which is not a degraded state — most people never set a
 * GitHub username, and a coloured monogram identifies three teammates as well as a
 * photograph does. Renders nothing at all for threads that are not Foundry's.
 */
export function AssigneeAvatar({
  thread,
  className,
}: {
  thread: { branch?: string | null; title?: string | null };
  className?: string;
}) {
  const who = useAssignee(thread);
  if (!who) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "grid size-4 shrink-0 place-items-center overflow-hidden rounded-full bg-secondary text-[8px] font-medium text-secondary-foreground",
              className,
            )}
          />
        }
      >
        {/* The monogram is always there, underneath. A username that no longer
            exists on GitHub then costs nothing: the picture hides itself and what
            was already correct shows through. */}
        <span className="col-start-1 row-start-1">{initialsOf(who.name)}</span>
        {who.login ? (
          <img
            src={`https://github.com/${who.login}.png?size=48`}
            alt=""
            loading="lazy"
            className="col-start-1 row-start-1 size-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
            }}
          />
        ) : null}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{who.name}</TooltipPopup>
    </Tooltip>
  );
}
