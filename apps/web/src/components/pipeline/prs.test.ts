import { describe, expect, it } from "vite-plus/test";

import { taskPrs, type Run } from "./api";

const run = (o: Partial<Run>): Run => ({
  id: "r",
  stage: "build",
  attempt: 1,
  state: "done",
  t3_thread_id: null,
  queued_at: "",
  started_at: null,
  active_ms: 0,
  active_since: null,
  timeout_ms: 0,
  head_sha: null,
  artifact_id: null,
  pr_url: null,
  park_reason: null,
  park_detail: null,
  finished_at: null,
  test_exit_code: null,
  ...o,
});
const fe = (n: number) => ({ repo: "fe", url: `https://github.com/o/fe/pull/${n}`, number: n });
const be = (n: number) => ({ repo: "be", url: `https://github.com/o/be/pull/${n}`, number: n });

describe("taskPrs", () => {
  it("is empty before a build has opened anything", () => {
    expect(taskPrs([run({ stage: "prd", state: "awaiting_gate" })])).toEqual([]);
  });

  it("lists every repository's pull request, primary first, even once verify is the current stage", () => {
    const runs = [run({ prs: [fe(402), be(672)], pr_url: fe(402).url }), run({ stage: "verify" })];
    expect(taskPrs(runs).map((p) => p.label)).toEqual(["fe #402", "be #672"]);
  });

  it("a later build's link wins for a repository, and one only an earlier build touched still shows", () => {
    const runs = [run({ prs: [fe(1), be(2)] }), run({ attempt: 2, prs: [fe(3)] })];
    expect(taskPrs(runs).map((p) => p.label)).toEqual(["fe #3", "be #2"]);
  });

  it("an older backend's single pr_url still shows", () => {
    expect(taskPrs([run({ pr_url: "https://github.com/o/fe/pull/9" })])).toEqual([
      { url: "https://github.com/o/fe/pull/9", label: "Pull request" },
    ]);
  });
});
