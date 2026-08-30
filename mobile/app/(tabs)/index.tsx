import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, useRouter } from "expo-router";
import { Bell } from "lucide-react-native";
import type { HomeContributor, HomeResponse } from "@psx/shared/api/home";
import {
  formatCompact,
  formatCompactSigned,
  formatFigure,
  formatPctSigned,
} from "@psx/shared/format";
import { shortSector } from "@psx/shared/sector-colors";
import { useApi } from "@/lib/use-api";
import { AreaChart } from "@/components/charts/area-chart";
import { StackedRule } from "@/components/charts/stacked-rule";
import { Wordmark } from "@/components/ui/mark";
import { Band, Ledger, LedgerRow } from "@/components/ui/layout";
import { Caps, Figure, Note } from "@/components/ui/text";
import { ErrorNote } from "@/components/status";
import { ScreenSkeleton } from "@/components/skeleton";
import { CountUp, LivePulse, Rise } from "@/components/ui/motion";
import { useMarketOpen } from "@/lib/use-market-open";
import { makeStyles, useColors } from "@/lib/theme-context";
import {
  colors,
  directionColor,
  directionColorOnDark,
  fontFamily,
  fontSize,
  layout,
  letterSpacing,
  space,
  tracking,
} from "@/lib/theme";

function HeaderMetric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.metricCell}>
      <Caps onDark>{label}</Caps>
      <Figure style={[styles.metricValue, tone ? { color: tone } : null]}>{value}</Figure>
      <Text style={styles.metricDetail}>{detail}</Text>
    </View>
  );
}

function Contributor({ row }: { row: HomeContributor }) {
  const styles = useStyles();
  return (
    <LedgerRow>
      <View style={[styles.dot, { backgroundColor: row.color }]} />
      <View style={styles.contributorName}>
        <Text style={styles.ticker}>{row.ticker}</Text>
        <Text style={styles.company} numberOfLines={1}>
          {row.companyName ?? shortSector(row.sector)}
        </Text>
      </View>
      <Figure style={[styles.contributorPnl, { color: directionColor(row.dayPnl) }]}>
        {formatCompactSigned(row.dayPnl)}
      </Figure>
      <Figure style={[styles.contributorPct, { color: directionColor(row.dayChangePct) }]}>
        {formatPctSigned(row.dayChangePct, 2)}
      </Figure>
    </LedgerRow>
  );
}

