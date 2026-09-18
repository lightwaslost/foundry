import { useEffect } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { cn } from "~/lib/utils";

export type FoundryTab = "board" | "stages" | "usage" | "team" | "docs" | "monitor";

/**
 * While a Foundry page is mounted, its popups — which render into <body>, outside
 * the page — are set in the page's type too. See `.foundry-portals` in index.css.
 */
export function useFoundryType(): void {
  useEffect(() => {
    document.body.classList.add("foundry-portals");
    return () => document.body.classList.remove("foundry-portals");
  }, []);
}

const PRIMARY: Array<[FoundryTab, string]> = [
  ["board", "Pipeline"],
  ["stages", "Stages"],
  ["usage", "Team usage"],
  ["team", "Team"],
];
/** Opened rarely, so they share one menu instead of a tab each. */
const MORE: Array<[FoundryTab, string]> = [
  ["docs", "How it works"],
  ["monitor", "Server monitor"],
];

export const FOUNDRY_TAB_LABEL: Record<FoundryTab, string> = Object.fromEntries([
  ...PRIMARY,
  ...MORE,
]) as Record<FoundryTab, string>;

/** The one tab row for every Foundry page, so moving between them looks like one place. */
export function FoundryTabs({
  active,
  onPick,
}: {
  active: FoundryTab;
  onPick: (tab: FoundryTab) => void;
}) {
  const inMore = MORE.some(([t]) => t === active);
  return (
    <div className="flex items-center rounded-lg border border-border/60 p-0.5">
      {PRIMARY.map(([t, label]) => (
        <Button
          key={t}
          size="xs"
          variant={active === t ? "secondary" : "ghost-muted"}
          onClick={() => onPick(t)}
        >
          {label}
        </Button>
      ))}
      <Menu>
        <MenuTrigger
          className={cn(
            "inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs",
            inMore
              ? "bg-secondary text-secondary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {inMore ? FOUNDRY_TAB_LABEL[active] : "More"}
          <ChevronDownIcon aria-hidden className="size-3 opacity-70" />
        </MenuTrigger>
        <MenuPopup align="end" side="bottom">
          {MORE.map(([t, label]) => (
            <MenuItem key={t} onClick={() => onPick(t)}>
              {label}
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
    </div>
  );
}
