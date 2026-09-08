import { cn } from "~/lib/utils";
import { AiraaMark } from "~/components/AiraaMark";

/**
 * Waiting, in Airaa's own shape.
 *
 * The mark is four arcs set at ninety degrees to each other, so turning it reads
 * as motion on its own — no ring drawn around it, no second shape competing with
 * the brand. Deliberately slow: a spinner that races suggests something is wrong,
 * and most of these waits are a network round trip, not a fault.
 *
 * `label` is the honest one-liner about what is being waited for. It is announced
 * to screen readers whether or not it is shown, because "Loading…" with no subject
 * is the least useful thing an interface can say.
 */
export function AiraaLoader({
  label = "Loading",
  size = "md",
  showLabel = true,
  className,
}: {
  label?: string;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  className?: string;
}) {
  const px = size === "sm" ? "size-5" : size === "lg" ? "size-12" : "size-8";
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex flex-col items-center justify-center gap-3", className)}
    >
      <AiraaMark
        aria-hidden
        className={cn(
          px,
          "text-primary motion-safe:animate-[airaa-turn_2.4s_cubic-bezier(0.4,0,0.2,1)_infinite]",
        )}
      />
      {showLabel ? <p className="text-[13px] text-muted-foreground">{label}</p> : null}
      <span className="sr-only">{label}</span>
    </div>
  );
}
