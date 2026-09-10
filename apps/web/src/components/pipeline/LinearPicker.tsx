import { useEffect, useState } from "react";
import { LinkIcon, SearchIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Combobox,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxStatus,
  ComboboxTrigger,
} from "~/components/ui/combobox";
import { API, type LinearIssue, type LinearIssueRow, type User } from "./api";

// Remembered for the page's life: a Foundry without Linear credentials answers 503,
// and asking again every time the dialog opens would only repeat that.
let unconfigured = false;

const selectClass =
  "h-6 rounded-md border border-border/60 bg-transparent px-1.5 text-xs text-muted-foreground";

/**
 * Start from a Linear ticket. Foundry does the searching — it holds the credential —
 * so the combobox filters nothing itself. Renders nothing when Foundry has no Linear
 * credentials, so a board without them looks exactly as it did.
 */
export function LinearPicker({
  users,
  me,
  onPick,
}: {
  users: User[];
  me: User | null;
  onPick: (issue: LinearIssue) => void;
}) {
  const [hidden, setHidden] = useState(unconfigured);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // "" is anyone, "none" is unassigned, anything else a Foundry user id.
  const [assignee, setAssignee] = useState("");
  const [state, setState] = useState<"all" | "open" | "done">("all");
  const [rows, setRows] = useState<{ open: LinearIssueRow[]; done: LinearIssueRow[] }>({
    open: [],
    done: [],
  });
  const [status, setStatus] = useState<string | null>(null);

  // Also the probe: the first search on mount is what finds out Linear is not set up.
  useEffect(() => {
    if (hidden) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      const qs = new URLSearchParams({ q: query.trim(), state });
      if (assignee) qs.set("assignee", assignee);
      try {
        const res = await fetch(`${API}/api/linear/issues?${qs}`, {
          credentials: "include",
          signal: ctl.signal,
        });
        if (res.status === 503) {
          unconfigured = true;
          setHidden(true);
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        setRows(await res.json());
        setStatus(null);
      } catch {
        if (!ctl.signal.aborted) setStatus("Linear unavailable");
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [hidden, query, assignee, state]);

  if (hidden) return null;

  const keys = [...rows.open, ...rows.done].map((r) => r.identifier);

  const pick = async (identifier: string) => {
    try {
      const res = await fetch(`${API}/api/linear/issues/${encodeURIComponent(identifier)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(String(res.status));
      onPick((await res.json()) as LinearIssue);
      setOpen(false);
    } catch {
      setStatus(`Could not load ${identifier}`);
    }
  };

  const group = (label: string, list: LinearIssueRow[], offset: number) =>
    list.length ? (
      <ComboboxGroup>
        <ComboboxGroupLabel>{label}</ComboboxGroupLabel>
        {list.map((r, i) => (
          <ComboboxItem
            key={r.identifier}
            hideIndicator
            index={offset + i}
            value={r.identifier}
            className="min-h-0 py-1.5 text-xs sm:min-h-0 sm:text-xs"
            contentClassName="flex min-w-0 items-center gap-2"
          >
            <span className="shrink-0 font-mono text-muted-foreground">{r.identifier}</span>
            <span className="min-w-0 flex-1 truncate">{r.title}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {r.state.name}
              {r.assignee ? ` · ${r.assignee.name}` : ""}
            </span>
          </ComboboxItem>
        ))}
      </ComboboxGroup>
    ) : null;

  return (
    <Combobox
      items={keys}
      // Foundry already narrowed the list; the combobox does no filtering of its own.
      filteredItems={keys}
      filter={null}
      autoHighlight
      value={null}
      onValueChange={(id) => {
        if (typeof id === "string") void pick(id);
      }}
      open={open}
      onOpenChange={setOpen}
    >
      <ComboboxTrigger render={<Button size="sm" variant="ghost-muted" />}>
        <LinkIcon aria-hidden className="size-3.5" />
        Start from a Linear ticket
      </ComboboxTrigger>
      <ComboboxPopup align="start" side="bottom" className="flex w-[28rem] flex-col">
        <div className="shrink-0 px-3 pt-2.5">
          <div className="relative -translate-y-px border-b border-border/70 pb-1.5 transition-colors focus-within:border-ring">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute top-1.5 left-0 size-4 shrink-0 text-muted-foreground/55"
            />
            <ComboboxInput
              aria-label="Search Linear tickets"
              className="[&_input]:h-6.5 [&_input]:ps-5 [&_input]:font-sans [&_input]:leading-6.5"
              inputClassName="rounded-none bg-transparent text-sm"
              placeholder="RAP-1920 or words from the title"
              showTrigger={false}
              size="sm"
              unstyled
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5 px-3 pt-2">
          <select
            aria-label="Assignee"
            className={selectClass}
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
          >
            <option value="">Anyone</option>
            {me ? <option value={me.id}>Me</option> : null}
            {users
              .filter((u) => u.id !== me?.id)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            <option value="none">Unassigned</option>
          </select>
          <select
            aria-label="Status"
            className={selectClass}
            value={state}
            onChange={(e) => setState(e.target.value as "all" | "open" | "done")}
          >
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="done">Done</option>
          </select>
        </div>
        <ComboboxList className="max-h-72">
          {group("Open", rows.open, 0)}
          {group("Done & cancelled", rows.done, rows.open.length)}
          {!status && keys.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">No tickets found.</p>
          ) : null}
        </ComboboxList>
        {status ? <ComboboxStatus>{status}</ComboboxStatus> : null}
      </ComboboxPopup>
    </Combobox>
  );
}
