/**
 * SEC Form 13F data set configuration.
 * Data sets: https://www.sec.gov/about/dera_form-13f
 * The SEC requires a User-Agent in the form "AppName contact@yourdomain.com".
 * Set the SEC_USER_AGENT environment variable (GitHub secret recommended) to
 * provide a real contact email, e.g. "stock-scanner you@yourdomain.com".
 */

export const SEC_USER_AGENT =
  process.env.SEC_USER_AGENT?.trim() || "stock-scanner contact@example.com";
export const SEC_13F_DATASET_INDEX_URL = "https://www.sec.gov/about/dera_form-13f";
export const SEC_13F_DATASET_BASE_URL = "https://www.sec.gov/files/structureddata/data/form-13f-data-sets/";
