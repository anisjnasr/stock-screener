import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewsletterArchiveRow } from "@/types/newsletter-macro";

const DEFAULT_LOOKBACK_HOURS = 48;
const DEFAULT_LIMIT = 120;

export type CurrentNewsletterArchiveResult =
  | { ok: true; rows: Pick<NewsletterArchiveRow, "id" | "sender_email" | "subject" | "body_text" | "received_at">[] }
  | { ok: false; error: string };

export function currentNewsletterArchiveStartIso(now = new Date(), lookbackHours = DEFAULT_LOOKBACK_HOURS): string {
  return new Date(now.getTime() - lookbackHours * 60 * 60 * 1000).toISOString();
}

export async function fetchCurrentNewsletterArchive(
  supabase: SupabaseClient,
  opts?: { now?: Date; lookbackHours?: number; limit?: number }
): Promise<CurrentNewsletterArchiveResult> {
  const sinceIso = currentNewsletterArchiveStartIso(opts?.now, opts?.lookbackHours);
  const limit = Math.max(1, Math.min(200, opts?.limit ?? DEFAULT_LIMIT));

  const { data, error } = await supabase
    .from("newsletter_archive")
    .select("id,sender_email,subject,body_text,received_at")
    .gte("received_at", sinceIso)
    .lte("received_at", (opts?.now ?? new Date()).toISOString())
    .order("received_at", { ascending: true })
    .limit(limit);

  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    rows: (data ?? []) as Pick<NewsletterArchiveRow, "id" | "sender_email" | "subject" | "body_text" | "received_at">[],
  };
}

export function formatNewsletterArchivePromptBlock(
  rows: Pick<NewsletterArchiveRow, "sender_email" | "subject" | "body_text" | "received_at">[]
): string {
  if (!rows.length) return "(No current newsletters archived in the last 2 days.)";
  return rows
    .map((row, i) => {
      const subject = row.subject ? ` - ${row.subject}` : "";
      return `--- Newsletter ${i + 1} (${row.sender_email}${subject}; received ${row.received_at}) ---\n${row.body_text.slice(0, 120_000)}`;
    })
    .join("\n\n");
}
