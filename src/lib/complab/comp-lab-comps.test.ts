import { describe, expect, it } from "vitest";
import { mapHistoricalAnaloguesToCompLabComps, sortCompLabComps } from "@/lib/complab/comp-lab-comps";

describe("comp-lab-comps", () => {
  it("maps lab-mode matches to comp cards", () => {
    const mapped = mapHistoricalAnaloguesToCompLabComps({
      match_count: 2,
      reference_setup_signature: "Moderate gap up · Tight base · Uptrend",
      matches: [
        {
          analogue_session_date: "2024-03-10",
          next_session_date: "2024-03-11",
          setup_signature: "Small gap up · Tight base · Uptrend",
          similarity_score: 100,
          gap_bucket_used_for_match: "small_up",
          next_session: {
            follow_through_label: "follow_through",
            close_vs_open_pct: 3.4,
          },
        },
        {
          analogue_session_date: "2024-02-01",
          next_session_date: "2024-02-02",
          setup_signature: "Flat gap · Tight base · Uptrend",
          similarity_score: 100,
          gap_bucket_used_for_match: "flat",
          next_session: {
            follow_through_label: "reversed",
            close_vs_open_pct: -2.1,
          },
        },
      ],
    });

    expect(mapped.match_count).toBe(2);
    expect(mapped.comps).toHaveLength(2);
    expect(mapped.comps[0]?.outcome).toBe("follow_through");
    expect(mapped.comps[0]?.outcome_label).toContain("Followed Through");
    expect(mapped.reference_setup_signature).toContain("Uptrend");
  });

  it("sorts by similarity then recent", () => {
    const comps = sortCompLabComps(
      [
        {
          comp_date: "2024-01-01",
          next_session_date: "2024-01-02",
          setup_signature: "A",
          similarity_score: 100,
          outcome: "flat",
          outcome_pct: 0,
          gap_bucket: "flat",
          outcome_label: "Flat 0%",
        },
        {
          comp_date: "2024-03-01",
          next_session_date: "2024-03-02",
          setup_signature: "B",
          similarity_score: 100,
          outcome: "flat",
          outcome_pct: 0,
          gap_bucket: "flat",
          outcome_label: "Flat 0%",
        },
      ],
      "recent"
    );
    expect(comps[0]?.comp_date).toBe("2024-03-01");
  });
});
