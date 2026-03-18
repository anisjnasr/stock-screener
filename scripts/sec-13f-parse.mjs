/**
 * Parse SEC Form 13F quarterly ZIP: extract holdings (filer, CUSIP, issuer, value, shares).
 * ZIP contains TSV files: SUBMISSION (filing metadata), COVERPAGE (filer name by accession),
 * and INFOTABLE (holdings).
 */

import AdmZip from "adm-zip";

const INFOTABLE_COLS = [
  "ACCESSION_NUMBER",
  "INFOTABLE_SK",
  "NAMEOFISSUER",
  "TITLEOFCLASS",
  "CUSIP",
  "FIGI",
  "VALUE",
  "SSHPRNAMT",
  "SSHPRNAMTTYPE",
  "PUTCALL",
  "INVESTMENTDISCRETION",
  "OTHERMANAGER",
  "VOTING_AUTH_SOLE",
  "VOTING_AUTH_SHARED",
  "VOTING_AUTH_NONE",
];

function getEntryByBasename(zip, baseName) {
  const direct = zip.getEntry(baseName);
  if (direct) return direct;
  const suffix = `/${baseName}`;
  return zip.getEntries().find((e) => e.entryName.endsWith(suffix)) || null;
}

function parseTsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && (c === "\t" || c === "\r")) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur.trim());
  return out;
}

/** Convert SEC date (DD-MMM-YYYY e.g. 31-MAR-2023) to YYYY-MM-DD. */
function periodToReportDate(periodStr) {
  if (!periodStr || typeof periodStr !== "string") return null;
  const m = periodStr.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const months = "JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split(" ");
  const mi = months.indexOf(m[2].toUpperCase());
  if (mi < 0) return null;
  const day = m[1].padStart(2, "0");
  const month = String(mi + 1).padStart(2, "0");
  return `${m[3]}-${month}-${day}`;
}

function normalizeDate(raw) {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const fromPeriod = periodToReportDate(s);
  if (fromPeriod) return fromPeriod;
  return null;
}

function getColumnIndex(header, names) {
  for (const name of names) {
    const idx = header.indexOf(name);
    if (idx >= 0) return idx;
  }
  return -1;
}

function isTruthyFlag(raw) {
  if (raw == null) return false;
  const v = String(raw).trim().toUpperCase();
  return v === "1" || v === "Y" || v === "YES" || v === "TRUE";
}

function compareSubmissionMeta(a, b) {
  const ad = a?.filedDate ?? "";
  const bd = b?.filedDate ?? "";
  if (ad && bd && ad !== bd) return ad > bd ? 1 : -1;
  if (a?.isAmendment !== b?.isAmendment) {
    return a?.isAmendment ? 1 : -1;
  }
  const aa = String(a?.accessionNumber ?? "");
  const bb = String(b?.accessionNumber ?? "");
  if (aa === bb) return 0;
  return aa > bb ? 1 : -1;
}

/**
 * Collect ACCESSION_NUMBER values that actually appear in INFOTABLE.tsv.
 * Some SUBMISSION entries (e.g. notice-only filings) have no holdings rows.
 */
function collectInfotableAccessions(zip) {
  const entry = getEntryByBasename(zip, "INFOTABLE.tsv");
  if (!entry) return new Set();
  const raw = entry.getData().toString("utf8");
  const lines = raw.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return new Set();
  const header = parseTsvLine(lines[0]);
  const accIdx = getColumnIndex(header, ["ACCESSION_NUMBER"]);
  if (accIdx < 0) return new Set();
  const out = new Set();
  for (let i = 1; i < lines.length; i++) {
    const row = parseTsvLine(lines[i]);
    const acc = row[accIdx]?.trim();
    if (acc) out.add(acc);
  }
  return out;
}

/**
 * Build map ACCESSION_NUMBER -> PERIODOFREPORT (YYYY-MM-DD) from SUBMISSION.tsv.
 * Also captures CIK / filing-date / amendment metadata so callers can select the latest
 * effective filing version for each filer and quarter.
 */
