import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { CheckIcon } from "lucide-react";
import { call, del, post, unauthorized } from "./api";

interface Identity {
  github_login: string | null;
  has_token: boolean;
  token_set_at: string | null;
}

/**
 * Who your work belongs to on GitHub.
 *
 * The two halves do genuinely different jobs and the copy says so, because the
 * first one is free and the second one is a credential. Git decides authorship from
 * the author line alone, so a username puts your name on every commit an agent
 * makes for you without you handing over anything. The token is only needed for the
 * things a name cannot do: push, and open the pull request under your account.
 */
export function GithubIdentity() {
  const [id, setId] = useState<Identity | null>(null);
  const [login, setLogin] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<"login" | "token" | "clear" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void call<Identity>("/api/me/github").then((r) => {
      if (unauthorized(r)) return;
      setId(r);
      setLogin(r.github_login ?? "");
    });
  }, []);

  const save = async (what: "login" | "token", body: Record<string, unknown>) => {
    setBusy(what);
    setErr(null);
    setMsg(null);
    const r = await post<Identity & { error?: string }>("/api/me/github", body);
    setBusy(null);
    if (unauthorized(r)) return;
    if (r.error) return setErr(r.error);
    setId(r);
    setLogin(r.github_login ?? "");
    setToken("");
    setMsg(
      what === "token"
        ? `Connected as @${r.github_login}. Pull requests will come from you.`
        : `Saved. Commits will be authored by @${r.github_login}.`,
    );
  };

  const clear = async () => {
    setBusy("clear");
    setErr(null);
    setMsg(null);
    const r = await del<Identity>("/api/me/github/token");
    setBusy(null);
    if (unauthorized(r)) return;
    setId(r);
    setMsg("Token removed. Your name stays on the commits.");
  };

  if (!id) return null;
  return (
    <div className="mt-3 border-t border-border/50 pt-3">
      <p className="mb-1.5 text-[11px] font-medium text-foreground">GitHub</p>

      <div className="flex gap-1.5">
        <Input
          size="sm"
          placeholder="your-github-username"
          value={login}
          onChange={(e) => setLogin((e.target as HTMLInputElement).value)}
        />
        <Button
          size="xs"
          variant="ghost-muted"
          onClick={() => void save("login", { github_login: login })}
          disabled={busy !== null || !login.trim() || login.trim() === id.github_login}
        >
          {busy === "login" ? <Spinner /> : "Save"}
        </Button>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
        Puts your name on every commit an agent writes for you. Nothing else needed.
      </p>

      {id.has_token ? (
        <div className="mt-2 flex items-center gap-1.5">
          <CheckIcon aria-hidden className="size-3 shrink-0 text-success-foreground" />
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
            Token connected — pull requests come from you.
          </span>
          <Button
            size="xs"
            variant="ghost-muted"
            onClick={() => void clear()}
            disabled={busy !== null}
          >
            {busy === "clear" ? <Spinner /> : "Remove"}
          </Button>
        </div>
      ) : (
        <>
          <div className="mt-2 flex gap-1.5">
            <Input
              size="sm"
              type="password"
              placeholder="Personal access token (optional)"
              value={token}
              onChange={(e) => setToken((e.target as HTMLInputElement).value)}
            />
            <Button
              size="xs"
              variant="ghost-muted"
              onClick={() => void save("token", { token })}
              disabled={busy !== null || token.trim().length < 8}
            >
              {busy === "token" ? <Spinner /> : "Connect"}
            </Button>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            Fine-grained, with Contents and Pull requests read/write on the repositories you work
            in. It is checked, encrypted, and never shown again — without one, Foundry opens the
            pull request instead.
          </p>
        </>
      )}

      {msg ? <p className="mt-2 text-[11px] text-success-foreground">{msg}</p> : null}
      {err ? <p className="mt-2 text-[11px] text-destructive-foreground">{err}</p> : null}
    </div>
  );
}
