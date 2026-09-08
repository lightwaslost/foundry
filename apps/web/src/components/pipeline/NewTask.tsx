import { useEffect, useMemo, useState } from "react";
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
import { CheckIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import {
  post,
  unauthorized,
  type PipelineDef,
  type Repo,
  type StageDef,
  type StageOverride,
  type Task,
  type User,
} from "./api";
import { StageFields, stageSummary } from "./StageFields";

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
  pipelines,
  repos,
  users,
  skills,
  models,
  me,
  onCreated,
  onCancel,
  onDirtyChange,
}: {
  pipelines: PipelineDef[];
  repos: Repo[];
  users: User[];
  skills: string[];
  models: string[];
  me: User | null;
  onCreated: (id: string) => void;
  onCancel: () => void;
  /** So the dialog's own dismissals can ask before throwing away typed work. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pipelineName, setPipelineName] = useState(pipelines[0]?.name ?? "feature");
  const [repo, setRepo] = useState("");
  // Repositories beyond the primary that this task is allowed to change.
  const [extras, setExtras] = useState<string[]>([]);
  const [assignee, setAssignee] = useState(me?.id ?? "");
  const [overrides, setOverrides] = useState<Record<string, StageOverride>>({});
  const [skipped, setSkipped] = useState<string[]>([]);
  const [openStage, setOpenStage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const cloned = useMemo(() => repos.filter((r) => r.clone_state === "cloned"), [repos]);
  const others = useMemo(() => cloned.filter((r) => r.id !== repo), [cloned, repo]);
  const allPicked = others.length > 0 && others.every((r) => extras.includes(r.id));
  useEffect(() => {
    if (!repo && cloned[0]) setRepo(cloned[0].id);
  }, [cloned, repo]);
  useEffect(() => {
    if (!pipelines.some((p) => p.name === pipelineName) && pipelines[0])
      setPipelineName(pipelines[0].name);
  }, [pipelines, pipelineName]);

  // Whichever repository leads is never also an "also change" — picking it there
  // would ask the backend for the same repo twice.
  useEffect(() => {
    setExtras((prev) => prev.filter((id) => id !== repo));
  }, [repo]);

  const pipeline = pipelines.find((p) => p.name === pipelineName);
  // Stage tweaks and the selection both belong to the pipeline they were made
  // against, so changing pipeline starts over with every stage switched on.
  useEffect(() => {
    setOverrides({});
    setOpenStage(null);
    setSkipped([]);
  }, [pipelineName]);

  const stages = pipeline?.stages ?? [];
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
    setBusy(true);
    setErr(null);
    const r = await post<{ task?: Task; error?: string }>("/api/tasks", {
      title,
      description,
      pipeline: pipelineName,
      repo_id: repo,
      ...(extras.length ? { extra_repo_ids: extras } : {}),
      assignee_id: assignee || null,
      ...(Object.keys(overrides).length ? { stage_overrides: overrides } : {}),
      // Sent only when it is not the whole pipeline, so an untouched dialog posts
      // exactly the body it always did.
      ...(skipped.length ? { stages: kept.map((s) => s.name) } : {}),
    });
    setBusy(false);
    if (unauthorized(r)) return;
    if (r.error) return setErr(r.error);
    setTitle("");
    setDescription("");
    setOverrides({});
    setExtras([]);
    onCreated(r.task!.id);
  };

  const tweaked = Object.entries(overrides)
    .filter(([, v]) => Object.keys(v).length > 0)
    .map(([k]) => k);
  // Losing a half-written ticket to a stray Escape is a small betrayal people
  // remember, so leaving with something typed asks first — here and in the dialog.
  const dirty =
    title.trim().length > 0 ||
    description.trim().length > 0 ||
    tweaked.length > 0 ||
    extras.length > 0 ||
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

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Repository</Label>
              <Select value={repo} onValueChange={(v) => setRepo(String(v))}>
                <SelectTrigger size="sm" aria-label="Repository">
                  <SelectValue>{cloned.find((r) => r.id === repo)?.name ?? "Pick one"}</SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  {cloned.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
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

          {others.length ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Label>Also change</Label>
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  onClick={() => setExtras(allPicked ? [] : others.map((r) => r.id))}
                >
                  {allPicked ? "none" : "all repos"}
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {others.map((r) => {
                  const on = extras.includes(r.id);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setExtras((prev) =>
                          prev.includes(r.id) ? prev.filter((x) => x !== r.id) : [...prev, r.id],
                        )
                      }
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px] transition-colors",
                        on
                          ? "border-primary/40 bg-primary/12 text-foreground"
                          : "border-border/60 text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      {on ? (
                        <CheckIcon aria-hidden className="size-3" />
                      ) : (
                        <PlusIcon aria-hidden className="size-3 opacity-60" />
                      )}
                      {r.name}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {extras.length
                  ? `The agent works across ${extras.length + 1} repositories on one branch — ${
                      cloned.find((r) => r.id === repo)?.name ?? "the primary"
                    } holds the documents, and every repository it actually changes gets its own pull request, linked to the others.`
                  : "Optional. Pick the other repositories this change reaches; they branch under the same name."}
              </p>
            </div>
          ) : null}

          {err ? <p className="text-xs text-destructive-foreground">{err}</p> : null}
        </div>

        {/* Right — the pipeline. */}
        <div className="space-y-2 sm:border-l sm:border-border/50 sm:pl-4">
          <div className="space-y-1.5">
            <Label>Pipeline</Label>
            <Select value={pipelineName} onValueChange={(v) => setPipelineName(String(v))}>
              <SelectTrigger size="sm" aria-label="Pipeline">
                <SelectValue>{pipelineName}</SelectValue>
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false}>
                {pipelines.map((p) => (
                  <SelectItem key={p.name} value={p.name}>
                    {p.name} · {p.stages.length} stage{p.stages.length === 1 ? "" : "s"}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>

          <div className="overflow-hidden rounded-lg border border-border/60">
            {stages.map((s) => {
              const on = !skipped.includes(s.name);
              const open = openStage === s.name;
              const o = overrides[s.name] ?? {};
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
                    {Object.keys(o).length ? (
                      <span className="shrink-0 rounded-sm bg-primary/12 px-1.5 py-0.5 text-[10px] text-foreground">
                        changed
                      </span>
                    ) : null}
                    <button
                      type="button"
                      aria-label={`Adjust ${s.name}`}
                      aria-expanded={open}
                      disabled={!on}
                      onClick={() => setOpenStage(open ? null : s.name)}
                      className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-40"
                    >
                      <ChevronRightIcon
                        className={cn("size-3.5 transition-transform", open && "rotate-90")}
                      />
                    </button>
                  </div>
                  {open && on ? (
                    <div className="border-t border-border/50 px-2.5 pt-2 pb-3">
                      <p className="pb-2 font-mono text-[11px] text-muted-foreground">
                        {stageSummary(s, o)}
                      </p>
                      <StageFields
                        base={s}
                        value={o}
                        skills={skills}
                        models={models}
                        compact
                        onChange={(next) =>
                          setOverrides((prev) => {
                            const copy = { ...prev };
                            if (Object.keys(next).length === 0) delete copy[s.name];
                            else copy[s.name] = next;
                            return copy;
                          })
                        }
                      />
                    </div>
                  ) : null}
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
          disabled={busy || !title.trim() || !repo || kept.length === 0}
        >
          {busy ? <Spinner /> : null}Create task
        </Button>
        <Button size="sm" variant="ghost-muted" onClick={close}>
          Cancel
        </Button>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {cloned.length === 0
            ? "No repository is cloned yet — an admin adds one first."
            : "Nothing runs until you start it."}
        </span>
      </footer>
    </section>
  );
}
