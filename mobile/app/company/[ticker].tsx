import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, MessageSquare } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import type { CompanyResponse } from "@psx/shared/api/stocks";
import { formatCompact, formatNumber, formatPctSigned } from "@psx/shared/format";
import { sectorColor, shortSector } from "@psx/shared/sector-colors";
import { useApi } from "@/lib/use-api";
import { Segmented } from "@/components/segmented";
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
  const router = useRouter();
  const { ticker } = useLocalSearchParams<{ ticker: string }>();
  const [tab, setTab] = useState<Tab>("Overview");
  const symbol = (ticker ?? "").toUpperCase();

  const { data, error, loading, refreshing, refresh } = useApi<CompanyResponse>(
    `/api/stocks/${encodeURIComponent(symbol)}`,
    "Could not load this company."
  );

  const headline = useMemo(() => {
    if (!data) return [];
    const by = new Map(data.ratios.map((r) => [r.name, r]));
    return HEADLINE.map((name) => ({ name, row: by.get(name) })).filter((entry) => entry.row);
  }, [data]);

  if (loading) return <Loading />;

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
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.textMuted} />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headerBar}>
            <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back} accessibilityRole="button">
              <ChevronLeft size={20} color={colors.textMuted} />
              <Text style={styles.backLabel}>Back</Text>
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
            headline.length === 0 ? (
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
            )
          ) : null}

          {tab === "Fundamentals" ? (
            data && data.ratios.length > 0 ? (
              <Ledger>
                {data.ratios.map((row, i) => (
                  <LedgerRow key={`${row.name}-${i}`}>
                    <Text style={styles.ratioName} numberOfLines={1}>
                      {row.name}
                    </Text>
                    <Figure style={styles.ratioValue}>{ratioText(row.value)}</Figure>
                  </LedgerRow>
                ))}
              </Ledger>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfacePage },
  header: { paddingHorizontal: layout.gutter, paddingBottom: space.md },
  headerBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 36 },
  back: { flexDirection: "row", alignItems: "center", gap: 2, marginLeft: -4 },
  backLabel: { fontFamily: fontFamily.uiMedium, fontSize: fontSize.sm, color: colors.textMuted },
  identity: { flexDirection: "row", alignItems: "center", gap: space.sm + 1, marginTop: space.sm },
  dot: { width: 10, height: 10 },
  symbol: { fontSize: fontSize.h1, letterSpacing: letterSpacing(fontSize.h1, tracking.editorial) },
  company: { marginTop: 2, fontFamily: fontFamily.ui, fontSize: fontSize.xs, color: colors.textMuted },
  quoteRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginTop: space.lg },
  price: {
    fontFamily: fontFamily.monoSemibold,
    fontSize: 34,
    lineHeight: 36,
    letterSpacing: letterSpacing(34, tracking.editorial),
    color: colors.textStrong,
  },
  quoteRight: { alignItems: "flex-end", gap: 2 },
  changePct: { fontFamily: fontFamily.monoSemibold, fontSize: fontSize.h2 },
  cap: { fontSize: fontSize.xxs, color: colors.textFaint },
  basis: { marginTop: space.md, fontSize: fontSize.xxs, color: colors.textFaint },
  tabs: { marginTop: space.lg },
  metricGrid: { flexDirection: "row", flexWrap: "wrap" },
  metricCell: {
    flexBasis: "50%",
    paddingVertical: space.md,
    paddingRight: space.md,
    gap: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.rule,
  },
  metricValue: { fontFamily: fontFamily.monoSemibold, fontSize: fontSize.h2, color: colors.textStrong },
  ratioName: { flex: 1, fontFamily: fontFamily.ui, fontSize: fontSize.sm, color: colors.textBody },
  ratioValue: { fontFamily: fontFamily.monoSemibold, fontSize: fontSize.sm },
  payoutLeft: { flex: 1, gap: 1 },
  payoutKind: { fontFamily: fontFamily.uiSemibold, fontSize: fontSize.sm, color: colors.textStrong },
  payoutDate: { fontSize: fontSize.xxs, color: colors.textFaint },
  payoutValue: { fontFamily: fontFamily.monoSemibold, fontSize: fontSize.sm },
  empty: { fontFamily: fontFamily.ui, fontSize: fontSize.sm, color: colors.textMuted, lineHeight: 20 },
});
