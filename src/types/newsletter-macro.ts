/** One row in `newsletter_archive` (Phase 4). */
export type NewsletterArchiveRow = {
  id: string;
  gmail_message_id: string;
  received_at: string;
  sender_email: string;
  subject: string | null;
  body_text: string;
  used_in_writeup_date: string | null;
  created_at: string;
};

/** One row in `daily_macro_writeup` (Phase 4). */
export type DailyMacroWriteupRow = {
  id: string;
  writeup_date: string;
  writeup_text: string;
  source_newsletter_ids: string[] | null;
  model_used: string;
  fallback_used: boolean;
  generated_at: string;
  is_flagged: boolean;
};
