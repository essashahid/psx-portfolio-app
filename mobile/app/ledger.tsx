import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { ChevronLeft, Plus } from "lucide-react-native";
import type { LedgerEntry, LedgerResponse } from "@psx/shared/api/ledger";
import { formatNumber } from "@psx/shared/format";
import { useApi } from "@/lib/use-api";
import { Band, Ledger, LedgerRow } from "@/components/ui/layout";
import { Caps, Figure, PageTitle } from "@/components/ui/text";
import { ErrorNote } from "@/components/status";
import { Rise } from "@/components/ui/motion";
import { PageSkeleton } from "@/components/skeleton";
import { Cta } from "@/components/ui/button";
import { TransactionSheet, type TransactionDraft } from "@/components/features/transaction-sheet";
import { CashSheet, type CashDraft } from "@/components/features/cash-sheet";
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

const FILTERS = ["All", "Trades", "Cash"] as const;
type Filter = (typeof FILTERS)[number];

/** Groups entries under their month, so a long statement stays scannable. */
function monthOf(date: string | null): string {
  if (!date) return "Undated";
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "Undated";
  return d.toLocaleDateString("en-PK", { month: "long", year: "numeric" });
}

function Entry({ entry, onPress }: { entry: LedgerEntry; onPress: () => void }) {
  const isCredit = entry.credit > 0;
  const amount = isCredit ? entry.credit : entry.debit;
  return (
    <LedgerRow onPress={onPress} accessibilityLabel={`Edit ${entry.narration}`}>
      <View style={styles.entryLeft}>
        <Text style={styles.narration} numberOfLines={1}>
          {entry.narration}
        </Text>
        <Figure style={styles.meta}>
          {entry.date ?? "date unknown"} · balance {formatNumber(entry.balance, 0)}
        </Figure>
      </View>
      <Figure
        style={[
          styles.amount,
          amount === 0
            ? styles.amountFlat
            : isCredit
              ? styles.amountCredit
              : styles.amountDebit,
        ]}
      >
        {amount === 0 ? "—" : `${isCredit ? "+" : "−"}${formatNumber(amount, 0)}`}
      </Figure>
    </LedgerRow>
  );
}

