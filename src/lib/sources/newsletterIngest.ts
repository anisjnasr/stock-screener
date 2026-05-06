import * as cheerio from "cheerio";
import { google, type gmail_v1 } from "googleapis";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadNewsletterAllowlistFromRepo } from "@/lib/premarket/newsletter-allowlist";
import { parseEmailAddressFromFromHeader } from "@/lib/sources/gmailParse";

const BODY_MAX_CHARS = 400_000;
const GMAIL_LIST_MAX_ATTEMPTS = 2;
const GMAIL_GET_MAX_ATTEMPTS = 2;
const RETRY_BASE_DELAY_MS = 800;

function decodeB64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function hasInvalidGrantError(e: unknown): boolean {
  const msg = errMessage(e).toLowerCase();
  return msg.includes("invalid_grant");
}

function isLikelyTransientGmailError(e: unknown): boolean {
  const msg = errMessage(e).toLowerCase();
  if (
    msg.includes("rate limit") ||
    msg.includes("429") ||
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("socket hang up")
  ) {
    return true;
  }
  return msg.includes(" 500") || msg.includes(" 502") || msg.includes(" 503") || msg.includes(" 504");
}

function oauthFixHint(baseMessage: string): string {
  return `${baseMessage}. OAuth refresh token is invalid/revoked. Re-auth Gmail and update GMAIL_REFRESH_TOKEN in the host environment.`;
}

function extractFromPart(part: gmail_v1.Schema$MessagePart): { plain?: string; html?: string } {
  const mime = part.mimeType ?? "";
  const rawB64 = part.body?.data;
  if (!rawB64) return {};
  const raw = decodeB64Url(rawB64);
  if (mime === "text/plain") return { plain: raw };
  if (mime === "text/html") {
    try {
      return { html: cheerio.load(raw).text() };
    } catch {
      return { html: raw };
    }
  }
  return {};
}

function walkParts(part: gmail_v1.Schema$MessagePart | null | undefined): { plain?: string; html?: string } {
  if (!part) return {};
  const direct = extractFromPart(part);
  if (direct.plain) return { plain: direct.plain };
  const acc: { plain?: string; html?: string } = {};
  if (direct.html) acc.html = direct.html;
  const parts = part.parts;
  if (parts?.length) {
    for (const p of parts) {
      const sub = walkParts(p);
      if (sub.plain) return { plain: sub.plain };
      if (sub.html) acc.html = (acc.html ?? "") + sub.html;
    }
  }
  return acc;
}

export function extractEmailBodyText(message: gmail_v1.Schema$Message): string {
  const payload = message.payload;
  if (!payload) return (message.snippet ?? "").trim();
  const hit = walkParts(payload);
  if (hit.plain) return hit.plain.trim().slice(0, BODY_MAX_CHARS);
  if (hit.html) return hit.html.replace(/\s+/g, " ").trim().slice(0, BODY_MAX_CHARS);
  return (message.snippet ?? "").trim().slice(0, BODY_MAX_CHARS);
}

function headerMap(message: gmail_v1.Schema$Message): Record<string, string> {
  const out: Record<string, string> = {};
  const headers = message.payload?.headers;
  if (!headers) return out;
  for (const h of headers) {
    const n = h.name?.toLowerCase();
    const v = h.value?.trim();
    if (n && v) out[n] = v;
  }
  return out;
}

export function isGmailIngestConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CLIENT_SECRET?.trim() &&
      process.env.GMAIL_REFRESH_TOKEN?.trim()
  );
}

function gmailClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN?.trim();
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GMAIL_REFRESH_TOKEN");
  }
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: "v1", auth: oauth2 });
}

export type NewsletterIngestResult =
  | { ok: true; inserted: number; examined: number; allowlisted: number }
  | { ok: false; error: string };

/**
 * Fetch Gmail messages from the last 2 days, keep allowlisted senders, and upsert into
 * `newsletter_archive`. Gmail only returns messages received up to the current refresh.
 */
