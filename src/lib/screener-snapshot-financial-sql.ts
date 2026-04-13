/**
 * Heavy correlated subselects appended to {@link getScreenerSnapshot} when
 * `includeFinancialExtras` is true. Kept in a separate module to keep
 * screener-db-native readable.
 */
export const SCREENER_SNAPSHOT_FINANCIAL_SQL = `
      , (
        SELECT fq.period_end
        FROM financials fq
        WHERE fq.symbol = c.symbol
          AND fq.period_type = 'quarterly'
          AND fq.period_end IS NOT NULL
        ORDER BY fq.period_end DESC
        LIMIT 1
      ) AS earnings_last_reported,
      (
        SELECT fq.period_end
        FROM financials fq
        WHERE fq.symbol = c.symbol
          AND fq.period_type = 'quarterly'
          AND fq.period_end IS NOT NULL
        ORDER BY fq.period_end DESC
        LIMIT 1
      ) AS sales_last_reported,
      (
        SELECT fq.eps
        FROM financials fq
        WHERE fq.symbol = c.symbol
          AND fq.period_type = 'quarterly'
          AND fq.eps IS NOT NULL
        ORDER BY fq.period_end DESC
        LIMIT 1
      ) AS eps_recent_q,
      (
        SELECT AVG(x.eps)
        FROM (
          SELECT fq.eps
          FROM financials fq
          WHERE fq.symbol = c.symbol
            AND fq.period_type = 'quarterly'
            AND fq.eps IS NOT NULL
          ORDER BY fq.period_end DESC
          LIMIT 2
        ) x
      ) AS avg_eps_2q,
      (
        SELECT fq.eps_growth_yoy
        FROM financials fq
        WHERE fq.symbol = c.symbol
          AND fq.period_type = 'quarterly'
          AND fq.eps_growth_yoy IS NOT NULL
        ORDER BY fq.period_end DESC
        LIMIT 1
      ) AS eps_growth_recent_q,
      (
        SELECT AVG(x.eps_growth_yoy)
        FROM (
          SELECT fq.eps_growth_yoy
          FROM financials fq
          WHERE fq.symbol = c.symbol
            AND fq.period_type = 'quarterly'
            AND fq.eps_growth_yoy IS NOT NULL
          ORDER BY fq.period_end DESC
          LIMIT 2
        ) x
      ) AS avg_eps_growth_2q,
      (
        SELECT AVG(x.eps_growth_yoy)
        FROM (
          SELECT fq.eps_growth_yoy
          FROM financials fq
          WHERE fq.symbol = c.symbol
            AND fq.period_type = 'quarterly'
            AND fq.eps_growth_yoy IS NOT NULL
          ORDER BY fq.period_end DESC
          LIMIT 3
        ) x
      ) AS avg_eps_growth_3q,
      (
        SELECT AVG(x.eps_growth_yoy)
        FROM (
          SELECT fq.eps_growth_yoy
          FROM financials fq
          WHERE fq.symbol = c.symbol
            AND fq.period_type = 'quarterly'
            AND fq.eps_growth_yoy IS NOT NULL
          ORDER BY fq.period_end DESC
          LIMIT 4
        ) x
      ) AS avg_eps_growth_4q,
      (
        SELECT SUM(x.eps)
        FROM (
          SELECT fq.eps
          FROM financials fq
          WHERE fq.symbol = c.symbol
            AND fq.period_type = 'quarterly'
            AND fq.eps IS NOT NULL
          ORDER BY fq.period_end DESC
          LIMIT 4
        ) x
      ) AS eps_ttm,
      (
        SELECT AVG(x.eps)
        FROM (
          SELECT fa.eps
          FROM financials fa
          WHERE fa.symbol = c.symbol
            AND fa.period_type = 'annual'
            AND fa.eps IS NOT NULL
          ORDER BY fa.period_end DESC
          LIMIT 2
        ) x
      ) AS avg_eps_2y,
      (
        SELECT fa.eps_growth_yoy
        FROM financials fa
        WHERE fa.symbol = c.symbol
          AND fa.period_type = 'annual'
          AND fa.eps_growth_yoy IS NOT NULL
        ORDER BY fa.period_end DESC
        LIMIT 1
      ) AS eps_growth_1y,
      (
        SELECT fa.eps_growth_yoy
        FROM financials fa
        WHERE fa.symbol = c.symbol
          AND fa.period_type = 'annual'
          AND fa.eps_growth_yoy IS NOT NULL
        ORDER BY fa.period_end DESC
        LIMIT 1 OFFSET 1
      ) AS eps_growth_2y_ago,
      (
        SELECT AVG(x.eps_growth_yoy)
        FROM (
          SELECT fa.eps_growth_yoy
          FROM financials fa
          WHERE fa.symbol = c.symbol
            AND fa.period_type = 'annual'
            AND fa.eps_growth_yoy IS NOT NULL
          ORDER BY fa.period_end DESC
          LIMIT 2
        ) x
      ) AS avg_eps_growth_2y,
      (
        SELECT AVG(x.eps_growth_yoy)
        FROM (
          SELECT fa.eps_growth_yoy
          FROM financials fa
          WHERE fa.symbol = c.symbol
            AND fa.period_type = 'annual'
            AND fa.eps_growth_yoy IS NOT NULL
          ORDER BY fa.period_end DESC
          LIMIT 3
        ) x
      ) AS avg_eps_growth_3y,
      (
        SELECT fq.sales
        FROM financials fq
        WHERE fq.symbol = c.symbol
          AND fq.period_type = 'quarterly'
          AND fq.sales IS NOT NULL
        ORDER BY fq.period_end DESC
        LIMIT 1
      ) AS sales_recent_q,
      (
        SELECT AVG(x.sales)
        FROM (
          SELECT fq.sales
          FROM financials fq
          WHERE fq.symbol = c.symbol
            AND fq.period_type = 'quarterly'
            AND fq.sales IS NOT NULL
          ORDER BY fq.period_end DESC
          LIMIT 2
        ) x
      ) AS avg_sales_2q,
      (
        SELECT fq.sales_growth_yoy
        FROM financials fq
        WHERE fq.symbol = c.symbol
          AND fq.period_type = 'quarterly'
          AND fq.sales_growth_yoy IS NOT NULL
        ORDER BY fq.period_end DESC
        LIMIT 1
      ) AS sales_growth_recent_q,
      (
        SELECT AVG(x.sales_growth_yoy)
        FROM (
          SELECT fq.sales_growth_yoy
          FROM financials fq
          WHERE fq.symbol = c.symbol
            AND fq.period_type = 'quarterly'
            AND fq.sales_growth_yoy IS NOT NULL
          ORDER BY fq.period_end DESC
          LIMIT 2
        ) x
      ) AS avg_sales_growth_2q,
      (
        SELECT AVG(x.sales_growth_yoy)
        FROM (
          SELECT fq.sales_growth_yoy
          FROM financials fq
          WHERE fq.symbol = c.symbol
            AND fq.period_type = 'quarterly'
            AND fq.sales_growth_yoy IS NOT NULL
          ORDER BY fq.period_end DESC
          LIMIT 3
        ) x
      ) AS avg_sales_growth_3q,
      (
        SELECT AVG(x.sales_growth_yoy)
        FROM (
          SELECT fq.sales_growth_yoy
          FROM financials fq
          WHERE fq.symbol = c.symbol
            AND fq.period_type = 'quarterly'
            AND fq.sales_growth_yoy IS NOT NULL
          ORDER BY fq.period_end DESC
          LIMIT 4
        ) x
      ) AS avg_sales_growth_4q,
      (
        SELECT SUM(x.sales)
        FROM (
          SELECT fq.sales
          FROM financials fq
          WHERE fq.symbol = c.symbol
            AND fq.period_type = 'quarterly'
            AND fq.sales IS NOT NULL
          ORDER BY fq.period_end DESC
          LIMIT 4
        ) x
      ) AS sales_ttm,
      (
        SELECT AVG(x.sales)
        FROM (
          SELECT fa.sales
          FROM financials fa
          WHERE fa.symbol = c.symbol
            AND fa.period_type = 'annual'
            AND fa.sales IS NOT NULL
          ORDER BY fa.period_end DESC
          LIMIT 2
        ) x
      ) AS avg_sales_2y,
      (
        SELECT fa.sales_growth_yoy
        FROM financials fa
        WHERE fa.symbol = c.symbol
          AND fa.period_type = 'annual'
          AND fa.sales_growth_yoy IS NOT NULL
        ORDER BY fa.period_end DESC
        LIMIT 1
      ) AS sales_growth_1y,
      (
        SELECT fa.sales_growth_yoy
        FROM financials fa
        WHERE fa.symbol = c.symbol
          AND fa.period_type = 'annual'
          AND fa.sales_growth_yoy IS NOT NULL
        ORDER BY fa.period_end DESC
        LIMIT 1 OFFSET 1
      ) AS sales_growth_2y_ago,
      (
        SELECT AVG(x.sales_growth_yoy)
        FROM (
          SELECT fa.sales_growth_yoy
          FROM financials fa
          WHERE fa.symbol = c.symbol
            AND fa.period_type = 'annual'
            AND fa.sales_growth_yoy IS NOT NULL
          ORDER BY fa.period_end DESC
          LIMIT 2
        ) x
      ) AS avg_sales_growth_2y,
      (
        SELECT AVG(x.sales_growth_yoy)
        FROM (
          SELECT fa.sales_growth_yoy
          FROM financials fa
          WHERE fa.symbol = c.symbol
            AND fa.period_type = 'annual'
            AND fa.sales_growth_yoy IS NOT NULL
          ORDER BY fa.period_end DESC
          LIMIT 3
        ) x
      ) AS avg_sales_growth_3y`;
