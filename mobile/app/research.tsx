import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, Search } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import type { StockRow, StocksResponse } from "@psx/shared/api/stocks";
import { formatCompact, formatNumber, formatPctSigned } from "@psx/shared/format";
import { sectorColor, shortSector } from "@psx/shared/sector-colors";
import { api, ApiError } from "@/lib/api";
import { Band, Ledger, LedgerRow } from "@/components/ui/layout";
import { Caps, Figure, PageTitle } from "@/components/ui/text";
import { ErrorNote } from "@/components/status";
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

const SORTS = [
  { key: "marketCap", label: "Size" },
  { key: "pe", label: "P/E" },
  { key: "ticker", label: "A–Z" },
] as const;

function Row({ row }: { row: StockRow }) {
  const styles = useStyles();
  const router = useRouter();
  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync();
        router.push({ pathname: "/company/[ticker]", params: { ticker: row.ticker } });
      }}
      accessibilityRole="button"
    >
      <LedgerRow>
        <View style={[styles.dot, { backgroundColor: sectorColor(row.sector) }]} />
        <View style={styles.name}>
          <Text style={styles.ticker}>{row.ticker}</Text>
          <Text style={styles.company} numberOfLines={1}>
            {row.name ?? shortSector(row.sector)}
          </Text>
        </View>
        <View style={styles.numbers}>
          <Figure style={styles.price}>{formatNumber(row.price, 2)}</Figure>
          <Figure style={[styles.change, { color: directionColor(row.dayChangePct) }]}>
            {formatPctSigned(row.dayChangePct, 2)}
          </Figure>
        </View>
        <View style={styles.valuation}>
          <Figure style={styles.pe}>{row.pe !== null ? `${formatNumber(row.pe, 1)}×` : "—"}</Figure>
          <Figure style={styles.cap}>{formatCompact(row.marketCap)}</Figure>
        </View>
      </LedgerRow>
    </Pressable>
  );
}

export default function ResearchScreen() {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  // Arriving from the Home search with something already typed.
  const { q } = useLocalSearchParams<{ q?: string }>();
  const [query, setQuery] = useState(q ?? "");
  const [sort, setSort] = useState<(typeof SORTS)[number]["key"]>("marketCap");
  const [data, setData] = useState<StocksResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const params = new URLSearchParams({ sort, limit: "40" });
      if (query.trim()) params.set("q", query.trim());
      setData(await api<StocksResponse>(`/api/stocks/browse?${params.toString()}`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the screener.");
    } finally {
      setBusy(false);
    }
  }, [query, sort]);

  // A keystroke should not fire a request. Wait for a pause in typing.
  useEffect(() => {
    const timer = setTimeout(() => void load(), query ? 350 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  const shown = useMemo(() => data?.stocks ?? [], [data]);

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back} accessibilityRole="button">
          <ChevronLeft size={20} color={colors.textMuted} />
          <Text style={styles.backLabel}>Back</Text>
        </Pressable>
        <PageTitle style={styles.title}>Companies</PageTitle>

        <View style={styles.searchBox}>
          <Search size={17} color={colors.textFaint} />
          <TextInput
            style={styles.search}
            value={query}
            onChangeText={setQuery}
            placeholder="Search ticker or company"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="search"
          />
        </View>

        <View style={styles.sorts}>
          {SORTS.map((option) => (
            <Pressable
              key={option.key}
              onPress={() => {
                void Haptics.selectionAsync();
                setSort(option.key);
              }}
              style={styles.sortChip}
              accessibilityRole="button"
              accessibilityState={{ selected: sort === option.key }}
            >
              <Text style={[styles.sortLabel, sort === option.key && styles.sortLabelActive]}>
                {option.label}
              </Text>
            </Pressable>
          ))}
          <View style={styles.count}>
            <Figure style={styles.countText}>
              {data ? `${shown.length} of ${data.total}` : ""}
            </Figure>
          </View>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Band style={styles.list}>
          <ErrorNote message={error} />
          <View style={styles.columnHead}>
            <Caps style={styles.colName}>Company</Caps>
            <Caps style={styles.colPrice}>Price</Caps>
            <Caps style={styles.colVal}>P/E · Cap</Caps>
          </View>
          {busy && shown.length === 0 ? (
            <ActivityIndicator style={styles.spinner} color={colors.accentPrimary} />
          ) : shown.length === 0 ? (
            <Text style={styles.empty}>
              {error ? "" : "Nothing matched. Try a ticker like OGDC, or clear the search."}
            </Text>
          ) : (
            <Ledger>
              {shown.map((row) => (
                <Row key={row.ticker} row={row} />
              ))}
            </Ledger>
          )}
        </Band>
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.surfacePage },
  header: { paddingHorizontal: layout.gutter, paddingBottom: space.md },
  back: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 36, marginLeft: -4 },
  backLabel: { fontFamily: fontFamily.uiMedium, fontSize: fontSize.sm, color: c.textMuted },
  title: { marginTop: space.xs },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 44,
    marginTop: space.md,
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderColor: c.rule,
    borderRadius: layout.radiusSm,
    backgroundColor: c.surfaceRaised,
  },
  search: { flex: 1, fontFamily: fontFamily.ui, fontSize: 16, color: c.textStrong },
  sorts: { flexDirection: "row", alignItems: "center", gap: space.lg, marginTop: space.md },
  sortChip: { minHeight: 32, justifyContent: "center" },
  sortLabel: { fontFamily: fontFamily.uiMedium, fontSize: fontSize.sm, color: c.textMuted },
  sortLabelActive: {
    fontFamily: fontFamily.uiBold,
    color: c.textStrong,
    textDecorationLine: "underline",
  },
  count: { flex: 1, alignItems: "flex-end" },
  countText: { fontSize: fontSize.xxs, color: c.textFaint },
  list: { paddingTop: space.sm },
  columnHead: {
    flexDirection: "row",
    paddingBottom: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.rule,
  },
  colName: { flex: 1 },
  colPrice: { width: 74, textAlign: "right" },
  colVal: { width: 78, textAlign: "right" },
  dot: { width: 8, height: 8 },
  name: { flex: 1, marginLeft: space.sm + 1, gap: 1 },
  ticker: { fontFamily: fontFamily.uiSemibold, fontSize: fontSize.sm, color: c.textStrong },
  company: { fontFamily: fontFamily.ui, fontSize: fontSize.xxs, color: c.textFaint },
  numbers: { width: 74, alignItems: "flex-end", gap: 1 },
  price: { fontSize: fontSize.sm, color: c.textStrong },
  change: { fontSize: fontSize.xxs },
  valuation: { width: 78, alignItems: "flex-end", gap: 1 },
  pe: { fontSize: fontSize.sm, color: c.textBody },
  cap: { fontSize: fontSize.xxs, color: c.textFaint },
  spinner: { marginTop: space.xl },
  empty: {
    marginTop: space.lg,
    fontFamily: fontFamily.ui,
    fontSize: fontSize.sm,
    color: c.textMuted,
    lineHeight: 20,
  },
}));
