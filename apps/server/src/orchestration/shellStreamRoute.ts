import { ThreadId, type OrchestrationEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import { requiredScopeForRpcMethod } from "../auth/RpcAuthorization.ts";
import { ORCHESTRATION_WS_METHODS } from "@t3tools/contracts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";

/**
 * The shell, as a plain HTTP stream, for Foundry.
 *
 * Foundry drives agent threads from outside this process and needs to know when
 * a turn has ended, whether anything is pending, and whether background work is
 * still alive. It used to reconstruct that from polled snapshots -- the thread
 * for its turn, the shell for liveness -- and every new signal was a new special
 * case stitched over the seam. The web client never had that problem: it
 * subscribes to the shell and receives the whole per-thread row on every change.
 *
 * That subscription is an Effect RPC over the WebSocket, built per connection,
 * and consuming it from a dependency-free Node service would mean speaking that
 * protocol by hand. So this is the same row, over server-sent events, with the
 * bearer in a header and `afterSequence` in the query.
 *
 * Contract, one JSON item per `data:` line:
 *   { kind: "snapshot", snapshot }            -- full shell; sent when there is no
 *                                                afterSequence or the gap is too
 *                                                large to replay
 *   { kind: "thread-upserted", sequence, thread }
 *   { kind: "thread-removed",  sequence, threadId }
 *   { kind: "sequence",        sequence }     -- a non-thread event; advances the
 *                                                cursor and carries nothing else
 *   { kind: "synchronized" }                  -- replay done, live from here
 * and a `:hb` comment every fifteen seconds so nothing between us times it out.
 *
 * ponytail: coalescing here is a fixed window per thread, not the budgeted
 * per-client machinery the WebSocket path has. One consumer that only ever
 * wants the latest row does not need it. If a second consumer appears, hoist
 * the WebSocket path's shell subscription out of its per-connection scope and
 * use it from both.
 */
const ROUTE = "/api/orchestration/shell/stream";
const REPLAY_MAX_GAP = 1_000;
const COALESCE_WINDOW = "150 millis";
const COALESCE_MAX = 512;
const HEARTBEAT = "15 seconds";

const encoder = new TextEncoder();
const frame = (item: unknown) => encoder.encode(`data: ${JSON.stringify(item)}\n\n`);
const heartbeat = encoder.encode(`:hb\n\n`);

const isThreadRemoval = (type: OrchestrationEvent["type"]) =>
  type === "thread.deleted" || type === "thread.archived";

export const shellStreamRouteLayer = HttpRouter.add(
  "GET",
  ROUTE,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
    const engine = yield* OrchestrationEngineService;
    const query = yield* ProjectionSnapshotQuery;

    const session = yield* serverAuth.authenticateHttpRequest(request).pipe(
      Effect.map(Option.some),
      Effect.catchIf(EnvironmentAuth.isServerAuthCredentialError, () =>
        Effect.succeed(Option.none<EnvironmentAuth.AuthenticatedSession>()),
      ),
    );
    if (Option.isNone(session)) {
      return HttpServerResponse.text("Unauthorized", { status: 401 });
    }
    if (
      !session.value.scopes.includes(
        requiredScopeForRpcMethod(ORCHESTRATION_WS_METHODS.subscribeShell),
      )
    ) {
      return HttpServerResponse.text("Forbidden", { status: 403 });
    }

    const url = HttpServerRequest.toURL(request);
    const afterRaw = Option.isSome(url) ? url.value.searchParams.get("afterSequence") : null;
    const afterSequence =
      afterRaw !== null && /^\d+$/.test(afterRaw) ? Number(afterRaw) : undefined;

    // One thread's newest sequence per window, then one projection read per thread.
    // A streaming turn is hundreds of events on one aggregate; the row it produces
    // is the same row, so reading it once per window is the whole point.
    const rowFor = (threadId: string, sequence: number, removed: boolean) =>
      removed
        ? Effect.succeed({ kind: "thread-removed" as const, sequence, threadId })
        : query.getThreadShellById(ThreadId.make(threadId)).pipe(
            Effect.map(
              Option.match({
                onNone: () => ({ kind: "thread-removed" as const, sequence, threadId }),
                onSome: (thread) => ({ kind: "thread-upserted" as const, sequence, thread }),
              }),
            ),
            // A transient read failure must not read as "this thread is gone".
            // Skip the item; the next event for the thread, or the reconciliation
            // poll on the other side, repairs it.
            Effect.orElseSucceed(() => ({ kind: "sequence" as const, sequence })),
          );

    const toItems = (events: ReadonlyArray<OrchestrationEvent>) => {
      const newest = new Map<string, { sequence: number; removed: boolean }>();
      let other = 0;
      for (const e of events) {
        if (e.aggregateKind === "thread") {
          const cur = newest.get(e.aggregateId);
          if (!cur || e.sequence > cur.sequence) {
            newest.set(e.aggregateId, { sequence: e.sequence, removed: isThreadRemoval(e.type) });
          }
        } else if (e.sequence > other) {
          other = e.sequence;
        }
      }
      const reads = [...newest].map(([id, { sequence, removed }]) => rowFor(id, sequence, removed));
      return Effect.all(reads, { concurrency: 8 }).pipe(
        Effect.map((rows) =>
          other ? [...rows, { kind: "sequence" as const, sequence: other }] : rows,
        ),
      );
    };

    const coalesced = (events: Stream.Stream<OrchestrationEvent, unknown>) =>
      events.pipe(
        Stream.groupedWithin(COALESCE_MAX, COALESCE_WINDOW),
        Stream.mapEffect(toItems),
        Stream.flatMap((items) => Stream.fromIterable(items)),
      );

    const live = coalesced(engine.streamDomainEvents);
    const synchronized = Stream.make({ kind: "synchronized" as const });

    let head: Stream.Stream<unknown, unknown>;
    if (afterSequence !== undefined) {
      const latest = yield* engine.latestSequence;
      const gap = latest - afterSequence;
      head =
        gap >= 0 && gap <= REPLAY_MAX_GAP
          ? coalesced(engine.readEvents(afterSequence, gap))
          : Stream.fromEffect(query.getShellSnapshot()).pipe(
              Stream.map((snapshot) => ({ kind: "snapshot" as const, snapshot })),
            );
    } else {
      head = Stream.fromEffect(query.getShellSnapshot()).pipe(
        Stream.map((snapshot) => ({ kind: "snapshot" as const, snapshot })),
      );
    }

    const body = Stream.concat(head, Stream.concat(synchronized, live)).pipe(
      Stream.map(frame),
      Stream.merge(
        Stream.fromSchedule(Schedule.spaced(HEARTBEAT)).pipe(Stream.map(() => heartbeat)),
      ),
      // Whatever went wrong, the client sees the stream end and reconnects with its
      // cursor. Failing the response mid-stream would only turn that into a worse
      // error on their side.
      Stream.catch(() => Stream.empty),
    );

    return HttpServerResponse.stream(body, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  }),
);
