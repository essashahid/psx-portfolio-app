-- latest_prices() — one round-trip for the latest price of many tickers
-- ---------------------------------------------------------------------------
-- getPortfolio() previously fired one query per held ticker to read the most
-- recent price row (prices is append-only history: unique per user/ticker/day).
-- For a 20-stock portfolio that was 20 round-trips on the hottest code path.
-- This SECURITY INVOKER function collapses it into a single DISTINCT ON scan,
-- so RLS still applies to the caller exactly as the per-ticker queries did
-- (owner sees own rows; an impersonating admin sees the override-policy rows).
-- The explicit p_user_id filter mirrors the old .eq("user_id", userId) and the
-- prices_user_ticker_idx (user_id, ticker, price_date desc) index serves it.

create or replace function public.latest_prices(p_user_id uuid, p_tickers text[])
returns table (ticker text, price numeric, price_date date, source text)
language sql
stable
set search_path = public
as $$
  select distinct on (p.ticker) p.ticker, p.price, p.price_date, p.source
  from public.prices p
  where p.user_id = p_user_id
    and p.ticker = any (p_tickers)
  order by p.ticker, p.price_date desc, p.created_at desc
$$;

grant execute on function public.latest_prices(uuid, text[]) to authenticated;
