import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { MarketMover, MarketResponse } from "@psx/shared/api/market";
import { formatCompact, formatFigure, formatNumber, formatPctSigned } from "@psx/shared/format";
import { useApi } from "@/lib/use-api";
import { SignedBar } from "@/components/charts/signed-bar";
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
  palette,
  space,
  tracking,
} from "@/lib/theme";

function Mover({ row }: { row: MarketMover }) {
  return (
    <LedgerRow>
      <View style={[styles.dot, { backgroundColor: row.color }]} />
      <View style={styles.moverName}>
        <View style={styles.moverTop}>
          <Text style={styles.ticker}>{row.ticker}</Text>
          {/* A position of your own in a market list deserves a mark. */}
          {row.owned ? <Text style={styles.held}>held</Text> : null}
        </View>
        <Text style={styles.company} numberOfLines={1}>
          {row.companyName ?? ""}
        </Text>
      </View>
      <Figure style={styles.price}>{formatNumber(row.price, 2)}</Figure>
      <Figure style={[styles.moverPct, { color: directionColor(row.changePct) }]}>
        {formatPctSigned(row.changePct, 2)}
      </Figure>
    </LedgerRow>
  );
}

function MoverBlock({ title, rows }: { title: string; rows: MarketMover[] }) {
  if (rows.length === 0) return null;
  return (
    <Band>
      <Caps style={styles.blockHead}>{title}</Caps>
      <Ledger>
        {rows.map((row) => (
          <Mover key={`${title}-${row.ticker}`} row={row} />
        ))}
      </Ledger>
    </Band>
  );
}

