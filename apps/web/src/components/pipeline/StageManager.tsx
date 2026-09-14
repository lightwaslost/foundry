import { useMemo, useState } from "react";
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
  selectedStage,
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
 * Three panes. On the left, the collections and the library. In the middle, the
 * open collection's stages as a numbered chain, in the order they run — or, for the
 * library, every stage and where it is used. On the right, the stage being written.
 * The chain stays visible while you write, because losing sight of the order is how
 * a stage ends up contradicting the one before it.
 *
 * A stage is written once and behaves the same in every collection that runs it, so
 * each says where it is used. One Save covers stages and collections together and
 * appends a version, so either can be rolled back without a deploy.
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
  const [view, setView] = useState<string>(catalogue.collections[0]?.name ?? LIBRARY);
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
  /** Where "insert" was pressed in the chain: the index a picked stage goes in at. */
  const [insertAt, setInsertAt] = useState<number | null>(null);

  // A save or revert makes a new version; only then does what is on screen follow the
  // server. The board re-reads the catalogue every few seconds, so following every
  // read would wipe a collection mid-edit.
  const [seenVersion, setSeenVersion] = useState(catalogue.version);
  if (seenVersion !== catalogue.version) {
    // Opened before the catalogue had loaded (a link straight to Stages): nothing was
    // chosen yet, so start on the first collection rather than the library.
    if (seenVersion === 0 && view === LIBRARY) setView(catalogue.collections[0]?.name ?? LIBRARY);
    setSeenVersion(catalogue.version);
    setCols(catalogue.collections);
    setAdded([]);
  }

  const library = useMemo(() => [...catalogue.stages, ...added], [catalogue.stages, added]);
  const collection = cols.find((c) => c.name === view) ?? null;
  const shown = collection
    ? collectionStages({ stages: library, collections: cols }, collection.name)
    : library;

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
  // Only ever a stage in the list in the middle: an empty new collection shows nothing,
  // not whichever stage happened to be selected in the last view.
  const stage = selectedStage(shown, selected);

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
    setInsertAt(null);
    if (!catalogue.collections.some((c) => c.name === view))
      setView(catalogue.collections[0]?.name ?? LIBRARY);
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

  /** Put a library stage into the open collection, at `at` or at the end. */
  const addToCollection = (name: string, at: number | null) => {
    if (!collection || !name) return;
    const entries = [...collection.stages];
    entries.splice(at ?? entries.length, 0, { name });
    updateCollection({ ...collection, stages: entries });
    setSelected(name);
    setInsertAt(null);
  };

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
      if (collection) addToCollection(name, null);
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
  const summary = (s: StageDef) =>
    [
      s.output.kind === "pull_request" ? "opens a pull request" : `writes ${s.output.file}`,
      s.skill ?? "no skill",
      s.gate === "auto" ? "no review" : "you review",
    ].join(" · ");

  const railItem = (
    key: string,
    label: string,
    count: number,
    on: boolean,
    onClick: () => void,
  ) => (
    <button
      key={key}
      type="button"
      aria-current={on ? "true" : undefined}
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors",
        on
          ? "bg-accent font-medium text-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      <span className="min-w-0 flex-1 truncate capitalize">{label}</span>
      <span className="text-[11px] text-muted-foreground/70 tabular-nums">{count}</span>
    </button>
  );
  const railAction = (label: string, onClick: () => void) =>
    canEdit ? (
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-muted-foreground hover:bg-accent/50 hover:text-foreground"
      >
        <PlusIcon aria-hidden className="size-3.5" />
        {label}
      </button>
    ) : null;
  const railHeading = (label: string) => (
    <p className="px-2.5 pt-3 pb-1 text-[10.5px] font-semibold tracking-[0.07em] text-muted-foreground/70 uppercase">
      {label}
    </p>
  );

  const pickerFor = (at: number | null) => (
    <select
      aria-label={collection ? `Add a stage to ${collection.name}` : "Add a stage"}
      autoFocus={at !== null}
      className="h-8 w-full rounded-lg border border-border/60 bg-card px-2 text-[12px] text-muted-foreground"
      value=""
      onChange={(e) => addToCollection(e.target.value, at)}
      onBlur={() => at !== null && setInsertAt(null)}
    >
      <option value="">
        {at === null ? "+ Add a stage from the library" : "Pick a stage to insert here"}
      </option>
      {notIn.map((s) => (
        <option key={s.name} value={s.name}>
          {s.name}
        </option>
      ))}
    </select>
  );

  return (
    <section className="flex min-h-0 flex-col gap-3">
      <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 px-1">
        <Badge variant="outline" size="sm" className="tabular-nums">
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

      <div className="grid min-h-0 gap-5 md:grid-cols-[196px_minmax(280px,360px)_minmax(0,1fr)]">
        {/* Left — what you are looking at. */}
        <nav
          aria-label="Collections and library"
          className="flex flex-col gap-0.5 md:border-r md:border-border/50 md:pr-3"
        >
          {railHeading("Collections")}
          {cols.map((c) =>
            railItem(c.name, c.name, c.stages.length, view === c.name, () => setView(c.name)),
          )}
          {railAction("New collection", () =>
            setNaming({ what: "collection", name: "", kind: "markdown" }),
          )}
          {railHeading("Library")}
          {railItem("__library", "All stages", library.length, view === LIBRARY, () =>
            setView(LIBRARY),
          )}
          {railAction("New stage", () => setNaming({ what: "stage", name: "", kind: "markdown" }))}
        </nav>

        {/* Middle — the chain, in the order it runs. */}
        <div className="flex min-w-0 flex-col gap-3 md:border-r md:border-border/50 md:pr-5">
          {naming ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card p-2.5">
              <Input
                autoFocus
                size="sm"
                aria-label={naming.what === "stage" ? "New stage name" : "New collection name"}
                placeholder={naming.what === "stage" ? "follow-up" : "sales"}
                value={naming.name}
                onChange={(e) =>
                  setNaming({ ...naming, name: (e.target as HTMLInputElement).value })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitName();
                  if (e.key === "Escape") setNaming(null);
                }}
              />
              <div className="flex flex-wrap items-center gap-1.5">
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
                <span className="flex-1" />
                <Button size="xs" variant="ghost-muted" onClick={() => setNaming(null)}>
                  Cancel
                </Button>
                <Button size="xs" onClick={commitName}>
                  Add {naming.what}
                </Button>
              </div>
            </div>
          ) : null}

          {collection ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground capitalize">
                {collection.name}
              </h3>
              <Input
                size="sm"
                disabled={!canEdit}
                aria-label="What this collection is for"
                placeholder="What this kind of work is for"
                value={collection.description ?? ""}
                onChange={(e) =>
                  updateCollection({
                    ...collection,
                    description: (e.target as HTMLInputElement).value,
                  })
                }
              />
              <label className="flex items-center gap-2 text-[13px] text-foreground">
                <Checkbox
                  checked={collection.code}
                  disabled={!canEdit}
                  onCheckedChange={(v) => updateCollection({ ...collection, code: v === true })}
                />
                Needs code
                <span className="text-[11px] text-muted-foreground">
                  {collection.code
                    ? "repositories, a branch, pull requests"
                    : "a folder of its own, no repository"}
                </span>
              </label>
              <Textarea
                size="sm"
                disabled={!canEdit}
                className="min-h-16"
                aria-label="New task template"
                placeholder={"New task template, e.g.\nCompany:\nCall notes:"}
                value={collection.template ?? ""}
                onChange={(e) => updateCollection({ ...collection, template: e.target.value })}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
                All stages
              </h3>
              <p className="text-[12px] text-muted-foreground">
                Written once, used by any collection. An edit here reaches every collection named on
                the stage.
              </p>
            </div>
          )}

          <ol className="flex flex-col">
            {shown.map((s, i) => {
              const on = s.name === stage?.name;
              const where = usedIn(cols, s.name);
              return (
                <li key={s.name} className="flex flex-col">
                  <div
                    className={cn(
                      "group flex items-start gap-2.5 rounded-xl border px-2.5 py-2 transition-colors",
                      on
                        ? "border-primary/50 bg-primary/8"
                        : "border-border/60 bg-card hover:border-border",
                    )}
                  >
                    {collection ? (
                      <span
                        className={cn(
                          "mt-0.5 grid size-5.5 shrink-0 place-items-center rounded-md text-[11px] font-semibold tabular-nums",
                          on
                            ? "bg-primary text-primary-foreground"
                            : "bg-secondary text-secondary-foreground",
                        )}
                      >
                        {i + 1}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setSelected(s.name)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] font-medium text-foreground">
                          {s.name}
                        </span>
                        {(edits[s.name] && Object.keys(edits[s.name]!).length > 0) ||
                        added.some((a) => a.name === s.name) ? (
                          <span
                            aria-label="changed"
                            className="size-1.5 shrink-0 rounded-full bg-warning"
                          />
                        ) : null}
                      </span>
                      <span className="block truncate text-[11.5px] text-muted-foreground">
                        {collection
                          ? summary(s)
                          : `used in ${where.join(", ") || "no collection yet"}`}
                      </span>
                    </button>
                    {collection && canEdit ? (
                      <span className="flex shrink-0 items-center opacity-50 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
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
                  {/* The link to the next stage, and the one place to put a stage between two. */}
                  {collection && i < shown.length - 1 ? (
                    insertAt === i + 1 ? (
                      <div className="py-1.5 pl-3.5">{pickerFor(i + 1)}</div>
                    ) : (
                      <div className="ml-[21px] flex h-6 items-center border-l border-dashed border-border">
                        {canEdit && notIn.length ? (
                          <button
                            type="button"
                            onClick={() => setInsertAt(i + 1)}
                            className="ml-3 text-[11px] text-muted-foreground/70 hover:text-foreground"
                          >
                            + insert
                          </button>
                        ) : null}
                      </div>
                    )
                  ) : null}
                </li>
              );
            })}
          </ol>

          {collection && shown.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-[12px] text-muted-foreground">
              No stages yet — add one from the library.
            </p>
          ) : null}
          {collection && canEdit && notIn.length ? pickerFor(null) : null}
        </div>

        {/* Right — the stage you are writing. */}
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
              <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
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
            <p className="text-[12px] text-muted-foreground">
              Used in {usedIn(cols, stage.name).join(", ") || "no collection yet"}
              {collection ? ` · reads ${stage.inputs.join(", ")}` : ""}
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
            {collection ? "Pick or add a stage to write it." : "The library is empty."}
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
