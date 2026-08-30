import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, MessageSquare, Pencil, Star } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import type { CompanyResponse } from "@psx/shared/api/stocks";
import { formatCompact, formatNumber, formatPctSigned } from "@psx/shared/format";
import { sectorColor, shortSector } from "@psx/shared/sector-colors";
import { useApi } from "@/lib/use-api";
import { Segmented } from "@/components/segmented";
import { Band, Ledger, LedgerRow } from "@/components/ui/layout";
import { Caps, Figure, PageTitle } from "@/components/ui/text";
import { ErrorNote } from "@/components/status";
import { PageSkeleton } from "@/components/skeleton";
import { PositionSheet } from "@/components/features/position-sheet";
import { PriceChart, PeriodRail, type ChartPeriod } from "@/components/charts/price-chart";
import { Rise } from "@/components/ui/motion";
import type { ChartDataResponse } from "@psx/shared/api/chart";
import type { NewsResponse } from "@psx/shared/api/news";
import { groupRatios } from "@psx/shared/company/ratio-groups";
import { formatCompactSigned } from "@psx/shared/format";
import { apiWrite } from "@/lib/api";
import { makeStyles, useColors } from "@/lib/theme-context";
import {
  colors,
  directionColor,
  fontFamily,
  fontSize,
  layout,
  letterSpacing,
  space,
  tracking,
} from "@/lib/theme";

const TABS = ["Overview", "Fundamentals", "Payouts"] as const;
type Tab = (typeof TABS)[number];

/** The handful of ratios worth the first screen, in reading order. */
const HEADLINE = [
  "P/E",
  "P/B",
  "Dividend yield (TTM)",
  "ROE",
  "Debt-to-equity",
  "Current ratio",
];

function ratioText(value: number | string | null): string {
  if (value === null || value === undefined) return "—";
  return typeof value === "number" ? formatNumber(value, 2) : String(value);
}

