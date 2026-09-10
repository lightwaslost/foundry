import { describe, expect, it } from "vite-plus/test";

import { prefillFromLinear } from "./api";

const issue = {
  title: "Mobile bottom navbar",
  description: "The navbar hides page content.",
  url: "https://linear.app/rapidnode/issue/RAP-1756",
};

describe("prefillFromLinear", () => {
  it("fills empty fields from the ticket", () => {
    expect(prefillFromLinear({ title: "", description: "" }, issue)).toEqual({
      title: "Mobile bottom navbar",
      description: `The navbar hides page content.\n\nLinear: ${issue.url}`,
    });
  });

  it("never overwrites what was typed: the title stays, the ticket goes below the context", () => {
    expect(prefillFromLinear({ title: "Fix it", description: "Only on iOS.\n" }, issue)).toEqual({
      title: "Fix it",
      description: `Only on iOS.\n\nThe navbar hides page content.\n\nLinear: ${issue.url}`,
    });
  });

  it("keeps a title inside Foundry's 200-character limit and survives an empty body", () => {
    const r = prefillFromLinear(
      { title: "", description: "" },
      { ...issue, title: "x".repeat(250), description: "" },
    );
    expect(r.title).toHaveLength(200);
    expect(r.description).toBe(`Linear: ${issue.url}`);
  });
});
