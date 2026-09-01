import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Plus, Search } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import type { HoldingRow, HoldingsResponse } from "@psx/shared/api/holdings";
import {
  formatCompact,
  formatCompactSigned,
  formatNumber,
  formatPctSigned,
} from "@psx/shared/format";
import { useApi } from "@/lib/use-api";
import { Band, Ledger, LedgerRow } from "@/components/ui/layout";
import { Caps, Figure, PageTitle } from "@/components/ui/text";
import { ErrorNote } from "@/components/status";
import { Rise } from "@/components/ui/motion";
import { ScreenSkeleton } from "@/components/skeleton";
import { TransactionSheet } from "@/components/features/transaction-sheet";
import { makeStyles, useColors } from "@/lib/theme-context";
import {
  colors,
  directionColor,
  fontFamily,
  fontSize,
  layout,
  space,
} from "@/lib/theme";

const ALL = "All";

function HeaderStat({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.stat}>
      <Caps>{label}</Caps>
      <Figure style={[styles.statValue, tone ? { color: tone } : null]}>{value}</Figure>
      <Text style={styles.statDetail}>{detail}</Text>
    </View>
  );
}

/**
 * One position over three lines: who and what it is worth, then what it cost
 * against what it is now, then its share of the book.
 *
 * A table would need horizontal scrolling to carry the same six figures, and a
 * column you have to swipe to is a column nobody reads.
 */
function Position({ row, largest }: { row: HoldingRow; largest: number }) {
  const styles = useStyles();
  const router = useRouter();
  const priced = row.marketValue !== null;
  const value = row.marketValue ?? row.totalCost ?? 0;
  const share = largest > 0 ? Math.min(1, value / largest) : 0;

  return (
    <Pressable
      style={styles.position}
      onPress={() => {
        void Haptics.selectionAsync();
        router.push({ pathname: "/company/[ticker]", params: { ticker: row.ticker } });
      }}
      accessibilityRole="button"
    >
      <View style={styles.line}>
        <View style={styles.identity}>
          <View style={[styles.dot, { backgroundColor: row.color }]} />
          <Text style={styles.ticker}>{row.ticker}</Text>
          <Text style={styles.company} numberOfLines={1}>
            {row.companyName ?? ""}
          </Text>
        </View>
        <Figure style={styles.value}>{formatCompact(value)}</Figure>
      </View>

      <View style={styles.lineTight}>
        <Figure style={styles.basis} numberOfLines={1}>
          {formatNumber(row.quantity, 0)} at {formatNumber(row.avgCost, 2)}
          {priced ? ` · now ${formatNumber(row.latestPrice, 2)}` : " · awaiting price"}
        </Figure>
        {priced ? (
          <Figure style={[styles.gain, { color: directionColor(row.unrealizedPl) }]}>
            {formatCompactSigned(row.unrealizedPl)} · {formatPctSigned(row.unrealizedPlPct)}
          </Figure>
        ) : (
          <Figure style={styles.atCost}>at cost</Figure>
        )}
      </View>

      <View style={styles.weightRow}>
        <View style={styles.weightTrack}>
          <View style={[styles.weightFill, { width: `${share * 100}%`, backgroundColor: row.color }]} />
        </View>
        <Figure style={styles.weight}>{row.weight !== null ? `${row.weight.toFixed(1)}%` : "—"}</Figure>
      </View>
    </Pressable>
  );
}

