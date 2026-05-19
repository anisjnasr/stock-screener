export type LargeCapRunEvent =
  | { type: "run_started"; total: number; data_mode: string; concurrency: number; tickers: string[] }
  | { type: "row_result"; ticker: string; ok: true; cache_hit?: boolean; claude_call_made?: boolean; digest_hash?: string; trading_date?: string; data_mode?: string; analyzed_at?: string; digest?: Record<string, unknown>; verdict?: Record<string, unknown>; archive_written?: boolean }
  | { type: "row_error"; ticker: string; ok: false; error: string }
  | { type: "run_complete"; total: number; ok_count: number; error_count: number }
  | { type: "archive_scored"; ticker: string; trading_date: string; outcome_session: string; outcome: string }
  | { type: "archive_scoring_complete"; scored_count: number; skipped_still_pending: number; analysis_date: string }
  | { type: "archive_score_error"; ticker: string; trading_date: string; error: string }
  | { type: "run_error"; ok: false; error: string };

export async function consumeLargeCapRunStream(
  response: Response,
  onEvent: (event: LargeCapRunEvent) => void
): Promise<void> {
  if (!response.body) {
    throw new Error("Empty response body");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      onEvent(JSON.parse(trimmed) as LargeCapRunEvent);
    }
  }
  const tail = buffer.trim();
  if (tail) {
    onEvent(JSON.parse(tail) as LargeCapRunEvent);
  }
}
