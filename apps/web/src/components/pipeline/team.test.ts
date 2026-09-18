import { describe, expect, it } from "@effect/vitest";

import {
  inviteStatus,
  memberStatus,
  openTicketsOf,
  pendingInvites,
  safeNextPath,
  visibleTasks,
  type Invite,
} from "./api";

const task = (id: string, state: string, assignee_id: string | null = null) => ({
  id,
  state,
  assignee_id,
});

/**
 * Deleting a ticket writes `cancelled` and nothing else does, so "deleted" is a
 * filter over one list rather than a second list to keep in step.
 */
describe("visibleTasks", () => {
  const tasks = [
    task("a", "open"),
    task("b", "cancelled"),
    task("c", "done"),
    task("d", "rejected"),
  ];

  it("keeps deleted tickets off the board", () => {
    expect(visibleTasks(tasks).map((t) => t.id)).toEqual(["a", "c", "d"]);
  });

  it("shows only deleted tickets in the Deleted view", () => {
    expect(visibleTasks(tasks, true).map((t) => t.id)).toEqual(["b"]);
  });
});

describe("openTicketsOf", () => {
  it("counts what a person still has to finish, not what is shipped, rejected or deleted", () => {
    const tasks = [
      task("a", "open", "u1"),
      task("b", "done", "u1"),
      task("c", "cancelled", "u1"),
      task("d", "rejected", "u1"),
      task("e", "open", "u2"),
      task("f", "open"),
    ];
    expect(openTicketsOf(tasks, "u1").map((t) => t.id)).toEqual(["a"]);
    expect(openTicketsOf(tasks, "nobody")).toEqual([]);
  });
});

describe("invites", () => {
  const now = Date.parse("2026-09-18T12:00:00Z");
  const invite = (over: Partial<Invite>): Invite => ({
    id: "i",
    email: "new@rapidnode.xyz",
    name: "New",
    role: "member",
    created_at: "2026-09-18T12:00:00Z",
    expires_at: "2026-09-25T12:00:00Z",
    accepted_at: null,
    revoked_at: null,
    ...over,
  });

  it("lists an invite until it is used or revoked", () => {
    const list = [
      invite({ id: "waiting" }),
      invite({ id: "used", accepted_at: "2026-09-18T13:00:00Z" }),
      invite({ id: "revoked", revoked_at: "2026-09-18T13:00:00Z" }),
      invite({ id: "expired", expires_at: "2026-09-01T00:00:00Z" }),
    ];
    expect(pendingInvites(list).map((i) => i.id)).toEqual(["waiting", "expired"]);
  });

  it("says how long a link has left in whole days", () => {
    expect(inviteStatus(invite({}), now)).toBe("Invited, expires in 7 days");
    expect(inviteStatus(invite({ expires_at: "2026-09-19T18:00:00Z" }), now)).toBe(
      "Invited, expires in 1 day",
    );
    expect(inviteStatus(invite({ expires_at: "2026-09-18T18:00:00Z" }), now)).toBe(
      "Invited, expires today",
    );
    expect(inviteStatus(invite({ expires_at: "2026-09-18T12:00:00Z" }), now)).toBe(
      "Invite expired",
    );
  });
});

describe("memberStatus", () => {
  it("calls a disabled account removed", () => {
    expect(memberStatus({ disabled_at: null })).toBe("Active");
    expect(memberStatus({})).toBe("Active"); // GET /api/users sends no disabled_at
    expect(memberStatus({ disabled_at: "2026-09-18T12:00:00Z" })).toBe("Removed");
  });
});

/**
 * `next` arrives in a link anyone can write, and is navigated to right after a
 * session is created — so it may only ever name a page on this site.
 */
describe("safeNextPath", () => {
  it("keeps a path on this site", () => {
    expect(safeNextPath("/pipeline")).toBe("/pipeline");
    expect(safeNextPath("/artifact/abc-123")).toBe("/artifact/abc-123");
    expect(safeNextPath("/pipeline?task=t1")).toBe("/pipeline?task=t1");
    expect(safeNextPath("/")).toBe("/");
  });

  it("falls back to the home page for anything that could leave the site", () => {
    for (const bad of [
      "//evil.example",
      "/\\evil.example",
      "https://evil.example",
      "javascript:alert(1)",
      "pipeline",
      "",
      undefined,
      null,
      42,
    ]) {
      expect(safeNextPath(bad)).toBe("/");
    }
  });
});
