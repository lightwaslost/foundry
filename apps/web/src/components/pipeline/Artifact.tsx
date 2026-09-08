import { useEffect, useState, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { cn } from "~/lib/utils";
import { API, call, unauthorized, type ArtifactMeta } from "./api";

/**
 * Documents the agents write are markdown or a self-contained HTML mockup. Both
 * are rendered here rather than downloaded: reviewing is the whole job of the
 * gate, and a reviewer who has to open a file elsewhere will skim instead.
 */
function markdown(src: string): ReactNode {
  const out: ReactNode[] = [];
  let code: string[] | null = null;
  src.split("\n").forEach((line, i) => {
    if (line.trimStart().startsWith("```")) {
      if (code) {
        out.push(
          <pre
            key={`c${i}`}
            className="my-2 overflow-x-auto rounded-md border border-border/60 bg-background p-2 font-mono text-[11px] leading-5 text-muted-foreground"
          >
            {code.join("\n")}
          </pre>,
        );
        code = null;
      } else code = [];
      return;
    }
    if (code) {
      code.push(line);
      return;
    }
    const h = /^(#{1,4})\s+(.*)/.exec(line);
    if (h) {
      const depth = h[1]?.length ?? 1;
      out.push(
        <p
          key={i}
          className={cn(
            "mt-3 mb-1 font-semibold tracking-[-0.01em] text-foreground first:mt-0",
            depth === 1 ? "text-[15px]" : depth === 2 ? "text-sm" : "text-[13px]",
          )}
        >
          {h[2]}
        </p>,
      );
      return;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      out.push(
        <p key={i} className="ml-3 text-[13px] leading-[1.5] text-muted-foreground">
          <span className="text-muted-foreground/60">•</span>{" "}
          {line.replace(/^\s*([-*]|\d+\.)\s+/, "")}
        </p>,
      );
      return;
    }
    if (/^\s*\|/.test(line)) {
      out.push(
        <p key={i} className="font-mono text-[11px] whitespace-pre text-muted-foreground">
          {line}
        </p>,
      );
      return;
    }
    if (!line.trim()) return;
    out.push(
      <p key={i} className="my-1.5 text-[13px] leading-[1.55] text-muted-foreground">
        {line}
      </p>,
    );
  });
  return out;
}

export function ArtifactViewer({
  meta,
  versions,
  onPickVersion,
  onClose,
  onDiff,
}: {
  meta: ArtifactMeta;
  versions: ArtifactMeta[];
  onPickVersion: (a: ArtifactMeta) => void;
  onClose: () => void;
  onDiff: (fromId: string, toId: string) => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setContent(null);
    void fetch(`${API}/api/artifacts/${meta.id}?raw=1`, { credentials: "include" })
      .then((r) => r.text())
      .then((t) => {
        if (live) setContent(t);
      });
    return () => {
      live = false;
    };
  }, [meta.id]);

  const prev = versions.find((v) => v.version === meta.version - 1);
  return (
    <section className="rounded-xl border border-border/60 bg-card/40">
      <header className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
        <span className="text-[13px] font-medium text-foreground">{meta.stage}</span>
        {versions.length > 1 ? (
          <Select
            value={String(meta.version)}
            onValueChange={(v) => {
              const picked = versions.find((x) => x.version === Number(v));
              if (picked) onPickVersion(picked);
            }}
          >
            <SelectTrigger size="sm" aria-label="Version" className="h-6 min-w-24">
              <SelectValue>
                v{meta.version}
                {meta.author_id ? " · edited" : ""}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup alignItemWithTrigger={false}>
              {versions.map((v) => (
                <SelectItem key={v.id} value={String(v.version)}>
                  v{v.version} {v.author_id ? "· edited by a person" : "· agent"}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        ) : (
          <span className="font-mono text-[11px] text-muted-foreground">
            v{meta.version} · {meta.author_id ? "edited" : "agent"}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {prev ? (
            <Button size="xs" variant="ghost-muted" onClick={() => onDiff(prev.id, meta.id)}>
              Compare with v{prev.version}
            </Button>
          ) : null}
          <Button size="xs" variant="ghost-muted" onClick={onClose}>
            Close
          </Button>
        </div>
      </header>
      {content === null ? (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">Loading…</p>
      ) : meta.kind === "html" ? (
        <iframe
          title={`${meta.stage} mockup`}
          sandbox="allow-scripts"
          srcDoc={content}
          className="h-[52vh] w-full rounded-b-xl border-0 bg-white"
        />
      ) : (
        <div className="max-h-[52vh] overflow-auto px-3 py-2">{markdown(content)}</div>
      )}
    </section>
  );
}

type DiffPayload = {
  from: { id: string; version: number; author_id: string | null };
  to: { id: string; version: number; author_id: string | null };
  diff: {
    hunks: Array<{ lines: Array<{ type: "ctx" | "add" | "del"; text: string }> }>;
    added: number;
    deleted: number;
  };
};

export function DiffView({
  fromId,
  toId,
  onClose,
}: {
  fromId: string;
  toId: string;
  onClose: () => void;
}) {
  const [d, setD] = useState<DiffPayload | null>(null);
  useEffect(() => {
    let live = true;
    setD(null);
    void call<DiffPayload>(`/api/artifacts/${toId}/diff?against=${fromId}`).then((r) => {
      if (live && !unauthorized(r)) setD(r);
    });
    return () => {
      live = false;
    };
  }, [fromId, toId]);

  return (
    <section className="rounded-xl border border-border/60 bg-card/40">
      <header className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
        <span className="text-[13px] font-medium text-foreground">
          {d ? `v${d.from.version} → v${d.to.version}` : "Comparing…"}
        </span>
        {d ? (
          <span className="font-mono text-[11px] tabular-nums">
            <span className="text-success-foreground">+{d.diff.added}</span>{" "}
            <span className="text-destructive-foreground">−{d.diff.deleted}</span>
          </span>
        ) : null}
        <Button size="xs" variant="ghost-muted" className="ml-auto" onClick={onClose}>
          Close
        </Button>
      </header>
      <pre className="max-h-[40vh] overflow-auto px-3 py-2 font-mono text-[11px] leading-5">
        {d && d.diff.hunks.length === 0 ? (
          <span className="text-muted-foreground">No differences.</span>
        ) : null}
        {d?.diff.hunks.map((h, i) => (
          <div key={i} className={i > 0 ? "mt-2 border-t border-border/50 pt-2" : ""}>
            {h.lines.map((l, j) => (
              <div
                key={j}
                className={cn(
                  "px-1",
                  l.type === "add" && "bg-success/12 text-foreground",
                  l.type === "del" && "bg-destructive/12 text-muted-foreground line-through",
                  l.type === "ctx" && "text-muted-foreground/70",
                )}
              >
                <span className="select-none text-muted-foreground/50">
                  {l.type === "add" ? "+" : l.type === "del" ? "−" : " "}{" "}
                </span>
                {l.text || " "}
              </div>
            ))}
          </div>
        ))}
      </pre>
    </section>
  );
}
