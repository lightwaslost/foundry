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
import { Switch } from "~/components/ui/switch";

/**
 * The reasoning levels every model on offer accepts. T3 carries this as the
 * `effort` option; `ultracode` is left out because sonnet does not take it and it
 * means multi-agent orchestration, which is not a thing to start unattended.
 */
const REASONING = ["low", "medium", "high", "xhigh", "max", "ultrathink"] as const;
import { Textarea } from "~/components/ui/textarea";
import { Undo2Icon } from "lucide-react";
import { cn } from "~/lib/utils";
import type { Gate, StageDef, StageOverride } from "./api";

/**
 * The editable half of a stage: what the agent is told, which skill it loads,
 * which model runs it, whether a person reviews the result, and how long it may
 * work. Structure — the stage's name, its inputs and its output file — is not
 * editable here, because those are what make the pipeline runnable at all.
 *
 * One component serves both places this is done: editing a pipeline everyone
 * shares, and tweaking a single task at creation. `base` is what the value would
 * be without this edit, so every field can say "changed" and offer a way back.
 */
export function StageFields({
  base,
  value,
  onChange,
  skills,
  models,
  disabled = false,
  compact = false,
}: {
  base: StageDef;
  value: StageOverride;
  onChange: (next: StageOverride) => void;
  skills: string[];
  models: string[];
  disabled?: boolean;
  compact?: boolean;
}) {
  const set = <K extends keyof StageOverride>(key: K, v: StageOverride[K]) => {
    const next = { ...value };
    if (v === undefined) delete next[key];
    else next[key] = v;
    onChange(next);
  };

  const prompt = value.prompt ?? base.prompt ?? "";
  const skill = value.skill !== undefined ? value.skill : base.skill;
  const model = value.model ?? base.provider.model;
  const instanceId = value.instanceId ?? base.provider.instanceId;
  const reasoning = value.reasoning !== undefined ? value.reasoning : base.reasoning;
  const gate = value.gate ?? base.gate;
  const timeout = value.timeout_minutes ?? base.timeout_minutes;
  const questions = value.questions ?? base.questions;

  const changed = (k: keyof StageOverride) => value[k] !== undefined;
  const modelOptions = models.includes(model) ? models : [model, ...models];
  const skillOptions = skill && !skills.includes(skill) ? [skill, ...skills] : skills;

  const Reset = ({ k }: { k: keyof StageOverride }) =>
    changed(k) ? (
      <Button
        size="icon-micro"
        variant="ghost-muted"
        aria-label="Undo this change"
        disabled={disabled}
        onClick={() => set(k, undefined)}
      >
        <Undo2Icon />
      </Button>
    ) : null;

  return (
    <div className={cn("space-y-3", compact ? "pt-1" : "pt-2")}>
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Label htmlFor={`prompt-${base.name}`}>Instructions</Label>
          <Reset k="prompt" />
          {base.prompt === null && !changed("prompt") ? (
            <span className="text-[11px] text-muted-foreground">
              using the built-in default for {base.output.kind.replace("_", " ")}
            </span>
          ) : null}
        </div>
        <Textarea
          id={`prompt-${base.name}`}
          size="sm"
          disabled={disabled}
          value={prompt}
          placeholder="What this stage should produce, and how. Left empty, the built-in instructions for this output type are used."
          onChange={(e) => set("prompt", e.target.value)}
          className="font-mono text-[12px]"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Label>Skill</Label>
            <Reset k="skill" />
          </div>
          <Select
            disabled={disabled}
            value={skill ?? "__none"}
            onValueChange={(v) => set("skill", v === "__none" ? null : String(v))}
          >
            <SelectTrigger size="sm" aria-label={`Skill for ${base.name}`}>
              <SelectValue>{skill ?? "None"}</SelectValue>
            </SelectTrigger>
            <SelectPopup alignItemWithTrigger={false}>
              <SelectItem value="__none">None</SelectItem>
              {skillOptions.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            Loaded before anything else, and canonical for the stage.
          </p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Label>Model</Label>
            <Reset k="model" />
          </div>
          <Select disabled={disabled} value={model} onValueChange={(v) => set("model", String(v))}>
            <SelectTrigger size="sm" aria-label={`Model for ${base.name}`}>
              <SelectValue>{model}</SelectValue>
            </SelectTrigger>
            <SelectPopup alignItemWithTrigger={false}>
              {modelOptions.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            Runs on <span className="font-mono">{instanceId}</span>.
          </p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Label>Reasoning</Label>
            <Reset k="reasoning" />
          </div>
          <Select
            disabled={disabled}
            value={reasoning ?? "__default"}
            onValueChange={(v) => set("reasoning", String(v) === "__default" ? null : String(v))}
          >
            <SelectTrigger size="sm" aria-label={`Reasoning for ${base.name}`}>
              <SelectValue>{reasoning ?? "Provider default"}</SelectValue>
            </SelectTrigger>
            <SelectPopup alignItemWithTrigger={false}>
              <SelectItem value="__default">Provider default</SelectItem>
              {REASONING.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            How hard it thinks. More costs time and tokens; a stage that only formats what it was
            given rarely needs it.
          </p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Label>Review</Label>
            <Reset k="gate" />
          </div>
          <Select
            disabled={disabled}
            value={gate}
            onValueChange={(v) => set("gate", String(v) as Gate)}
          >
            <SelectTrigger size="sm" aria-label={`Review for ${base.name}`}>
              <SelectValue>
                {gate === "human" ? "A person approves" : "Continue automatically"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup alignItemWithTrigger={false}>
              <SelectItem value="human">A person approves</SelectItem>
              <SelectItem value="auto">Continue automatically</SelectItem>
            </SelectPopup>
          </Select>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Label htmlFor={`timeout-${base.name}`}>Time limit</Label>
            <Reset k="timeout_minutes" />
          </div>
          <div className="flex items-center gap-2">
            <Input
              id={`timeout-${base.name}`}
              size="sm"
              type="number"
              min={1}
              max={1440}
              disabled={disabled}
              value={String(timeout)}
              onChange={(e) => {
                const n = Number((e.target as HTMLInputElement).value);
                set("timeout_minutes", Number.isFinite(n) ? n : undefined);
              }}
              className="w-24"
            />
            <span className="text-[11px] text-muted-foreground">minutes of working time</span>
          </div>
        </div>
      </div>

      <div className="flex items-start justify-between gap-4 rounded-lg border border-border/60 bg-card/40 px-3 py-2">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-foreground">Let the agent ask first</p>
          <p className="text-[11px] leading-[1.45] text-muted-foreground">
            A read-only pass before the real run, where it asks anything that would otherwise be
            guesswork.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Reset k="questions" />
          <Switch
            disabled={disabled}
            checked={questions}
            onCheckedChange={(v: boolean) => set("questions", v)}
            aria-label={`Pre-flight questions for ${base.name}`}
          />
        </div>
      </div>
    </div>
  );
}

/** A one-line summary of a stage, for collapsed rows. */
export function stageSummary(s: StageDef, o?: StageOverride): string {
  const model = o?.model ?? s.provider.model;
  const skill = o?.skill !== undefined ? o.skill : s.skill;
  const gate = o?.gate ?? s.gate;
  const reasoning = o?.reasoning !== undefined ? o.reasoning : s.reasoning;
  return [
    model,
    reasoning ? `reasoning: ${reasoning}` : null,
    skill ? `skill: ${skill}` : null,
    gate === "auto" ? "no review" : null,
    s.tests === "required" ? "tests required" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
