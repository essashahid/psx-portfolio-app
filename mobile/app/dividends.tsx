import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useState } from "react";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { ChevronLeft, Plus } from "lucide-react-native";
import type { DividendRow, DividendsResponse } from "@psx/shared/api/dividends";
import { formatCompact, formatNumber, formatPkr } from "@psx/shared/format";
import { useApi } from "@/lib/use-api";
import { Band, Ledger, LedgerRow } from "@/components/ui/layout";
import { Caps, Figure, PageTitle } from "@/components/ui/text";
import { ErrorNote } from "@/components/status";
import { Rise } from "@/components/ui/motion";
import { PageSkeleton } from "@/components/skeleton";
import { DividendSheet, type DividendDraft } from "@/components/features/dividend-sheet";
import { Cta } from "@/components/ui/button";
import {
  colors,
  fontFamily,
  fontSize,
  layout,
  letterSpacing,
  palette,
  space,
  tracking,
} from "@/lib/theme";

function Payment({ row, onEdit }: { row: DividendRow; onEdit: (row: DividendRow) => void }) {
  return (
    <LedgerRow onPress={() => onEdit(row)} accessibilityLabel={`Edit ${row.ticker ?? "dividend"}`}>
      <View style={styles.paymentLeft}>
        <Text style={styles.ticker}>{row.ticker ?? "—"}</Text>
        <Figure style={styles.meta} numberOfLines={1}>
          {row.payDate ?? "date unknown"}
          {row.perShare !== null ? ` · ${formatNumber(row.perShare, 2)} per share` : ""}
        </Figure>
      </View>
      <View style={styles.paymentRight}>
        <Figure style={styles.amount}>{formatNumber(row.netAmount ?? row.amount, 0)}</Figure>
        {row.tax ? <Figure style={styles.meta}>{formatNumber(row.tax, 0)} tax</Figure> : null}
      </View>
    </LedgerRow>
  );
}

/**
 * The rate actually withheld, measured from the payments themselves. The
 * configured rate is what he expects to be charged and defaults to zero on a
 * new account, so printing it beside a real tax figure would be wrong.
 */
function withheldNote(data: DividendsResponse): string | null {
  const gross = data.byTaxYear.reduce((sum, y) => sum + y.gross, 0);
  const tax = data.byTaxYear.reduce((sum, y) => sum + y.tax, 0);
  if (gross > 0 && tax > 0) return `${formatNumber((tax / gross) * 100, 1)}% withheld`;
  if (gross > 0) return "no tax withheld";
  return data.taxRatePct ? `${formatNumber(data.taxRatePct, 0)}% expected` : null;
}