export default function CompanyScreen() {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const { ticker } = useLocalSearchParams<{ ticker: string }>();
  const [tab, setTab] = useState<Tab>("Overview");
  const symbol = (ticker ?? "").toUpperCase();

  const [editing, setEditing] = useState(false);
  const [watchBusy, setWatchBusy] = useState(false);
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>("1Y");

  // The chart and the ticker's news load beside the company card rather than
  // inside it: each is slower than the ratios and neither should hold them up.
  const chart = useApi<ChartDataResponse>(
    `/api/chart-data?ticker=${encodeURIComponent(symbol)}&period=${chartPeriod}`,
    "Could not load the price history."
  );
  const news = useApi<NewsResponse>(
    `/api/portfolio/news?tab=companies&window=all&ticker=${encodeURIComponent(symbol)}`,
    "Could not load the news for this company."
  );

  const { data, error, loading, refreshing, refresh } = useApi<CompanyResponse>(
    `/api/stocks/${encodeURIComponent(symbol)}`,
    "Could not load this company."
  );

  const headline = useMemo(() => {
    if (!data) return [];
    const by = new Map(data.ratios.map((r) => [r.name, r]));
    return HEADLINE.map((name) => ({ name, row: by.get(name) })).filter((entry) => entry.row);
  }, [data]);

  function openStory(url: string) {
    void WebBrowser.openBrowserAsync(url, {
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
    });
  }

  async function toggleWatch() {
    void Haptics.selectionAsync();
    setWatchBusy(true);
    try {
      await apiWrite("/api/stocks/watchlist", "POST", { ticker: symbol, action: "toggle" });
      refresh();
    } catch {
      // The star is a preference, not a figure. A failed toggle leaves the
      // screen readable and is repeatable, so it does not deserve an alert.
    } finally {
      setWatchBusy(false);
    }
  }

  if (loading) return <PageSkeleton rows={6} />;

  const position = data?.position ?? null;
  const price = data?.quote?.price ?? data?.priceUsed ?? null;
  const marketValue = position && price !== null ? position.quantity * price : null;
  const unrealized =
    marketValue !== null && position?.totalCost != null ? marketValue - position.totalCost : null;
  const unrealizedPct =
    unrealized !== null && position?.totalCost ? (unrealized / position.totalCost) * 100 : null;
  // Five is what fits before the section stops being a summary of the news and
  // starts being the news.
  const stories = (news.data?.groups ?? []).flatMap((group) => group.events).slice(0, 5);

  const grouped = groupRatios(data?.ratios ?? []);

  const quote = data?.quote;
  // What the figures rest on, and a warning when they are not hand-verified.
  // "stale" and "mismatch" are worth saying out loud; "verified" is the quiet
  // default and does not need announcing.
  const period = data?.verified?.throughPeriod ?? data?.periods.latestInterim ?? data?.periods.latestAnnual;
  const status = data?.verified?.status;
  // A trailing period already reads as a phrase ("TTM to 2026 9M"), so it takes
  // no preposition; a bare one ("2026 FY") does.
  const periodPhrase = period ? (/^TTM/i.test(period) ? period : `Figures to ${period}`) : null;
  const basisLine = periodPhrase
    ? `${periodPhrase}${status && status !== "verified" ? ` · ${status}` : ""}`
    : null;

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            // A pull refreshes the whole screen, not only the block that owns
            // the spinner.
            onRefresh={() => {
              void refresh();
              void chart.refresh();
              void news.refresh();
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
              {data?.position ? (
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
                onPress={() => {
                  void Haptics.selectionAsync();
                  router.push({ pathname: "/(tabs)/copilot", params: { q: `Tell me about ${symbol}` } });
                }}
                hitSlop={12}
                accessibilityLabel="Ask the Copilot about this company"
                accessibilityRole="button"
              >
                <MessageSquare size={19} color={colors.textMuted} />
              </Pressable>
            </View>
          </View>

          <View style={styles.identity}>
            <View style={[styles.dot, { backgroundColor: sectorColor(data?.sector ?? null) }]} />
            <PageTitle style={styles.symbol}>{symbol}</PageTitle>
          </View>
          <Text style={styles.company} numberOfLines={2}>
            {data?.name ?? ""}
            {data?.sector ? ` · ${shortSector(data.sector)}` : ""}
          </Text>

          <View style={styles.quoteRow}>
            <Figure style={styles.price}>{formatNumber(quote?.price, 2)}</Figure>
            <View style={styles.quoteRight}>
              <Figure style={[styles.changePct, { color: directionColor(quote?.dayChangePct) }]}>
                {formatPctSigned(quote?.dayChangePct, 2)}
              </Figure>
              <Figure style={styles.cap}>Cap {formatCompact(quote?.marketCap)}</Figure>
            </View>
          </View>

          {/* Say what the valuation rests on. A ratio from a single old period
              is a different claim from a trailing twelve months. */}
          {basisLine ? <Figure style={styles.basis}>{basisLine}</Figure> : null}

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
                <Figure style={styles.chartKey}>
                  dashed rule is your cost · rings are your trades
                </Figure>
              ) : chart.data?.avgCost ? (
                <Figure style={styles.chartKey}>dashed rule is your cost</Figure>
              ) : null}

              {position ? (
                <View style={styles.positionBlock}>
                  <View style={styles.blockHead}>
                    <Caps>Your position</Caps>
                    <Figure style={styles.positionWeight}>
                      {formatNumber(position.quantity, 0)} shares
                    </Figure>
                  </View>
                  <View style={styles.metricGrid}>
                    <View style={styles.metricCell}>
                      <Caps>At cost</Caps>
                      <Figure style={styles.metricValue}>
                        {position.totalCost !== null ? formatNumber(position.totalCost, 0) : "—"}
                      </Figure>
                    </View>
                    <View style={styles.metricCell}>
                      <Caps>Value now</Caps>
                      <Figure style={styles.metricValue}>
                        {marketValue !== null ? formatNumber(marketValue, 0) : "—"}
                      </Figure>
                    </View>
                    <View style={styles.metricCell}>
                      <Caps>Unrealised</Caps>
                      <Figure style={[styles.metricValue, { color: directionColor(unrealized) }]}>
                        {unrealized !== null ? formatCompactSigned(unrealized) : "—"}
                      </Figure>
                    </View>
                    <View style={styles.metricCell}>
                      <Caps>On cost</Caps>
                      <Figure style={[styles.metricValue, { color: directionColor(unrealizedPct) }]}>
                        {unrealizedPct !== null ? formatPctSigned(unrealizedPct) : "—"}
                      </Figure>
                    </View>
                  </View>
                  {position.notes ? <Text style={styles.positionNote}>{position.notes}</Text> : null}
                  {position.hidden ? (
                    <Text style={styles.hiddenNote}>
                      Hidden from analysis. It stays in your ledger but is left out of every figure
                      and chart.
                    </Text>
                  ) : null}
                </View>
              ) : null}

              <View style={styles.ratioBlock}>
                <Caps style={styles.blockCaps}>Key ratios</Caps>
                {headline.length === 0 ? (
                  <Text style={styles.empty}>No ratios published for this company yet.</Text>
                ) : (
                  <View style={styles.metricGrid}>
                    {headline.map(({ name, row }) => (
                      <View key={name} style={styles.metricCell}>
                        <Caps>{name}</Caps>
                        <Figure style={styles.metricValue}>{ratioText(row?.value ?? null)}</Figure>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              {/* News about the company you are reading about belongs here, not
                  two taps away in another section. */}
              {stories.length > 0 ? (
                <View style={styles.newsBlock}>
                  <Caps style={styles.blockCaps}>In the news</Caps>
                  {stories.map((story, i) => (
                    <Rise key={story.id} index={i}>
                      <Pressable
                        onPress={() => openStory(story.url)}
                        style={({ pressed }) => [styles.story, pressed && styles.storyPressed]}
                        accessibilityRole="link"
                        accessibilityLabel={story.title}
                      >
                        <Figure style={styles.storyMeta} numberOfLines={1}>
                          {story.source} · {story.timeLabel}
                        </Figure>
                        <Text style={styles.storyTitle}>{story.title}</Text>
                      </Pressable>
                    </Rise>
                  ))}
                </View>
              ) : null}
            </>
          ) : null}

          {tab === "Fundamentals" ? (
            grouped.length > 0 ? (
              <>
                {grouped.map((group) => (
                  <View key={group.title} style={styles.ratioGroup}>
                    <Caps style={styles.blockCaps}>{group.title}</Caps>
                    <Ledger>
                      {group.rows.map((row, i) => (
                        <LedgerRow key={`${row.name}-${i}`}>
                          <Text style={styles.ratioName} numberOfLines={1}>
                            {row.name}
                          </Text>
                          <Figure style={styles.ratioValue}>{ratioText(row.value)}</Figure>
                        </LedgerRow>
                      ))}
                    </Ledger>
                  </View>
                ))}
              </>
            ) : (
              <Text style={styles.empty}>No fundamentals published for this company yet.</Text>
            )
          ) : null}

          {tab === "Payouts" ? (
            data && data.payouts.length > 0 ? (
              <Ledger>
                {data.payouts.map((p, i) => (
                  <LedgerRow key={`${p.date}-${i}`}>
                    <View style={styles.payoutLeft}>
                      <Text style={styles.payoutKind}>{p.kind ?? "Payout"}</Text>
                      <Figure style={styles.payoutDate}>{p.date ?? "date unknown"}</Figure>
                    </View>
                    <Figure style={styles.payoutValue}>
                      {p.dps !== null
                        ? `${formatNumber(p.dps, 2)} per share`
                        : p.percentage !== null
                          ? `${formatNumber(p.percentage, 0)}%`
                          : "—"}
                    </Figure>
                  </LedgerRow>
                ))}
              </Ledger>
            ) : (
              <Text style={styles.empty}>No declared payouts on record.</Text>
            )
          ) : null}
        </Band>
      </ScrollView>

      <PositionSheet
        open={editing}
        ticker={symbol}
        initial={data?.position ?? null}
        onClose={() => setEditing(false)}
        onSaved={refresh}
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
  basis: { marginTop: space.md, fontSize: fontSize.xxs, color: c.textFaint },
  tabs: { marginTop: space.lg },
  chartKey: { marginTop: space.sm, fontSize: fontSize.xxs, color: c.textFaint },
  positionBlock: { marginTop: space.xl },
  blockHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: space.md,
  },
  blockCaps: { marginBottom: space.md },
  positionWeight: { fontSize: fontSize.xxs, color: c.textFaint },
  positionNote: {
    fontFamily: fontFamily.ui,
    fontSize: fontSize.sm,
    lineHeight: 20,
    color: c.textMuted,
  },
  hiddenNote: {
    fontFamily: fontFamily.ui,
    fontSize: fontSize.xxs,
    lineHeight: 17,
    color: c.textMuted,
    marginTop: space.sm,
  },
  ratioBlock: { marginTop: space.xl },
  ratioGroup: { marginBottom: space.xl },
  newsBlock: { marginTop: space.xl },
  story: {
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.rule,
    gap: 2,
  },
  storyPressed: { backgroundColor: c.surfaceSunken },
  storyMeta: { fontSize: fontSize.xxs, color: c.textFaint },
  storyTitle: {
    fontFamily: fontFamily.uiMedium,
    fontSize: fontSize.sm,
    lineHeight: 20,
    color: c.textStrong,
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
  ratioName: { flex: 1, fontFamily: fontFamily.ui, fontSize: fontSize.sm, color: c.textBody },
  ratioValue: { fontFamily: fontFamily.monoSemibold, fontSize: fontSize.sm },
  payoutLeft: { flex: 1, gap: 1 },
  payoutKind: { fontFamily: fontFamily.uiSemibold, fontSize: fontSize.sm, color: c.textStrong },
  payoutDate: { fontSize: fontSize.xxs, color: c.textFaint },
  payoutValue: { fontFamily: fontFamily.monoSemibold, fontSize: fontSize.sm },
  empty: { fontFamily: fontFamily.ui, fontSize: fontSize.sm, color: c.textMuted, lineHeight: 20 },
}));
