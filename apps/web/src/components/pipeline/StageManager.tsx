import { useEffect, useMemo, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { ChevronDownIcon, GitPullRequestIcon, FileTextIcon, RotateCcwIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import {
  ago,
  post,
  put,
  unauthorized,
  type Catalogue,
  type CatalogueVersion,
  type StageDef,
  type StageOverride,
  type User,
} from "./api";
import { StageFields } from "./StageFields";

/**
 * Where a stage's behaviour is decided, once, for every task that runs it.
 *
 * There used to be three pipelines to choose between. Two of them were subsets of
 * the third — `bugfix` was `feature` without the one-pager and mockup, and its
 * one apparent difference was something `selectStages` already derives — so the
 * choice moved to the task ("which stages") and what is left here is the part
 * that was always shared: the instructions, the skill, the model, whether a
 * person reviews it, how long it may take.
 *
 * The list on the left is the pipeline, in order, and it stays visible while you
 * write. That is the whole reason for the split: the prompts are the point of
 * this screen — a build stage carries a team's code practices — and they need
 * height, but losing sight of the order while editing one is how a stage ends up
 * contradicting the one before it.
 *
 * Saving appends a version rather than overwriting one, so a prompt can be rolled
 * back without a deploy.
 */
export function StageManager({
  catalogue,
  skills,
  models,
  users,
  canEdit,
  onSaved,
  now,
}: {
  catalogue: Catalogue;
  skills: string[];
  models: string[];
  users: User[];
  canEdit: boolean;
  onSaved: () => void;
  now: number;
}) {
  const [edits, setEdits] = useState<Record<string, StageOverride>>({});
  const [selected, setSelected] = useState(catalogue.stages[0]?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [versions, setVersions] = useState<CatalogueVersion[] | null>(null);

  useEffect(() => {
    if (!catalogue.stages.some((s) => s.name === selected) && catalogue.stages[0]) {
      setSelected(catalogue.stages[0].name);
    }
  }, [catalogue.stages, selected]);

  const changed = useMemo(
    () =>
      Object.entries(edits)
        .filter(([, o]) => Object.keys(o).length > 0)
        .map(([name]) => name),
    [edits],
  );
  const dirty = changed.length > 0;
  const editor = users.find((u) => u.id === catalogue.updated_by);
  const stage = catalogue.stages.find((s) => s.name === selected);

  /** Fold the pending edits into the stage list the API expects back. */
  const merged = (): StageDef[] =>
    catalogue.stages.map((s) => {
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
    const r = await put<{ error?: string }>("/api/admin/stages", { stages: merged() });
    setBusy(false);
    if (unauthorized(r)) return;
    if (r.error) return setErr(r.error);
    setEdits({});
    setVersions(null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    onSaved();
  };

  const revert = async (version: number) => {
    setBusy(true);
    setErr(null);
    const r = await post<{ error?: string }>("/api/admin/stages/revert", { version });
    setBusy(false);
    if (unauthorized(r)) return;
    if (r.error) return setErr(r.error);
    setEdits({});
    setVersions(null);
    onSaved();
  };

  return (
    <section className="flex min-h-0 flex-col gap-3">
      <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 px-1">
        <Badge variant="outline" size="sm" className="font-mono">
          v{catalogue.version}
        </Badge>
        <p className="text-[13px] text-muted-foreground">
          {catalogue.updated_at
            ? `${editor ? editor.name : "Seeded"} · ${ago(catalogue.updated_at, now)}`
            : "Seeded from the repository"}
        </p>

        <div className="ml-auto flex items-center gap-1.5">
          {saved ? <span className="text-[11px] text-success-foreground">Saved</span> : null}
          {dirty ? (
            <span className="text-[11px] text-warning-foreground">
              {changed.length === 1 ? `${changed[0]} changed` : `${changed.length} stages changed`}
            </span>
          ) : null}
          <VersionMenu
            versions={versions}
            users={users}
            now={now}
            canEdit={canEdit}
            currentVersion={catalogue.version}
            onOpen={setVersions}
            onRevert={(v) => void revert(v)}
          />
          {dirty ? (
            <Button size="xs" variant="ghost-muted" onClick={() => setEdits({})} disabled={busy}>
              Discard
            </Button>
          ) : null}
          <Button size="xs" onClick={() => void save()} disabled={!canEdit || busy || !dirty}>
            {busy ? <Spinner /> : null}Save as v{catalogue.version + 1}
          </Button>
        </div>
      </header>

      {err ? (
        <p className="rounded-lg border border-destructive/32 bg-destructive/8 px-3 py-2 text-xs text-destructive-foreground">
          {err}
        </p>
      ) : null}
      {!canEdit ? (
        <p className="px-1 text-[13px] text-muted-foreground">
          These are what every task runs. An admin can change them.
        </p>
      ) : null}

      <div className="grid min-h-0 gap-4 md:grid-cols-[212px_minmax(0,1fr)]">
        {/* The pipeline, in order, and which of it you have touched. */}
        <nav className="flex flex-col gap-0.5 md:border-r md:border-border/50 md:pr-3">
          {catalogue.stages.map((s, i) => {
            const on = s.name === selected;
            return (
              <button
                key={s.name}
                type="button"
                aria-current={on ? "true" : undefined}
                onClick={() => setSelected(s.name)}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
                  on ? "bg-accent" : "hover:bg-accent/50",
                )}
              >
                <span className="w-3.5 shrink-0 text-right font-mono text-[10px] text-muted-foreground/70">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block truncate text-[13px] text-foreground",
                      on && "font-medium",
                    )}
                  >
                    {s.name}
                  </span>
                  <span className="block truncate font-mono text-[10px] text-muted-foreground">
                    {s.output.file ?? "pull request"}
                  </span>
                </span>
                {edits[s.name] && Object.keys(edits[s.name]!).length > 0 ? (
                  <span
                    aria-label="changed"
                    className="size-1.5 shrink-0 rounded-full bg-warning"
                  />
                ) : null}
              </button>
            );
          })}
        </nav>

        {/* The stage you are writing. */}
        {stage ? (
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
                {stage.name}
              </h3>
              <Badge variant={stage.gate === "auto" ? "outline" : "warning"} size="sm">
                {stage.gate === "auto" ? "no review" : "human review"}
              </Badge>
              {stage.tests === "required" ? (
                <Badge variant="outline" size="sm">
                  tests required
                </Badge>
              ) : null}
              <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                {stage.output.kind === "pull_request" ? (
                  <>
                    <GitPullRequestIcon aria-hidden className="size-3" />
                    opens a pull request
                  </>
                ) : (
                  <>
                    <FileTextIcon aria-hidden className="size-3" />
                    writes {stage.output.file}
                  </>
                )}
              </span>
            </div>

            {/* Read-only, but shown: the wiring is what makes the order mean
                something, and it is the first thing you check when a prompt
                refers to a document the stage cannot actually see. */}
            <p className="font-mono text-[11px] text-muted-foreground">
              reads {stage.inputs.length ? stage.inputs.join(", ") : "ticket"}
            </p>

            <StageFields
              base={stage}
              value={edits[stage.name] ?? {}}
              skills={skills}
              models={models}
              disabled={!canEdit}
              onChange={(next) => setEdits((e) => ({ ...e, [stage.name]: next }))}
            />
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">The catalogue is empty.</p>
        )}
      </div>
    </section>
  );
}

/** Every saved version, newest first. Reverting saves the old content as a new one. */
function VersionMenu({
  versions,
  users,
  now,
  canEdit,
  currentVersion,
  onOpen,
  onRevert,
}: {
  versions: CatalogueVersion[] | null;
  users: User[];
  now: number;
  canEdit: boolean;
  currentVersion: number;
  onOpen: (v: CatalogueVersion[]) => void;
  onRevert: (version: number) => void;
}) {
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (versions) return;
    setLoading(true);
    const r = await (
      await import("./api")
    ).call<{ versions: CatalogueVersion[] }>("/api/stages/versions");
    setLoading(false);
    if (!unauthorized(r)) onOpen(r.versions);
  };

  return (
    <Menu>
      <MenuTrigger
        onClick={() => void load()}
        className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        History
        <ChevronDownIcon aria-hidden className="size-3 opacity-70" />
      </MenuTrigger>
      <MenuPopup align="end" side="bottom" className="min-w-64">
        {loading ? (
          <MenuItem disabled>Loading…</MenuItem>
        ) : !versions?.length ? (
          <MenuItem disabled>No earlier versions</MenuItem>
        ) : (
          versions.map((v) => {
            const who = users.find((u) => u.id === v.updated_by);
            return (
              <MenuItem
                key={v.version}
                disabled={!canEdit || v.version === currentVersion}
                onClick={() => onRevert(v.version)}
              >
                <span className="font-mono text-[11px]">v{v.version}</span>
                <span className="ml-2 truncate text-muted-foreground">
                  {v.note ?? (who ? who.name : "seeded")} · {ago(v.updated_at, now)}
                </span>
                {v.version === currentVersion ? (
                  <span className="ml-auto text-[10px] text-muted-foreground">current</span>
                ) : (
                  <RotateCcwIcon aria-hidden className="ml-auto size-3 opacity-60" />
                )}
              </MenuItem>
            );
          })
        )}
      </MenuPopup>
    </Menu>
  );
}
