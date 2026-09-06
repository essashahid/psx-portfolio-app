import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, MessageSquare, Pencil, Star } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import type {
  CompanyFiling,
  CompanyNewsItem,
  CompanyPayout,
  CompanyResponse,
  KeyFigure,
  TrendPoint,
} from "@psx/shared/api/stocks";
import type { ChartDataResponse } from "@psx/shared/api/chart";
import type { HoldingRow, HoldingsResponse } from "@psx/shared/api/holdings";
import type { WatchlistWriteRequest } from "@psx/shared/api/watchlist";
import { formatCompact, formatCompactSigned, formatNumber, formatPctSigned } from "@psx/shared/format";
import { sectorColor, shortSector } from "@psx/shared/sector-colors";
import { tone } from "@psx/shared/market/format";
import { useApi } from "@/lib/use-api";
import { apiWrite } from "@/lib/api";
import { track } from "@/lib/track";
import { groupRatiosForReader } from "@/lib/ratios";
import {
  countWord,
  growthReading,
  isGapFigure,
  payoutReading,
  valuationReading,
} from "@/lib/company-readings";
import { Segmented } from "@/components/segmented";
import { Band, Ledger, LedgerRow } from "@/components/ui/layout";
import { Disclosure } from "@/components/ui/disclosure";
import { Caps, Figure, PageTitle } from "@/components/ui/text";
import { ErrorNote } from "@/components/status";
import { PageSkeleton } from "@/components/skeleton";
import { PositionSheet } from "@/components/features/position-sheet";
import { PriceChart, PeriodRail, type ChartPeriod } from "@/components/charts/price-chart";
import { Rise } from "@/components/ui/motion";
import { makeStyles, useColors } from "@/lib/theme-context";
import {
  colors,
  fontFamily,
  fontSize,
  layout,
  letterSpacing,
  space,
  toneColor,
  tracking,
} from "@/lib/theme";

/** The same three tabs as the web company page, in the same order. */
const TABS = ["Overview", "Financials", "Filings"] as const;
type Tab = (typeof TABS)[number];

/** How many filed years the growth bars show. Matches the web strip. */
const TREND_YEARS = 4;

/** Key figures shown on the Overview before "Show all eight". */
const KEY_FIGURES_FOLDED = 4;

const ASK_QUESTION = (ticker: string) =>
  `Explain ${ticker} to me simply: what it does, how it is doing, and whether it pays dividends.`;

function ratioText(value: number | string | null): string {
  if (value === null || value === undefined) return "—";
  return typeof value === "number" ? formatNumber(value, 2) : String(value);
}

function openLink(url: string) {
  void WebBrowser.openBrowserAsync(url, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
  });
}

function payoutText(p: CompanyPayout): string {
  if (p.dps !== null) return `${formatNumber(p.dps, 2)} per share`;
  if (p.percentage !== null) return `${formatNumber(p.percentage, 0)}%`;
  return "—";
}

/**
 * Small bars for the last few filed years. A withheld year draws as an empty
 * dashed slot rather than a gap, so the reader sees it was filed and is under
 * review, not that it was never filed. The reason goes in a footnote.
 */
function TinyBars({
  points,
  withheld,
}: {
  points: TrendPoint[];
  withheld: { year: number; reason: string }[];
}) {
  const styles = useStyles();
  const colors = useColors();
  const years = [...new Set([...points.map((p) => p.year), ...withheld.map((w) => w.year)])]
    .sort((a, b) => a - b)
    .slice(-TREND_YEARS);
  if (years.length === 0) return <Text style={styles.empty}>No filed years on record.</Text>;
  const byYear = new Map(points.map((p) => [p.year, p.value]));
  const values = years.map((y) => byYear.get(y)).filter((v): v is number => typeof v === "number");
  const hi = Math.max(0, ...values);
  const lo = Math.min(0, ...values);
  const span = hi - lo || 1;
  const H = 44;
  const zeroY = (hi / span) * H;

  return (
    <View>
      <View style={[styles.bars, { height: H }]}>
        {years.map((year, i) => {
          const v = byYear.get(year);
          if (typeof v !== "number") {
            return <View key={year} style={[styles.barSlot, styles.barWithheld, { height: H }]} />;
          }
          const top = v >= 0 ? zeroY - (v / span) * H : zeroY;
          const h = Math.max(1.5, (Math.abs(v) / span) * H);
          const last = i === years.length - 1;
          const fill = v < 0 ? colors.chartDown : last ? colors.textStrong : colors.textFaint;
          return (
            <View key={year} style={[styles.barSlot, { height: H }]}>
              <View style={[styles.bar, { top, height: h, backgroundColor: fill }]} />
            </View>
          );
        })}
      </View>
      <View style={styles.bars}>
        {years.map((year) => (
          <Figure key={year} style={styles.barYear}>
            {String(year).slice(2)}
          </Figure>
        ))}
      </View>
    </View>
  );
}