function parseSubmission(zip) {
  const entry = getEntryByBasename(zip, "SUBMISSION.tsv");
  if (!entry) return new Map();
  const raw = entry.getData().toString("utf8");
  const lines = raw.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return new Map();
  const header = parseTsvLine(lines[0]);
  const accIdx = getColumnIndex(header, ["ACCESSION_NUMBER"]);
  const periodIdx = getColumnIndex(header, ["PERIODOFREPORT"]);
  const cikIdx = getColumnIndex(header, ["CIK", "CENTRALINDEXKEY"]);
  const filedIdx = getColumnIndex(header, ["FILING_DATE", "DATEFILED", "FILEDASOFDATE"]);
  const amendTypeIdx = getColumnIndex(header, ["AMENDMENTTYPE", "AMENDMENT_TYPE"]);
  const amendFlagIdx = getColumnIndex(header, ["ISAMENDMENT", "AMENDMENTFLAG"]);
  if (accIdx < 0 || periodIdx < 0) return new Map();
  const map = new Map();
  for (let i = 1; i < lines.length; i++) {
    const row = parseTsvLine(lines[i]);
    const acc = row[accIdx]?.trim();
    const period = row[periodIdx]?.trim() ?? "";
    if (acc) {
      const reportDate = normalizeDate(period);
      const cikRaw = cikIdx >= 0 ? row[cikIdx] : "";
      const cik = cikRaw ? String(cikRaw).trim().replace(/^0+/, "") : "";
      const filedDateRaw = filedIdx >= 0 ? row[filedIdx] : "";
      const filedDate = normalizeDate(filedDateRaw);
      const amendmentType = amendTypeIdx >= 0 ? String(row[amendTypeIdx] ?? "").trim() : "";
      const amendmentFlag = amendFlagIdx >= 0 ? isTruthyFlag(row[amendFlagIdx]) : false;
      const isAmendment =
        amendmentFlag ||
        (amendmentType && amendmentType.toUpperCase() !== "NEW HOLDINGS");
      map.set(acc, {
        accessionNumber: acc,
        reportDate: reportDate || undefined,
        cik: cik || "",
        filedDate: filedDate || undefined,
        amendmentType,
        isAmendment,
      });
    }
  }
  return map;
}

/**
 * Pick the latest filing accession for each (CIK, reportDate), so amended filings
 * supersede earlier versions and we avoid double-counting funds.
 */
function selectLatestAccessionsByFilerQuarter(submissionByAccession, fallbackReportDate, allowedAccessions) {
  const selectedByFilerQuarter = new Map();
  for (const [accession, meta] of submissionByAccession.entries()) {
    if (allowedAccessions && !allowedAccessions.has(accession)) continue;
    const reportDate = meta?.reportDate || fallbackReportDate;
    if (!reportDate) continue;
    const cik = meta?.cik ? String(meta.cik) : accession;
    const key = `${cik}|${reportDate}`;
    const prev = selectedByFilerQuarter.get(key);
    const candidate = {
      accessionNumber: accession,
      reportDate,
      cik,
      filedDate: meta?.filedDate,
      amendmentType: meta?.amendmentType ?? "",
      isAmendment: Boolean(meta?.isAmendment),
    };
    if (!prev || compareSubmissionMeta(candidate, prev) > 0) {
      selectedByFilerQuarter.set(key, candidate);
    }
  }
  return new Set([...selectedByFilerQuarter.values()].map((m) => m.accessionNumber));
}

/**
 * Build map ACCESSION_NUMBER -> FILINGMANAGER_NAME from COVERPAGE.tsv.
 */
function parseCoverpage(zip) {
  const entry = getEntryByBasename(zip, "COVERPAGE.tsv");
  if (!entry) return new Map();
  const raw = entry.getData().toString("utf8");
  const lines = raw.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return new Map();
  const header = parseTsvLine(lines[0]);
  const accIdx = header.indexOf("ACCESSION_NUMBER");
  const nameIdx = header.indexOf("FILINGMANAGER_NAME");
  if (accIdx < 0 || nameIdx < 0) return new Map();
  const map = new Map();
  for (let i = 1; i < lines.length; i++) {
    const row = parseTsvLine(lines[i]);
    if (row[accIdx]) map.set(row[accIdx].trim(), (row[nameIdx] || "").trim());
  }
  return map;
}

