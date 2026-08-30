import { useMemo } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { MarketMover, MarketResponse } from "@psx/shared/api/market";
import { formatCompact, formatFigure, formatNumber, formatPctSigned } from "@psx/shared/format";
import { useApi } from "@/lib/use-api";
import { SignedBar } from "@/components/charts/signed-bar";
import { Band, Ledger, LedgerRow } from "@/components/ui/layout";
import { Caps, Figure, PageTitle } from "@/components/ui/text";
import { ErrorNote } from "@/components/status";
import { Rise, Tick } from "@/components/ui/motion";
import { ReturnHistogram } from "@/components/charts/return-histogram";
import { ScreenSkeleton } from "@/components/skeleton";
import { makeStyles, useColors } from "@/lib/theme-context";
import { MarketMap } from "@/components/charts/market-map";
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
  const styles = useStyles();
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
      {/* A price that moves under you says so. This is the only figure that
          tints, and it never counts up: one is a notification, the other an
          entrance, and a figure that does both says neither clearly. */}
      <Tick value={row.price}>
        <Figure style={styles.price}>{formatNumber(row.price, 2)}</Figure>
      </Tick>
      <Figure style={[styles.moverPct, { color: directionColor(row.changePct) }]}>
        {formatPctSigned(row.changePct, 2)}
      </Figure>
    </LedgerRow>
  );
}

function MoverBlock({ title, rows }: { title: string; rows: MarketMover[] }) {
  const styles = useStyles();
  if (rows.length === 0) return null;
  return (
    <Band>
      <Caps style={styles.blockHead}>{title}</Caps>
      <Ledger>
        {rows.map((row, i) => (
          <Rise key={`${title}-${row.ticker}`} index={i}>
            <Mover row={row} />
          </Rise>
        ))}
      </Ledger>
    </Band>
  );
}

