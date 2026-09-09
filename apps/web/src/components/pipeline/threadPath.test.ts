import { describe, expect, it } from "vite-plus/test";
import { threadPath } from "./api";

/**
 * This shape was wrong twice, in two different components, and both times it
 * failed as a 404 page rather than as anything a build or a type could catch.
 * The route is `_chat.$environmentId.$threadId` — the two ids sit side by side.
 */
describe("threadPath", () => {
  it("puts the ids side by side, with no segment between them", () => {
    expect(threadPath("env-1", "thread-1")).toBe("/env-1/thread-1");
  });

  it("never emits the /thread/ segment that routes to nothing", () => {
    expect(threadPath("env-1", "thread-1")).not.toContain("/thread/");
  });

  it("is null when either id is missing, so callers cannot navigate nowhere", () => {
    expect(threadPath(null, "thread-1")).toBeNull();
    expect(threadPath("env-1", null)).toBeNull();
    expect(threadPath("env-1", undefined)).toBeNull();
    expect(threadPath(null, null)).toBeNull();
  });
});
