# Launch-disabled features

This file documents the statement-import and fallback-heavy surfaces hidden for launch so they can be restored intentionally later.

## Default account surface

New accounts now default to these app tabs only:

- `/dashboard` - Dashboard
- `/holdings` - Holdings
- `/dividends` - Dividends
- `/stocks` - Stock Research, including `/stocks/[ticker]`
- `/market` - Market Pulse
- `/chat` - Research Copilot

The default is stored in `profiles.enabled_features`. Migration `0024_launch_feature_flags.sql` backfills the same launch view for existing accounts except `eessashahid@gmail.com`, which is left with all feature flags enabled for comparison and internal work.

`/dashboard` is always required so an account cannot be configured into a redirect loop.

## Hidden until admin enables them

These tabs are no longer in the default account feature list:

- `/import` - Import Center and statement parser flow
- `/settings` - Settings, demo data, reset, saved mappings, uploaded statements
- `/performance` - ledger/performance analytics with AKD/database fallback paths
- `/research` - saved generated reports
- `/news` - News Center
- `/goals` - goals and target allocations
- `/journal` - decision journal
- `/alerts` - alerts
- `/allocation` - capital allocation forecaster, still admin-only
- `/bulls-bears` - weekly transcript cockpit, still admin-only
- `/coverage` - provider/data engine health, still admin-only

Admin can enable or disable account features from `app/admin/users/[id]/user-detail-client.tsx`. The presets are:

- `Launch default` - restores the six-tab launch view.
- `Enable everything` - checks every feature flag. Admin-only pages still require `profiles.is_admin`.

Route access is enforced in `proxy.ts` using `lib/features.ts`, so hidden tabs are not only removed from nav.

## AI company details and reports disabled

Two non-route capability flags are stored in `profiles.enabled_features` and default off:

- `company_enrichment` - holdings/company metadata enrichment and stock profile generation.
- `company_reports` - company report generation and stock-detail AI analysis.

Admin can enable either capability per account. `Enable everything` turns both back on.

While disabled, these UI entry points are hidden:

- Holdings page `Update company details` action.
- Holdings data-quality `Review issues` enrichment action.
- Holdings row `Generate company report` action.
- Stock search `Report` action.
- Stock detail header report action.
- Stock detail `AI Analysis` tab.
- Stock overview `Generate company profile` and description refresh action.
- Dashboard print/generate report button.

These server routes are also guarded so direct calls cannot spend AI credits:

- `app/api/holdings/enrich/route.ts`
- `app/api/stocks/[ticker]/refresh/route.ts` when `section` is `description`
- `app/api/ai/company/route.ts`
- `app/api/reports/company/route.ts` for new reports
- `app/api/reports/company/preview/route.ts`
- `app/api/reports/company/[id]/refresh/route.ts`
- `app/api/reports/company/[id]/sections/[section]/route.ts`

Transaction recompute and statement commit now skip metadata enrichment unless `company_enrichment` is enabled.

To restore later, enable the capability from Admin and revisit the affected UI entry points above. The components remain in place; they are only gated.

## Holdings launch simplification

The Holdings table now exposes only these tabs:

- Performance
- Income
- Allocation

The old Planning tab was removed from the visible table. The extra `More filters` menu was also removed; search, sector, and performance filters remain. To bring Planning back, restore the `planning` tab/columns/mobile card branch in `components/holdings-table.tsx`.

The Holdings `Refresh prices` action remains enabled and calls `/api/prices` only. It does not call metadata enrichment and does not update sector/category data.

## Statement import disabled

The onboarding wizard no longer asks users to upload a statement or routes them to `/import`.

The following server routes now check whether `/import` is enabled for the account and return `403` when it is disabled:

- `app/api/import/upload/route.ts`
- `app/api/import/remap/route.ts`
- `app/api/import/commit/route.ts`
- `app/api/import/sync-cash/route.ts`
- `app/api/statements/[id]/route.ts`

Default Dashboard and Holdings empty states now start from manual transaction entry instead of Import Center.

To restore statement imports later:

1. Enable `/import` for the target account in Admin.
2. Re-add an onboarding setup step only after parser reliability is acceptable.
3. Revisit `components/import-wizard.tsx`, `lib/import/*`, and the guarded API routes above.
4. Re-enable statement management in Settings by enabling both `/settings` and `/import`.

## Closed signup, waitlist, and demo mode

Public signup is removed from `app/login/page.tsx`. The login page now has:

- Approved-account sign in.
- Read-only demo entry via `app/api/demo/session/route.ts`.
- Waitlist capture via `app/api/waitlist/route.ts`.

Waitlist entries are stored in `public.waitlist_entries` and managed from the admin panel through `app/admin/admin-waitlist-client.tsx` and `app/api/admin/waitlist/route.ts`.

The shared demo account is controlled by:

- `DEMO_ACCOUNT_EMAIL`
- `DEMO_ACCOUNT_PASSWORD`

The demo session route creates/seeds that account if needed, marks `profiles.demo_mode = true`, applies the six launch tabs, and disables LLM providers for the demo account.

`lib/demo.ts` now seeds curated read-only Research Copilot threads under the `Demo library:` summary prefix. Those chats are intentionally prewritten with labelled research answers and artifact cards; demo users can browse them but cannot send follow-ups, rename, delete, or create threads.

Demo write protection is enforced in two places:

- Database RLS via `public.is_demo_account()` in `0025_waitlist_readonly_demo.sql`.
- Server route guards via `lib/demo-mode.ts` on mutating user endpoints, refresh endpoints, AI endpoints, report endpoints, import endpoints, and provider-work endpoints.

## LLM model access

`profiles.allowed_llm_providers` controls Research Copilot provider access at account level.

Allowed values:

- `claude`
- `deepseek`

Admin can allow Claude, DeepSeek, both, or neither. The client filters model availability and `app/api/chat/route.ts` will not call a disabled provider. If no provider is allowed or configured, Copilot returns live data cards/raw summaries without LLM narration.

## Fallback/template-heavy areas hidden by default

The launch feature set hides pages that rely heavily on templates, fallback chains, or incomplete imported-ledger assumptions:

- Performance analytics and AKD/database fallback ledger paths
- Allocation narrative/template fallback
- Coverage/data provider fallback chain
- Demo data access in Settings
- Saved/import mappings and uploaded statement file management

These paths are not deleted. They are behind `profiles.enabled_features` so they can be enabled account-by-account when ready.

## Portfolio price query change

`lib/portfolio.ts` no longer uses `.limit(500)` on the full `prices` history table. It now fetches the latest price per held ticker, ordered by `price_date` and `created_at`, so a large historical price table cannot silently leave later holdings valued at cost.

## Cash balance launch note

Cash balance still sums:

- `cash_movements`: deposits/dividends add; withdrawals/fees/taxes subtract
- `transactions`: sells add; buys/rights subtract

Categories were checked for no obvious overlap, but before launch the computed cash total should still be reconciled against a real AKD statement closing balance.
