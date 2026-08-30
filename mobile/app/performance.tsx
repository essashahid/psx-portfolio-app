import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import type { PerformanceResponse } from "@psx/shared/api/performance";
import { formatCompact, formatCompactSigned, formatNumber, formatPctSigned } from "@psx/shared/format";
import { sectorColor, shortSector } from "@psx/shared/sector-colors";
import { useApi } from "@/lib/use-api";
import { AreaChart } from "@/components/charts/area-chart";
import { BenchmarkChart } from "@/components/charts/benchmark-chart";
import { Band, Ledger, LedgerRow } from "@/components/ui/layout";
import { Caps, Figure, PageTitle } from "@/components/ui/text";
import { ErrorNote } from "@/components/status";
import { PageSkeleton } from "@/components/skeleton";
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

function Stat({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.stat}>
      <Caps>{label}</Caps>
      <Figure style={[styles.statValue, tone ? { color: tone } : null]}>{value}</Figure>
      {detail ? <Text style={styles.statDetail}>{detail}</Text> : null}
    </View>
  );
}

export default function PerformanceScreen() {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const { data, error, loading, refreshing, refresh } = useApi<PerformanceResponse>(
    "/api/portfolio/performance",
    "Could not load performance."
  );

  if (loading) return <PageSkeleton rows={6} />;

  const r = data?.returns;
  const f = data?.friction;
  const c = data?.concentration;
  const bm = data?.benchmark ?? null;
  const curve = data?.timeline.map((point) => point.netWorth) ?? [];

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.textMuted} />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back} accessibilityRole="button">
            <ChevronLeft size={20} color={colors.textMuted} />
            <Text style={styles.backLabel}>Back</Text>
          </Pressable>
          <PageTitle style={styles.title}>Performance</PageTitle>

          {/* XIRR leads because it is the only figure here that accounts for
              when money went in, which is what makes returns comparable. */}
          <Caps style={styles.headLabel}>Annualised return</Caps>
          <Text style={styles.headValue}>
            {r?.xirrStatus === "calculated" && r.xirrPct !== null ? formatPctSigned(r.xirrPct) : "—"}
          </Text>
          <Text style={styles.headDetail}>
            {r?.xirrStatus === "calculated"
              ? `over ${formatNumber(r.holdingPeriodYears, 1)} years`
              : (r?.xirrFailureReason ?? "Not enough dated cash flows to annualise yet.")}
          </Text>
        </View>

        {curve.length > 1 ? (
          <Band style={styles.chartBand}>
            <View style={styles.blockHead}>
              <Caps>Net worth</Caps>
              <Figure style={styles.note}>dashed rule is deposited</Figure>
            </View>
            <AreaChart
              values={curve}
              reference={r?.totalDeposited ?? null}
              color={colors.chartLine}
              height={110}
            />
          </Band>
        ) : null}

        {/* The app's whole claim, in one frame: holding these companies
            against simply owning the index, and against doing nothing at all. */}
        {bm && bm.series.length > 1 ? (
          <Band>
            <View style={styles.blockHead}>
              <Caps>Against the index</Caps>
              <Figure
                style={[styles.note, { color: directionColor(bm.excessVsKse100) }]}
              >
                {formatCompactSigned(bm.excessVsKse100)} vs KSE-100
              </Figure>
            </View>
            <BenchmarkChart series={bm.series} />
            <Figure style={styles.benchmarkNote}>
              What the same money would be worth in the index, and what it would
              need to be worth to have kept its purchasing power.
              {bm.maxDrawdownPct !== null
                ? ` Worst fall along the way, ${formatNumber(Math.abs(bm.maxDrawdownPct), 1)}%.`
                : ""}
            </Figure>
          </Band>
        ) : null}

        <Band>
          <ErrorNote message={error} />
          {!r ? (
            error ? null : (
              <Text style={styles.empty}>
                There is no ledger to analyse yet. Import a broker statement on the web and
                this fills in.
              </Text>
            )
          ) : (
            <>
              <View style={styles.statGrid}>
                <Stat
                  label="Total gain"
                  value={formatCompactSigned(r.totalGain)}
                  detail={`${formatPctSigned(r.totalReturnPct)} on deposits`}
                  tone={directionColor(r.totalGain)}
                />
                <Stat label="Deposited" value={formatCompact(r.totalDeposited)} detail="paid in" />
                <Stat label="Net worth" value={formatCompact(r.netWorth)} detail="today" />
                <Stat
                  label="Realised"
                  value={formatCompactSigned(r.realizedPl)}
                  detail="from sales"
                  tone={directionColor(r.realizedPl)}
                />
              </View>

              {f ? (
                <View style={styles.block}>
                  <View style={styles.blockHead}>
                    <Caps>Cost of trading</Caps>
                    <Figure style={styles.note}>{formatNumber(f.pctOfDeposits, 2)}% of deposits</Figure>
                  </View>
                  <Ledger>
                    {[
                      ["Trade fees", f.tradeFeesTotal],
                      ["Capital gains tax", f.cgt],
                      ["Account fees", f.accountFees],
                      ["Total friction", f.total],
                    ].map(([label, amount], i, all) => (
                      <LedgerRow key={String(label)} style={i === all.length - 1 ? styles.totalRow : undefined}>
                        <Text style={[styles.rowLabel, i === all.length - 1 && styles.rowLabelStrong]}>
                          {label as string}
                        </Text>
                        <Figure style={[styles.rowValue, i === all.length - 1 && styles.rowValueStrong]}>
                          {formatCompact(amount as number)}
                        </Figure>
                      </LedgerRow>
                    ))}
                  </Ledger>
                </View>
              ) : null}

              {c ? (
                <View style={styles.block}>
                  <View style={styles.blockHead}>
                    <Caps>Concentration</Caps>
                    <Figure style={styles.note}>
                      {c.topHolding ? `${c.topHolding.ticker} largest` : ""}
                    </Figure>
                  </View>
                  <View style={styles.statGrid}>
                    <Stat
                      label="Top position"
                      value={c.topHolding ? `${formatNumber(c.topHolding.weightPct, 1)}%` : "—"}
                      detail="of the book"
                    />
                    <Stat
                      label="Tail under 1%"
                      value={String(c.positionsBelow1pct)}
                      detail="small positions"
                    />
                  </View>
                  {c.sectorWeights.length > 0 ? (
                    <Ledger>
                      {c.sectorWeights.map((s) => (
                        <LedgerRow key={s.sector}>
                          <View style={[styles.dot, { backgroundColor: sectorColor(s.sector) }]} />
                          <Text style={styles.rowLabel} numberOfLines={1}>
                            {shortSector(s.sector)}
                          </Text>
                          <Figure style={styles.rowValue}>{formatNumber(s.weightPct, 1)}%</Figure>
                        </LedgerRow>
                      ))}
                    </Ledger>
                  ) : null}
                </View>
              ) : null}

              {data?.source ? (
                <Text style={styles.source}>
                  {data.source.label}
                  {data.source.status !== "complete" ? `. ${data.source.detail}` : ""}
                </Text>
              ) : null}
            </>
          )}
        </Band>
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.surfacePage },
  header: { paddingHorizontal: layout.gutter, paddingBottom: space.sm },
  back: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 36, marginLeft: -4 },
  backLabel: { fontFamily: fontFamily.uiMedium, fontSize: fontSize.sm, color: c.textMuted },
  title: { marginTop: space.xs },
  headLabel: { marginTop: space.xl },
  headValue: {
    marginTop: space.xs,
    fontFamily: fontFamily.monoSemibold,
    fontSize: 38,
    letterSpacing: letterSpacing(38, tracking.editorial),
    color: c.textStrong,
  },
  headDetail: { marginTop: space.xs, fontFamily: fontFamily.ui, fontSize: fontSize.sm, color: c.textMuted, lineHeight: 19 },
  chartBand: { paddingBottom: 0 },
  blockHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: space.md,
  },
  benchmarkNote: { marginTop: space.md, fontSize: fontSize.xxs, lineHeight: 17, color: c.textFaint },
  note: { fontSize: fontSize.xxs, color: c.textFaint },
  statGrid: { flexDirection: "row", flexWrap: "wrap" },
  stat: {
    flexBasis: "50%",
    paddingVertical: space.md,
    paddingRight: space.md,
    gap: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.rule,
  },
  statValue: { fontFamily: fontFamily.monoSemibold, fontSize: fontSize.h2, color: c.textStrong },
  statDetail: { fontFamily: fontFamily.ui, fontSize: fontSize.xxs, color: c.textFaint },
  block: { marginTop: space.xl },
  totalRow: { borderBottomWidth: 0 },
  rowLabel: { flex: 1, fontFamily: fontFamily.ui, fontSize: fontSize.sm, color: c.textBody },
  rowLabelStrong: { fontFamily: fontFamily.uiSemibold, color: c.textStrong },
  rowValue: { fontFamily: fontFamily.mono, fontSize: fontSize.sm, color: c.textBody },
  rowValueStrong: { fontFamily: fontFamily.monoSemibold, color: c.textStrong },
  dot: { width: 8, height: 8, marginRight: space.sm + 1 },
  source: { marginTop: space.xl, fontFamily: fontFamily.ui, fontSize: fontSize.xxs, color: c.textFaint, lineHeight: 17 },
  empty: { fontFamily: fontFamily.ui, fontSize: fontSize.sm, color: c.textMuted, lineHeight: 20 },
}));
