import { useEffect, useMemo, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { ChevronRightIcon, FileJson2Icon, RotateCcwIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import {
  ago,
  del,
  put,
  unauthorized,
  type PipelineDef,
  type StageDef,
  type StageOverride,
  type User,
} from "./api";
import { StageFields, stageSummary } from "./StageFields";

/**
 * Editing the pipelines everyone shares. The JSON files in the repository are the
 * seed; saving here stores an edit that wins over the file, and "Restore the
 * file" throws it away. Tasks freeze their stages when they are created, so an
 * edit here never disturbs work already running.
 */
export function PipelineSettings({
  pipelines,
  skills,
  models,
  users,
  canEdit,
  onSaved,
  now,
}: {
  pipelines: PipelineDef[];
  skills: string[];
  models: string[];
  users: User[];
  canEdit: boolean;
  onSaved: () => void;
  now: number;
}) {
  const [selected, setSelected] = useState(pipelines[0]?.name ?? "");
  useEffect(() => {
    if (!pipelines.some((p) => p.name === selected) && pipelines[0]) setSelected(pipelines[0].name);
  }, [pipelines, selected]);
  const pipeline = pipelines.find((p) => p.name === selected);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {pipelines.map((p) => (
          <Button
            key={p.name}
            size="xs"
            variant={p.name === selected ? "secondary" : "ghost-muted"}
            onClick={() => setSelected(p.name)}
          >
            {p.name}
            <span className="font-mono text-[10px] text-muted-foreground">{p.stages.length}</span>
            {p.source === "edited" ? <span className="size-1.5 rounded-full bg-primary" /> : null}
          </Button>
        ))}
      </div>
      {pipeline ? (
        <PipelineEditor
          key={pipeline.name}
          pipeline={pipeline}
          skills={skills}
          models={models}
          users={users}
          canEdit={canEdit}
          onSaved={onSaved}
          now={now}
        />
      ) : null}
    </div>
  );
}

function PipelineEditor({
  pipeline,
  skills,
  models,
  users,
  canEdit,
  onSaved,
  now,
}: {
  pipeline: PipelineDef;
  skills: string[];
  models: string[];
  users: User[];
  canEdit: boolean;
  onSaved: () => void;
  now: number;
}) {
  const [edits, setEdits] = useState<Record<string, StageOverride>>({});
  const [open, setOpen] = useState<string | null>(pipeline.stages[0]?.name ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = useMemo(() => Object.values(edits).some((o) => Object.keys(o).length > 0), [edits]);
  const editor = users.find((u) => u.id === pipeline.updated_by);

  /** Fold the pending edits into the stage list the API expects back. */
  const merged = (): StageDef[] =>
    pipeline.stages.map((s) => {
      const o = edits[s.name];
      if (!o) return s;
      return {
        ...s,
        prompt: o.prompt !== undefined ? o.prompt.trim() || null : s.prompt,
        skill: o.skill !== undefined ? o.skill : s.skill,
        gate: o.gate ?? s.gate,
        timeout_minutes: o.timeout_minutes ?? s.timeout_minutes,
        questions: o.questions ?? s.questions,
        provider: {
          instanceId: o.instanceId ?? s.provider.instanceId,
          model: o.model ?? s.provider.model,
        },
      };
    });

  const save = async () => {
    setBusy(true);
    setErr(null);
    const r = await put<{ error?: string }>(`/api/admin/pipelines/${pipeline.name}`, {
      description: pipeline.description,
      stages: merged(),
    });
    setBusy(false);
    if (unauthorized(r)) return;
    if (r.error) return setErr(r.error);
    setEdits({});
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    onSaved();
  };

  const restore = async () => {
    setBusy(true);
    setErr(null);
    const r = await del<{ error?: string }>(`/api/admin/pipelines/${pipeline.name}/override`);
    setBusy(false);
    if (unauthorized(r)) return;
    if (r.error) return setErr(r.error);
    setEdits({});
    onSaved();
  };

  return (
    <section className="space-y-2.5">
      <div className="flex flex-wrap items-start justify-between gap-3 px-1">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm text-foreground">
            {pipeline.name}
            {pipeline.source === "edited" ? (
              <Badge variant="info" size="sm">
                edited
              </Badge>
            ) : (
              <Badge variant="outline" size="sm" className="gap-1">
                <FileJson2Icon className="size-3" />
                from the repository
              </Badge>
            )}
          </h2>
          <p className="mt-0.5 max-w-xl text-[13px] leading-[1.45] text-muted-foreground">
            {pipeline.description ?? "No description."}
            {pipeline.source === "edited" && pipeline.updated_at ? (
              <>
                {" "}
                Edited {editor ? `by ${editor.name} ` : ""}
                {ago(pipeline.updated_at, now)}.
              </>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {saved ? <span className="text-[11px] text-success-foreground">Saved</span> : null}
          {pipeline.source === "edited" && canEdit ? (
            <Button size="xs" variant="ghost-muted" onClick={() => void restore()} disabled={busy}>
              <RotateCcwIcon /> Restore the file
            </Button>
          ) : null}
          <Button size="xs" onClick={() => void save()} disabled={!canEdit || busy || !dirty}>
            {busy ? <Spinner /> : null}Save for everyone
          </Button>
        </div>
      </div>

      {!canEdit ? (
        <p className="px-1 text-[11px] text-muted-foreground">
          Only an admin can change what everyone runs — but you can adjust stages for a single task
          when you create it.
        </p>
      ) : null}
      {err ? (
        <p className="rounded-lg border border-destructive/32 bg-destructive/8 px-3 py-2 text-xs text-destructive-foreground">
          {err}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-border/60 bg-card/40">
        {pipeline.stages.map((s, i) => {
          const isOpen = open === s.name;
          const o = edits[s.name] ?? {};
          return (
            <div key={s.name} className={cn(i > 0 && "border-t border-border/50")}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : s.name)}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
              >
                <span className="grid size-5 shrink-0 place-items-center rounded-full border border-border/60 font-mono text-[10px] text-muted-foreground">
                  {i + 1}
                </span>
                <span className="text-[13px] font-medium text-foreground">{s.name}</span>
                <span className="truncate font-mono text-[11px] text-muted-foreground">
                  {stageSummary(s, o)}
                </span>
                {Object.keys(o).length ? (
                  <Badge variant="info" size="sm" className="ml-auto shrink-0">
                    unsaved
                  </Badge>
                ) : null}
                <ChevronRightIcon
                  className={cn(
                    "ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform",
                    Object.keys(o).length ? "ml-1.5" : "",
                    isOpen && "rotate-90",
                  )}
                />
              </button>
              {isOpen ? (
                <div className="px-3 pb-3">
                  <dl className="mb-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
                    <span>reads: {s.inputs.join(", ")}</span>
                    <span>writes: {s.output.file ?? "a pull request"}</span>
                    {s.tests ? <span>tests required</span> : null}
                  </dl>
                  <StageFields
                    base={s}
                    value={o}
                    skills={skills}
                    models={models}
                    disabled={!canEdit}
                    onChange={(next) =>
                      setEdits((prev) => {
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
      <p className="px-1 text-[11px] text-muted-foreground">
        A stage's name, what it reads and what it writes are fixed by the file — those are what make
        the pipeline runnable. Saving affects tasks created from now on; anything already running
        keeps the stages it started with.
      </p>
    </section>
  );
}
