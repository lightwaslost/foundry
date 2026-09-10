import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
import { Textarea } from "~/components/ui/textarea";
import { CheckIcon, ChevronRightIcon, PaperclipIcon, PlusIcon, XIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import {
  post,
  prefillFromLinear,
  unauthorized,
  type Catalogue,
  type Repo,
  type StageDef,
  type Task,
  type User,
} from "./api";
import { LinearPicker } from "./LinearPicker";
import { stageSummary } from "./StageFields";

/**
 * What the server's `selectStages` will leave each kept stage reading. Display
 * only — the backend recomputes it and is the authority. Kept in step with
 * `src/pipelines/store.ts:selectStages` in foundry-mvp.
 */
function resolveInputs(stages: StageDef[], skipped: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const produced = new Set<string>();
  for (const s of stages) {
    if (skipped.includes(s.name)) continue;
    const inputs = s.inputs.filter((i) => i === "ticket" || produced.has(i));
    produced.add(s.output.file ?? s.name);
    out.set(s.name, inputs.length ? inputs : ["ticket"]);
  }
  return out;
}

/**
 * Starting work. Two panes: on the left what you want, on the right which
 * stages will do it. The stage list is deliberately not folded away — picking
 * "just a mockup", or "I have the spec, only build it", is the point of the
 * dialog rather than an advanced option.
 *
 * The selection is stored as the stages left OUT, so changing pipeline clears
 * it without having to know the new pipeline's stage names.
 */
export function NewTask({
  catalogue,
  repos,
  defaultRepos = [],
  users,
  me,
  onTalk,
  onCreated,
  onCancel,
  onDirtyChange,
}: {
  catalogue: Catalogue;
  repos: Repo[];
  /** The repositories every task starts with, main first. Empty: just the first one. */
  defaultRepos?: string[];
  users: User[];
  me: User | null;
  /**
   * Talk it through instead of typing it. Files go up before the conversation
   * opens, so the agent has them on its very first turn.
   */
  onTalk?: (
    title: string,
    repoId: string,
    /** Travels beside repoId: the agent may add to this list, never take from it. */
    extraRepoIds: string[],
    assigneeId: string | null,
    files: File[],
    /** The context box — the agent reads it on its first turn, beside the title. */
    brief: string,
    linearIssue: string | null,
  ) => Promise<string | null>;
  onCreated: (id: string) => void;
  onCancel: () => void;
  /** So the dialog's own dismissals can ask before throwing away typed work. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  // The Linear ticket this started from. Unlinking keeps the text it filled in.
  const [linked, setLinked] = useState<{ identifier: string; image_count: number } | null>(null);
  // Every repository this task may change, in the order they were chosen. The head
  // is the main one: its pull request is the headline and the others link back to
  // it. Keeping that as a position rather than a second piece of
  // state is what makes "untick the primary" need no code -- the next one is
  // already standing where it needs to be.
  //
  // `null` means "not seeded yet", which is not the same as "they unticked
  // everything": `repos` arrives asynchronously, and an initial [] cannot tell
  // those apart.
  const [picked, setPicked] = useState<string[] | null>(null);
  const [assignee, setAssignee] = useState(me?.id ?? "");
  const [skipped, setSkipped] = useState<string[]>([]);
  const [busy, setBusy] = useState<"create" | "talk" | null>(null);
  // Held here until the draft exists to hang them on.
  const [files, setFiles] = useState<File[]>([]);
  const filePicker = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);

  const cloned = useMemo(() => repos.filter((r) => r.clone_state === "cloned"), [repos]);
  // What an untouched dialog starts with: the team's repositories, main first, or
  // just the first one when none are configured.
  const seed = useMemo(() => {
    const d = defaultRepos.filter((id) => cloned.some((r) => r.id === id));
    return d.length ? d : cloned[0] ? [cloned[0].id] : [];
  }, [defaultRepos, cloned]);
  useEffect(() => {
    if (picked === null && seed.length) setPicked(seed);
  }, [seed, picked]);
  const chosen = picked ?? [];
  const repo = chosen[0] ?? "";
  const extras = chosen.slice(1);
  const allPicked = cloned.length > 0 && chosen.length === cloned.length;

  const toggleRepo = (id: string) =>
    setPicked((prev) => {
      const cur = prev ?? [];
      if (!cur.includes(id)) return [...cur, id];
      if (cur.length === 1) return cur; // a task needs a main repository
      return cur.filter((x) => x !== id); // dropping the head promotes the next
    });
  const makePrimary = (id: string) =>
    setPicked((prev) => [id, ...(prev ?? []).filter((x) => x !== id)]);

  // How each stage behaves is settled in the Stages tab, for every task. All this
  // dialog decides is which of them run.
  const stages = catalogue.stages;

  const kept = stages.filter((s) => !skipped.includes(s.name));
  const resolved = resolveInputs(stages, skipped);
  const last = kept[kept.length - 1];
  const ending =
    last === undefined
      ? null
      : last.output.kind === "pull_request"
        ? "in a pull request"
        : `with ${last.output.file}`;

  const toggle = (name: string) =>
    setSkipped((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));

  const submit = async () => {
    if (!title.trim() || !repo || kept.length === 0) return;
    setBusy("create");
    setErr(null);
    const common = {
      title,
      description,
      ...(extras.length ? { extra_repo_ids: extras } : {}),
      assignee_id: assignee || null,
    };
    const r = await post<{ task?: Task; error?: string }>("/api/tasks", {
      ...common,
      repo_id: repo,
      // Sent only when it is not the whole catalogue, so an untouched dialog posts
      // exactly the body it always did.
      ...(skipped.length ? { stages: kept.map((st) => st.name) } : {}),
      ...(linked ? { linear_issue: linked.identifier } : {}),
    });
    setBusy(null);
    if (unauthorized(r)) return;
    if (r.error) return setErr(r.error);
    setTitle("");
    setDescription("");
    setLinked(null);
    setPicked(seed.length ? seed : null);
    onCreated(r.task!.id);
  };

  /** Hand the one-liner to an intake agent instead of filling the rest in here. */
  const talk = async () => {
    if (!onTalk || !title.trim() || !repo) return;
    setBusy("talk");
    setErr(null);
    const failure = await onTalk(
      title,
      repo,
      extras,
      assignee || null,
      files,
      description,
      linked?.identifier ?? null,
    );
    setBusy(null);
    if (failure) setErr(failure);
  };

  // Losing a half-written ticket to a stray Escape is a small betrayal people
  // remember, so leaving with something typed asks first — here and in the dialog.
  const dirty =
    title.trim().length > 0 ||
    description.trim().length > 0 ||
    files.length > 0 ||
    linked !== null ||
    // Divergence from the default, not "more than one" — otherwise seeding the
    // picker would make an untouched dialog prompt on every Escape.
    (picked !== null && picked.join() !== seed.join()) ||
    skipped.length > 0;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  const close = () => {
    if (dirty && !window.confirm("Discard this task? What you have typed will be lost.")) return;
    onCancel();
  };

  return (
    <section className="flex max-h-[85vh] flex-col">
      <header className="shrink-0 px-4 pt-4 pb-2">
        <h2 className="text-sm font-medium tracking-[-0.005em] text-foreground">New task</h2>
        <p className="text-[13px] text-muted-foreground">
          An agent writes the first stage. Nothing runs until you start it.
        </p>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-4 py-3 sm:grid-cols-[minmax(0,1fr)_320px]">
        {/* Left — the ask. */}
        <div className="space-y-3">
          {linked ? (
            <div className="space-y-1">
              <span className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/12 px-2 py-1 font-mono text-[11px] text-foreground">
                {linked.identifier}
                <button
                  type="button"
                  aria-label={`Unlink ${linked.identifier}`}
                  onClick={() => setLinked(null)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <XIcon aria-hidden className="size-3" />
                </button>
              </span>
              {linked.image_count > 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  {linked.image_count} image{linked.image_count === 1 ? "" : "s"} from{" "}
                  {linked.identifier} {linked.image_count === 1 ? "is" : "are"} attached when the
                  task is created
                </p>
              ) : null}
            </div>
          ) : (
            <LinearPicker
              users={users}
              me={me}
              onPick={(issue) => {
                const next = prefillFromLinear({ title, description }, issue);
                setTitle(next.title);
                setDescription(next.description);
                setLinked({ identifier: issue.identifier, image_count: issue.image_count });
              }}
            />
          )}
          <div className="space-y-1.5">
            <Label htmlFor="task-title">What do you want built?</Label>
            <Input
              id="task-title"
              autoFocus
              value={title}
              placeholder="Notifications when a stage needs a person"
              onChange={(e) => setTitle((e.target as HTMLInputElement).value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="task-context">Context for the agent</Label>
            <Textarea
              id="task-context"
              size="sm"
              className="max-h-[40vh] min-h-24 overflow-y-auto"
              value={description}
              placeholder="Who has the problem, what exists today, what done looks like, and anything you have already decided."
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {onTalk ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Label>Files</Label>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  onClick={() => filePicker.current?.click()}
                >
                  <PaperclipIcon aria-hidden className="size-3" />
                  attach
                </button>
              </div>
              <input
                ref={filePicker}
                type="file"
                multiple
                className="hidden"
                accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
                onChange={(e) => {
                  const picked = [...(e.currentTarget.files ?? [])];
                  e.currentTarget.value = "";
                  setFiles((prev) => [...prev, ...picked]);
                }}
              />
              {files.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {files.map((f, i) => (
                    <span
                      key={`${f.name}-${i}`}
                      className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 font-mono text-[11px] text-muted-foreground"
                    >
                      {f.name}
                      <button
                        type="button"
                        aria-label={`Remove ${f.name}`}
                        onClick={() => setFiles((prev) => prev.filter((_, n) => n !== i))}
                        className="hover:text-foreground"
                      >
                        <XIcon aria-hidden className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Images and PDFs. The agent reads them from its first turn, and they stay on the
                  task.
                </p>
              )}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Assignee</Label>
              <Select
                value={assignee || "__none"}
                onValueChange={(v) => setAssignee(v === "__none" ? "" : String(v))}
              >
                <SelectTrigger size="sm" aria-label="Assignee">
                  <SelectValue>
                    {users.find((u) => u.id === assignee)?.name ?? "Unassigned"}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  <SelectItem value="__none">Unassigned</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          </div>

          {cloned.length ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Label>Repositories</Label>
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  onClick={() =>
                    setPicked(
                      allPicked
                        ? [chosen[0] ?? cloned[0]!.id]
                        : [...new Set([...chosen, ...seed, ...cloned.map((r) => r.id)])],
                    )
                  }
                >
                  {allPicked ? "just the main one" : "all repos"}
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {cloned.map((r) => {
                  const on = chosen.includes(r.id);
                  const isPrimary = repo === r.id;
                  return (
                    <div
                      key={r.id}
                      className={cn(
                        "group inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px] transition-colors",
                        on
                          ? "border-primary/40 bg-primary/12 text-foreground"
                          : "border-border/60 text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      <button
                        type="button"
                        aria-pressed={on}
                        className="inline-flex items-center gap-1.5"
                        onClick={() => toggleRepo(r.id)}
                      >
                        {on ? (
                          <CheckIcon aria-hidden className="size-3" />
                        ) : (
                          <PlusIcon aria-hidden className="size-3 opacity-60" />
                        )}
                        {r.name}
                      </button>
                      {isPrimary ? (
                        <span className="rounded bg-primary/20 px-1 text-[10px]">main</span>
                      ) : on ? (
                        <button
                          type="button"
                          aria-label={`Make ${r.name} the main repository`}
                          className="text-[10px] text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                          onClick={() => makePrimary(r.id)}
                        >
                          main?
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {extras.length
                  ? `One branch across ${chosen.length} repositories, with ${
                      cloned.find((r) => r.id === repo)?.name ?? "the first"
                    } as the main one. Say in the description which to change; only the ones the agent actually changes get a pull request, linked to the others.`
                  : "Tick every repository this might change. The agent can read them all either way, but it only writes in these."}
              </p>
            </div>
          ) : null}

          {err ? <p className="text-xs text-destructive-foreground">{err}</p> : null}
        </div>

        {/* Right — the pipeline. */}
        <div className="space-y-2 sm:border-l sm:border-border/50 sm:pl-4">
          <div className="flex items-baseline gap-2">
            <Label>Stages</Label>
            <span className="text-[11px] text-muted-foreground">
              what each one does is set in Stages
            </span>
          </div>

          <div className="overflow-hidden rounded-lg border border-border/60">
            {stages.map((s) => {
              const on = !skipped.includes(s.name);
              const reads = resolved.get(s.name);
              return (
                <div key={s.name} className="border-b border-border/50 last:border-b-0">
                  <div className="flex items-center gap-2 px-2.5 py-2">
                    <Checkbox
                      checked={on}
                      aria-label={s.name}
                      onCheckedChange={() => toggle(s.name)}
                    />
                    <div className="min-w-0 flex-1">
                      <div
                        className={cn(
                          "text-[13px]",
                          on ? "text-foreground" : "text-muted-foreground line-through",
                        )}
                      >
                        {s.name}
                      </div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground">
                        {!on
                          ? "skipped"
                          : reads && reads.join() !== s.inputs.join()
                            ? `reads: ${reads.join(", ")}`
                            : (s.output.file ?? "pull request")}
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {stageSummary(s)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-[11px] text-muted-foreground">
            {kept.length === 0
              ? "Pick at least one stage."
              : `${kept.length} stage${kept.length === 1 ? "" : "s"}, ends ${ending}.`}
          </p>
        </div>
      </div>

      <footer className="flex shrink-0 items-center gap-2 border-t border-border/50 px-4 py-3">
        <Button
          size="sm"
          onClick={() => void submit()}
          disabled={busy !== null || !title.trim() || !repo || kept.length === 0}
        >
          {busy === "create" ? <Spinner /> : null}Create task
        </Button>
        {onTalk ? (
          <Button
            size="sm"
            variant="ghost-muted"
            onClick={() => void talk()}
            disabled={busy !== null || !title.trim() || !repo}
          >
            {busy === "talk" ? <Spinner /> : null}Talk it through
          </Button>
        ) : null}
        <Button size="sm" variant="ghost-muted" onClick={close}>
          Cancel
        </Button>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {cloned.length === 0
            ? "No repository is cloned yet — an admin adds one first."
            : onTalk
              ? "Or talk it through and let the agent write the brief and pick the stages."
              : "Nothing runs until you start it."}
        </span>
      </footer>
    </section>
  );
}
