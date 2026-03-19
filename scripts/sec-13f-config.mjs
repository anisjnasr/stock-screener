/**
 * SEC Form 13F data set configuration: quarter list and download URLs.
 * Data sets: https://www.sec.gov/about/dera_form-13f
 * Use a descriptive User-Agent per SEC policy (e.g. "CompanyName AdminContact@example.com").
 */

export const SEC_USER_AGENT = "stock-scanner admin@localhost";

/** Quarter key -> { reportDate (YYYY-MM-DD, quarter-end of holdings), url }. Sep–Nov ZIP contains reports as of 2025-09-30 (Q3). Q4 2025 (Dec 31) posts after Feb 2026. */
export const QUARTERS_12 = [
  { key: "2025q3", reportDate: "2025-09-30", url: "https://www.sec.gov/files/structureddata/data/form-13f-data-sets/01sep2025-30nov2025_form13f.zip" },
  { key: "2025q2", reportDate: "2025-06-30", url: "https://www.sec.gov/files/structureddata/data/form-13f-data-sets/01jun2025-31aug2025_form13f.zip" },
  { key: "2025q1", reportDate: "2025-03-31", url: "https://www.sec.gov/files/structureddata/data/form-13f-data-sets/01mar2025-31may2025_form13f.zip" },
  { key: "2024q4", reportDate: "2024-12-31", url: "https://www.sec.gov/files/structureddata/data/form-13f-data-sets/01dec2024-28feb2025_form13f.zip" },
  { key: "2024q3", reportDate: "2024-09-30", url: "https://www.sec.gov/files/structureddata/data/form-13f-data-sets/01sep2024-30nov2024_form13f.zip" },
  { key: "2024q2", reportDate: "2024-06-30", url: "https://www.sec.gov/files/structureddata/data/form-13f-data-sets/01jun2024-31aug2024_form13f.zip" },
  { key: "2024q1", reportDate: "2024-03-31", url: "https://www.sec.gov/files/structureddata/data/form-13f-data-sets/01mar2024-31may2024_form13f.zip" },
  { key: "2023q4", reportDate: "2023-12-31", url: "https://www.sec.gov/files/structureddata/data/form-13f-data-sets/01jan2024-29feb2024_form13f.zip" },
  { key: "2023q3", reportDate: "2023-09-30", url: "https://www.sec.gov/files/structureddata/data/form-13f-data-sets/2023q3_form13f.zip" },
  { key: "2023q2", reportDate: "2023-06-30", url: "https://www.sec.gov/files/structureddata/data/form-13f-data-sets/2023q2_form13f.zip" },
  { key: "2023q1", reportDate: "2023-02-28", url: "https://www.sec.gov/files/structureddata/data/form-13f-data-sets/2023q1_form13f.zip" },
];