export default function MarketScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { data, error, loading, refreshing, refresh } = useApi<MarketResponse>(
    "/api/market/dashboard",
    "Could not load the market."
  );

  const verdict = useMemo(() => {
    const rows = data?.map ?? [];
    if (rows.length === 0) return null;
    const advanced = rows.filter((r) => (r.changePct ?? 0) > 0.05).length;
    const capTotal = rows.reduce((n, r) => n + r.marketCap, 0);
    const rising = rows.filter((r) => (r.changePct ?? 0) > 0).reduce((n, r) => n + r.marketCap, 0);
    const bySector = new Map<string, { cap: number; weighted: number; label: string }>();
    for (const r of rows) {
      const key = r.sectorLabel;
      const g = bySector.get(key) ?? { cap: 0, weighted: 0, label: key };
      g.cap += r.marketCap;
      g.weighted += (r.changePct ?? 0) * r.marketCap;
      bySector.set(key, g);
    }
    const ranked = [...bySector.values()]
      .map((g) => ({ label: g.label, move: g.weighted / g.cap }))
      .sort((a, b) => b.move - a.move);
    if (ranked.length === 0) return null;
    const share = Math.round((rising / capTotal) * 100);
    return `${advanced} of ${rows.length} companies advanced, and ${share}% of market value sits in names that rose. ${ranked[0].label} carried the index; ${ranked[ranked.length - 1].label} weighed most on it.`;
  }, [data?.map]);

  /** Index points a name moved: its weight in the index times its own move. */
  const contributions = useMemo(() => {
    const rows = data?.map ?? [];
    const level = data?.index?.value;
    if (rows.length === 0 || !level) return [];
    const capTotal = rows.reduce((n, r) => n + r.marketCap, 0);
    const scored = rows
      .map((r) => ({
        ticker: r.ticker,
        color: r.color,
        points: (r.marketCap / capTotal) * ((r.changePct ?? 0) / 100) * level,
      }))
      .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
      .slice(0, 7);
    const max = Math.max(...scored.map((r) => Math.abs(r.points)), 0.0001);
    return scored.map((r) => ({ ...r, width: Math.max((Math.abs(r.points) / max) * 48, 0.8) }));
  }, [data?.map, data?.index?.value]);

  if (loading) return <ScreenSkeleton dark={false} metrics={2} rows={8} />;

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

        {data?.map && data.map.length > 0 ? (
          <Band>
            <Caps style={styles.blockHead}>The market today</Caps>
            <MarketMap items={data.map} />
            <Figure style={styles.mapCaption}>
              Area is market value, grouped by sector.
              {data.mapCoverage
                ? ` ${data.mapCoverage.shown} companies · ${formatCompact(data.mapCoverage.capShown)} of ${formatCompact(data.mapCoverage.capTotal)}.`
                : ""}
            </Figure>
            {verdict ? <Text style={styles.verdict}>{verdict}</Text> : null}
          </Band>
        ) : null}

        {contributions.length > 0 ? (
          <Band>
            <Caps style={styles.blockHead}>Index points moved</Caps>
            <Ledger>
              {contributions.map((row) => (
                <LedgerRow key={row.ticker}>
                  <View style={styles.contribRow}>
                    <View style={[styles.contribDot, { backgroundColor: row.color }]} />
                    <Text style={styles.contribTicker}>{row.ticker}</Text>
                    <View style={styles.contribTrack}>
                      <View style={[styles.contribAxis, { backgroundColor: colors.ruleStrong }]} />
                      <View
                        style={[
                          styles.contribBar,
                          {
                            backgroundColor: row.points >= 0 ? colors.chartUp : colors.chartDown,
                            left: row.points >= 0 ? "50%" : `${50 - row.width}%`,
                            width: `${row.width}%`,
                          },
                        ]}
                      />
                    </View>
                    <Figure style={[styles.contribAmt, { color: directionColor(row.points) }]}>
                      {row.points >= 0 ? "+" : "−"}{Math.abs(row.points).toFixed(0)}
                    </Figure>
                  </View>
                </LedgerRow>
              ))}
            </Ledger>
            <Figure style={styles.mapCaption}>Weight in the index times the day's move.</Figure>
          </Band>
        ) : null}

        {/* Directly after breadth, which it is the detailed version of. The
            sector list below runs to thirty-odd rows, and burying this under
            it would put the answer to "was that just the market?" three
            screens from the question. */}
        {data?.distribution && data.distribution.total > 0 ? (
          <Band>
            <View style={styles.histogramHead}>
              <Caps>How the market moved</Caps>
              <Figure style={styles.histogramCount}>
                {data.distribution.total} companies
              </Figure>
            </View>
            <ReturnHistogram distribution={data.distribution} />
            <Figure style={styles.histogramNote}>
              Each bar is one percent. Your holdings are marked underneath.
            </Figure>
          </Band>
        ) : null}

        {data?.flows && data.flows.length > 0 ? (
          <Band>
            <Caps style={styles.blockHead}>Who was buying</Caps>
            <Ledger>
              {data.flows.map((flow) => {
                const max = Math.max(...(data.flows ?? []).map((f) => Math.abs(f.net ?? 0)), 1);
                const width = Math.max((Math.abs(flow.net ?? 0) / max) * 48, 0.8);
                const net = flow.net ?? 0;
                return (
                  <LedgerRow key={flow.label}>
                    <View style={styles.contribRow}>
                      <Text style={styles.flowLabel} numberOfLines={1}>{flow.label}</Text>
                      <View style={styles.contribTrack}>
                        <View style={[styles.contribAxis, { backgroundColor: colors.ruleStrong }]} />
                        <View
                          style={[
                            styles.contribBar,
                            {
                              backgroundColor: net >= 0 ? colors.chartUp : colors.chartDown,
                              left: net >= 0 ? "50%" : `${50 - width}%`,
                              width: `${width}%`,
                            },
                          ]}
                        />
                      </View>
                      <Figure style={[styles.contribAmt, { color: directionColor(net) }]}>
                        {net >= 0 ? "+" : "−"}{formatCompact(Math.abs(net))}
                      </Figure>
                    </View>
                  </LedgerRow>
                );
              })}
            </Ledger>
            <Figure style={styles.mapCaption}>
              Net buying by investor type across the market, not in your holdings.
              {data.flowsAsOf ? ` As of ${data.flowsAsOf}.` : ""}
            </Figure>
          </Band>
        ) : null}

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