/** One of the eight headline figures. Tapping the row shows what it means. */
function KeyFigureRow({ figure }: { figure: KeyFigure }) {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync();
        setOpen((v) => !v);
      }}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      style={({ pressed }) => [styles.figureRow, pressed && styles.rowPressed]}
    >
      <View style={styles.figureLine}>
        <Text style={styles.figureLabel}>{figure.label}</Text>
        <View style={styles.figureRight}>
          <Figure style={[styles.figureValue, figure.value === null && styles.figureMuted]}>
            {figure.display}
          </Figure>
          {figure.period ? <Figure style={styles.figurePeriod}>{figure.period}</Figure> : null}
        </View>
      </View>
      {figure.withheld ? <Text style={styles.footnote}>{figure.withheld}</Text> : null}
      {open ? <Text style={styles.hint}>{figure.hint}</Text> : null}
    </Pressable>
  );
}

type Development = {
  key: string;
  date: string | null;
  label: string;
  title: string;
  note: string | null;
  url: string | null;
};

function developmentsOf(filings: CompanyFiling[], news: CompanyNewsItem[]): Development[] {
  return [
    ...filings.map((f, i) => ({
      key: `f-${f.date ?? ""}-${i}`,
      date: f.date,
      label: "PSX filing",
      title: f.title,
      note: f.category || null,
      url: f.url || null,
    })),
    ...news.map((n) => ({
      key: `n-${n.id}`,
      date: n.publishedAt?.slice(0, 10) ?? null,
      label: n.source ?? "Press",
      title: n.title,
      note: null,
      url: n.url,
    })),
  ].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

/** How far back "recently" reaches on the Filings tab. */
const RECENT_FILING_DAYS = 120;
const RECENT_FILING_CAP = 6;

/**
 * The filings a holder actually acts on, in plain words. The portal's
 * category is a word or a code depending on the row's age, so the match is on
 * the stem rather than the exact string.
 */
function plainFilingLabel(category: string): string | null {
  const c = category.toLowerCase().replace(/[^a-z]/g, "");
  if (c.startsWith("result") || c.startsWith("financialresult")) return "Financial results";
  if (c.startsWith("dividend")) return "Dividend announced";
  if (c.startsWith("board")) return "Board meeting";
  if (c.startsWith("material")) return "Material information";
  return null;
}

function recentFilingsOf(filings: CompanyFiling[], now = new Date()): Development[] {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - RECENT_FILING_DAYS);
  const out: Development[] = [];
  filings.forEach((f, i) => {
    if (!f.date) return;
    const d = new Date(`${f.date.slice(0, 10)}T00:00:00`);
    if (Number.isNaN(d.getTime()) || d < cutoff) return;
    const label = plainFilingLabel(f.category);
    if (!label) return;
    out.push({
      key: `r-${f.date}-${i}`,
      date: f.date,
      label: "PSX filing",
      title: f.title,
      note: label,
      url: f.url || null,
    });
  });
  return out.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, RECENT_FILING_CAP);
}

/** A ratio row inside a ledger. Shared by the reader groups and the analyst rows. */
function RatioLine({ row }: { row: { name: string; value: number | string | null } }) {
  const styles = useStyles();
  return (
    <LedgerRow>
      <Text style={styles.ratioName} numberOfLines={1}>
        {row.name}
      </Text>
      <Figure style={[styles.ratioValue, row.value === null && styles.figureMuted]}>{ratioText(row.value)}</Figure>
    </LedgerRow>
  );
}

function PayoutLine({ payout, withKind }: { payout: CompanyPayout; withKind?: boolean }) {
  const styles = useStyles();
  return (
    <LedgerRow>
      {withKind ? (
        <View style={styles.payoutLeft}>
          <Text style={styles.payoutKind}>{payout.kind ?? "Payout"}</Text>
          <Figure style={styles.payoutDate}>{payout.date ?? "date unknown"}</Figure>
        </View>
      ) : (
        <Figure style={styles.payoutDate}>{payout.date ?? "date unknown"}</Figure>
      )}
      <Figure style={styles.payoutValue}>{payoutText(payout)}</Figure>
    </LedgerRow>
  );
}