/**
 * Parse INFOTABLE.tsv and yield holding rows.
 * Uses PERIODOFREPORT per accession when available so each row has the correct report_date.
 * VALUE in 13F is in thousands of dollars (as filed). We keep it as number (thousands).
 */
function* parseInfotable(zip, defaultReportDate, filerNameByAccession, accessionToReportDate) {
  const entry = getEntryByBasename(zip, "INFOTABLE.tsv");
  if (!entry) return;
  const raw = entry.getData().toString("utf8");
  const lines = raw.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return;
  const header = parseTsvLine(lines[0]);
  const getIdx = (name) => {
    const i = header.indexOf(name);
    return i >= 0 ? i : -1;
  };
  const accIdx = getIdx("ACCESSION_NUMBER");
  const issuerIdx = getIdx("NAMEOFISSUER");
  const cusipIdx = getIdx("CUSIP");
  const valueIdx = getIdx("VALUE");
  const shsIdx = getIdx("SSHPRNAMT");
  if (accIdx < 0 || cusipIdx < 0) return;

  for (let i = 1; i < lines.length; i++) {
    const row = parseTsvLine(lines[i]);
    const accession = row[accIdx]?.trim();
    const cusip = (row[cusipIdx] || "").trim().replace(/\s/g, "");
    if (!cusip || cusip.length !== 9) continue;
    const valueStr = row[valueIdx]?.trim().replace(/,/g, "");
    const value = valueStr ? parseInt(valueStr, 10) : null;
    if (value != null && isNaN(value)) continue;
    const sharesStr = row[shsIdx]?.trim().replace(/,/g, "");
    const shares = sharesStr ? parseInt(sharesStr, 10) : null;
    const issuerName = (row[issuerIdx] || "").trim();
    const subMeta = accession ? accessionToReportDate.get(accession) : null;
    const filerName = (accession && filerNameByAccession.get(accession)) || "";
    const reportDate = subMeta?.reportDate || defaultReportDate;
    if (!reportDate) continue;
    yield {
      accessionNumber: accession || "",
      cik: subMeta?.cik || "",
      filerName,
      cusip,
      issuerName,
      value: value != null && !isNaN(value) ? value : null,
      shares: shares != null && !isNaN(shares) ? shares : null,
      reportDate,
      filedDate: subMeta?.filedDate || null,
      amendmentType: subMeta?.amendmentType || "",
      isAmendment: Boolean(subMeta?.isAmendment),
    };
  }
}

/**
 * Parse one quarter ZIP and yield all holdings.
 * Uses SUBMISSION.tsv PERIODOFREPORT per accession when available; otherwise falls back to reportDate.
 * By default, only rows belonging to the latest filing version per (CIK, reportDate)
 * are emitted (amendments supersede previous versions).
 * @param {Buffer|string} zipPathOrBuffer - Path to .zip or buffer
 * @param {string} reportDate - YYYY-MM-DD fallback when PERIODOFREPORT is missing
 * @param {object} [opts]
 * @param {boolean} [opts.latestByFilerQuarter=true]
 * @returns {Generator<{accessionNumber, cik, filerName, cusip, issuerName, value, shares, reportDate, filedDate, amendmentType, isAmendment}>}
 */
export function* parseQuarter13F(zipPathOrBuffer, reportDate, opts = {}) {
  const { latestByFilerQuarter = true } = opts;
  const zip = Buffer.isBuffer(zipPathOrBuffer)
    ? new AdmZip(zipPathOrBuffer)
    : new AdmZip(zipPathOrBuffer);
  const submissionByAccession = parseSubmission(zip);
  const infotableAccessions = latestByFilerQuarter ? collectInfotableAccessions(zip) : null;
  const selectedAccessions = latestByFilerQuarter
    ? selectLatestAccessionsByFilerQuarter(submissionByAccession, reportDate, infotableAccessions)
    : null;
  const filerNameByAccession = parseCoverpage(zip);
  for (const row of parseInfotable(zip, reportDate, filerNameByAccession, submissionByAccession)) {
    if (selectedAccessions && !selectedAccessions.has(row.accessionNumber)) continue;
    yield row;
  }
}
