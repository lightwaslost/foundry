import { useEffect, useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
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
import { ChevronRightIcon, SlidersHorizontalIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import {
  post,
  unauthorized,
  type PipelineDef,
  type Repo,
  type StageOverride,
  type Task,
  type User,
} from "./api";
import { StageFields, stageSummary } from "./StageFields";

/**
 * Starting work. The default path is two fields and a button; the stage
 * customisation is folded away because most tasks should run the pipeline as the
 * team agreed it, and the ones that shouldn't are obvious to the person typing.
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
  const [assignee, setAssignee] = useState(me?.id ?? "");
  const [overrides, setOverrides] = useState<Record<string, StageOverride>>({});
  const [openStage, setOpenStage] = useState<string | null>(null);
  const [customising, setCustomising] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const cloned = useMemo(() => repos.filter((r) => r.clone_state === "cloned"), [repos]);
  useEffect(() => {
    if (!repo && cloned[0]) setRepo(cloned[0].id);
  }, [cloned, repo]);
  useEffect(() => {
    if (!pipelines.some((p) => p.name === pipelineName) && pipelines[0])
      setPipelineName(pipelines[0].name);
  }, [pipelines, pipelineName]);

  const pipeline = pipelines.find((p) => p.name === pipelineName);
  // Stage tweaks belong to the pipeline they were made against.
  useEffect(() => {
    setOverrides({});
    setOpenStage(null);
  }, [pipelineName]);

  const submit = async () => {
    if (!title.trim() || !repo) return;
    setBusy(true);
    setErr(null);
    const r = await post<{ task?: Task; error?: string }>("/api/tasks", {
      title,
      description,
      pipeline: pipelineName,
      repo_id: repo,
      assignee_id: assignee || null,
      ...(Object.keys(overrides).length ? { stage_overrides: overrides } : {}),
    });
    setBusy(false);
    if (unauthorized(r)) return;
    if (r.error) return setErr(r.error);
    setTitle("");
    setDescription("");
    setOverrides({});
    onCreated(r.task!.id);
  };

  const tweaked = Object.entries(overrides)
    .filter(([, v]) => Object.keys(v).length > 0)
    .map(([k]) => k);
  // Losing a half-written ticket to a stray Escape is a small betrayal people
  // remember, so leaving with something typed asks first — here and in the dialog.
  const dirty = title.trim().length > 0 || description.trim().length > 0 || tweaked.length > 0;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  const close = () => {
    if (dirty && !window.confirm("Discard this task? What you have typed will be lost.")) return;
    onCancel();
  };

  return (
    <section className="rounded-xl border border-border/60 bg-card/40">
      <div className="space-y-3 px-3 py-3">
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
            value={description}
            placeholder="Who has the problem, what exists today, what done looks like, and anything you have already decided."
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
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

        {pipeline ? (
          <div className="rounded-lg border border-border/60">
            <button
              type="button"
              onClick={() => setCustomising((v) => !v)}
              className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
            >
              <SlidersHorizontalIcon className="size-3.5 text-muted-foreground" />
              <span className="text-[13px] font-medium text-foreground">
                Adjust the stages for this task
              </span>
              {tweaked.length ? (
                <span className="rounded-sm bg-primary/12 px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                  {tweaked.join(", ")}
                </span>
              ) : (
                <span className="text-[11px] text-muted-foreground">
                  optional — affects this task only
                </span>
              )}
              <ChevronRightIcon
                className={cn(
                  "ml-auto size-3.5 text-muted-foreground transition-transform",
                  customising && "rotate-90",
                )}
              />
            </button>
            {customising ? (
              <div className="border-t border-border/50">
                {pipeline.stages.map((s) => {
                  const open = openStage === s.name;
                  const o = overrides[s.name] ?? {};
                  return (
                    <div key={s.name} className="border-b border-border/50 last:border-b-0">
                      <button
                        type="button"
                        onClick={() => setOpenStage(open ? null : s.name)}
                        className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
                      >
                        <ChevronRightIcon
                          className={cn(
                            "size-3.5 shrink-0 text-muted-foreground transition-transform",
                            open && "rotate-90",
                          )}
                        />
                        <span className="text-[13px] text-foreground">{s.name}</span>
                        <span className="truncate font-mono text-[11px] text-muted-foreground">
                          {stageSummary(s, o)}
                        </span>
                        {Object.keys(o).length ? (
                          <span className="ml-auto shrink-0 rounded-sm bg-primary/12 px-1.5 py-0.5 text-[10px] text-foreground">
                            changed
                          </span>
                        ) : null}
                      </button>
                      {open ? (
                        <div className="px-2.5 pb-3">
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
            ) : null}
          </div>
        ) : null}

        {err ? <p className="text-xs text-destructive-foreground">{err}</p> : null}
      </div>

      <footer className="flex items-center gap-2 border-t border-border/50 px-3 py-2">
        <Button size="sm" onClick={() => void submit()} disabled={busy || !title.trim() || !repo}>
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