export default function HoldingsScreen() {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const [filter, setFilter] = useState<string>(ALL);
  const [adding, setAdding] = useState(false);
  const { data, error, loading, refreshing, refresh } = useApi<HoldingsResponse>(
    "/api/portfolio/holdings",
    "Could not load your positions."
  );

  const rows = useMemo(() => {
    if (!data) return [];
    if (filter === ALL) return data.rows;
    return data.rows.filter((row) => (row.sector ?? "Unclassified") === filter);
  }, [data, filter]);

  const largest = useMemo(
    () => Math.max(...rows.map((row) => row.marketValue ?? row.totalCost ?? 0), 0),
    [rows]
  );

  if (loading) return <ScreenSkeleton dark={false} metrics={4} rows={6} />;

  return (
    <View style={styles.screen}>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.textMuted} />
        }
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[1]}
      >
        <SafeAreaView edges={["top"]} style={styles.header}>
          <View style={styles.titleRow}>
            <PageTitle>Holdings</PageTitle>
            <View style={styles.titleActions}>
              <Pressable
                onPress={() => router.push("/research")}
                hitSlop={12}
                accessibilityLabel="Stock research"
                accessibilityRole="button"
              >
                <Search size={19} color={colors.textMuted} />
              </Pressable>
              <Pressable
                onPress={() => {
                  void Haptics.selectionAsync();
                  setAdding(true);
                }}
                hitSlop={12}
                accessibilityLabel="Add transaction"
                accessibilityRole="button"
                style={styles.addButton}
              >
                <Plus size={18} color={colors.textOnDark} />
              </Pressable>
            </View>
          </View>

          <View style={styles.statGrid}>
            <HeaderStat
              label={data?.pricedCount === 0 ? "At cost" : "Market value"}
              value={formatCompact(data?.totalValue ?? 0)}
              detail="PKR"
            />
            <HeaderStat
              label="Unrealised"
              value={data?.pricedCount === 0 ? "—" : formatCompactSigned(data?.unrealizedPl ?? 0)}
              detail={
                data?.pricedCount === 0
                  ? "awaiting prices"
                  : `${formatPctSigned(data?.unrealizedPlPct)} on cost`
              }
              tone={data?.pricedCount === 0 ? undefined : directionColor(data?.unrealizedPl)}
            />
            <HeaderStat
              label="Today"
              value={formatCompactSigned(data?.totalDayPnl)}
              detail={formatPctSigned(data?.dayChangePct, 2)}
              tone={directionColor(data?.totalDayPnl)}
            />
            <HeaderStat
              label="Below cost"
              value={data?.belowCostCount === null ? "—" : String(data?.belowCostCount ?? 0)}
              detail={`of ${data?.count ?? 0} holdings`}
            />
          </View>
        </SafeAreaView>

        {/* Sector filters, built from what the book holds rather than the whole
            PSX taxonomy. Sticky so it stays reachable down a long list. */}
        <View style={styles.railWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
            <Chip
              label={ALL}
              count={data?.count ?? 0}
              color={colors.textMuted}
              active={filter === ALL}
              onPress={() => setFilter(ALL)}
            />
            {(data?.sectorFilters ?? []).map((s) => (
              <Chip
                key={s.sector}
                label={s.label}
                count={s.count}
                color={s.color}
                active={filter === s.sector}
                onPress={() => setFilter(s.sector)}
              />
            ))}
          </ScrollView>
        </View>

        <Band style={styles.list}>
          <ErrorNote message={error} />
          {rows.length === 0 ? (
            <Text style={styles.empty}>
              {error
                ? ""
                : filter === ALL
                  ? "No open positions yet. Import a statement on the web to get started."
                  : "Nothing held in that sector."}
            </Text>
          ) : (
            <Ledger>
              {rows.map((row, i) => (
                <Rise key={row.ticker} index={i}>
                  <Position row={row} largest={largest} />
                </Rise>
              ))}
            </Ledger>
          )}
        </Band>

        {/* Sold out of, but not forgotten. A track record is the point of the
            app, so closing a position must not erase that it was held. */}
        {data?.closed && data.closed.length > 0 ? (
          <Band>
            <Caps>Previously held</Caps>
            <Ledger>
              {data.closed.map((c) => (
                <LedgerRow key={c.ticker}>
                  <View style={styles.closedRow}>
                    <View style={styles.closedLeft}>
                      <Text style={styles.closedTicker}>{c.ticker}</Text>
                      <Figure style={styles.closedMeta} numberOfLines={1}>
                        {formatNumber(c.sold, 0)} shares
                        {c.heldDays != null
                          ? ` · ${c.heldDays < 365 ? `${c.heldDays}d` : `${(c.heldDays / 365).toFixed(1)}y`}`
                          : ""}
                        {c.lastSell ? ` · sold ${c.lastSell}` : ""}
                      </Figure>
                    </View>
                    <View style={styles.closedRight}>
                      <Figure style={[styles.closedPl, { color: directionColor(c.realizedPl) }]}>
                        {c.realizedPl >= 0 ? "+" : "−"}{formatCompact(Math.abs(c.realizedPl))}
                      </Figure>
                      {c.realizedPct != null ? (
                        <Figure style={styles.closedPct}>
                          {c.realizedPct >= 0 ? "+" : "−"}{Math.abs(c.realizedPct).toFixed(1)}%
                        </Figure>
                      ) : null}
                    </View>
                  </View>
                </LedgerRow>
              ))}
            </Ledger>
          </Band>
        ) : null}
      </ScrollView>

      {/* Refetching on save is what makes the new row appear without a manual
          pull, and the position totals above it agree with the list. */}
      <TransactionSheet open={adding} onClose={() => setAdding(false)} onSaved={refresh} />
    </View>
  );
}

