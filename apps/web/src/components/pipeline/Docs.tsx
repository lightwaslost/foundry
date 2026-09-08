import type { ReactNode } from "react";
import { Badge } from "~/components/ui/badge";

/**
 * What a new person on the team needs to know, kept where they already are.
 * Written as prose rather than a feature list: the questions people actually ask
 * are "what is this doing", "what does it need from me", and "it stopped, now what".
 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium tracking-[-0.005em] text-foreground/70">{title}</h2>
      <div className="space-y-2 rounded-xl border border-border/60 bg-card/40 px-4 py-3 text-[13px] leading-[1.6] text-muted-foreground">
        {children}
      </div>
    </section>
  );
}
const Term = ({ children }: { children: ReactNode }) => (
  <span className="font-mono text-[12px] text-foreground">{children}</span>
);

export function Docs() {
  return (
    <div className="space-y-5 pb-8">
      <Section title="What this is">
        <p>
          A ticket goes through a fixed set of stages — a one-pager, a mockup, a technical PRD, then
          the build — and an agent does each one. You are in it at two moments: when an agent asks
          something it cannot reasonably decide, and when a stage finishes and needs a person to
          approve what it produced. Everything else runs without you.
        </p>
        <p>
          Each stage runs as a real agent session you can open and watch, on a branch of its own
          named <Term>foundry/&lt;ticket&gt;</Term>. Documents are committed to that branch under{" "}
          <Term>specs/&lt;TICKET&gt;/</Term>, so the pipeline's output is in the repository, not
          locked in a tool.
        </p>
      </Section>

      <Section title="Starting something">
        <p>
          <strong className="font-medium text-foreground">New task</strong>, then say what you want
          built and give the agent context: who has the problem, what exists today, what done looks
          like, and anything you have already decided. Under-describing a task does not fail — it
          just means the agent asks you more questions before it starts.
        </p>
        <p>
          Pick the pipeline that matches the work: <Term>feature</Term> for the full run,{" "}
          <Term>bugfix</Term> to skip straight to a PRD and a build, <Term>spike</Term> when you
          only want the thinking written down. Nothing runs until you press{" "}
          <strong className="font-medium text-foreground">Start</strong>.
        </p>
      </Section>

      <Section title="The two things it will ask of you">
        <p>
          <Badge variant="warning" size="sm" className="mr-1.5 align-[1px]">
            needs answers
          </Badge>
          Before the real work, each stage runs a read-only pass where the agent asks anything that
          would otherwise be guesswork. Answer here, or answer the same questions inside the agent
          thread — including from your phone. Whichever happens first, the stage resumes. Your
          answers carry into later attempts, so sending work back never means answering the same
          thing twice.
        </p>
        <p>
          <Badge variant="warning" size="sm" className="mr-1.5 align-[1px]">
            needs review
          </Badge>
          When a stage produces its document, it stops. Read it, then approve, edit and approve,
          send it back with feedback, or reject the task. Editing saves your version as a new
          revision, and that is the version the next stage reads — so fixing a paragraph yourself is
          usually faster than a round trip.
        </p>
        <p>Anyone can approve. Every decision is recorded against the person who made it.</p>
      </Section>

      <Section title="When something stops">
        <p>
          A stage that fails <strong className="font-medium text-foreground">parks</strong>. It
          never retries by itself, because a silent retry on a failure you have not seen wastes the
          shared Claude subscription and hides the cause. The card says what happened in plain
          words, and keeps the details.
        </p>
        <p>
          The common ones: <Term>Claude usage limit reached</Term> means the shared subscription is
          rate-limited — wait, then run the stage again.{" "}
          <Term>The agent finished without writing its deliverable</Term> usually means the
          instructions were ambiguous; send it back with feedback rather than retrying blind.{" "}
          <Term>Ran past its time limit</Term> means the stage's working-time budget was used up —
          waiting on you never counts towards it.
        </p>
      </Section>

      <Section title="Changing how a stage behaves">
        <p>
          Every stage has instructions, a skill it loads first, a model, whether a person reviews
          it, and a time limit. You can change those in two places, and the difference matters:
        </p>
        <p>
          <strong className="font-medium text-foreground">For one task</strong> — when creating it,
          open "Adjust the stages for this task". Nobody else is affected, and the task keeps those
          settings for its whole life.
        </p>
        <p>
          <strong className="font-medium text-foreground">For everyone</strong> — the Pipelines tab,
          admin only. This changes what future tasks run. Anything already in flight keeps the
          stages it started with, so editing is never disruptive. The JSON files in the repository
          remain the source you can always restore to.
        </p>
      </Section>

      <Section title="Where things live">
        <p>
          The board and the agent threads are the same application, so "Watch the agent" on any
          stage opens the real session. The branch and the committed documents are in the repository
          the task was created against. A finished build pushes its branch and opens a draft pull
          request; agents never merge.
        </p>
        <p>
          Your session lasts 30 days. Change your password from your name in the top right — that
          also signs out your other devices.
        </p>
      </Section>
    </div>
  );
}