export async function ingestMorningNewslettersForDate(
  supabase: SupabaseClient,
  _opts: { ymd: string; signal?: AbortSignal }
): Promise<NewsletterIngestResult> {
  void _opts;
  if (!isGmailIngestConfigured()) {
    return { ok: false, error: "Gmail OAuth env not configured (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_REFRESH_TOKEN)" };
  }

  const allow = new Set(loadNewsletterAllowlistFromRepo());
  if (allow.size === 0) {
    return { ok: false, error: "Newsletter allowlist is empty" };
  }

  let gmail;
  try {
    gmail = gmailClient();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Gmail client error" };
  }

  let ids: string[] = [];
  {
    let listErr: unknown = null;
    for (let attempt = 1; attempt <= GMAIL_LIST_MAX_ATTEMPTS; attempt++) {
      try {
        const list = await gmail.users.messages.list({
          userId: "me",
          maxResults: 120,
          q: "newer_than:2d",
        });
        ids = list.data.messages?.map((m) => m.id).filter(Boolean) as string[];
        listErr = null;
        break;
      } catch (e) {
        listErr = e;
        if (hasInvalidGrantError(e)) {
          return { ok: false, error: oauthFixHint("Gmail messages.list failed: invalid_grant") };
        }
        if (attempt < GMAIL_LIST_MAX_ATTEMPTS && isLikelyTransientGmailError(e)) {
          await sleep(RETRY_BASE_DELAY_MS * attempt);
          continue;
        }
        break;
      }
    }
    if (listErr) {
      return { ok: false, error: `Gmail messages.list failed: ${errMessage(listErr)}` };
    }
  }

  if (!ids?.length) {
    return { ok: true, inserted: 0, examined: 0, allowlisted: 0 };
  }

  let inserted = 0;
  let examined = 0;
  let allowlisted = 0;

  let skippedFetchErrors = 0;
  for (const id of ids) {
    let full: gmail_v1.Schema$Message | null = null;
    let fetchErr: unknown = null;
    for (let attempt = 1; attempt <= GMAIL_GET_MAX_ATTEMPTS; attempt++) {
      try {
        const response = await gmail.users.messages.get({
          userId: "me",
          id,
          format: "full",
        });
        full = response.data ?? null;
        fetchErr = null;
        break;
      } catch (e) {
        fetchErr = e;
        if (hasInvalidGrantError(e)) {
          return { ok: false, error: oauthFixHint(`Gmail messages.get(${id}) failed: invalid_grant`) };
        }
        if (attempt < GMAIL_GET_MAX_ATTEMPTS && isLikelyTransientGmailError(e)) {
          await sleep(RETRY_BASE_DELAY_MS * attempt);
          continue;
        }
        break;
      }
    }
    if (fetchErr) {
      skippedFetchErrors += 1;
      console.warn(`[newsletter-ingest] skipped message ${id}: ${errMessage(fetchErr)}`);
      continue;
    }
    if (!full) {
      skippedFetchErrors += 1;
      console.warn(`[newsletter-ingest] skipped message ${id}: Gmail returned empty payload`);
      continue;
    }
    const gmsg = full;
    if (!gmsg.id) continue;
    examined += 1;
    const internal = Number(gmsg.internalDate);
    if (!Number.isFinite(internal)) continue;

    const headers = headerMap(gmsg);
    const from = headers["from"] ?? "";
    const sender = parseEmailAddressFromFromHeader(from);
    if (!sender || !allow.has(sender)) continue;
    allowlisted += 1;

    const subject = headers["subject"] ?? null;
    const body = extractEmailBodyText(gmsg);
    const receivedAt = new Date(internal).toISOString();

    const row = {
      gmail_message_id: gmsg.id,
      received_at: receivedAt,
      sender_email: sender,
      subject,
      body_text: body,
    };

    const { error } = await supabase.from("newsletter_archive").upsert(row, { onConflict: "gmail_message_id" });
    if (error) {
      return { ok: false, error: `[newsletter_archive] ${error.message}` };
    }
    inserted += 1;
  }

  if (skippedFetchErrors > 0) {
    console.warn(`[newsletter-ingest] completed with skipped Gmail message fetch errors: ${skippedFetchErrors}`);
  }
  return { ok: true, inserted, examined, allowlisted };
}
