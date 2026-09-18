import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { SidebarInset } from "~/components/ui/sidebar";
import { Spinner } from "~/components/ui/spinner";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "~/components/WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "~/components/WorkspacePageContainer";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import {
  call,
  del,
  inviteStatus,
  memberStatus,
  openTicketsOf,
  patch,
  pendingInvites,
  post,
  unauthorized,
  type Invite,
  type Task,
  type Unauthorized,
  type User,
} from "~/components/pipeline/api";
import { AssigneePicker } from "~/components/pipeline/AssigneePicker";
import { FoundryTabs, useFoundryType } from "~/components/pipeline/FoundryTabs";
import { isElectron } from "~/env";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { setPairingTokenOnUrl } from "~/pairingUrl";

/**
 * Team: who is in Foundry. Everyone sees the list; an admin also invites, changes
 * roles, resets passwords and removes people. Members read GET /api/users, which
 * only has active people; everything under /api/admin is asked for by admins alone.
 */

type Role = User["role"];
const ROLE_LABEL: Record<Role, string> = { admin: "Admin", member: "Member" };

/** Something the server hands over exactly once: an invite link, a password, a pairing link. */
type Secret = { title: string; body: string; value: string };

function RoleSelect({
  value,
  onChange,
  disabled,
}: {
  value: Role;
  onChange: (r: Role) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as Role)}
      {...(disabled ? { disabled } : {})}
    >
      <SelectTrigger size="sm" aria-label="Role" className="w-28">
        <SelectValue>{ROLE_LABEL[value]}</SelectValue>
      </SelectTrigger>
      <SelectPopup alignItemWithTrigger={false}>
        <SelectItem value="member">Member</SelectItem>
        <SelectItem value="admin">Admin</SelectItem>
      </SelectPopup>
    </Select>
  );
}

