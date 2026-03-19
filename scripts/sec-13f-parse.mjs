/**
 * Parse SEC Form 13F quarterly ZIP: extract holdings (filer, CUSIP, issuer, value, shares).
 * ZIP contains TSV files: COVERPAGE (filer name by accession), INFOTABLE (holdings).
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

/**
 * Build map ACCESSION_NUMBER -> PERIODOFREPORT (YYYY-MM-DD) from SUBMISSION.tsv.
 * Ensures each holding is attributed to the correct quarter.
 */
function parseSubmission(zip) {
  const entry = zip.getEntry("SUBMISSION.tsv");
  if (!entry) return new Map();
  const raw = entry.getData().toString("utf8");
  const lines = raw.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return new Map();
  const header = parseTsvLine(lines[0]);
  const accIdx = header.indexOf("ACCESSION_NUMBER");
  const periodIdx = header.indexOf("PERIODOFREPORT");
  if (accIdx < 0 || periodIdx < 0) return new Map();
  const map = new Map();
  for (let i = 1; i < lines.length; i++) {
    const row = parseTsvLine(lines[i]);
    const acc = row[accIdx]?.trim();
    const period = row[periodIdx]?.trim();
    if (acc) {
      const reportDate = periodToReportDate(period);
      map.set(acc, reportDate || undefined);
    }
  }
  return map;
}

/**
 * Build map ACCESSION_NUMBER -> FILINGMANAGER_NAME from COVERPAGE.tsv.
 */
function parseCoverpage(zip) {
  const entry = zip.getEntry("COVERPAGE.tsv");
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
  const entry = zip.getEntry("INFOTABLE.tsv");
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
    const filerName = (accession && filerNameByAccession.get(accession)) || "";
    const reportDate = (accession && accessionToReportDate.get(accession)) || defaultReportDate;
    if (!reportDate) continue;
    yield {
      accessionNumber: accession || "",
      filerName,
      cusip,
      issuerName,
      value: value != null && !isNaN(value) ? value : null,
      shares: shares != null && !isNaN(shares) ? shares : null,
      reportDate,
    };
  }
}

/**
 * Parse one quarter ZIP and yield all holdings.
 * Uses SUBMISSION.tsv PERIODOFREPORT per accession when available; otherwise falls back to reportDate.
 * @param {Buffer|string} zipPathOrBuffer - Path to .zip or buffer
 * @param {string} reportDate - YYYY-MM-DD fallback when PERIODOFREPORT is missing
 * @returns {Generator<{accessionNumber, filerName, cusip, issuerName, value, shares, reportDate}>}
 */
export function* parseQuarter13F(zipPathOrBuffer, reportDate) {
  const zip = Buffer.isBuffer(zipPathOrBuffer)
    ? new AdmZip(zipPathOrBuffer)
    : new AdmZip(zipPathOrBuffer);
  const accessionToReportDate = parseSubmission(zip);
  const filerNameByAccession = parseCoverpage(zip);
  yield* parseInfotable(zip, reportDate, filerNameByAccession, accessionToReportDate);
}