const useStyles = makeStyles((c) => ({
  mapCaption: { marginTop: space.xs, fontSize: fontSize.xxs, lineHeight: 17, color: c.textFaint },
  /* Set in the display face: it is a sentence of judgement, not a label. */
  verdict: {
    marginTop: space.md,
    fontFamily: fontFamily.display,
    fontSize: 17,
    lineHeight: 26,
    letterSpacing: -0.3,
    color: c.textStrong,
  },
  contribRow: { flexDirection: "row", alignItems: "center", flex: 1, gap: space.sm },
  contribDot: { width: 8, height: 8 },
  contribTicker: { width: 56, fontFamily: fontFamily.uiSemibold, fontSize: fontSize.sm, color: c.textStrong },
  /* A centre line the bars grow out of, so gains and losses read as opposites. */
  contribTrack: { position: "relative", flex: 1, height: 14, justifyContent: "center" },
  contribAxis: { position: "absolute", top: 0, bottom: 0, left: "50%", width: 1 },
  contribBar: { position: "absolute", top: 4, height: 6 },
  flowLabel: { width: 104, fontFamily: fontFamily.ui, fontSize: fontSize.xs, color: c.textBody },
  contribAmt: { minWidth: 52, textAlign: "right", fontSize: fontSize.sm, fontWeight: "600" },
  screen: { flex: 1, backgroundColor: c.surfacePage },
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
    color: c.textStrong,
  },
  indexRight: { alignItems: "flex-end", paddingBottom: 4 },
  indexChange: { fontFamily: fontFamily.monoSemibold, fontSize: fontSize.h2 },
  indexPct: { marginTop: 2, fontSize: fontSize.sm },
  breadthBlock: { marginTop: space.xl - 4 },
  breadthTrack: { flexDirection: "row", height: 9, gap: 1 },
  breadthSeg: { height: 9 },
  breadthLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 7 },
  breadthLabel: { fontSize: fontSize.xxs, color: c.textFaint },
  turnover: { marginTop: space.sm, fontSize: fontSize.xxs, color: c.textFaint },
  blockHead: { marginBottom: space.md + 2 },
  histogramHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: space.md + 2,
  },
  histogramCount: { fontSize: fontSize.xxs, color: c.textFaint },
  histogramNote: { marginTop: space.md, fontSize: fontSize.xxs, color: c.textFaint },
  dot: { width: 8, height: 8 },
  sectorName: { flexDirection: "row", alignItems: "center", gap: 7, width: 88 },
  sectorLabel: { flex: 1, fontFamily: fontFamily.ui, fontSize: fontSize.xxs, color: c.textBody },
  sectorBar: { flex: 1, marginHorizontal: space.sm },
  sectorPct: { minWidth: 56, textAlign: "right", fontFamily: fontFamily.monoSemibold, fontSize: fontSize.sm },
  moverName: { flex: 1, marginLeft: space.sm + 1, gap: 1 },
  moverTop: { flexDirection: "row", alignItems: "center", gap: space.sm },
  ticker: { fontFamily: fontFamily.uiSemibold, fontSize: fontSize.sm, color: c.textStrong },
  held: {
    fontFamily: fontFamily.uiBold,
    fontSize: 9,
    letterSpacing: letterSpacing(9, tracking.caps),
    textTransform: "uppercase",
    color: c.textBrand,
  },
  company: { fontFamily: fontFamily.ui, fontSize: fontSize.xxs, color: c.textFaint },
  price: { fontSize: fontSize.sm, color: c.textMuted, minWidth: 62, textAlign: "right" },
  moverPct: {
    minWidth: 62,
    textAlign: "right",
    fontFamily: fontFamily.monoSemibold,
    fontSize: fontSize.sm,
  },
  empty: { marginTop: space.lg, fontFamily: fontFamily.ui, fontSize: fontSize.sm, color: c.textMuted, lineHeight: 20 },
  footer: { paddingTop: 0 },
  updated: { fontSize: fontSize.xxs, color: c.textFaint },
}));
