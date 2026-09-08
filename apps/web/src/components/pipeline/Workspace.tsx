import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { Textarea } from "~/components/ui/textarea";
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
 */
export function Workspace({ taskId, onChanged }: { taskId: string; onChanged: () => void }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [files, setFiles] = useState<AttachmentMeta[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const now = Date.now();

  const load = async () => {
    const [c, a] = await Promise.all([
      call<{ comments: Comment[] }>(`/api/tasks/${taskId}/comments`),
      call<{ attachments: AttachmentMeta[] }>(`/api/tasks/${taskId}/attachments`),
    ]);
    if (!unauthorized(c)) setComments(c.comments);
    if (!unauthorized(a)) setFiles(a.attachments);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  return (
    <section className="space-y-2">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload(e.dataTransfer.files);
        }}
        className={cn(
          "rounded-xl border bg-card/40 transition-colors",
          dragging ? "border-primary/60 bg-primary/5" : "border-border/60",
        )}
      >
        <div className="space-y-2 px-3 py-2.5">
          {comments.length === 0 && files.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              Nothing on this task yet. Notes and files you add here are read by the agents on every
              later run.
            </p>
          ) : null}

          {comments.map((c) => (
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

          {files.length > 0 ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {files.map((f) => (
                <div key={f.id} className="group relative">
                  {f.mime.startsWith("image/") ? (
                    <a
                      href={`${API}/api/attachments/${f.id}`}
                      target="_blank"
                      rel="noreferrer"
                      title={f.filename}
                    >
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
                  <span
                    className="mt-0.5 block max-w-16 truncate font-mono text-[10px] text-muted-foreground"
                    title={f.filename}
                  >
                    {f.filename}
                  </span>
                  <span className="block font-mono text-[9px] text-muted-foreground/60">
                    {formatBytes(f.size)}
                  </span>
                  <Button
                    size="icon-micro"
                    variant="ghost-muted"
                    aria-label={`Remove ${f.filename}`}
                    onClick={() => void remove(f.id)}
                    className="absolute -top-1 -right-1 hidden bg-background group-hover:flex"
                  >
                    <TrashIcon />
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="space-y-1.5 border-t border-border/50 px-3 py-2.5">
          <Textarea
            size="sm"
            value={draft}
            placeholder="A note for the team and the agents — a decision, a constraint, something the ticket left out."
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void send();
            }}
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="xs" onClick={() => void send()} disabled={busy || !draft.trim()}>
              {busy ? <Spinner /> : null}Add note
            </Button>
            <Button
              size="xs"
              variant="outline"
              onClick={() => fileInput.current?.click()}
              disabled={busy}
            >
              <ImageIcon /> Attach
            </Button>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
              className="hidden"
              onChange={(e) => void upload(e.target.files)}
            />
            <span className="text-[11px] text-muted-foreground">
              Agents read these on every later run. Images and PDFs, 5 MB each.
            </span>
          </div>
          {err ? <p className="text-xs text-destructive-foreground">{err}</p> : null}
        </div>
      </div>
    </section>
  );
}