function SecretDialog({ secret, onClose }: { secret: Secret | null; onClose: () => void }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  return (
    <Dialog open={secret !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{secret?.title}</DialogTitle>
          <DialogDescription>{secret?.body}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex items-center gap-2">
            <Input
              size="sm"
              readOnly
              value={secret?.value ?? ""}
              className="font-mono"
              onFocus={(e) => (e.target as HTMLInputElement).select()}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => secret && copyToClipboard(secret.value, undefined)}
            >
              {isCopied ? "Copied" : "Copy"}
            </Button>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button size="sm" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function InviteDialog({
  open,
  onClose,
  onInvited,
}: {
  open: boolean;
  onClose: () => void;
  onInvited: (link: string, email: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await post<{ path?: string; error?: string }>("/api/admin/invites", {
      email: email.trim(),
      name: name.trim(),
      role,
    });
    setBusy(false);
    if (unauthorized(r)) return setError("Your session expired. Sign in again.");
    if (r.error || !r.path) return setError(r.error ?? "could not create the invite");
    onInvited(window.location.origin + r.path, email.trim());
    setEmail("");
    setName("");
    setRole("member");
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogPopup className="max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Invite someone</DialogTitle>
            <DialogDescription>
              You get a link to send them. They choose their own password. The link works once and
              lasts 7 days.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="team-invite-email">Email</Label>
              <Input
                id="team-invite-email"
                type="email"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="team-invite-name">Name</Label>
              <Input
                id="team-invite-name"
                required
                value={name}
                onChange={(e) => setName((e.target as HTMLInputElement).value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <RoleSelect value={role} onChange={setRole} />
            </div>
            {error ? <p className="text-xs text-destructive-foreground">{error}</p> : null}
          </DialogPanel>
          <DialogFooter>
            <Button type="button" size="sm" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={busy || !email.trim() || !name.trim()}>
              {busy ? <Spinner /> : null}Create invite link
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/** Removing someone with open tickets means saying who takes them — or nobody, on purpose. */
function RemoveDialog({
  member,
  tickets,
  others,
  onClose,
  onRemoved,
}: {
  member: User | null;
  tickets: Task[];
  others: User[];
  onClose: () => void;
  onRemoved: () => void;
}) {
  const [takeover, setTakeover] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setTakeover(undefined);
    setError(null);
  }, [member?.id]);

  const remove = async () => {
    if (!member) return;
    setBusy(true);
    setError(null);
    const r = await patch<{ error?: string }>(`/api/admin/users/${member.id}`, {
      disabled: true,
      ...(takeover === undefined ? {} : { reassign_to: takeover }),
    });
    setBusy(false);
    if (unauthorized(r)) return setError("Your session expired. Sign in again.");
    if (r.error) return setError(r.error);
    onRemoved();
  };

  return (
    <Dialog open={member !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Remove {member?.name}?</DialogTitle>
          <DialogDescription>
            They are signed out and can no longer sign in, and they stop getting review requests.
            Their past work stays. You can restore them later.
          </DialogDescription>
        </DialogHeader>
        {tickets.length > 0 ? (
          <DialogPanel className="space-y-3">
            <div>
              <p className="text-sm text-foreground">
                {tickets.length === 1
                  ? "They have 1 open ticket:"
                  : `They have ${tickets.length} open tickets:`}
              </p>
              <ul className="mt-1.5 space-y-1 text-[13px]">
                {tickets.map((t) => (
                  <li key={t.id} className="flex gap-2">
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {t.ticket}
                    </span>
                    <span className="min-w-0 truncate">{t.title}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-1.5">
              <Label>Who takes them?</Label>
              <AssigneePicker
                users={others}
                value={takeover}
                onChange={setTakeover}
                placeholder="Choose a person, or Unassigned"
              />
            </div>
          </DialogPanel>
        ) : null}
        {error ? <p className="px-6 pb-3 text-xs text-destructive-foreground">{error}</p> : null}
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={busy || (tickets.length > 0 && takeover === undefined)}
            onClick={() => void remove()}
          >
            {busy ? <Spinner /> : null}Remove
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function TeamPage() {
  const navigate = useNavigate();
  useFoundryType();
  const [me, setMe] = useState<User | null>(null);
  const [users, setUsers] = useState<User[] | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<User | null>(null);
  const [secret, setSecret] = useState<Secret | null>(null);
  const [now] = useState(() => Date.now());
  const admin = me?.role === "admin";

  const load = useCallback(async () => {
    try {
      const meRes = await call<{ user: User }>("/api/auth/me");
      setNeedsAuth(unauthorized(meRes));
      if (unauthorized(meRes)) return;
      setMe(meRes.user);
      const isAdmin = meRes.user.role === "admin";
      const [u, t, i] = await Promise.all([
        call<{ users: User[] }>(isAdmin ? "/api/admin/users" : "/api/users"),
        call<{ tasks: Task[] }>("/api/tasks"),
        isAdmin ? call<{ invites?: Invite[] }>("/api/admin/invites") : null,
      ]);
      if (!unauthorized(u)) setUsers(u.users);
      if (!unauthorized(t)) setTasks(t.tasks);
      // An older backend has no invites yet, and answers with a 404 body.
      if (i && !unauthorized(i)) setInvites(Array.isArray(i.invites) ? i.invites : []);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  /** One admin action: refusals are shown as the server worded them, then the list is read again. */
  const act = async <T extends { error?: string }>(
    request: Promise<T | Unauthorized>,
  ): Promise<T | null> => {
    setActionError(null);
    try {
      const r = await request;
      if (unauthorized(r)) {
        setNeedsAuth(true);
        return null;
      }
      if (r.error) {
        setActionError(r.error);
        return null;
      }
      void load();
      return r;
    } catch (e) {
      setActionError((e as Error).message);
      return null;
    }
  };

  const resetPassword = async (u: User) => {
    if (!window.confirm(`Reset ${u.name}'s password? They are signed out everywhere.`)) return;
    const r = await act(
      post<{ password?: string; error?: string }>(`/api/admin/users/${u.id}/password`),
    );
    if (r?.password)
      setSecret({
        title: `New password for ${u.name}`,
        body: "Shown once. Send it to them; they can change it from their account menu.",
        value: r.password,
      });
  };

  const newPairingLink = async (u: User) => {
    const r = await act(
      post<{ token?: string; error?: string }>(`/api/admin/users/${u.id}/pairing-token`),
    );
    if (r?.token)
      setSecret({
        title: `Pairing link for ${u.name}`,
        body: "Shown once, and it stops working soon. They open it in the browser they want to use.",
        value: setPairingTokenOnUrl(new URL("/pair", window.location.origin), r.token).toString(),
      });
  };

  const active = (users ?? []).filter((u) => !u.disabled_at);
  return (
    <SidebarInset className="foundry-type h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <WorkspacePageHeader electron={isElectron}>
        <WorkspaceBreadcrumb ariaLabel="Team">
          <WorkspaceBreadcrumbItem>Team</WorkspaceBreadcrumbItem>
        </WorkspaceBreadcrumb>
        <div className="ml-auto flex items-center gap-1.5">
          {admin ? (
            <Button size="xs" onClick={() => setInviting(true)}>
              Invite
            </Button>
          ) : null}
          <FoundryTabs
            active="team"
            onPick={(t) => {
              if (t === "usage") void navigate({ to: "/team-usage" });
              else if (t !== "team") void navigate({ to: "/pipeline", search: { tab: t } });
            }}
          />
        </div>
      </WorkspacePageHeader>

      <div className="min-h-0 flex-1 overflow-auto">
        <WorkspacePageContainer width="wide">
          {needsAuth ? (
            <p className="text-sm text-muted-foreground">
              You're signed out of Foundry.{" "}
              <Link to="/pipeline" className="underline">
                Sign in on the Pipeline page
              </Link>
              .
            </p>
          ) : error ? (
            <div className="flex items-center gap-3 text-sm text-destructive-foreground">
              Could not load the team: {error}
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  setError(null);
                  void load();
                }}
              >
                Retry
              </Button>
            </div>
          ) : !users ? (
            <Spinner />
          ) : (
            <div className="flex flex-col gap-4">
              {actionError ? (
                <p className="rounded-lg border border-destructive/32 bg-destructive/8 px-3 py-2 text-xs text-destructive-foreground">
                  {actionError}
                </p>
              ) : null}
              <div className="overflow-x-auto rounded-lg border border-border/60">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr className="border-b border-border/60">
                      <th className="px-3 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium">Email</th>
                      <th className="px-3 py-2 font-medium">Role</th>
                      <th className="px-3 py-2 font-medium">GitHub</th>
                      <th className="px-3 py-2 text-right font-medium">Open tickets</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      {admin ? <th className="px-3 py-2" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => {
                      const removed = Boolean(u.disabled_at);
                      const self = u.id === me?.id;
                      return (
                        <tr
                          key={u.id}
                          className={
                            removed
                              ? "border-b border-border/40 text-muted-foreground"
                              : "border-b border-border/40"
                          }
                        >
                          <td className="px-3 py-2 font-medium">
                            {u.name}
                            {self ? <span className="font-normal"> (you)</span> : null}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{u.email}</td>
                          <td className="px-3 py-2">
                            {admin && !removed && !self ? (
                              <RoleSelect
                                value={u.role}
                                onChange={(role) =>
                                  void act(
                                    patch<{ error?: string }>(`/api/admin/users/${u.id}`, { role }),
                                  )
                                }
                              />
                            ) : (
                              ROLE_LABEL[u.role]
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                            {u.github_login ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {openTicketsOf(tasks, u.id).length}
                          </td>
                          <td className="px-3 py-2">{memberStatus(u)}</td>
                          {admin ? (
                            <td className="px-3 py-2">
                              <div className="flex justify-end gap-1">
                                {removed ? (
                                  <Button
                                    size="xs"
                                    variant="outline"
                                    onClick={() =>
                                      void act(
                                        patch<{ error?: string }>(`/api/admin/users/${u.id}`, {
                                          disabled: false,
                                        }),
                                      )
                                    }
                                  >
                                    Restore
                                  </Button>
                                ) : (
                                  <>
                                    <Button
                                      size="xs"
                                      variant="ghost-muted"
                                      onClick={() => void resetPassword(u)}
                                    >
                                      Reset password
                                    </Button>
                                    <Button
                                      size="xs"
                                      variant="ghost-muted"
                                      onClick={() => void newPairingLink(u)}
                                    >
                                      New pairing link
                                    </Button>
                                    {self ? null : (
                                      <Button
                                        size="xs"
                                        variant="ghost-muted"
                                        onClick={() => setRemoving(u)}
                                      >
                                        Remove
                                      </Button>
                                    )}
                                  </>
                                )}
                              </div>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                    {pendingInvites(invites).map((i) => (
                      <tr key={i.id} className="border-b border-border/40 text-muted-foreground">
                        <td className="px-3 py-2 font-medium">{i.name}</td>
                        <td className="px-3 py-2">{i.email}</td>
                        <td className="px-3 py-2">{ROLE_LABEL[i.role]}</td>
                        <td className="px-3 py-2">—</td>
                        <td className="px-3 py-2 text-right">—</td>
                        <td className="px-3 py-2">{inviteStatus(i, now)}</td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end">
                            <Button
                              size="xs"
                              variant="ghost-muted"
                              onClick={() =>
                                void act(del<{ error?: string }>(`/api/admin/invites/${i.id}`))
                              }
                            >
                              Revoke
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                {admin
                  ? "An invite link lets one person set their own password. To invite someone again, revoke the old link and create a new one."
                  : "Ask an admin to invite someone or change a role."}
              </p>
            </div>
          )}
        </WorkspacePageContainer>
      </div>

      <InviteDialog
        open={inviting}
        onClose={() => setInviting(false)}
        onInvited={(link, email) => {
          setInviting(false);
          setSecret({
            title: "Invite link",
            body: `Shown once. Send it to ${email}; it works one time and lasts 7 days.`,
            value: link,
          });
          void load();
        }}
      />
      <RemoveDialog
        member={removing}
        tickets={removing ? openTicketsOf(tasks, removing.id) : []}
        others={active.filter((u) => u.id !== removing?.id)}
        onClose={() => setRemoving(null)}
        onRemoved={() => {
          setRemoving(null);
          void load();
        }}
      />
      <SecretDialog secret={secret} onClose={() => setSecret(null)} />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/team")({
  component: TeamPage,
});