export default function DividendsScreen() {
  const router = useRouter();
  const [editing, setEditing] = useState<DividendDraft | undefined>(undefined);
  const [sheetOpen, setSheetOpen] = useState(false);

  function openSheet(draft?: DividendDraft) {
    void Haptics.selectionAsync();
    setEditing(draft);
    setSheetOpen(true);
  }

  function editRow(row: DividendRow) {
    openSheet({
      id: row.id,
      ticker: row.ticker ?? "",
      payment_date: row.payDate,
      ex_date: row.exDate,
      dividend_per_share: row.perShare,
      quantity_held: row.quantityHeld,
      amount: row.amount,
      tax: row.tax,
      status: row.status,
    });
  }

  const { data, error, loading, refreshing, refresh } = useApi<DividendsResponse>(
    "/api/portfolio/dividends",
    "Could not load dividends."
  );

  if (loading) return <PageSkeleton rows={6} />;

  const years = data?.byTaxYear ?? [];
  const peak = Math.max(...years.map((y) => y.net), 1);

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.textMuted} />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headRow}>
            <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back} accessibilityRole="button">
              <ChevronLeft size={20} color={colors.textMuted} />
              <Text style={styles.backLabel}>Back</Text>
            </Pressable>
            <Pressable
              onPress={() => openSheet(undefined)}
              hitSlop={12}
              style={styles.addButton}
              accessibilityRole="button"
              accessibilityLabel="Record dividend"
            >
              <Plus size={18} color={colors.textOnDark} />
            </Pressable>
          </View>
          <PageTitle style={styles.title}>Dividends</PageTitle>

          <Caps style={styles.totalLabel}>Received after tax</Caps>
          <Text style={styles.total}>
            <Text style={styles.totalUnit}>PKR </Text>
            <Text style={styles.totalFigure}>{formatNumber(data?.receivedNetTotal ?? 0, 0)}</Text>
          </Text>
          {data && data.upcomingTotal > 0 ? (
            <Figure style={styles.expected}>
              {formatPkr(data.upcomingTotal, 0)} announced and not yet paid
            </Figure>
          ) : null}
        </View>

        <Band>
          <ErrorNote message={error} />
          {!data || data.count === 0 ? (
            error ? null : (
              <View style={styles.emptyBlock}>
                <Text style={styles.empty}>
                  No dividends recorded yet. They appear once a payout is detected or imported, and
                  you can enter one yourself from a broker note.
                </Text>
                <Cta label="Record a dividend" onPress={() => openSheet(undefined)} />
              </View>
            )
          ) : (
            <>
              {years.length > 0 ? (
                <View style={styles.block}>
                  <View style={styles.blockHead}>
                    <Caps>By tax year</Caps>
                    <Figure style={styles.note}>{withheldNote(data)}</Figure>
                  </View>
                  {/* Tax years read down the page as bars, so the trend is
                      visible without a chart that repeats the same figures. */}
                  {years.map((y) => (
                    <View key={y.taxYear} style={styles.yearRow}>
                      <View style={styles.yearHead}>
                        <Text style={styles.yearLabel}>{y.taxYear}</Text>
                        <Figure style={styles.yearNet}>{formatCompact(y.net)}</Figure>
                      </View>
                      <View style={styles.yearTrack}>
                        <View style={[styles.yearFill, { width: `${(y.net / peak) * 100}%` }]} />
                      </View>
                      <Figure style={styles.yearMeta}>
                        {y.count} payment{y.count === 1 ? "" : "s"}
                        {y.tax > 0 ? ` · ${formatCompact(y.tax)} tax` : ""}
                      </Figure>
                    </View>
                  ))}
                </View>
              ) : null}

              {data.upcoming.length > 0 ? (
                <View style={styles.block}>
                  <Caps style={styles.blockHead}>Expected</Caps>
                  <Ledger>
                    {data.upcoming.slice(0, 10).map((row) => (
                      <Payment key={row.id} row={row} onEdit={editRow} />
                    ))}
                  </Ledger>
                </View>
              ) : null}

              {/* Yield on cost is the number that matters once a position is
                  old: a stock bought at 150 that now pays 12 yields 8% to you
                  whatever the screen says today. */}
              {data.yieldOnCost.length > 0 ? (
                <View style={styles.block}>
                  <View style={styles.blockHead}>
                    <Caps>Yield on cost</Caps>
                    <Figure style={styles.note}>last twelve months</Figure>
                  </View>
                  <Ledger>
                    {data.yieldOnCost.map((row, i) => (
                      <Rise key={row.ticker} index={i}>
                        <LedgerRow>
                          <View style={styles.yieldLeft}>
                            <Text style={styles.ticker}>{row.ticker}</Text>
                            <Figure style={styles.meta} numberOfLines={1}>
                              {formatNumber(row.ttmNet, 0)} on {formatCompact(row.cost)}
                            </Figure>
                          </View>
                          <View style={styles.yieldRight}>
                            <Figure style={styles.yieldValue}>
                              {/* toFixed, not formatNumber: this is a column
                                  of figures and a trimmed "7.7" breaks the
                                  decimal alignment against "12.51". */}
                              {row.yieldOnCost !== null ? `${row.yieldOnCost.toFixed(2)}%` : "—"}
                            </Figure>
                            <Figure style={styles.meta}>
                              {row.yieldOnValue !== null
                                ? `${row.yieldOnValue.toFixed(2)}% today`
                                : ""}
                            </Figure>
                          </View>
                        </LedgerRow>
                      </Rise>
                    ))}
                  </Ledger>
                </View>
              ) : null}

              {data.recent.length > 0 ? (
                <View style={styles.block}>
                  <Caps style={styles.blockHead}>Recent payments</Caps>
                  <Ledger>
                    {data.recent.slice(0, 25).map((row, i) => (
                      <Rise key={row.id} index={i}>
                        <Payment row={row} onEdit={editRow} />
                      </Rise>
                    ))}
                  </Ledger>
                </View>
              ) : null}
            </>
          )}
        </Band>
      </ScrollView>

      <DividendSheet
        open={sheetOpen}
        initial={editing}
        onClose={() => setSheetOpen(false)}
        onSaved={refresh}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfacePage },
  header: { paddingHorizontal: layout.gutter, paddingBottom: space.sm },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  addButton: {
    width: 34,
    height: 34,
    borderRadius: layout.radiusPill,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyBlock: { gap: space.lg, alignItems: "flex-start" },
  back: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 36, marginLeft: -4 },
  backLabel: { fontFamily: fontFamily.uiMedium, fontSize: fontSize.sm, color: colors.textMuted },
  title: { marginTop: space.xs },
  totalLabel: { marginTop: space.xl },
  total: { marginTop: space.xs },
  totalUnit: { fontFamily: fontFamily.display, fontSize: 16, color: colors.textMuted },
  totalFigure: {
    fontFamily: fontFamily.monoSemibold,
    fontSize: 34,
    letterSpacing: letterSpacing(34, tracking.editorial),
    color: colors.textStrong,
  },
  expected: { marginTop: space.sm, fontSize: fontSize.xxs, color: colors.textFaint },
  block: { marginBottom: space.xl },
  blockHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: space.md,
  },
  note: { fontSize: fontSize.xxs, color: colors.textFaint },
  yearRow: {
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.rule,
    gap: space.sm,
  },
  yearHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  yearLabel: { fontFamily: fontFamily.uiSemibold, fontSize: fontSize.body, color: colors.textStrong },
  yearNet: { fontFamily: fontFamily.monoSemibold, fontSize: fontSize.body },
  yearTrack: { height: 6, backgroundColor: colors.surfaceInset },
  yearFill: { height: 6, backgroundColor: palette.up2 },
  yearMeta: { fontSize: fontSize.xxs, color: colors.textFaint },
  yieldLeft: { flex: 1, gap: 1 },
  yieldRight: { alignItems: "flex-end", gap: 1 },
  yieldValue: { fontFamily: fontFamily.monoSemibold, fontSize: fontSize.body, color: colors.textStrong },
  paymentLeft: { flex: 1, gap: 1 },
  paymentRight: { alignItems: "flex-end", gap: 1 },
  ticker: { fontFamily: fontFamily.uiSemibold, fontSize: fontSize.sm, color: colors.textStrong },
  amount: { fontFamily: fontFamily.monoSemibold, fontSize: fontSize.sm },
  meta: { fontSize: fontSize.xxs, color: colors.textFaint },
  empty: { fontFamily: fontFamily.ui, fontSize: fontSize.sm, color: colors.textMuted, lineHeight: 20 },
});
