import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";
import { formatTokens, formatUsd } from "@t3tools/shared/usageFormat";

import { Button } from "~/components/ui/button";
import { SidebarInset } from "~/components/ui/sidebar";
import { Spinner } from "~/components/ui/spinner";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "~/components/WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "~/components/WorkspacePageContainer";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { call, duration, unauthorized } from "~/components/pipeline/api";
import { FoundryTabs, useFoundryType } from "~/components/pipeline/FoundryTabs";
import { isElectron } from "~/env";

/**
 * Team usage: what each person is running through Foundry, and what its agents used.
 * Everything comes from GET /api/usage (foundry-mvp src/usage/usage.ts); this page only
 * lays it out. Credit goes to the task's assignee.
 */

type Range = "7d" | "30d" | "all";
const RANGE_LABEL: Record<Range, string> = { "7d": "7 days", "30d": "30 days", all: "All time" };

interface Stage {
  stage: string;
  attempt: number;
  active_ms: number;
  status: "working" | "unmeasured" | "measured";
  sessions: number | null;
  tokens: number;
  cost_usd: number;
}
interface UsageTask {
  id: string;
  ticket: string;
  title: string;
  state: string;
  linear_issue: string | null;
  pr_urls: string[];
  stages: Stage[];
}
interface Totals {
  tasks_started: number;
  tasks_open: number;
  tasks_done: number;
  tickets: number;
  prs: number;
  active_ms: number;
  tokens: number;
  cost_usd: number;
  unmeasured_runs: number;
}
interface Report {
  unpriced_models: string[];
  totals: Totals;
  people: Array<{ user: { id: string; name: string } | null; totals: Totals; tasks: UsageTask[] }>;
}

function stageCost(s: Stage): string {
  if (s.status === "working") return "counted when it stops";
  if (s.status === "measured" && s.sessions === 0) return "—";
  const cost = s.tokens > 0 ? formatUsd(s.cost_usd) : "—";
  return s.status === "unmeasured" ? `${cost} · counting…` : cost;
}

function TeamUsagePage() {
  const navigate = useNavigate();
  useFoundryType();
  const [range, setRange] = useState<Range>("30d");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const r = await call<Report>(`/api/usage?range=${range}`);
      setNeedsAuth(unauthorized(r));
      if (!unauthorized(r)) setReport(r);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [range]);
  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const t = report?.totals;
  return (
    <SidebarInset className="foundry-type h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <WorkspacePageHeader electron={isElectron}>
        <WorkspaceBreadcrumb ariaLabel="Team usage">
          <WorkspaceBreadcrumbItem>Team usage</WorkspaceBreadcrumbItem>
        </WorkspaceBreadcrumb>
        <div className="ml-auto flex items-center rounded-lg border border-border/60 p-0.5">
          {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
            <Button
              key={r}
              size="xs"
              variant={range === r ? "secondary" : "ghost-muted"}
              onClick={() => {
                setError(null);
                setRange(r);
              }}
            >
              {RANGE_LABEL[r]}
            </Button>
          ))}
        </div>
        <FoundryTabs
          active="usage"
          onPick={(t) => {
            if (t !== "usage") void navigate({ to: "/pipeline", search: { tab: t } });
          }}
        />
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
              Could not load usage: {error}
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
          ) : !report || !t ? (
            <Spinner />
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                {t.tasks_started} tasks · {t.prs} PRs · {duration(t.active_ms)} of agent time ·{" "}
                {formatTokens(t.tokens)} tokens ·{" "}
                <span className="font-medium text-foreground">
                  {formatUsd(t.cost_usd)} est. cost
                </span>
                {t.unmeasured_runs > 0 ? ` · ${t.unmeasured_runs} stages still being counted` : ""}
                {report.unpriced_models.length > 0
                  ? ` · not priced: ${report.unpriced_models.join(", ")}`
                  : ""}
              </p>

              {report.people.length === 0 ? (
                <p className="text-sm text-muted-foreground">No Foundry work in this period.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border/60">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr className="border-b border-border/60">
                        <th className="px-3 py-2 font-medium">Person</th>
                        <th className="px-3 py-2 font-medium">Tasks</th>
                        <th className="px-3 py-2 text-right font-medium">Linear tickets</th>
                        <th className="px-3 py-2 text-right font-medium">PRs opened</th>
                        <th className="px-3 py-2 text-right font-medium">Agent time</th>
                        <th className="px-3 py-2 text-right font-medium">AI tokens</th>
                        <th className="px-3 py-2 text-right font-medium">Est. cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.people.map((p) => {
                        const key = p.user?.id ?? "unassigned";
                        const expanded = open.has(key);
                        return (
                          <Fragment key={key}>
                            <tr
                              className="cursor-pointer border-b border-border/40 hover:bg-accent/40"
                              onClick={() => toggle(key)}
                            >
                              <td className="px-3 py-2 font-medium">
                                <button
                                  type="button"
                                  aria-expanded={expanded}
                                  className="inline-flex items-center gap-1"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggle(key);
                                  }}
                                >
                                  {expanded ? (
                                    <ChevronDownIcon className="size-3.5" />
                                  ) : (
                                    <ChevronRightIcon className="size-3.5" />
                                  )}
                                  {p.user?.name ?? "Unassigned"}
                                </button>
                              </td>
                              <td className="px-3 py-2 text-muted-foreground">
                                {p.totals.tasks_started} started · {p.totals.tasks_open} open ·{" "}
                                {p.totals.tasks_done} done
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {p.totals.tickets}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">{p.totals.prs}</td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {duration(p.totals.active_ms)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {formatTokens(p.totals.tokens)}
                              </td>
                              <td className="px-3 py-2 text-right font-medium tabular-nums">
                                {formatUsd(p.totals.cost_usd)}
                              </td>
                            </tr>
                            {expanded
                              ? p.tasks.map((task) => (
                                  <tr
                                    key={task.id}
                                    className="border-b border-border/40 bg-muted/30"
                                  >
                                    <td colSpan={7} className="px-3 py-2 pl-8">
                                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                        <button
                                          type="button"
                                          className="font-mono text-xs underline-offset-2 hover:underline"
                                          onClick={() =>
                                            void navigate({
                                              to: "/pipeline",
                                              search: { task: task.id },
                                            })
                                          }
                                        >
                                          {task.ticket}
                                        </button>
                                        <span className="min-w-0 truncate">{task.title}</span>
                                        {task.linear_issue ? (
                                          <span className="text-xs text-muted-foreground">
                                            {task.linear_issue}
                                          </span>
                                        ) : null}
                                        {task.pr_urls.map((url) => (
                                          <a
                                            key={url}
                                            href={url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-xs text-muted-foreground underline"
                                          >
                                            PR #{url.split("/").pop()}
                                          </a>
                                        ))}
                                      </div>
                                      <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                                        {task.stages.map((s) => (
                                          <span
                                            key={`${s.stage}-${s.attempt}`}
                                            className="rounded-md border border-border/60 px-1.5 py-0.5"
                                          >
                                            {s.stage}
                                            {s.attempt > 1 ? ` #${s.attempt}` : ""} {stageCost(s)}
                                          </span>
                                        ))}
                                      </div>
                                    </td>
                                  </tr>
                                ))
                              : null}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Counts work run through Foundry only, credited to each task's assignee. Est. cost is
                what the tokens would cost at Claude's public API prices; Foundry runs on a
                subscription. Deleted tasks and Claude on your own machine are not included.
              </p>
            </div>
          )}
        </WorkspacePageContainer>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/team-usage")({
  component: TeamUsagePage,
});
