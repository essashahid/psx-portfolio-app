# `samples/`

Small, **sanitised** statement fixtures used to exercise the import engine. The
tickers are real PSX symbols but the quantities, costs, and dates are made up.
Nothing here belongs to a real account.

| File | Exercises |
|---|---|
| `sample-holdings-akd.csv` | Holdings snapshot, including the title line real AKD exports carry |
| `sample-trades-akd.csv` | Buys plus one sell, so weighted-average cost and realised P/L both run |
| `sample-dividends-cdc.csv` | Dividends, a fee, and a deposit |
| `sample-prices.csv` | The bulk price-upload format (`ticker,price[,date]`) |

Run them through the parsers with:

```bash
npx tsx scripts/verification/verify-import-parsers.ts
```

Real account statements do **not** belong here. They live in `data/private/`,
which is documented in `data/README.md`.