export default function LedgerScreen() {
  const router = useRouter();
  const { data, error, loading, refreshing, refresh } = useApi<LedgerResponse>(
    "/api/portfolio/ledger",
    "Could not load the ledger."
  );
  const [filter, setFilter] = useState<Filter>("All");
  const [txnDraft, setTxnDraft] = useState<TransactionDraft | undefined>();
  const [txnOpen, setTxnOpen] = useState(false);
  const [cashDraft, setCashDraft] = useState<CashDraft | undefined>();
  const [cashOpen, setCashOpen] = useState(false);

  const entries = useMemo(() => {
    const all = data?.entries ?? [];
    if (filter === "Trades") return all.filter((e) => e.refType === "transaction");
    if (filter === "Cash") return all.filter((e) => e.refType === "cash_movement");
    return all;
  }, [data, filter]);

  // Grouped in render order, so month headings appear exactly once each.
  const groups = useMemo(() => {
    const out: { month: string; rows: LedgerEntry[] }[] = [];
    for (const entry of entries) {
      const month = monthOf(entry.date);
      const last = out[out.length - 1];
      if (last && last.month === month) last.rows.push(entry);
      else out.push({ month, rows: [entry] });
    }
    return out;
  }, [entries]);

  function openEntry(entry: LedgerEntry) {
    void Haptics.selectionAsync();
    if (entry.refType === "transaction") {
      const t = data?.transactions.find((row) => row.id === entry.id);
      if (!t) return;
      setTxnDraft({
        id: t.id,
        ticker: t.ticker ?? "",
        trade_date: t.trade_date ?? undefined,
        type: t.type as TransactionDraft["type"],
        quantity: t.quantity,
        price: t.price,
        commission: t.commission,
        notes: t.notes,
      });
      setTxnOpen(true);
      return;
    }
    const c = data?.cashMovements.find((row) => row.id === entry.id);
    if (!c) return;
    setCashDraft({
      id: c.id,
      movement_date: c.movement_date ?? undefined,
      type: c.type as CashDraft["type"],
      amount: c.amount,
      description: c.description,
    });
    setCashOpen(true);
  }

  function addTransaction() {
    void Haptics.selectionAsync();
    setTxnDraft(undefined);
    setTxnOpen(true);
  }

  function addCash() {
    void Haptics.selectionAsync();
    setCashDraft(undefined);
    setCashOpen(true);
  }

  if (loading) return <PageSkeleton rows={7} />;

  const empty = !data || data.count === 0;

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
              onPress={addTransaction}
              hitSlop={12}
              style={styles.addButton}
              accessibilityRole="button"
              accessibilityLabel="Add transaction"
            >
              <Plus size={18} color={colors.textOnDark} />
            </Pressable>
          </View>
          <PageTitle style={styles.title}>Ledger</PageTitle>

          <Caps style={styles.totalLabel}>Cash on hand</Caps>
          <Text style={styles.total}>
            <Text style={styles.totalUnit}>PKR </Text>
            <Text style={styles.totalFigure}>{formatNumber(data?.closingBalance ?? 0, 0)}</Text>
          </Text>
          <Figure style={styles.subtitle}>
            {data?.count ?? 0} entr{data?.count === 1 ? "y" : "ies"}, deposits and sales in, buys and
            charges out.
          </Figure>
        </View>

        <Band>
          <ErrorNote message={error} />

          {empty ? (
            error ? null : (
              <View style={styles.emptyBlock}>
                <Text style={styles.empty}>
                  Nothing in the ledger yet. Add a trade or a deposit here, or import a broker
                  statement on the web app to load your history at once.
                </Text>
                <Cta label="Add a transaction" onPress={addTransaction} />
                <Pressable onPress={addCash} accessibilityRole="button" hitSlop={8}>
                  <Text style={styles.link}>Add a cash movement instead</Text>
                </Pressable>
              </View>
            )
          ) : (
            <>
              <View style={styles.filters}>
                {FILTERS.map((option) => {
                  const on = option === filter;
                  return (
                    <Pressable
                      key={option}
                      onPress={() => {
                        void Haptics.selectionAsync();
                        setFilter(option);
                      }}
                      style={[styles.filter, on && styles.filterOn]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={[styles.filterLabel, on && styles.filterLabelOn]}>{option}</Text>
                    </Pressable>
                  );
                })}
                <View style={styles.filterSpacer} />
                <Pressable onPress={addCash} accessibilityRole="button" hitSlop={8}>
                  <Text style={styles.link}>Add cash</Text>
                </Pressable>
              </View>

              {groups.length === 0 ? (
                <Text style={styles.empty}>Nothing under this filter.</Text>
              ) : (
                groups.map((group) => (
                  <View key={group.month} style={styles.block}>
                    <Caps style={styles.blockHead}>{group.month}</Caps>
                    <Ledger>
                      {group.rows.map((entry, i) => (
                        <Rise key={`${entry.refType}:${entry.id}`} index={i}>
                          <Entry entry={entry} onPress={() => openEntry(entry)} />
                        </Rise>
                      ))}
                    </Ledger>
                  </View>
                ))
              )}
            </>
          )}
        </Band>
      </ScrollView>

      <TransactionSheet
        open={txnOpen}
        initial={txnDraft}
        onClose={() => setTxnOpen(false)}
        onSaved={refresh}
      />
      <CashSheet
        open={cashOpen}
        initial={cashDraft}
        onClose={() => setCashOpen(false)}
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
  subtitle: { marginTop: space.sm, fontSize: fontSize.xxs, color: colors.textFaint, lineHeight: 16 },
  filters: { flexDirection: "row", alignItems: "center", gap: space.xs, marginBottom: space.lg },
  filterSpacer: { flex: 1 },
  filter: {
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: layout.radiusPill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
  },
  filterOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  filterLabel: { fontFamily: fontFamily.uiMedium, fontSize: fontSize.xxs, color: colors.textMuted },
  filterLabelOn: { color: colors.textOnDark },
  link: { fontFamily: fontFamily.uiMedium, fontSize: fontSize.xxs, color: colors.textMuted },
  block: { marginBottom: space.xl },
  blockHead: { marginBottom: space.md },
  entryLeft: { flex: 1, gap: 1, paddingRight: space.md },
  narration: { fontFamily: fontFamily.uiSemibold, fontSize: fontSize.sm, color: colors.textStrong },
  meta: { fontSize: fontSize.xxs, color: colors.textFaint },
  amount: { fontFamily: fontFamily.monoSemibold, fontSize: fontSize.sm },
  amountCredit: { color: palette.up2 },
  amountDebit: { color: colors.textStrong },
  amountFlat: { color: colors.textFaint },
  emptyBlock: { gap: space.lg, alignItems: "flex-start" },
  empty: { fontFamily: fontFamily.ui, fontSize: fontSize.sm, color: colors.textMuted, lineHeight: 20 },
});
