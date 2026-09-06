/**
 * Pure aggregation over app_events rows for the admin beta page. Kept out of
 * the page so the counting can be unit tested.
 */
export interface EventRow {
  user_id: string | null;
  surface: "web" | "mobile";
  name: string;
  path: string | null;
  props: Record<string, unknown> | null;
  created_at: string;
}

export function summariseBeta(events: EventRow[], holders: { user_id: string; source: string | null }[], now: Date = new Date()) {
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const byName = new Map<string, EventRow[]>();
  for (const e of events) {
    const list = byName.get(e.name) ?? [];
    list.push(e);
    byName.set(e.name, list);
  }
  const count = (name: string) => byName.get(name)?.length ?? 0;
  const propCount = (name: string, key: string): string => {
    const tally = new Map<string, number>();
    for (const e of byName.get(name) ?? []) {
      const v = String(e.props?.[key] ?? "unknown");
      tally.set(v, (tally.get(v) ?? 0) + 1);
    }
    return [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ");
  };
  const propValue = (name: string, key: string, value: unknown): number =>
    (byName.get(name) ?? []).filter((e) => e.props?.[key] === value).length;

  const views = byName.get("page_view") ?? [];
  const routeTally = new Map<string, number>();
  for (const v of views) {
    const r = String(v.props?.route ?? v.path ?? "?");
    routeTally.set(r, (routeTally.get(r) ?? 0) + 1);
  }
  const topRoutes = [...routeTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const routeViews = (route: string) => routeTally.get(route) ?? 0;

  const bySurface = { web: 0, mobile: 0 };
  for (const e of events) bySurface[e.surface] = (bySurface[e.surface] ?? 0) + 1;

  const weeklyActive = new Set(events.filter((e) => e.user_id && e.created_at >= weekAgo).map((e) => e.user_id)).size;

  const usersWithHoldings = new Set(holders.map((h) => h.user_id)).size;
  const holdingsBySource = { manual: 0, transactions: 0, import: 0 };
  for (const h of holders) {
    const s = h.source ?? "";
    if (s === "manual") holdingsBySource.manual++;
    else if (s === "transactions") holdingsBySource.transactions++;
    else holdingsBySource.import++;
  }

  return { count, propCount, propValue, topRoutes, routeViews, bySurface, weeklyActive, usersWithHoldings, holdingsBySource };
}