function Chip({
  label,
  count,
  color,
  active,
  onPress,
}: {
  label: string;
  count: number;
  color: string;
  active: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      style={styles.chip}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <View style={[styles.chipDot, { backgroundColor: color }]} />
      <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{label}</Text>
      <Figure style={styles.chipCount}>{count}</Figure>
      {active ? <View style={styles.chipUnderline} /> : null}
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  closedRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flex: 1, gap: space.sm },
  closedLeft: { flex: 1, minWidth: 0 },
  closedTicker: { fontFamily: fontFamily.uiSemibold, fontSize: fontSize.body, color: c.textStrong },
  closedMeta: { marginTop: 2, fontSize: fontSize.xxs, color: c.textFaint },
  closedRight: { alignItems: "flex-end" },
  closedPl: { fontSize: fontSize.body, fontWeight: "600" },
  closedPct: { marginTop: 2, fontSize: fontSize.xxs, color: c.textFaint },
  screen: { flex: 1, backgroundColor: c.surfacePage },
  header: { paddingHorizontal: layout.gutter, paddingBottom: space.lg },
  titleActions: { flexDirection: "row", alignItems: "center", gap: space.lg },
  addButton: {
    width: 34,
    height: 34,
    borderRadius: layout.radiusPill,
    backgroundColor: c.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: layout.hitMin,
  },
  statGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: space.md },
  stat: { flexBasis: "50%", paddingVertical: space.sm, paddingRight: space.md, gap: 2 },
  statValue: { fontFamily: fontFamily.monoSemibold, fontSize: fontSize.h2, color: c.textStrong },
  statDetail: { fontFamily: fontFamily.ui, fontSize: fontSize.xxs, color: c.textFaint },
  railWrap: {
    backgroundColor: c.surfacePage,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.rule,
  },
  rail: { flexDirection: "row", gap: space.lg + 2, paddingHorizontal: layout.gutter, paddingVertical: space.md },
  chip: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 28 },
  chipDot: { width: 8, height: 8 },
  chipLabel: { fontFamily: fontFamily.uiMedium, fontSize: fontSize.sm, color: c.textMuted },
  chipLabelActive: { fontFamily: fontFamily.uiBold, color: c.textStrong },
  chipCount: { fontSize: fontSize.xxs, color: c.textFaint },
  chipUnderline: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: -space.md + 2,
    height: 2,
    backgroundColor: c.textStrong,
  },
  list: { paddingTop: space.xs },
  position: {
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.rule,
  },
  line: { flexDirection: "row", alignItems: "baseline", gap: space.md },
  lineTight: { flexDirection: "row", alignItems: "baseline", gap: space.md, marginTop: space.xs },
  identity: { flex: 1, flexDirection: "row", alignItems: "center", gap: space.sm + 1 },
  dot: { width: 8, height: 8 },
  ticker: { fontFamily: fontFamily.uiSemibold, fontSize: fontSize.body, color: c.textStrong },
  company: { flex: 1, fontFamily: fontFamily.ui, fontSize: fontSize.xxs, color: c.textFaint },
  value: { fontFamily: fontFamily.monoSemibold, fontSize: fontSize.body },
  basis: { flex: 1, fontSize: fontSize.xxs, color: c.textFaint },
  gain: { fontFamily: fontFamily.monoSemibold, fontSize: fontSize.sm },
  atCost: { fontSize: fontSize.xxs, color: c.textFaint },
  weightRow: { flexDirection: "row", alignItems: "center", gap: space.sm + 1, marginTop: space.sm + 1 },
  weightTrack: { flex: 1, height: 4, backgroundColor: c.surfaceInset },
  weightFill: { height: 4 },
  weight: { width: 44, textAlign: "right", fontSize: fontSize.xxs, color: c.textFaint },
  empty: { fontFamily: fontFamily.ui, fontSize: fontSize.sm, color: c.textMuted, lineHeight: 20 },
}));
