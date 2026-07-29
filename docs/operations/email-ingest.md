# AKD trade-confirmation email ingest

AKD Securities emails a daily trade confirmation from `confirmation@akdsl.com`
(subject "Trade Confirmation for Account No. COAF... dated DD-MMM-YYYY") with
one PDF attachment listing that day's fills. This pipeline lands those fills in
the transactions ledger automatically, without a Gmail API integration.

## How it works

1. A Google Apps Script in the account owner's own Google account
   ([scripts/apps-script/akd-gmail-ingest.gs](../../scripts/apps-script/akd-gmail-ingest.gs))
   runs on a time trigger, finds unprocessed emails from `confirmation@akdsl.com`,
   and POSTs each PDF (base64) to `POST /api/ingest/email` with a shared secret.
   Processed threads get the Gmail label `akd-ingested`.
2. The endpoint ([app/api/ingest/email/route.ts](../../app/api/ingest/email/route.ts))
   verifies the secret and the sender, stores the PDF in the `statements`
   bucket, records it in `uploaded_statements`, parses the confirmation table
   ([lib/import/akd-confirmation.ts](../../lib/import/akd-confirmation.ts)), and
   inserts each fill into `transactions` with `source = "email_confirmation"`,
   then recomputes holdings.

Failure handling: a PDF whose table cannot be parsed is still stored, with
`uploaded_statements.status = 'email_review'`, so nothing is lost; the Apps
Script leaves the thread unlabelled on non-2xx responses and retries on the
next run. Everything is idempotent (file hash + per-fill row hash), so retries
and re-forwards never double-count.

Email-ingested statements use statuses `email_committed` / `email_review`
(not `committed`) deliberately: `/api/import/sync-cash` scans the five newest
`committed` PDFs for the full Statement Of Account, and daily confirmation
PDFs must not crowd those out.

## Server setup (Vercel env vars)

- `EMAIL_INGEST_SECRET`: long random value, `openssl rand -hex 32`.
- `EMAIL_INGEST_USER_ID`: the `auth.users` uuid that owns the trades.

## Gmail setup

Follow the numbered steps in the header comment of
[akd-gmail-ingest.gs](../../scripts/apps-script/akd-gmail-ingest.gs): paste the
script at script.google.com, set `INGEST_URL` and `INGEST_SECRET` script
properties, run once to grant permissions, then add a time-driven trigger
(every 15 to 60 minutes).

## Verifying the parser on a real PDF

The parser was written defensively against the known AKD layout but must be
checked against a real confirmation before the pipeline is trusted:

```bash
npx tsx scripts/verification/verify-akd-confirmation.ts ~/Downloads/COAF5632.pdf
```

This prints the raw extracted text plus every parsed fill (side, ticker,
quantity, rate, gross, charges) and the rows it refused to reconcile. A fill's
`gross` must reconcile with `quantity * rate` within 1% for the row to be
accepted; unreconciled rows are reported as warnings, never guessed at.

## Interaction with statement imports

The confirmations become the day-to-day trade feed. The full Statement Of
Account import remains the source for deposits, fees and CGT (via sync-cash)
and for backfills. Trades imported from a statement use a different row-hash
scheme than email confirmations, so importing a statement that covers a period
already ingested by email will stage those trades as new rows in the wizard
preview: exclude them there, or import statements only for cash rows.
