import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { AiraaLoader } from "./AiraaLoader";
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
 *
 * This used to be a hand-rolled line-at-a-time renderer, which meant a PRD's
 * tables, links, inline code and bold text arrived as literal pipes and
 * asterisks. `react-markdown` and `remark-gfm` are already dependencies of this
 * app, so the whole thing is a component map.
 */
const MD_COMPONENTS: Components = {
  h1: (p) => (
    <h1
      className="mt-5 mb-2 text-[17px] font-semibold tracking-[-0.015em] text-foreground first:mt-0"
      {...p}
    />
  ),
  h2: (p) => (
    <h2
      className="mt-5 mb-1.5 text-[15px] font-semibold tracking-[-0.01em] text-foreground first:mt-0"
      {...p}
    />
  ),
  h3: (p) => (
    <h3 className="mt-4 mb-1 text-[13px] font-semibold text-foreground first:mt-0" {...p} />
  ),
  h4: (p) => <h4 className="mt-3 mb-1 text-[13px] font-medium text-foreground first:mt-0" {...p} />,
  p: (p) => <p className="my-2 text-[13.5px] leading-[1.65] text-foreground/85" {...p} />,
  ul: (p) => (
    <ul
      className="my-2 ml-5 list-disc space-y-1 text-[13.5px] leading-[1.6] text-foreground/85"
      {...p}
    />
  ),
  ol: (p) => (
    <ol
      className="my-2 ml-5 list-decimal space-y-1 text-[13.5px] leading-[1.6] text-foreground/85"
      {...p}
    />
  ),
  li: (p) => <li className="pl-0.5 marker:text-muted-foreground/60" {...p} />,
  strong: (p) => <strong className="font-semibold text-foreground" {...p} />,
  a: (p) => (
    <a
      className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
      target="_blank"
      rel="noreferrer"
      {...p}
    />
  ),
  blockquote: (p) => (
    <blockquote
      className="my-2 border-l-2 border-border pl-3 text-[13.5px] text-muted-foreground"
      {...p}
    />
  ),
  hr: () => <hr className="my-4 border-border/60" />,
  code: ({ className, children, ...rest }) =>
    // A fenced block arrives with a language class; anything else is inline.
    className?.startsWith("language-") ? (
      <code className="font-mono text-[12px] leading-5" {...rest}>
        {children}
      </code>
    ) : (
      <code
        className="rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground"
        {...rest}
      >
        {children}
      </code>
    ),
  pre: (p) => (
    <pre
      className="my-3 overflow-x-auto rounded-lg border border-border/60 bg-muted/40 p-3 font-mono text-[12px] leading-5 text-foreground/85"
      {...p}
    />
  ),
  table: (p) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full border-collapse text-[12.5px]" {...p} />
    </div>
  ),
  thead: (p) => <thead className="bg-muted/50" {...p} />,
  th: (p) => (
    <th
      className="border-b border-border/60 px-2.5 py-1.5 text-left font-medium text-foreground"
      {...p}
    />
  ),
  td: (p) => (
    <td className="border-b border-border/40 px-2.5 py-1.5 align-top text-foreground/85" {...p} />
  ),
};

function Markdown({ src }: { src: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
      {src}
    </ReactMarkdown>
  );
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
    <section className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 px-3">
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
            Back
          </Button>
        </div>
      </header>
      {content === null ? (
        <AiraaLoader size="sm" className="px-3 py-6" label="Loading the document" />
      ) : meta.kind === "html" ? (
        <iframe
          title={`${meta.stage} mockup`}
          sandbox="allow-scripts"
          srcDoc={content}
          className="min-h-0 w-full flex-1 border-0 bg-white"
        />
      ) : (
        // Documents are read, not skimmed: a measure cap keeps the lines legible
        // however wide the reader has dragged the panel.
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <div className="mx-auto max-w-[68ch]">
            <Markdown src={content} />
          </div>
        </div>
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
    <section className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 px-3">
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
          Back
        </Button>
      </header>
      <pre className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[11.5px] leading-5">
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