function DevelopmentRow({ entry }: { entry: Development }) {
  const styles = useStyles();
  return (
    <Pressable
      onPress={entry.url ? () => openLink(entry.url as string) : undefined}
      disabled={!entry.url}
      style={({ pressed }) => [styles.development, pressed && styles.rowPressed]}
      accessibilityRole={entry.url ? "link" : "text"}
      accessibilityLabel={entry.title}
    >
      <Figure style={styles.developmentMeta} numberOfLines={1}>
        {entry.date ?? "undated"}
        {"  "}
        <Text style={styles.developmentLabel}>{entry.label.toUpperCase()}</Text>
        {entry.note ? `  ${entry.note}` : ""}
      </Figure>
      <Text style={styles.developmentTitle}>{entry.title}</Text>
    </Pressable>
  );
}

export default function CompanyScreen() {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const { ticker } = useLocalSearchParams<{ ticker: string }>();
  const [tab, setTabState] = useState<Tab>("Overview");
  const symbol = (ticker ?? "").toUpperCase();

  const [editing, setEditing] = useState(false);
  const [watchBusy, setWatchBusy] = useState(false);
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>("1Y");

  // The chart loads beside the company card rather than inside it: it is
  // slower than the ratios and should not hold them up.
  const chart = useApi<ChartDataResponse>(
    `/api/chart-data?ticker=${encodeURIComponent(symbol)}&period=${chartPeriod}`,
    "Could not load the price history."
  );

  const { data, error, loading, refreshing, refresh } = useApi<CompanyResponse>(
    `/api/stocks/${encodeURIComponent(symbol)}`,
    "Could not load this company."
  );

  // Your position's value and gain come from the holdings route, which is the
  // same calculation the Holdings tab and the web show. Nothing is recomputed
  // here, so the three surfaces cannot disagree. The route is already warm
  // from launch, so this is usually a cache hit.
  const holdings = useApi<HoldingsResponse>("/api/portfolio/holdings", "");
  const held: HoldingRow | null = useMemo(
    () => holdings.data?.rows.find((row) => row.ticker === symbol) ?? null,
    [holdings.data, symbol]
  );

  const viewed = useRef(false);
  useEffect(() => {
    if (!data || viewed.current) return;
    viewed.current = true;
    track("company_viewed", { ticker: symbol, held: !!data.position });
  }, [data, symbol]);

  function setTab(next: Tab) {
    setTabState(next);
    track("company_tab_viewed", { ticker: symbol, tab: next.toLowerCase() });
  }

  async function toggleWatch() {
    void Haptics.selectionAsync();
    setWatchBusy(true);
    try {
      const body: WatchlistWriteRequest = { ticker: symbol, action: "toggle" };
      await apiWrite("/api/stocks/watchlist", "POST", body);
      refresh();
    } catch {
      // The star is a preference, not a figure. A failed toggle leaves the
      // screen readable and is repeatable, so it does not deserve an alert.
    } finally {
      setWatchBusy(false);
    }
  }

  function askAbout() {
    void Haptics.selectionAsync();
    router.push({ pathname: "/(tabs)/copilot", params: { q: ASK_QUESTION(symbol) } });
  }

  if (loading) return <PageSkeleton rows={6} />;

  const position = data?.position ?? null;
  const quote = data?.quote;
  const freshness = data?.quoteFreshness ?? (quote?.price !== null && quote?.price !== undefined ? "fresh" : "missing");
  const quoteDate = quote?.asOf ? quote.asOf.slice(0, 10) : null;
  const delayedLine =
    freshness === "missing"
      ? "No recent price"
      : freshness === "stale"
        ? `Delayed, as of ${quoteDate ?? "an earlier session"}`
        : "Delayed";

  const ratios = data?.ratios ?? [];
  // Reader groups and the analyst rows folded out of them, from the shared
  // helper, so the web and the phone show the same table.
  const { groups: grouped, analyst: analystRows } = groupRatiosForReader(ratios);
  const keyFigures = data?.keyFigures ?? [];
  // A gap in the filings is not a fact about the company, so it leaves the
  // Overview list. Contested and loss-making figures stay: they say something.
  const shownFigures = keyFigures.filter((f) => !isGapFigure(f));
  const byKey = new Map(keyFigures.map((f) => [f.key, f]));
  const peFigure = byKey.get("P/E") ?? null;
  const yieldFigure = byKey.get("Dividend yield (TTM)") ?? null;
  const trends = data?.trends;
  const contestedFor = (field: string) =>
    (trends?.contested ?? []).filter((c) => c.field === field).map((c) => ({ year: c.year, reason: c.reason }));
  const revenueWithheld = contestedFor("revenue");
  const epsWithheld = contestedFor("eps");
  const payouts = data?.payouts ?? [];
  const lastPayouts = payouts
    .filter((p) => (!p.kind || p.kind.toLowerCase() === "cash") && p.dps !== null)
    .slice(0, 4);
  const filings = data?.filings ?? [];
  const developments = developmentsOf(filings, data?.news ?? []);
  const recentFilings = recentFilingsOf(filings);

  // The plain sentences. Each restates a figure shown beside it.
  const growthLine = growthReading(trends?.revenue ?? []);
  const payLine = payoutReading({ payouts, yieldFigure, ratios, price: quote?.price ?? data?.priceUsed });
  const priceLine = valuationReading(peFigure);

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void refresh();
              void chart.refresh();
              void holdings.refresh();
            }}
            tintColor={colors.textMuted}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headerBar}>
            <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back} accessibilityRole="button">
              <ChevronLeft size={20} color={colors.textMuted} />
              <Text style={styles.backLabel}>Back</Text>
            </Pressable>
            <View style={styles.headerActions}>
              {position ? (
                <Pressable
                  onPress={() => {
                    void Haptics.selectionAsync();
                    setEditing(true);
                  }}
                  hitSlop={12}
                  accessibilityLabel={`Edit your ${symbol} position`}
                  accessibilityRole="button"
                >
                  <Pencil size={18} color={colors.textMuted} />
                </Pressable>
              ) : null}
              <Pressable
                onPress={toggleWatch}
                disabled={watchBusy}
                hitSlop={12}
                accessibilityLabel={data?.watched ? `Stop watching ${symbol}` : `Watch ${symbol}`}
                accessibilityRole="button"
                accessibilityState={{ selected: !!data?.watched }}
              >
                <Star
                  size={19}
                  color={data?.watched ? colors.accentSecondary : colors.textMuted}
                  fill={data?.watched ? colors.accentSecondary : "transparent"}
                />
              </Pressable>
              <Pressable
                onPress={askAbout}
                hitSlop={12}
                accessibilityLabel={`Ask about ${symbol}`}
                accessibilityRole="button"
              >
                <MessageSquare size={19} color={colors.textMuted} />
              </Pressable>
            </View>
          </View>

          {/* Identity: ticker, name, sector dot. */}
          <View style={styles.identity}>
            <View style={[styles.dot, { backgroundColor: sectorColor(data?.sector ?? null) }]} />
            <PageTitle style={styles.symbol}>{symbol}</PageTitle>
          </View>
          <Text style={styles.company} numberOfLines={2}>
            {data?.name ?? ""}
            {data?.sector ? `, ${shortSector(data.sector)}` : ""}
          </Text>

          {/* Quote row. Every price here is delayed, and the caption says so. */}
          <View style={styles.quoteRow}>
            <Figure style={styles.price}>{formatNumber(quote?.price, 2)}</Figure>
            <View style={styles.quoteRight}>
              <Figure style={[styles.changePct, { color: toneColor(colors, tone(quote?.dayChangePct)) }]}>
                {formatPctSigned(quote?.dayChangePct, 2)}
              </Figure>
              <Figure style={styles.cap}>Cap {formatCompact(quote?.marketCap)}</Figure>
            </View>
          </View>
          <Figure style={styles.delayed}>{delayedLine}</Figure>

          <View style={styles.tabs}>
            <Segmented options={TABS} value={tab} onChange={setTab} />
          </View>
        </View>

        <Band>
          <ErrorNote message={error} />

          {tab === "Overview" ? (
            <>
              <PriceChart
                candles={chart.data?.candles ?? []}
                avgCost={chart.data?.avgCost ?? null}
                trades={chart.data?.transactions ?? []}
                loading={chart.loading}
              />
              <PeriodRail value={chartPeriod} onChange={setChartPeriod} />
              {chart.data && chart.data.transactions.length > 0 ? (
                <Figure style={styles.chartKey}>The dashed rule is your cost. Rings are your trades.</Figure>
              ) : chart.data?.avgCost ? (
                <Figure style={styles.chartKey}>The dashed rule is your cost.</Figure>
              ) : null}
              {chart.data && chart.data.breaks > 0 ? (
                <Figure style={styles.chartKey}>Adjusted for bonus and split events.</Figure>
              ) : null}

              <View style={styles.block}>
                <Caps style={styles.blockCaps}>What the company does</Caps>
                <Text style={styles.prose}>{data?.description || "No official description on file."}</Text>
              </View>

              {position ? (
                <View style={styles.block}>
                  <View style={styles.blockHead}>
                    <Caps>Your position</Caps>
                    <Figure style={styles.blockNote}>{formatNumber(position.quantity, 0)} shares</Figure>
                  </View>
                  <View style={styles.metricGrid}>
                    <View style={styles.metricCell}>
                      <Caps>At cost</Caps>
                      <Figure style={styles.metricValue}>
                        {held?.totalCost != null ? formatNumber(held.totalCost, 0) : "—"}
                      </Figure>
                    </View>
                    <View style={styles.metricCell}>
                      <Caps>Value now</Caps>
                      <Figure style={styles.metricValue}>
                        {held?.marketValue != null ? formatNumber(held.marketValue, 0) : "—"}
                      </Figure>
                    </View>
                    <View style={styles.metricCell}>
                      <Caps>Unrealised</Caps>
                      <Figure style={[styles.metricValue, { color: toneColor(colors, tone(held?.unrealizedPl)) }]}>
                        {held?.unrealizedPl != null ? formatCompactSigned(held.unrealizedPl) : "—"}
                      </Figure>
                    </View>
                    <View style={styles.metricCell}>
                      <Caps>On cost</Caps>
                      <Figure style={[styles.metricValue, { color: toneColor(colors, tone(held?.unrealizedPlPct)) }]}>
                        {held?.unrealizedPlPct != null ? formatPctSigned(held.unrealizedPlPct) : "—"}
                      </Figure>
                    </View>
                  </View>
                  {position.notes ? <Text style={styles.positionNote}>{position.notes}</Text> : null}
                  {position.hidden ? (
                    <Text style={styles.footnote}>
                      Hidden from analysis. It stays in your ledger but is left out of every figure and
                      chart.
                    </Text>
                  ) : null}
                </View>
              ) : null}

              <View style={styles.block}>
                <Caps style={styles.blockCaps}>Is it growing?</Caps>
                <Text style={styles.reading}>{growthLine}</Text>
                <View style={styles.trendGrid}>
                  <View style={styles.trendCell}>
                    <Text style={styles.trendLabel}>Revenue</Text>
                    <TinyBars points={trends?.revenue ?? []} withheld={revenueWithheld} />
                  </View>
                  <View style={styles.trendCell}>
                    <Text style={styles.trendLabel}>Earnings per share</Text>
                    <TinyBars points={trends?.eps ?? []} withheld={epsWithheld} />
                  </View>
                </View>
                {[...revenueWithheld, ...epsWithheld].length > 0 ? (
                  <Text style={styles.footnote}>
                    {[...revenueWithheld.map((w) => `FY${w.year} revenue withheld. ${w.reason}`), ...epsWithheld.map((w) => `FY${w.year} EPS withheld. ${w.reason}`)].join(" ")}
                  </Text>
                ) : null}
              </View>

              <View style={styles.block}>
                <Caps style={styles.blockCaps}>Does it pay?</Caps>
                <Text style={styles.reading}>{payLine}</Text>
                <View style={styles.figureLine}>
                  <Text style={styles.figureLabel}>{yieldFigure?.label ?? "Dividend yield"}</Text>
                  <View style={styles.figureRight}>
                    <Figure style={[styles.figureValue, (yieldFigure?.value ?? null) === null && styles.figureMuted]}>
                      {yieldFigure?.display ?? "—"}
                    </Figure>
                    {yieldFigure?.period ? <Figure style={styles.figurePeriod}>{yieldFigure.period}</Figure> : null}
                  </View>
                </View>
                {yieldFigure?.withheld ? <Text style={styles.footnote}>{yieldFigure.withheld}</Text> : null}
                <Caps style={styles.subCaps}>Last cash payouts</Caps>
                {lastPayouts.length === 0 ? (
                  <Text style={styles.empty}>No cash payout announcements on file.</Text>
                ) : (
                  <Ledger>
                    {lastPayouts.map((p, i) => (
                      <LedgerRow key={`${p.date}-${i}`}>
                        <Figure style={styles.payoutDate}>{p.date ?? "date unknown"}</Figure>
                        <Figure style={styles.payoutValue}>{payoutText(p)}</Figure>
                      </LedgerRow>
                    ))}
                  </Ledger>
                )}
              </View>

              <View style={styles.block}>
                <Caps style={styles.blockCaps}>Is it expensive?</Caps>
                <Text style={styles.reading}>{priceLine}</Text>
                <View style={styles.figureLine}>
                  <Text style={styles.figureLabel}>{peFigure?.label ?? "Price to earnings"}</Text>
                  <View style={styles.figureRight}>
                    <Figure style={[styles.figureValue, (peFigure?.value ?? null) === null && styles.figureMuted]}>
                      {peFigure?.display ?? "—"}
                    </Figure>
                    {peFigure?.period ? <Figure style={styles.figurePeriod}>{peFigure.period}</Figure> : null}
                  </View>
                </View>
                {peFigure?.value !== null && peFigure?.value !== undefined ? (
                  <Text style={styles.footnote}>
                    {peFigure.hint || "The share price divided by a year of earnings per share."}
                  </Text>
                ) : null}
              </View>

              <View style={styles.block}>
                <Caps style={styles.blockCaps}>Key figures</Caps>
                {shownFigures.length === 0 ? (
                  <Text style={styles.empty}>No figures published for this company yet.</Text>
                ) : (
                  <>
                    <View style={styles.figureList}>
                      {shownFigures.slice(0, KEY_FIGURES_FOLDED).map((figure) => (
                        <KeyFigureRow key={figure.key} figure={figure} />
                      ))}
                    </View>
                    {shownFigures.length > KEY_FIGURES_FOLDED ? (
                      <Disclosure
                        label={`Show all ${countWord(shownFigures.length)}`}
                        openLabel="Show fewer"
                        style={styles.figureMore}
                      >
                        <View style={styles.figureList}>
                          {shownFigures.slice(KEY_FIGURES_FOLDED).map((figure) => (
                            <KeyFigureRow key={figure.key} figure={figure} />
                          ))}
                        </View>
                      </Disclosure>
                    ) : null}
                  </>
                )}
                <Text style={styles.footnote}>Tap a figure to see what it means. The full set is under Financials.</Text>
              </View>

              <View style={styles.block}>
                <Caps style={styles.blockCaps}>Recent developments</Caps>
                {developments.length === 0 ? (
                  <Text style={styles.empty}>
                    No filings or coverage on file for {symbol}. Announcements appear here as the exchange
                    publishes them.
                  </Text>
                ) : (
                  developments.map((entry, i) => (
                    <Rise key={entry.key} index={i}>
                      <DevelopmentRow entry={entry} />
                    </Rise>
                  ))
                )}
              </View>

              <Pressable onPress={askAbout} style={styles.askRow} accessibilityRole="button">
                <Text style={styles.askText}>Want the plain version? Ask walks through {symbol} in a few sentences.</Text>
                <Text style={styles.askLink}>Ask about {symbol}</Text>
              </Pressable>
            </>
          ) : null}

          {tab === "Financials" ? (
            <>
              {/* The same eight figures as the Overview, all of them here,
                  with the reason for any gap. This is the grid a reader needs;
                  the full ratio card sits behind one row below it. */}
              <View style={styles.ratioGroup}>
                <Caps style={styles.blockCaps}>Key figures</Caps>
                {keyFigures.length === 0 ? (
                  <Text style={styles.empty}>No fundamentals published for this company yet.</Text>
                ) : (
                  <View style={styles.figureList}>
                    {keyFigures.map((figure) => (
                      <KeyFigureRow key={figure.key} figure={figure} />
                    ))}
                  </View>
                )}
              </View>

              <View style={styles.ratioGroup}>
                <Caps style={styles.blockCaps}>Last cash payouts</Caps>
                {lastPayouts.length === 0 ? (
                  <Text style={styles.empty}>No cash payout announcements on file.</Text>
                ) : (
                  <Ledger>
                    {lastPayouts.map((p, i) => (
                      <PayoutLine key={`${p.date}-${i}`} payout={p} />
                    ))}
                  </Ledger>
                )}
              </View>

              <Disclosure
                label="All ratios"
                note={grouped.length > 0 ? `${grouped.reduce((n, g) => n + g.rows.length, 0)} figures` : "none published"}
              >
                {grouped.length === 0 && analystRows.length === 0 ? (
                  <Text style={styles.empty}>No ratios published for this company yet.</Text>
                ) : null}
                {grouped.map((group) => (
                  <Disclosure
                    key={group.title}
                    label={group.title}
                    note={`${group.rows.length}`}
                    nested
                  >
                    <Ledger>
                      {group.rows.map((row, i) => (
                        <RatioLine key={`${row.name}-${i}`} row={row} />
                      ))}
                    </Ledger>
                  </Disclosure>
                ))}
                {analystRows.length > 0 ? (
                  <Disclosure label="Analyst rows" note={`${analystRows.length}`} nested>
                    <Text style={styles.footnote}>
                      Derived and reconciliation figures. Kept for anyone checking the sums; not needed
                      to judge the company.
                    </Text>
                    <Ledger>
                      {analystRows.map((row, i) => (
                        <RatioLine key={`${row.name}-${i}`} row={row} />
                      ))}
                    </Ledger>
                  </Disclosure>
                ) : null}
              </Disclosure>

              <Disclosure
                label="All payouts"
                note={payouts.length > 0 ? `${payouts.length} declared` : "none on record"}
              >
                {payouts.length === 0 ? (
                  <Text style={styles.empty}>No declared payouts on record.</Text>
                ) : (
                  <Ledger>
                    {payouts.map((p, i) => (
                      <PayoutLine key={`${p.date}-${i}`} payout={p} withKind />
                    ))}
                  </Ledger>
                )}
              </Disclosure>
            </>
          ) : null}

          {tab === "Filings" ? (
            filings.length === 0 ? (
              <Text style={styles.empty}>No filings on file for {symbol}.</Text>
            ) : (
              <>
                <View style={styles.ratioGroup}>
                  <Caps style={styles.blockCaps}>What matters recently</Caps>
                  {recentFilings.length === 0 ? (
                    <Text style={styles.empty}>
                      No results, dividends, board meetings or material information in the last{" "}
                      {RECENT_FILING_DAYS} days.
                    </Text>
                  ) : (
                    recentFilings.map((entry, i) => (
                      <Rise key={entry.key} index={i}>
                        <DevelopmentRow entry={entry} />
                      </Rise>
                    ))
                  )}
                </View>

                <Disclosure
                  label="Complete record"
                  note={`${filings.length} filings`}
                  defaultOpen={recentFilings.length === 0}
                >
                  {filings.map((f, i) => (
                    <DevelopmentRow
                      key={`${f.date}-${i}`}
                      entry={{
                        key: `f-${i}`,
                        date: f.date,
                        label: "PSX filing",
                        title: f.title,
                        note: plainFilingLabel(f.category) ?? f.category ?? null,
                        url: f.url || null,
                      }}
                    />
                  ))}
                </Disclosure>
              </>
            )
          ) : null}
        </Band>
      </ScrollView>

      <PositionSheet
        open={editing}
        ticker={symbol}
        initial={position}
        onClose={() => setEditing(false)}
        onSaved={() => {
          refresh();
          void holdings.refresh();
        }}
        onRemoved={() => router.back()}
      />
    </SafeAreaView>
  );
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.surfacePage },
  header: { paddingHorizontal: layout.gutter, paddingBottom: space.md },
  headerActions: { flexDirection: "row", alignItems: "center", gap: space.lg },
  headerBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 36 },
  back: { flexDirection: "row", alignItems: "center", gap: 2, marginLeft: -4 },
  backLabel: { fontFamily: fontFamily.uiMedium, fontSize: fontSize.sm, color: c.textMuted },
  identity: { flexDirection: "row", alignItems: "center", gap: space.sm + 1, marginTop: space.sm },
  dot: { width: 10, height: 10 },
  symbol: { fontSize: fontSize.h1, letterSpacing: letterSpacing(fontSize.h1, tracking.editorial) },
  company: { marginTop: 2, fontFamily: fontFamily.ui, fontSize: fontSize.xs, color: c.textMuted },
  quoteRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginTop: space.lg },
  price: {
    fontFamily: fontFamily.monoSemibold,
    fontSize: 34,
    lineHeight: 36,
    letterSpacing: letterSpacing(34, tracking.editorial),
    color: c.textStrong,
  },
  quoteRight: { alignItems: "flex-end", gap: 2 },
  changePct: { fontFamily: fontFamily.monoSemibold, fontSize: fontSize.h2 },
  cap: { fontSize: fontSize.xxs, color: c.textFaint },
  delayed: { marginTop: space.sm, fontSize: fontSize.xxs, color: c.textFaint },
  tabs: { marginTop: space.lg },
  chartKey: { marginTop: space.sm, fontSize: fontSize.xxs, color: c.textFaint },
  block: { marginTop: space.xl },
  blockHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: space.md,
  },
  blockCaps: { marginBottom: space.md },
  subCaps: { marginTop: space.lg, marginBottom: space.xs },
  blockNote: { fontSize: fontSize.xxs, color: c.textFaint },
  prose: { fontFamily: fontFamily.ui, fontSize: fontSize.sm, lineHeight: 21, color: c.textBody },
  /* The plain sentence under a question. Body weight, a touch larger than the
     figures it explains, so it reads first. */
  reading: {
    marginBottom: space.md,
    fontFamily: fontFamily.uiMedium,
    fontSize: fontSize.body,
    lineHeight: 22,
    color: c.textStrong,
  },
  figureMore: { marginTop: space.xs, borderTopWidth: 0 },
  positionNote: {
    marginTop: space.md,
    fontFamily: fontFamily.ui,
    fontSize: fontSize.sm,
    lineHeight: 20,
    color: c.textMuted,
  },
  footnote: {
    marginTop: space.sm,
    fontFamily: fontFamily.ui,
    fontSize: fontSize.xxs,
    lineHeight: 17,
    color: c.textFaint,
  },
  hint: {
    marginTop: space.xs,
    fontFamily: fontFamily.ui,
    fontSize: fontSize.xs,
    lineHeight: 18,
    color: c.textMuted,
  },
  metricGrid: { flexDirection: "row", flexWrap: "wrap" },
  metricCell: {
    flexBasis: "50%",
    paddingVertical: space.md,
    paddingRight: space.md,
    gap: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.rule,
  },
  metricValue: { fontFamily: fontFamily.monoSemibold, fontSize: fontSize.h2, color: c.textStrong },
  trendGrid: { flexDirection: "row", gap: space.xl },
  trendCell: { flex: 1, gap: space.sm },
  trendLabel: { fontFamily: fontFamily.uiMedium, fontSize: fontSize.xs, color: c.textMuted },
  bars: { flexDirection: "row", gap: 8, alignItems: "flex-end" },
  barSlot: { width: 22, position: "relative" },
  bar: { position: "absolute", left: 0, right: 0 },
  barWithheld: { borderWidth: 1, borderStyle: "dashed", borderColor: c.ruleStrong },
  barYear: { width: 22, textAlign: "center", marginTop: 4, fontSize: fontSize.xxxs, color: c.textFaint },
  figureList: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.rule },
  figureRow: {
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.rule,
  },
  figureLine: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: space.md },
  figureLabel: { flex: 1, fontFamily: fontFamily.ui, fontSize: fontSize.sm, color: c.textBody },
  figureRight: { alignItems: "flex-end", gap: 2 },
  figureValue: { fontFamily: fontFamily.monoSemibold, fontSize: fontSize.sm, color: c.textStrong },
  figureMuted: { color: c.textFaint },
  figurePeriod: { fontSize: fontSize.xxxs, color: c.textFaint },
  rowPressed: { backgroundColor: c.surfaceSunken },
  development: {
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.rule,
    gap: 3,
  },
  developmentMeta: { fontSize: fontSize.xxs, color: c.textFaint },
  developmentLabel: {
    fontFamily: fontFamily.uiBold,
    fontSize: fontSize.xxxs,
    letterSpacing: letterSpacing(fontSize.xxxs, tracking.caps),
    color: c.textFaint,
  },
  developmentTitle: {
    fontFamily: fontFamily.uiMedium,
    fontSize: fontSize.sm,
    lineHeight: 20,
    color: c.textStrong,
  },
  askRow: {
    marginTop: space.xl,
    paddingTop: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.ruleStrong,
    gap: space.sm,
    minHeight: layout.hitMin,
  },
  askText: { fontFamily: fontFamily.ui, fontSize: fontSize.sm, lineHeight: 20, color: c.textMuted },
  askLink: { fontFamily: fontFamily.uiSemibold, fontSize: fontSize.sm, color: c.textBrand },
  ratioGroup: { marginBottom: space.xl },
  ratioName: { flex: 1, fontFamily: fontFamily.ui, fontSize: fontSize.sm, color: c.textBody },
  ratioValue: { fontFamily: fontFamily.monoSemibold, fontSize: fontSize.sm },
  payoutLeft: { flex: 1, gap: 1 },
  payoutKind: { fontFamily: fontFamily.uiSemibold, fontSize: fontSize.sm, color: c.textStrong },
  payoutDate: { flex: 1, fontSize: fontSize.xxs, color: c.textFaint },
  payoutValue: { fontFamily: fontFamily.monoSemibold, fontSize: fontSize.sm },
  empty: { fontFamily: fontFamily.ui, fontSize: fontSize.sm, color: c.textMuted, lineHeight: 20 },
}));
