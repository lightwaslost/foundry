import { ExternalLinkIcon } from "lucide-react";

import { Button } from "~/components/ui/button";

/**
 * Beszel, the VPS metrics dashboard, embedded rather than linked.
 *
 * The pipeline runs agents on one box; when a stage goes quiet the first question
 * is always whether the machine is the problem. That question should not cost a
 * context switch into another tab.
 *
 * Hardcoded because there is one VPS and one monitor. If a second environment ever
 * exists this belongs in `settings`, alongside the Slack channel.
 *
 * Beszel answers with `X-Frame-Options: SAMEORIGIN`, so Traefik replaces that with
 * a `frame-ancestors` policy naming this host (`/etc/traefik/dynamic/monitor.yml`).
 * Beszel keeps its own login, and its session cookie is third-party inside this
 * frame — if a browser is blocking those, the frame shows Beszel's sign-in page
 * instead of the dashboard, which is why the escape hatch below is not optional.
 */
const MONITOR_URL = "https://monitor.srv1805755.hstgr.cloud/system/09edz5kxdauchyk";

export function ServerMonitor() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 px-4">
        <span className="font-mono text-[11px] text-muted-foreground">
          beszel · monitor.srv1805755.hstgr.cloud
        </span>
        <Button
          size="xs"
          variant="ghost-muted"
          className="ml-auto"
          render={<a href={MONITOR_URL} target="_blank" rel="noreferrer" />}
        >
          <ExternalLinkIcon /> Open it directly
        </Button>
      </div>
      <iframe
        title="Server monitor"
        src={MONITOR_URL}
        className="min-h-0 w-full flex-1 border-0 bg-background"
      />
    </div>
  );
}
