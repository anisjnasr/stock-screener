import { describe, expect, it } from "vitest";
import { consumeLargeCapRunStream } from "@/lib/premarket/large-cap-run-client";

describe("large-cap-run-client", () => {
  it("parses NDJSON stream events", async () => {
    const body = [
      '{"type":"run_started","total":1}',
      '{"type":"row_result","ticker":"AAPL","ok":true}',
      '{"type":"run_complete","ok_count":1}',
    ].join("\n");

    const response = new Response(body, {
      headers: { "Content-Type": "application/x-ndjson" },
    });

    const types: string[] = [];
    await consumeLargeCapRunStream(response, (e) => types.push(e.type));
    expect(types).toEqual(["run_started", "row_result", "run_complete"]);
  });
});
