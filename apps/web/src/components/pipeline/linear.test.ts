import { describe, expect, it } from "vite-plus/test";

import { applyLinear, removeLinear } from "./api";

const a = {
  title: "Mobile bottom navbar",
  description: "The navbar hides page content.",
  url: "https://linear.app/rapidnode/issue/RAP-1756",
};
const b = {
  title: "Add slug in campaigns",
  description: "Campaign URLs should use a slug.",
  url: "https://linear.app/rapidnode/issue/RAP-1755",
};
const empty = { title: "", description: "" };

describe("applyLinear", () => {
  it("fills empty fields from the ticket", () => {
    const r = applyLinear(empty, a);
    expect(r.title).toBe("Mobile bottom navbar");
    expect(r.description).toBe(`The navbar hides page content.\n\nLinear: ${a.url}`);
  });

  it("never overwrites what was typed: the title stays, the ticket goes below the context", () => {
    const r = applyLinear({ title: "Fix it", description: "Only on iOS.\n" }, a);
    expect(r.title).toBe("Fix it");
    expect(r.description).toBe(`Only on iOS.\n\nThe navbar hides page content.\n\nLinear: ${a.url}`);
    expect(r.fill.title).toBeNull();
  });

  it("keeps a title inside Foundry's 200-character limit and survives an empty body", () => {
    const r = applyLinear(empty, { ...a, title: "x".repeat(250), description: "" });
    expect(r.title).toHaveLength(200);
    expect(r.description).toBe(`Linear: ${a.url}`);
  });
});

describe("removeLinear", () => {
  it("unlinking takes the ticket's text back out", () => {
    const r = applyLinear(empty, a);
    expect(removeLinear(r, r.fill)).toEqual(empty);
  });

  it("leaves what was typed before and after the ticket", () => {
    const r = applyLinear({ title: "Fix it", description: "Only on iOS." }, a);
    const withMore = { ...r, description: `${r.description}\n\nAlso Android.` };
    expect(removeLinear(withMore, r.fill)).toEqual({
      title: "Fix it",
      description: "Only on iOS.\n\nAlso Android.",
    });
  });

  it("a title or ticket text the person edited is theirs and stays", () => {
    const r = applyLinear(empty, a);
    const edited = { title: "Navbar on mobile", description: r.description.replace("hides", "covers") };
    expect(removeLinear(edited, r.fill)).toEqual(edited);
  });

  it("picking another ticket replaces the first one's text", () => {
    const first = applyLinear(empty, a);
    const second = applyLinear(removeLinear(first, first.fill), b);
    expect(second.title).toBe("Add slug in campaigns");
    expect(second.description).toBe(`Campaign URLs should use a slug.\n\nLinear: ${b.url}`);
  });
});
