import { describe, expect, it } from "@effect/vitest";

import {
  collectionStages,
  moveStage,
  newStage,
  stageColumns,
  templateFill,
  usedIn,
  validName,
  type Catalogue,
  type StageDef,
} from "./api";

const stage = (name: string, file?: string, inputs = ["ticket"]): StageDef => ({
  name,
  skill: null,
  provider: { instanceId: "claudeAgent", model: "m" },
  inputs,
  output: file ? { file, kind: "markdown" } : { kind: "pull_request" },
  gate: "human",
  timeout_minutes: 5,
  prompt: "p",
  questions: true,
  reasoning: null,
  tests: null,
  interactive: true,
});

const catalogue: Pick<Catalogue, "stages" | "collections"> = {
  stages: [
    stage("prd", "prd.md"),
    stage("build"),
    stage("call-brief", "call-brief.md"),
    stage("proposal", "proposal.md"),
  ],
  collections: [
    {
      name: "engineering",
      code: true,
      stages: [
        { name: "prd", inputs: ["ticket"] },
        { name: "build", inputs: ["prd.md"] },
      ],
    },
    { name: "sales", code: false, stages: [{ name: "call-brief" }, { name: "proposal" }] },
  ],
};

describe("collections", () => {
  it("wire a stage without its own inputs to the ticket and everything before it", () => {
    expect(collectionStages(catalogue, "sales").map((s) => s.inputs)).toEqual([
      ["ticket"],
      ["ticket", "call-brief.md"],
    ]);
    expect(collectionStages(catalogue, "engineering").map((s) => s.inputs)).toEqual([
      ["ticket"],
      ["prd.md"],
    ]);
    expect(collectionStages(catalogue, "nope")).toEqual([]);
  });

  it("move a stage within bounds only", () => {
    expect(moveStage(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveStage(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
    expect(moveStage(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
  });

  it("say where a stage is used", () => {
    expect(usedIn(catalogue.collections, "prd")).toEqual(["engineering"]);
    expect(usedIn(catalogue.collections, "mockup")).toEqual([]);
  });

  it("name a new stage's file after it, and start it as a plain one-shot", () => {
    const s = newStage("follow-up", "markdown", stage("prd", "prd.md"));
    expect(s.output).toEqual({ file: "follow-up.md", kind: "markdown" });
    expect(newStage("deck", "html", s).output.file).toBe("deck.html");
    expect(s.interactive).toBe(false);
    expect(s.prompt).toBeNull();
    expect(validName("follow-up")).toBe(true);
    expect(validName("Follow Up")).toBe(false);
  });

  it("fill the description from a template only when it is empty", () => {
    expect(templateFill("", "Company:\n")).toBe("Company:\n");
    expect(templateFill("typed", "Company:\n")).toBe("typed");
    expect(templateFill("  ", undefined)).toBe("");
  });

  it("keep a task whose stage left the collection on the board", () => {
    const tasks = [{ stage: "prd" }, { stage: "mockup" }];
    expect(stageColumns(["prd", "build"], tasks).map((c) => [c.key, c.tasks.length])).toEqual([
      ["prd", 1],
      ["build", 0],
      ["removed", 1],
    ]);
    expect(stageColumns(["prd"], [{ stage: "prd" }]).map((c) => c.key)).toEqual(["prd"]);
  });
});
