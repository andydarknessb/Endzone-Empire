# FFC ADP snapshot for #1442

Raw responses from `https://fantasyfootballcalculator.com/api/v1/adp/<format>?teams=12&year=<year>`, fetched 2026-10-03, unedited. FFC's draft window rolls, so a later fetch returns different data; #1442's fixture script builds its `server/data/adp-<year>-<format>.json` files from these instead of refetching (#1442 body, ruled choices 1 and 3).

| File | FFC window | Drafts | Players |
|---|---|---|---|
| adp-2025-standard.json | 2025-08-25 to 2025-09-01 | 2017 | 221 |
| adp-2025-half-ppr.json | 2025-08-31 to 2025-09-01 | 718 | 156 |
| adp-2025-ppr.json | 2025-08-25 to 2025-09-01 | 8470 | 249 |
| adp-2026-standard.json | 2026-09-08 to 2026-09-15 | 156 | 118 |
| adp-2026-half-ppr.json | 2026-09-09 to 2026-09-14 | 116 | 54 |
| adp-2026-ppr.json | 2026-09-18 to 2026-09-25 | 109 | 29 |

The 2026 prior serves a week only when the window ends before that week's first kickoff: week 2 on for standard and half-PPR, week 4 on for PPR.
