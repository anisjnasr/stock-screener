import { describe, expect, it } from "vitest";
import { parseEmailAddressFromFromHeader } from "./gmailParse";

describe("parseEmailAddressFromFromHeader", () => {
  it("parses angle-bracket form", () => {
    expect(parseEmailAddressFromFromHeader(`"Doomberg" <doomberg@substack.com>`)).toBe("doomberg@substack.com");
  });
  it("parses bare email", () => {
    expect(parseEmailAddressFromFromHeader("crew@morningbrew.com")).toBe("crew@morningbrew.com");
  });
});
