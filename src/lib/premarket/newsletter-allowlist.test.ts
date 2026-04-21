import { describe, expect, it } from "vitest";
import { loadNewsletterAllowlistFromRepo, parseNewsletterAllowlistText } from "./newsletter-allowlist";

describe("parseNewsletterAllowlistText", () => {
  it("keeps only lines that look like emails", () => {
    expect(parseNewsletterAllowlistText("Header\n\nA@b.com\nnot-an-email\n")).toEqual(["a@b.com"]);
  });
});

describe("loadNewsletterAllowlistFromRepo", () => {
  it("loads committed config file", () => {
    const list = loadNewsletterAllowlistFromRepo();
    expect(list).toContain("crew@morningbrew.com");
    expect(list.length).toBeGreaterThanOrEqual(10);
  });
});
