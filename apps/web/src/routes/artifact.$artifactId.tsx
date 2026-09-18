import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AiraaLoader } from "~/components/pipeline/AiraaLoader";
import { ArtifactViewer, DiffView } from "~/components/pipeline/Artifact";
import { call, unauthorized, type ArtifactMeta } from "~/components/pipeline/api";
import { useFoundryType } from "~/components/pipeline/FoundryTabs";

/**
 * One document with the whole window to itself, for a second screen or a wide
 * mockup. It is the same viewer the task panel uses — version picker, compare and
 * the sandboxed frame for HTML — so nothing here reads the raw file directly.
 */
function ArtifactPage() {
  const { artifactId } = Route.useParams();
  const navigate = useNavigate();
  useFoundryType();
  const [versions, setVersions] = useState<ArtifactMeta[]>([]);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ fromId: string; toId: string } | null>(null);

  // Picking another version only changes the address; what was loaded already has it.
  const meta = versions.find((v) => v.id === artifactId);
  useEffect(() => {
    if (meta) return;
    let live = true;
    void (async () => {
      try {
        const [a, v] = await Promise.all([
          call<{ artifact?: { stage: string }; error?: string }>(`/api/artifacts/${artifactId}`),
          call<{ versions?: Array<Omit<ArtifactMeta, "stage">>; error?: string }>(
            `/api/artifacts/${artifactId}/versions`,
          ),
        ]);
        if (!live) return;
        if (unauthorized(a) || unauthorized(v)) return setSignedOut(true);
        const stage = a.artifact?.stage;
        if (!stage || !v.versions) return setError(a.error ?? v.error ?? "no such document");
        setSignedOut(false);
        setVersions(v.versions.map((x) => ({ ...x, stage })).sort((x, y) => x.version - y.version));
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    })();
    return () => {
      live = false;
    };
  }, [artifactId, meta]);

  return (
    <main className="foundry-type flex h-dvh min-h-0 flex-col bg-background text-foreground">
      {signedOut ? (
        <p className="p-6 text-sm text-muted-foreground">
          You're signed out of Foundry.{" "}
          <Link to="/pipeline" className="underline">
            Sign in on the Pipeline page
          </Link>
          , then open this link again.
        </p>
      ) : error ? (
        <p className="p-6 text-sm text-muted-foreground">
          Could not open this document: {error}.{" "}
          <Link to="/pipeline" className="underline">
            Go to the Pipeline page
          </Link>
          .
        </p>
      ) : !meta ? (
        <AiraaLoader className="py-16" label="Loading the document" />
      ) : diff ? (
        <DiffView fromId={diff.fromId} toId={diff.toId} onClose={() => setDiff(null)} />
      ) : (
        <ArtifactViewer
          fullWindow
          meta={meta}
          versions={versions}
          onPickVersion={(picked) =>
            void navigate({
              to: "/artifact/$artifactId",
              params: { artifactId: picked.id },
              replace: true,
            })
          }
          onDiff={(fromId, toId) => setDiff({ fromId, toId })}
        />
      )}
    </main>
  );
}

export const Route = createFileRoute("/artifact/$artifactId")({
  // The same gate as the workspace: a browser T3 has not paired goes to pair first,
  // and comes back here afterwards.
  beforeLoad: ({ context, location }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", search: { next: location.pathname }, replace: true });
    }
  },
  component: ArtifactPage,
});
