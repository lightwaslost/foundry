import { describe, expect, it } from "@effect/vitest";

import { bannerFor, NEEDS_HUMAN, type RunState } from "./api";

/**
 * The eyebrow is the first line read on a task. Three states used to share the
 * string "Waiting on you", so a one-pager that had asked its opening question
 * looked exactly like a finished document waiting to be signed off.
 */
describe("bannerFor", () => {
  it("names the move rather than restating that something is waiting", () => {
    expect(bannerFor("awaiting_gate", false)).toBe("Ready for your decision");
    expect(bannerFor("awaiting_answers", false)).toBe("Needs your answers to start");
    expect(bannerFor("parked", false)).toBe("Stopped");
  });

  it("tells an interview apart from a draft waiting to be accepted", () => {
    expect(bannerFor("conversing", false)).toBe("Answer to continue");
    expect(bannerFor("conversing", true)).toBe("Draft ready — reply or accept");
  });

  it("says nothing special about a run that wants nothing", () => {
    for (const s of [
      "queued",
      "preparing",
      "running",
      "collecting",
      "testing",
      "done",
    ] as RunState[]) {
      expect(bannerFor(s, false)).toBe("Working");
    }
  });

  // The property the old Record<string, string> could not hold: a typo'd or newly
  // added waiting state fell through to "Working" with no compile error and no test.
  it("gives every state that needs a person something to do", () => {
    for (const s of NEEDS_HUMAN) expect(bannerFor(s, false)).not.toBe("Working");
  });

  it("keeps the four apart — saying the same thing four times was the bug", () => {
    const said = ["awaiting_gate", "awaiting_answers", "conversing", "parked"].map((s) =>
      bannerFor(s as RunState, false),
    );
    expect(new Set(said).size).toBe(said.length);
  });
});