export default function HomeScreen() {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const marketOpen = useMarketOpen();
  const { data, error, loading, refreshing, refresh } = useApi<HomeResponse>(
    "/api/portfolio/home",
    "Could not load your portfolio."
  );

  if (loading) return <ScreenSkeleton metrics={4} rows={7} />;

  const curve = data?.timeline.map((point) => point.netWorth) ?? [];

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.textMuted} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* The ink field: everything about the book as a whole. */}
        <SafeAreaView edges={["top"]} style={styles.header}>
          <View style={styles.headerBar}>
            <Wordmark />
            <Bell
              size={19}
              color={colors.textOnDarkMuted}
              onPress={() => router.push("/alerts")}
            />
          </View>

          <Caps onDark style={styles.valueLabel}>
            {data?.atCost ? "Invested at cost" : "Portfolio value"}
          </Caps>
          <Text style={styles.value}>
            <Text style={styles.valueUnit}>PKR </Text>
            <CountUp
              value={data?.totalValue ?? 0}
              format={formatFigure}
              style={styles.valueFigure}
            />
          </Text>

          {data && data.totalDayPnl !== null ? (
            <Text style={styles.today}>
              Today{" "}
              <Figure style={[styles.todayFigure, { color: directionColorOnDark(data.totalDayPnl) }]}>
                {formatCompactSigned(data.totalDayPnl)} · {formatPctSigned(data.dayChangePct, 2)}
              </Figure>
            </Text>
          ) : null}

          {data?.asOf ? (
            <View style={styles.asOfRow}>
              <LivePulse live={marketOpen} />
              <Figure style={styles.asOf}>As of {data.asOf.slice(0, 16).replace("T", " ")}</Figure>
            </View>
          ) : null}

          {curve.length > 1 ? (
            <View style={styles.chartBlock}>
              <View style={styles.chartHead}>
                <Caps onDark>Since first purchase</Caps>
                <Figure style={[styles.chartPct, { color: directionColorOnDark(data?.unrealizedPlPct) }]}>
                  {formatPctSigned(data?.unrealizedPlPct)}
                </Figure>
              </View>
              <AreaChart values={curve} reference={data?.totalCost ?? null} />
              <View style={styles.chartFoot}>
                <Figure style={styles.chartFootText}>
                  dashed rule is cost, {formatCompact(data?.totalCost ?? 0)}
                </Figure>
              </View>
            </View>
          ) : null}

          <View style={styles.metricGrid}>
            {/* With no live price there is no measured gain, and printing a
                confident zero would be a claim the data does not support. */}
            <HeaderMetric
              label="Unrealised gain"
              value={data?.atCost ? "—" : formatCompactSigned(data?.unrealizedPl ?? 0)}
              detail={data?.atCost ? "awaiting prices" : `${formatPctSigned(data?.unrealizedPlPct)} on cost`}
              tone={data?.atCost ? undefined : directionColorOnDark(data?.unrealizedPl)}
            />
            <HeaderMetric
              label="Invested"
              value={formatCompact(data?.totalCost ?? 0)}
              detail={`${data?.holdingsCount ?? 0} holdings`}
            />
            <HeaderMetric
              label="Dividends"
              value={formatCompact(data?.dividendIncome ?? 0)}
              detail="received to date"
            />
            <HeaderMetric
              label="Largest position"
              value={data?.largest ? `${data.largest.weightPct.toFixed(1)}%` : "—"}
              detail={data?.largest?.ticker ?? "—"}
            />
          </View>
        </SafeAreaView>

        <View style={styles.gutter}>
          <ErrorNote message={error} />
        </View>

        {data && data.sectors.length > 0 ? (
          <Band style={styles.bandTight}>
            <View style={styles.bandHead}>
              <Caps>Allocation by sector</Caps>
              <Figure style={styles.bandNote}>{data.sectors.length} sectors</Figure>
            </View>
            <StackedRule segments={data.sectors.map((s) => ({ value: s.value, color: s.color }))} />
            <Ledger>
              {data.sectors.map((s, i) => (
                <Rise key={s.sector} index={i}>
                  <LedgerRow>
                    <View style={[styles.chip, { backgroundColor: s.color }]} />
                    <Text style={styles.sectorName} numberOfLines={1}>
                      {shortSector(s.sector)}
                    </Text>
                    <Figure style={styles.sectorValue}>{formatCompact(s.value)}</Figure>
                    <Figure style={styles.sectorWeight}>{s.weightPct.toFixed(1)}%</Figure>
                  </LedgerRow>
                </Rise>
              ))}
            </Ledger>
          </Band>
        ) : null}

        {data && data.contributors.length > 0 ? (
          <Band>
            <View style={styles.bandHead}>
              <Caps>Today&apos;s contributors</Caps>
              <Link href="/holdings" style={styles.link}>
                All holdings
              </Link>
            </View>
            <Ledger>
              {data.contributors.map((row) => (
                <Contributor key={row.ticker} row={row} />
              ))}
            </Ledger>
            <Note style={styles.disclaimer}>
              For personal portfolio tracking and research support only. It is not financial
              advice.
            </Note>
          </Band>
        ) : null}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.surfacePage },
  scroll: { paddingBottom: space.xl },
  gutter: { paddingHorizontal: layout.gutter },
  header: { backgroundColor: c.ink, paddingHorizontal: layout.gutter, paddingBottom: space.xs },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 46,
  },
  valueLabel: { marginTop: space.lg },
  value: { marginTop: space.xs },
  valueUnit: {
    fontFamily: fontFamily.display,
    fontSize: 17,
    color: c.textOnDarkMuted,
  },
  valueFigure: {
    fontFamily: fontFamily.monoSemibold,
    fontSize: 38,
    letterSpacing: letterSpacing(38, tracking.editorial),
    color: c.textOnDark,
  },
  today: {
    marginTop: space.md,
    fontFamily: fontFamily.ui,
    fontSize: fontSize.body,
    color: c.textOnDarkMuted,
  },
  todayFigure: { fontFamily: fontFamily.monoSemibold, fontSize: fontSize.body },
  asOfRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.md + 2 },
  asOf: { fontSize: fontSize.xxs, color: c.textOnDarkFaint },
  chartBlock: { marginTop: space.xl - 2 },
  chartHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: space.xs + 2,
  },
  chartPct: { fontSize: fontSize.xxs },
  chartFoot: { flexDirection: "row", justifyContent: "space-between", marginTop: 5 },
  chartFootText: { fontSize: fontSize.xxs, color: c.textOnDarkFaint },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: space.xl - 2,
    marginHorizontal: -layout.gutter,
    backgroundColor: c.ruleOnDark,
    gap: StyleSheet.hairlineWidth,
  },
  metricCell: {
    flexBasis: "48%",
    flexGrow: 1,
    backgroundColor: c.ink,
    paddingVertical: space.md + 2,
    paddingHorizontal: layout.gutter,
    gap: 3,
  },
  metricValue: {
    fontFamily: fontFamily.monoSemibold,
    fontSize: fontSize.h2,
    color: c.textOnDark,
  },
  metricDetail: {
    fontFamily: fontFamily.ui,
    fontSize: fontSize.xxs,
    color: c.textOnDarkFaint,
  },
  bandTight: { paddingBottom: 0 },
  bandHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: space.md,
  },
  bandNote: { fontSize: fontSize.xxs, color: c.textFaint },
  link: { fontFamily: fontFamily.uiMedium, fontSize: fontSize.xxs, color: c.textBrand },
  chip: { width: 8, height: 8, marginRight: space.md - 1 },
  sectorName: { flex: 1, fontFamily: fontFamily.ui, fontSize: fontSize.sm, color: c.textStrong },
  sectorValue: { fontSize: fontSize.sm, color: c.textMuted, marginRight: space.md },
  sectorWeight: {
    minWidth: 52,
    textAlign: "right",
    fontFamily: fontFamily.monoSemibold,
    fontSize: fontSize.sm,
  },
  dot: { width: 8, height: 8, marginRight: space.sm + 1 },
  contributorName: { flex: 1, gap: 1 },
  ticker: { fontFamily: fontFamily.uiSemibold, fontSize: fontSize.sm, color: c.textStrong },
  company: { fontFamily: fontFamily.ui, fontSize: fontSize.xxs, color: c.textFaint },
  contributorPnl: {
    minWidth: 74,
    textAlign: "right",
    fontFamily: fontFamily.monoSemibold,
    fontSize: fontSize.sm,
  },
  contributorPct: { minWidth: 62, textAlign: "right", fontSize: fontSize.sm },
  disclaimer: { marginTop: space.lg },
}));
