import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import type { PerformanceResponse } from "@psx/shared/api/performance";
import { formatCompact, formatCompactSigned, formatNumber, formatPctSigned } from "@psx/shared/format";
import { sectorColor, shortSector } from "@psx/shared/sector-colors";
import { useApi } from "@/lib/use-api";
import { AreaChart } from "@/components/charts/area-chart";
import { Band, Ledger, LedgerRow } from "@/components/ui/layout";
import { Caps, Figure, PageTitle } from "@/components/ui/text";
import { Loading, ErrorNote } from "@/components/status";
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
  return (
    <View style={styles.stat}>
      <Caps>{label}</Caps>
      <Figure style={[styles.statValue, tone ? { color: tone } : null]}>{value}</Figure>
      {detail ? <Text style={styles.statDetail}>{detail}</Text> : null}
    </View>
  );
}

export default function PerformanceScreen() {
  const router = useRouter();
  const { data, error, loading, refreshing, refresh } = useApi<PerformanceResponse>(
    "/api/portfolio/performance",
    "Could not load performance."
  );

  if (loading) return <Loading />;

  const r = data?.returns;
  const f = data?.friction;
  const c = data?.concentration;
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfacePage },
  header: { paddingHorizontal: layout.gutter, paddingBottom: space.sm },
  back: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 36, marginLeft: -4 },
  backLabel: { fontFamily: fontFamily.uiMedium, fontSize: fontSize.sm, color: colors.textMuted },
  title: { marginTop: space.xs },
  headLabel: { marginTop: space.xl },
  headValue: {
    marginTop: space.xs,
    fontFamily: fontFamily.monoSemibold,
    fontSize: 38,
    letterSpacing: letterSpacing(38, tracking.editorial),
    color: colors.textStrong,
  },
  headDetail: { marginTop: space.xs, fontFamily: fontFamily.ui, fontSize: fontSize.sm, color: colors.textMuted, lineHeight: 19 },
  chartBand: { paddingBottom: 0 },
  blockHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: space.md,
  },
  note: { fontSize: fontSize.xxs, color: colors.textFaint },
  statGrid: { flexDirection: "row", flexWrap: "wrap" },
  stat: {
    flexBasis: "50%",
    paddingVertical: space.md,
    paddingRight: space.md,
    gap: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.rule,
  },
  statValue: { fontFamily: fontFamily.monoSemibold, fontSize: fontSize.h2, color: colors.textStrong },
  statDetail: { fontFamily: fontFamily.ui, fontSize: fontSize.xxs, color: colors.textFaint },
  block: { marginTop: space.xl },
  totalRow: { borderBottomWidth: 0 },
  rowLabel: { flex: 1, fontFamily: fontFamily.ui, fontSize: fontSize.sm, color: colors.textBody },
  rowLabelStrong: { fontFamily: fontFamily.uiSemibold, color: colors.textStrong },
  rowValue: { fontFamily: fontFamily.mono, fontSize: fontSize.sm, color: colors.textBody },
  rowValueStrong: { fontFamily: fontFamily.monoSemibold, color: colors.textStrong },
  dot: { width: 8, height: 8, marginRight: space.sm + 1 },
  source: { marginTop: space.xl, fontFamily: fontFamily.ui, fontSize: fontSize.xxs, color: colors.textFaint, lineHeight: 17 },
  empty: { fontFamily: fontFamily.ui, fontSize: fontSize.sm, color: colors.textMuted, lineHeight: 20 },
});
