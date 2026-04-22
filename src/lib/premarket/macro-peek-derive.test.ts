import { describe, expect, it } from "vitest";
import { deriveMacroPeekKeywords } from "./macro-peek-derive";

describe("deriveMacroPeekKeywords", () => {
  it("joins short topic-style chunks from sentences", () => {
    const s =
      "Oil spiked on Middle East tensions. The Fed signaled patience on cuts. Q1 earnings breadth improved.";
    const p = deriveMacroPeekKeywords(s);
    expect(p).toContain(" - ");
    expect(p.length).toBeLessThanOrEqual(143);
  });

  it("uses capitalized entities in comma clause instead of long verb phrase", () => {
    const s =
      "Trump indefinitely extended the Iran ceasefire, and Congress debated next steps. Fed Chair nominee Kevin Warsh faced questions.";
    const p = deriveMacroPeekKeywords(s);
    expect(p).not.toMatch(/Indefinitely Extended/i);
    expect(p).toMatch(/Trump|Iran/i);
  });
});
