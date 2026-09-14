import { useEffect, useMemo, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { Textarea } from "~/components/ui/textarea";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  GitPullRequestIcon,
  FileTextIcon,
  PlusIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";
import { cn } from "~/lib/utils";
import {
  ago,
  collectionStages,
  moveStage,
  newStage,
  post,
  put,
  unauthorized,
  usedIn,
  validName,
  type Catalogue,
  type CatalogueVersion,
  type Collection,
  type StageDef,
  type StageOverride,
  type User,
} from "./api";
import { StageFields } from "./StageFields";

const LIBRARY = "";

/**
 * Where stages are written, and where they are put together into kinds of work.
 *
 * A stage is written once, in the library, and behaves the same in every collection
 * that runs it — so each stage says where it is used, because an edit made for Sales
 * reaches Engineering too. A collection is an ordered choice of those stages: which
 * run, in what order, and whether its tasks have code at all.
 *
 * The list on the left stays visible while you write. The prompts are the point of
 * this screen and they need height, but losing sight of the order while editing one
 * is how a stage ends up contradicting the one before it.
 *
 * One Save covers stages and collections together and appends a version, so either
 * can be rolled back without a deploy.
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
  const [added, setAdded] = useState<StageDef[]>([]);
  const [cols, setCols] = useState<Collection[]>(catalogue.collections);
  const [view, setView] = useState<string>(LIBRARY);
  const [selected, setSelected] = useState(catalogue.stages[0]?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [versions, setVersions] = useState<CatalogueVersion[] | null>(null);
  const [naming, setNaming] = useState<null | {
    what: "stage" | "collection";
    name: string;
    kind: "markdown" | "html";
  }>(null);

  // A save or revert makes a new version; only then does what is on screen follow the
  // server. The board re-reads the catalogue every few seconds, so following every
  // read would wipe a collection mid-edit.
  const [seenVersion, setSeenVersion] = useState(catalogue.version);
  if (seenVersion !== catalogue.version) {
    setSeenVersion(catalogue.version);
    setCols(catalogue.collections);
    setAdded([]);
  }

  const library = useMemo(() => [...catalogue.stages, ...added], [catalogue.stages, added]);
  const collection = cols.find((c) => c.name === view) ?? null;
  const shown = collection
    ? collectionStages({ stages: library, collections: cols }, collection.name)
    : library;

  useEffect(() => {
    if (!shown.some((s) => s.name === selected) && shown[0]) setSelected(shown[0].name);
  }, [shown, selected]);

  const changed = useMemo(
    () =>
      Object.entries(edits)
        .filter(([, o]) => Object.keys(o).length > 0)
        .map(([name]) => name),
    [edits],
  );
  const colsChanged = JSON.stringify(cols) !== JSON.stringify(catalogue.collections);
  const dirty = changed.length > 0 || added.length > 0 || colsChanged;
  const editor = users.find((u) => u.id === catalogue.updated_by);
  const stage = library.find((s) => s.name === selected);

  /** Fold the pending edits into the stage list the API expects back. */
  const merged = (): StageDef[] =>
    library.map((s) => {
      const o = edits[s.name];
      if (!o) return s;
      return {
        ...s,
        prompt: o.prompt !== undefined ? o.prompt.trim() || null : s.prompt,
        skill: o.skill !== undefined ? o.skill : s.skill,
        gate: o.gate ?? s.gate,
        timeout_minutes: o.timeout_minutes ?? s.timeout_minutes,
        questions: o.questions ?? s.questions,
        reasoning: o.reasoning !== undefined ? o.reasoning : s.reasoning,
        provider: {
          instanceId: o.instanceId ?? s.provider.instanceId,
          model: o.model ?? s.provider.model,
        },
      };
    });

  const discard = () => {
    setEdits({});
    setAdded([]);
    setCols(catalogue.collections);
    if (!catalogue.collections.some((c) => c.name === view)) setView(LIBRARY);
  };

  const save = async () => {
    setBusy(true);
    setErr(null);
    const r = await put<{ error?: string }>("/api/admin/stages", {
      stages: merged(),
      collections: cols,
    });
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

  const updateCollection = (next: Collection) =>
    setCols((all) => all.map((c) => (c.name === next.name ? next : c)));

  /** Add what is being named: a stage to the library, or an empty collection. */
  const commitName = () => {
    if (!naming) return;
    const name = naming.name.trim();
    if (!validName(name))
      return setErr("Names are lowercase letters, digits and dashes, starting with a letter.");
    if (naming.what === "stage") {
      if (library.some((s) => s.name === name))
        return setErr(`There is already a stage called ${name}.`);
      const like = library.find((s) => s.output.kind !== "pull_request") ?? library[0];
      if (!like) return;
      setAdded((a) => [...a, newStage(name, naming.kind, like)]);
      if (collection) updateCollection({ ...collection, stages: [...collection.stages, { name }] });
      setSelected(name);
    } else {
      if (cols.some((c) => c.name === name))
        return setErr(`There is already a collection called ${name}.`);
      setCols((all) => [...all, { name, code: false, stages: [] }]);
      setView(name);
    }
    setErr(null);
    setNaming(null);
  };

  const notIn = collection
    ? library.filter((s) => !collection.stages.some((e) => e.name === s.name))
    : [];

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
            <span className="text-[11px] text-warning-foreground">Unsaved changes</span>
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
            <Button size="xs" variant="ghost-muted" onClick={discard} disabled={busy}>
              Discard
            </Button>
          ) : null}
          <Button size="xs" onClick={() => void save()} disabled={!canEdit || busy || !dirty}>
            {busy ? <Spinner /> : null}Save as v{catalogue.version + 1}
          </Button>
        </div>
      </header>

      {/* What you are looking at: every stage, or one kind of work. */}
      <div className="flex flex-wrap items-center gap-1.5 px-1">
        {[LIBRARY, ...cols.map((c) => c.name)].map((name) => (
          <button
            key={name || "library"}
            type="button"
            aria-pressed={view === name}
            onClick={() => setView(name)}
            className={cn(
              "rounded-md border px-2 py-0.5 text-[12px]",
              view === name
                ? "border-primary/40 bg-primary/12 text-foreground"
                : "border-border/60 text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {name || "All stages"}
          </button>
        ))}
        {canEdit ? (
          <button
            type="button"
            onClick={() => setNaming({ what: "collection", name: "", kind: "markdown" })}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <PlusIcon aria-hidden className="size-3" />
            Collection
          </button>
        ) : null}
      </div>

      {naming ? (
        <div className="flex flex-wrap items-center gap-2 px-1">
          <Input
            autoFocus
            size="sm"
            className="w-48"
            aria-label={naming.what === "stage" ? "New stage name" : "New collection name"}
            placeholder={naming.what === "stage" ? "follow-up" : "sales"}
            value={naming.name}
            onChange={(e) => setNaming({ ...naming, name: (e.target as HTMLInputElement).value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") setNaming(null);
            }}
          />
          {naming.what === "stage"
            ? (["markdown", "html"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={naming.kind === k}
                  onClick={() => setNaming({ ...naming, kind: k })}
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-[11px]",
                    naming.kind === k
                      ? "border-primary/40 bg-primary/12 text-foreground"
                      : "border-border/60 text-muted-foreground hover:bg-accent",
                  )}
                >
                  {k === "html" ? "Web page" : "Document"}
                </button>
              ))
            : null}
          <Button size="xs" onClick={commitName}>
            Add {naming.what}
          </Button>
          <Button size="xs" variant="ghost-muted" onClick={() => setNaming(null)}>
            Cancel
          </Button>
        </div>
      ) : null}

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

      {collection ? (
        <div className="grid gap-3 rounded-lg border border-border/60 px-3 py-2.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[13px] text-foreground">
              <Checkbox
                checked={collection.code}
                disabled={!canEdit}
                onCheckedChange={(v) => updateCollection({ ...collection, code: v === true })}
              />
              Needs code
            </label>
            <p className="text-[11px] text-muted-foreground">
              {collection.code
                ? "Tasks pick repositories, get a branch, and may open a pull request."
                : "Tasks have no repository: no branch, no pull request. The agent works in a folder of its own."}
            </p>
            <Input
              size="sm"
              disabled={!canEdit}
              aria-label="Description"
              placeholder="What this kind of work is for"
              value={collection.description ?? ""}
              onChange={(e) =>
                updateCollection({
                  ...collection,
                  description: (e.target as HTMLInputElement).value,
                })
              }
            />
          </div>
          <div className="space-y-1">
            <p className="text-[12px] text-foreground">New task template</p>
            <Textarea
              size="sm"
              disabled={!canEdit}
              className="min-h-20"
              placeholder={"Company:\nWebsite / X:\nCall notes:"}
              value={collection.template ?? ""}
              onChange={(e) => updateCollection({ ...collection, template: e.target.value })}
            />
            <p className="text-[11px] text-muted-foreground">
              Fills the description when someone starts a task here. The agent reads what they
              write.
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid min-h-0 gap-4 md:grid-cols-[232px_minmax(0,1fr)]">
        {/* The stages, in order, and which of them you have touched. */}
        <nav className="flex flex-col gap-0.5 md:border-r md:border-border/50 md:pr-3">
          {shown.map((s, i) => {
            const on = s.name === selected;
            return (
              <div
                key={s.name}
                className={cn(
                  "group flex items-center gap-1 rounded-lg pr-1 transition-colors",
                  on ? "bg-accent" : "hover:bg-accent/50",
                )}
              >
                <button
                  type="button"
                  aria-current={on ? "true" : undefined}
                  onClick={() => setSelected(s.name)}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
                >
                  <span className="w-3.5 shrink-0 text-right font-mono text-[10px] text-muted-foreground/70">
                    {collection ? i + 1 : ""}
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
                  {(edits[s.name] && Object.keys(edits[s.name]!).length > 0) ||
                  added.some((a) => a.name === s.name) ? (
                    <span
                      aria-label="changed"
                      className="size-1.5 shrink-0 rounded-full bg-warning"
                    />
                  ) : null}
                </button>
                {collection && canEdit ? (
                  <span className="flex shrink-0 items-center opacity-60 group-hover:opacity-100">
                    <IconButton
                      label={`Move ${s.name} up`}
                      disabled={i === 0}
                      onClick={() =>
                        updateCollection({
                          ...collection,
                          stages: moveStage(collection.stages, i, -1),
                        })
                      }
                    >
                      <ArrowUpIcon aria-hidden className="size-3" />
                    </IconButton>
                    <IconButton
                      label={`Move ${s.name} down`}
                      disabled={i === shown.length - 1}
                      onClick={() =>
                        updateCollection({
                          ...collection,
                          stages: moveStage(collection.stages, i, 1),
                        })
                      }
                    >
                      <ArrowDownIcon aria-hidden className="size-3" />
                    </IconButton>
                    <IconButton
                      label={`Remove ${s.name} from ${collection.name}`}
                      onClick={() =>
                        updateCollection({
                          ...collection,
                          stages: collection.stages.filter((e) => e.name !== s.name),
                        })
                      }
                    >
                      <XIcon aria-hidden className="size-3" />
                    </IconButton>
                  </span>
                ) : null}
              </div>
            );
          })}

          {collection && canEdit && notIn.length ? (
            <select
              aria-label={`Add a stage to ${collection.name}`}
              className="mt-1 h-7 rounded-md border border-border/60 bg-transparent px-1.5 text-[12px] text-muted-foreground"
              value=""
              onChange={(e) => {
                const name = e.target.value;
                if (name)
                  updateCollection({ ...collection, stages: [...collection.stages, { name }] });
              }}
            >
              <option value="">+ Add a stage from the library</option>
              {notIn.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              onClick={() => setNaming({ what: "stage", name: "", kind: "markdown" })}
              className="mt-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-left text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <PlusIcon aria-hidden className="size-3" />
              New stage
            </button>
          ) : null}
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

            {/* An edit here reaches every collection named, so they are named. */}
            <p className="font-mono text-[11px] text-muted-foreground">
              used in {usedIn(cols, stage.name).join(", ") || "no collection yet"}
              {collection
                ? ` · reads ${(shown.find((s) => s.name === stage.name)?.inputs ?? ["ticket"]).join(", ")}`
                : ""}
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
          <p className="text-[13px] text-muted-foreground">
            {collection ? "No stages yet — add one from the library." : "The library is empty."}
          </p>
        )}
      </div>
    </section>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
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
