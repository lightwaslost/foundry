import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { Textarea } from "~/components/ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { ImageIcon, PaperclipIcon, TrashIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import {
  ago,
  API,
  call,
  del,
  formatBytes,
  initials,
  post,
  unauthorized,
  type AttachmentMeta,
  type Comment,
} from "./api";

/**
 * Notes and files a person adds to a task.
 *
 * Both are read by the agents on every later run, which is the point — "leave a
 * comment, then run" — and both say so where they are entered, because context
 * that silently steers an agent is worse than no context at all.
 *
 * The list and the box you type into are separate exports because they sit in
 * different places: the notes scroll away with the rest of the task, the box is
 * pinned to the foot of the panel. Leaving a note used to mean scrolling past
 * every run in the history first, which is the wrong price for a one-line remark.
 * The shared state lives in the hook so the two halves stay one thing.
 */
export interface WorkspaceState {
  comments: Comment[];
  files: AttachmentMeta[];
  busy: boolean;
  err: string | null;
  draft: string;
  setDraft: (v: string) => void;
  send: () => Promise<void>;
  upload: (list: FileList | null) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export function useWorkspace(taskId: string, onChanged: () => void): WorkspaceState {
  const [comments, setComments] = useState<Comment[]>([]);
  const [files, setFiles] = useState<AttachmentMeta[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    const [c, a] = await Promise.all([
      call<{ comments: Comment[] }>(`/api/tasks/${taskId}/comments`),
      call<{ attachments: AttachmentMeta[] }>(`/api/tasks/${taskId}/attachments`),
    ]);
    if (!unauthorized(c)) setComments(c.comments);
    if (!unauthorized(a)) setFiles(a.attachments);
  };
  useEffect(() => {
    setDraft("");
    setErr(null);
    void load();
  }, [taskId]);

  const send = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    setErr(null);
    const r = await post<{ error?: string }>(`/api/tasks/${taskId}/comments`, { body: draft });
    setBusy(false);
    if (unauthorized(r)) return;
    if (r.error) return setErr(r.error);
    setDraft("");
    void load();
    onChanged();
  };

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    setErr(null);
    for (const file of Array.from(list)) {
      const data = await file.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(data);
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }
      const r = await post<{ error?: string }>(`/api/tasks/${taskId}/attachments`, {
        filename: file.name,
        data_base64: btoa(binary),
      });
      if (!unauthorized(r) && r.error) {
        setErr(r.error);
        break;
      }
    }
    setBusy(false);
    void load();
  };

  const remove = async (id: string) => {
    await del(`/api/attachments/${id}`);
    void load();
  };

  return { comments, files, busy, err, draft, setDraft, send, upload, remove };
}

/** Everything already on the task: what people said, and what they attached. */
export function NotesList({ ws, now }: { ws: WorkspaceState; now: number }) {
  if (ws.comments.length === 0 && ws.files.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        Nothing on this task yet. Notes and files you add are read by the agents on every later run.
      </p>
    );
  }
  return (
    <div className="space-y-2.5">
      {ws.comments.map((c) => (
        <div key={c.id} className="flex gap-2">
          <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-secondary text-[9px] font-medium text-secondary-foreground">
            {initials(c.author ?? "?")}
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-baseline gap-2">
              <span className="text-[13px] font-medium text-foreground">
                {c.author ?? "someone"}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {ago(c.created_at, now)}
              </span>
            </p>
            <p className="text-[13px] leading-[1.5] whitespace-pre-wrap text-muted-foreground">
              {c.body}
            </p>
          </div>
        </div>
      ))}

      {ws.files.length > 0 ? (
        <div className="flex flex-wrap gap-2 pt-0.5">
          {ws.files.map((f) => (
            <div key={f.id} className="group relative">
              {f.mime.startsWith("image/") ? (
                <a href={`${API}/api/attachments/${f.id}`} target="_blank" rel="noreferrer">
                  <img
                    src={`${API}/api/attachments/${f.id}`}
                    alt={f.filename}
                    className="size-16 rounded-lg border border-border/60 object-cover"
                  />
                </a>
              ) : (
                <a
                  href={`${API}/api/attachments/${f.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex size-16 flex-col items-center justify-center gap-1 rounded-lg border border-border/60 bg-background text-[10px] text-muted-foreground"
                >
                  <PaperclipIcon className="size-4" />
                  PDF
                </a>
              )}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="mt-0.5 block max-w-16 truncate font-mono text-[10px] text-muted-foreground" />
                  }
                >
                  {f.filename}
                </TooltipTrigger>
                <TooltipPopup side="bottom">{f.filename}</TooltipPopup>
              </Tooltip>
              <span className="block font-mono text-[9px] text-muted-foreground/60">
                {formatBytes(f.size)}
              </span>
              <Button
                size="icon-micro"
                variant="ghost-muted"
                aria-label={`Remove ${f.filename}`}
                onClick={() => void ws.remove(f.id)}
                className="absolute -top-1 -right-1 hidden bg-background group-hover:flex"
              >
                <TrashIcon />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The box, pinned to the foot of the panel.
 *
 * One line until it is being used, because most of the time it is a place to put
 * a sentence, not a place to write. It grows on focus and shrinks back when it is
 * left empty, so it costs the history almost nothing to keep it always in reach.
 */
export function NoteComposer({ ws, className }: { ws: WorkspaceState; className?: string }) {
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const expanded = open || ws.draft.trim().length > 0;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void ws.upload(e.dataTransfer.files);
      }}
      className={cn(
        "shrink-0 border-t px-4 py-2.5 transition-colors",
        dragging ? "border-primary/60 bg-primary/5" : "border-border/50 bg-background",
        className,
      )}
    >
      <div className="flex items-end gap-1.5">
        <Textarea
          size="sm"
          className={cn("flex-1 overflow-y-auto", expanded ? "max-h-[30vh]" : "max-h-9 min-h-9")}
          rows={expanded ? 3 : 1}
          value={ws.draft}
          placeholder={
            expanded
              ? "A decision, a constraint, something the ticket left out. ⌘↵ to add."
              : "Add a note…"
          }
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(e) => ws.setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void ws.send();
          }}
        />
        <Button
          size="xs"
          variant="ghost-muted"
          aria-label="Attach an image or PDF"
          onClick={() => fileInput.current?.click()}
          disabled={ws.busy}
        >
          <ImageIcon />
        </Button>
        <Button size="xs" onClick={() => void ws.send()} disabled={ws.busy || !ws.draft.trim()}>
          {ws.busy ? <Spinner /> : null}Add
        </Button>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
          className="hidden"
          onChange={(e) => void ws.upload(e.target.files)}
        />
      </div>
      {expanded ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Agents read these on every later run. Drop images and PDFs here, 5 MB each.
        </p>
      ) : null}
      {ws.err ? <p className="mt-1 text-xs text-destructive-foreground">{ws.err}</p> : null}
    </div>
  );
}
