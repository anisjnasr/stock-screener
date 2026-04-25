import * as cheerio from "cheerio";
import { google, type gmail_v1 } from "googleapis";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadNewsletterAllowlistFromRepo } from "@/lib/premarket/newsletter-allowlist";
import { parseEmailAddressFromFromHeader } from "@/lib/sources/gmailParse";

const BODY_MAX_CHARS = 400_000;

function decodeB64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
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

  let ids: string[];
  try {
    const list = await gmail.users.messages.list({
      userId: "me",
      maxResults: 120,
      q: "newer_than:2d",
    });
    ids = list.data.messages?.map((m) => m.id).filter(Boolean) as string[];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Gmail messages.list failed: ${msg}` };
  }

  if (!ids?.length) {
    return { ok: true, inserted: 0, examined: 0, allowlisted: 0 };
  }

  let inserted = 0;
  let examined = 0;
  let allowlisted = 0;

  for (const id of ids) {
    let full;
    try {
      full = await gmail.users.messages.get({
        userId: "me",
        id,
        format: "full",
      });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `Gmail messages.get(${id}) failed: ${err}` };
    }
    const gmsg = full.data;
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

  return { ok: true, inserted, examined, allowlisted };
}
