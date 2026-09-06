import { useMemo, useState } from "react";
import { Pressable, Text, View, type LayoutChangeEvent } from "react-native";
import { useRouter } from "expo-router";
import type { MarketMapItem } from "@psx/shared/api/market";
import { squarify, mix, type Sized } from "@/lib/treemap";
import { makeStyles, useColors } from "@/lib/theme-context";
import { fontFamily, fontSize, space } from "@/lib/theme";

/** The move at which a tile reaches full colour. Beyond this it stops darkening. */
const SATURATE_AT = 3;
/** Gap between sector blocks, so the grouping is visible without drawing borders. */
const SECTOR_INSET = 1.5;

type Group = { sector: string; label: string; cap: number; items: MarketMapItem[] };

/**
 * The market map: every large company as a rectangle, area by market value,
 * fill by the day's move, grouped by sector.
 *
 * Sectors are laid out first and companies placed inside their block, so
 * adjacency carries the sector and the fill is free to carry direction alone.
 * Colouring tiles by sector as well would leave two variables competing for
 * the same channel and neither would read.
 */
export function MarketMap({ items }: { items: MarketMapItem[] }) {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const [width, setWidth] = useState(0);
  const height = width * (336 / 370); // the proportion the layout was designed at

  const groups = useMemo(() => {
    const by = new Map<string, Group>();
    for (const item of items) {
      const key = item.sector ?? "Other";
      let g = by.get(key);
      if (!g) {
        g = { sector: key, label: item.sectorLabel, cap: 0, items: [] };
        by.set(key, g);
      }
      g.items.push(item);
      g.cap += item.marketCap;
    }
    return [...by.values()];
  }, [items]);

  const tiles = useMemo(() => {
    if (width <= 0) return [];
    const blocks = squarify<Group>(
      groups.map((g) => ({ value: g.cap, item: g })) as Sized<Group>[],
      0, 0, width, height
    );
    const out: { item: MarketMapItem; x: number; y: number; w: number; h: number }[] = [];
    for (const block of blocks) {
      const ix = block.x + SECTOR_INSET;
      const iy = block.y + SECTOR_INSET;
      const iw = Math.max(0, block.w - SECTOR_INSET * 2);
      const ih = Math.max(0, block.h - SECTOR_INSET * 2);
      out.push(
        ...squarify<MarketMapItem>(
          block.item.items.map((u) => ({ value: u.marketCap, item: u })),
          ix, iy, iw, ih
        )
      );
    }
    return out;
  }, [groups, width, height]);

  /**
   * Direction is the only thing the fill says. It mixes toward whichever
   * surface the theme is painting, so the same tile reads correctly on paper
   * and on black without a second palette.
   *
   * heatColor() in @psx/shared/market/format is deliberately not used here.
   * It returns fixed hsl() strings tuned for the web's dark heatmap and has no
   * way to take the active theme surface, so on the light phone palette its
   * tiles would not sit on paper, and mix() needs hex input to blend toward
   * the theme. The ramp below is the same idea with the palette as input.
   */
  function fillFor(pct: number | null) {
    const d = pct ?? 0;
    if (Math.abs(d) < 0.05) {
      return { bg: colors.surfaceInset, fg: colors.textMuted };
    }
    const k = Math.min(1, Math.abs(d) / SATURATE_AT);
    const base = d > 0 ? colors.chartUp : colors.chartDown;
    // 16% at a flat day, 84% at saturation: enough tint to read at a glance
    // without the smallest movers looking as decisive as the largest.
    const bg = mix(colors.surfacePage, base, 0.16 + 0.68 * k);
    return { bg, fg: k > 0.52 ? "#ffffff" : colors.textStrong };
  }

  return (
    <View>
      <View
        style={[styles.canvas, { height: height || undefined }]}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        accessibilityRole="image"
        accessibilityLabel="Market map. Area is market value, colour is the day's move, grouped by sector."
      >
        {tiles.map(({ item, x, y, w, h }) => {
          const { bg, fg } = fillFor(item.changePct);
          const roomForTicker = w >= 38 && h >= 20;
          const roomForBoth = w >= 46 && h >= 36;
          const big = w >= 62 && h >= 46;
          return (
            <Pressable
              key={item.ticker}
              onPress={() => router.push(`/company/${item.ticker}` as never)}
              style={[styles.tile, { left: x, top: y, width: w, height: h, backgroundColor: bg }]}
              accessibilityRole="button"
              accessibilityLabel={`${item.ticker}, ${item.changePct?.toFixed(1) ?? "no"} percent`}
            >
              {roomForTicker ? (
                <View style={[styles.tileInner, { padding: big ? 7 : 4 }]}>
                  <Text numberOfLines={1} style={[styles.ticker, { fontSize: big ? 13 : 10, color: fg }]}>
                    {item.ticker}
                  </Text>
                  {roomForBoth ? (
                    <Text style={[styles.pct, { color: fg }]}>
                      {item.changePct == null ? "" : `${item.changePct >= 0 ? "+" : "−"}${Math.abs(item.changePct).toFixed(1)}%`}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              {/* A small square rather than a ring: it survives a 20pt tile. */}
              {item.owned ? <View style={[styles.held, { backgroundColor: colors.textStrong }]} /> : null}
            </Pressable>
          );
        })}
      </View>

      <View style={styles.legend}>
        <Text style={styles.legendEnd}>{"−"}3%</Text>
        <View style={styles.scale}>
          {Array.from({ length: 24 }, (_, i) => {
            const t = i / 23;
            const d = (t - 0.5) * 2 * SATURATE_AT;
            return <View key={i} style={[styles.scaleStep, { backgroundColor: fillFor(d).bg }]} />;
          })}
        </View>
        <Text style={styles.legendEnd}>+3%</Text>
        <View style={[styles.held, styles.legendHeld, { backgroundColor: colors.textStrong }]} />
        <Text style={styles.legendEnd}>you hold</Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  canvas: { position: "relative", width: "100%", backgroundColor: c.surfacePage },
  tile: { position: "absolute", overflow: "hidden", borderWidth: 0.5, borderColor: c.surfacePage },
  tileInner: { flex: 1 },
  ticker: { fontFamily: fontFamily.uiBold, letterSpacing: -0.2 },
  pct: { fontFamily: fontFamily.mono, fontSize: 10, opacity: 0.86, marginTop: 1 },
  held: { position: "absolute", top: 4, right: 4, width: 5, height: 5 },
  legend: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: space.sm },
  legendEnd: { fontFamily: fontFamily.mono, fontSize: fontSize.xxxs, color: c.textFaint },
  legendHeld: { position: "relative", top: 0, right: 0, marginLeft: space.xs },
  scale: { flex: 1, flexDirection: "row", height: 5 },
  scaleStep: { flex: 1 },
}));