export default function MarketScreen() {
  const { data, error, loading, refreshing, refresh } = useApi<MarketResponse>(
    "/api/market/dashboard",
    "Could not load the market."
  );

  if (loading) return <Loading />;

  const breadth = data?.breadth;
  const extent = Math.max(...(data?.sectors ?? []).map((s) => Math.abs(s.averageReturn ?? 0)), 0.01);

  return (
    <View style={styles.screen}>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.textMuted} />
        }
        showsVerticalScrollIndicator={false}
      >
        <SafeAreaView edges={["top"]} style={styles.header}>
          <PageTitle>Market Pulse</PageTitle>

          {data?.index ? (
            <>
              <View style={styles.indexRow}>
                <View style={styles.indexLeft}>
                  <Caps>{data.index.name}</Caps>
                  <Figure style={styles.indexValue}>{formatFigure(data.index.value)}</Figure>
                </View>
                <View style={styles.indexRight}>
                  <Figure style={[styles.indexChange, { color: directionColor(data.index.change) }]}>
                    {data.index.change !== null && data.index.change > 0 ? "+" : ""}
                    {formatFigure(data.index.change)}
                  </Figure>
                  <Figure style={[styles.indexPct, { color: directionColor(data.index.changePct) }]}>
                    {formatPctSigned(data.index.changePct, 2)}
                  </Figure>
                </View>
              </View>

              {breadth ? (
                <View style={styles.breadthBlock}>
                  <View style={styles.breadthTrack}>
                    <View style={[styles.breadthSeg, { flex: Math.max(breadth.advancers, 1), backgroundColor: palette.up2 }]} />
                    <View style={[styles.breadthSeg, { flex: Math.max(breadth.unchanged, 1), backgroundColor: palette.ink4 }]} />
                    <View style={[styles.breadthSeg, { flex: Math.max(breadth.decliners, 1), backgroundColor: palette.down2 }]} />
                  </View>
                  <View style={styles.breadthLabels}>
                    <Figure style={[styles.breadthLabel, { color: colors.textUp }]}>
                      {breadth.advancers} advancing
                    </Figure>
                    <Figure style={styles.breadthLabel}>{breadth.unchanged} flat</Figure>
                    <Figure style={[styles.breadthLabel, { color: colors.textDown }]}>
                      {breadth.decliners} declining
                    </Figure>
                  </View>
                  <Figure style={styles.turnover}>
                    Turnover {formatCompact(breadth.totalValue)} on {formatCompact(breadth.totalVolume)} shares
                  </Figure>
                </View>
              ) : null}
            </>
          ) : (
            <Text style={styles.empty}>
              No market snapshot yet. It fills in after the next scheduled refresh.
            </Text>
          )}
        </SafeAreaView>

        <View style={styles.gutter}>
          <ErrorNote message={error} />
        </View>

        {data && data.sectors.length > 0 ? (
          <Band>
            <Caps style={styles.blockHead}>Sectors, best to worst</Caps>
            <Ledger>
              {data.sectors.map((s) => (
                <LedgerRow key={s.sector}>
                  <View style={styles.sectorName}>
                    <View style={[styles.dot, { backgroundColor: s.color }]} />
                    <Text style={styles.sectorLabel} numberOfLines={1}>
                      {s.label}
                    </Text>
                  </View>
                  <View style={styles.sectorBar}>
                    <SignedBar value={s.averageReturn} extent={extent} />
                  </View>
                  <Figure style={[styles.sectorPct, { color: directionColor(s.averageReturn) }]}>
                    {formatPctSigned(s.averageReturn, 2)}
                  </Figure>
                </LedgerRow>
              ))}
            </Ledger>
          </Band>
        ) : null}

        <MoverBlock title="Gainers" rows={data?.gainers ?? []} />
        <MoverBlock title="Losers" rows={data?.losers ?? []} />
        <MoverBlock title="Most active" rows={data?.mostActive ?? []} />

        {data?.updatedLabel ? (
          <Band style={styles.footer}>
            <Figure style={styles.updated}>{data.updatedLabel}</Figure>
          </Band>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfacePage },
  gutter: { paddingHorizontal: layout.gutter },
  header: { paddingHorizontal: layout.gutter, paddingBottom: space.lg },
  indexRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginTop: space.lg },
  indexLeft: { flex: 1 },
  indexValue: {
    marginTop: 5,
    fontFamily: fontFamily.monoSemibold,
    fontSize: 36,
    lineHeight: 38,
    letterSpacing: letterSpacing(36, tracking.editorial),
    color: colors.textStrong,
  },
  indexRight: { alignItems: "flex-end", paddingBottom: 4 },
  indexChange: { fontFamily: fontFamily.monoSemibold, fontSize: fontSize.h2 },
  indexPct: { marginTop: 2, fontSize: fontSize.sm },
  breadthBlock: { marginTop: space.xl - 4 },
  breadthTrack: { flexDirection: "row", height: 9, gap: 1 },
  breadthSeg: { height: 9 },
  breadthLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 7 },
  breadthLabel: { fontSize: fontSize.xxs, color: colors.textFaint },
  turnover: { marginTop: space.sm, fontSize: fontSize.xxs, color: colors.textFaint },
  blockHead: { marginBottom: space.md + 2 },
  dot: { width: 8, height: 8 },
  sectorName: { flexDirection: "row", alignItems: "center", gap: 7, width: 88 },
  sectorLabel: { flex: 1, fontFamily: fontFamily.ui, fontSize: fontSize.xxs, color: colors.textBody },
  sectorBar: { flex: 1, marginHorizontal: space.sm },
  sectorPct: { minWidth: 56, textAlign: "right", fontFamily: fontFamily.monoSemibold, fontSize: fontSize.sm },
  moverName: { flex: 1, marginLeft: space.sm + 1, gap: 1 },
  moverTop: { flexDirection: "row", alignItems: "center", gap: space.sm },
  ticker: { fontFamily: fontFamily.uiSemibold, fontSize: fontSize.sm, color: colors.textStrong },
  held: {
    fontFamily: fontFamily.uiBold,
    fontSize: 9,
    letterSpacing: letterSpacing(9, tracking.caps),
    textTransform: "uppercase",
    color: colors.textBrand,
  },
  company: { fontFamily: fontFamily.ui, fontSize: fontSize.xxs, color: colors.textFaint },
  price: { fontSize: fontSize.sm, color: colors.textMuted, minWidth: 62, textAlign: "right" },
  moverPct: {
    minWidth: 62,
    textAlign: "right",
    fontFamily: fontFamily.monoSemibold,
    fontSize: fontSize.sm,
  },
  empty: { marginTop: space.lg, fontFamily: fontFamily.ui, fontSize: fontSize.sm, color: colors.textMuted, lineHeight: 20 },
  footer: { paddingTop: 0 },
  updated: { fontSize: fontSize.xxs, color: colors.textFaint },
});
