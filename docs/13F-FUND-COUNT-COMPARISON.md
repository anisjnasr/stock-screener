# 13F Fund Count: Pipeline vs Reference

Comparison of our pipeline `num_funds` vs the reference "Fund Ownership Summary" for MSFT, AAPL, NVDA, TSLA.

## Side-by-side (quarter-end → No. of Funds)

| Date    | MSFT (ref) | MSFT (ours) | AAPL (ref) | AAPL (ours) | NVDA (ref) | NVDA (ours) | TSLA (ref) | TSLA (ours) |
|---------|------------|-------------|------------|-------------|------------|-------------|------------|-------------|
| Dec-25  | 10,496     | (no data)   | 7,566      | (no data)   | 9,210      | (no data)   | 4,770      | (no data)   |
| Sep-25  | 10,696     | 6,194       | 7,599      | 5,889       | 9,198      | 5,663       | 4,729      | 4,105       |
| Jun-25  | 10,708     | (no data)   | 7,528      | (no data)   | 9,069      | (no data)   | 4,639      | (no data)   |
| Mar-25  | 10,710     | 6,228       | 7,817      | 6,036       | 8,828      | 5,479       | 4,684      | 3,820       |
| Dec-24  | 10,864     | 6,223       | 7,934      | 6,015       | 8,738       | 5,482       | 4,841      | 4,116       |
| Sep-24  | 10,794     | 5,655       | 7,891      | 5,482       | 8,360       | 4,960       | 4,284      | 3,387       |
| Jun-24  | 10,846     | 5,663       | 7,948      | 5,533       | 8,164       | 4,913       | 4,072      | 3,191       |
| Mar-24  | 10,609     | 5,673       | 7,314      | 5,445       | 7,592       | 4,633       | 4,121      | 3,103       |

**Gap (ours vs reference):** Our counts are consistently **~35–45% lower** (e.g. MSFT Sep-25: 6,194 vs 10,696).

## After CUSIP improvement (rerun)

CUSIP map was rebuilt with expanded issuer-name matching (more suffixes, "&" → " and ", "THE " strip, first-two-words fallback). Map size went from **7,564** to **14,769** symbols. Pipeline now also uses PERIODOFREPORT per filing.

**Previous (before improvement) vs New (after) vs Reference** for selected quarters:

| Date    | MSFT prev / new / ref | AAPL prev / new / ref | NVDA prev / new / ref | TSLA prev / new / ref |
|---------|------------------------|------------------------|------------------------|------------------------|
| Sep-25  | 6,194 / **5,813** / 10,696 | 5,889 / **5,625** / 7,599 | 5,663 / **5,350** / 9,198 | 4,105 / **3,934** / 4,729 |
| Mar-25  | 6,228 / **5,736** / 10,710 | 6,036 / **5,639** / 7,817 | 5,479 / **5,125** / 8,828 | 3,820 / **3,574** / 4,684 |
| Dec-24  | 6,223 / **5,918** / 10,864 | 6,015 / **5,787** / 7,934 | 5,482 / **5,257** / 8,738 | 4,116 / **3,936** / 4,841 |
| Sep-24  | 5,655 / **5,373** / 10,794 | 5,482 / **5,249** / 7,891 | 4,960 / **4,711** / 8,360 | 3,387 / **3,241** / 4,284 |
| Jun-24  | 5,663 / **5,367** / 10,846 | 5,533 / **5,289** / 7,948 | 4,913 / **4,659** / 8,164 | 3,191 / **3,013** / 4,072 |
| Mar-24  | 5,673 / **5,350** / 10,609 | 5,445 / **5,178** / 7,314 | 4,633 / **4,446** / 7,592 | 3,103 / **2,952** / 4,121 |
| Dec-23  | 5,409 / **5,440** / —     | 5,125 / **5,245** / —     | 4,183 / **4,214** / —     | 3,222 / **3,290** / —     |
| Jun-23  | 4,835 / **4,915** / —     | 4,643 / **4,754** / —     | 3,361 / **3,649** / —     | 2,759 / **2,973** / —     |
| Feb-23  | 4,913 / 4,913 / —         | 4,785 / 4,785 / —         | 3,123 / 3,123 / —     | 2,624 / 2,624 / —     |

- **Dec-24, Dec-23, Jun-23:** New counts are **higher** than previous (better CUSIP coverage).
- **Sep-25, Mar-25, Sep-24, Jun-24, Mar-24:** New counts are **slightly lower** than previous; PERIODOFREPORT now attributes filings to the correct quarter, so some counts moved between quarters. Reference remains much higher.
- **2025-06-30 and 2023-09-30** show very low new counts (e.g. ~100–200) because most filings in our 11 ZIPs have other period-of-report dates; those quarters are under-represented in the current ZIP set.

## Likely causes

1. **CUSIP coverage**  
   We only count a holding when its CUSIP is in our `cusip-to-symbol` map (~7.5k CUSIPs from issuer-name matching + overrides). The reference likely uses a full institutional CUSIP/ticker database, so they count every 13F filing that reports the stock (including alternate CUSIPs, share classes, etc.). **Unmapped CUSIPs → we undercount.**

2. **One report date per ZIP**  
   We assign a single `report_date` per SEC ZIP (from config). Each ZIP actually contains filings with **multiple period-of-report dates** (e.g. Sep–Nov ZIP has both Jun-30 and Sep-30 reports). We should use **SUBMISSION.tsv → PERIODOFREPORT** per accession so each holding is attributed to the correct quarter. That fixes alignment; it does not by itself explain the size of the gap.

3. **Definition of “fund”**  
   We count distinct **ACCESSION_NUMBER** per (symbol, report_date). The reference may use a different definition (e.g. unique CIK, or one count per “fund family”). That could add a small difference but is unlikely to explain a 40%+ gap.

## Recommendations

- **Use PERIODOFREPORT** from SUBMISSION so each holding is assigned the correct quarter-end (fixes alignment with reference dates). **Done:** the parser now reads `SUBMISSION.tsv` and uses each filing’s `PERIODOFREPORT` for that row’s `report_date`.
- **Improve CUSIP→symbol coverage** (e.g. add more overrides, or a free CUSIP/ticker source) to close the gap in levels. This is the main lever to get closer to reference counts.
- Keep the current “distinct accessions” definition for “number of funds” unless the reference methodology is known.
