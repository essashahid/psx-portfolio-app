import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Shimmer } from "@/components/ui/motion";
import { colors, layout, space } from "@/lib/theme";

/**
 * Waiting states in the shape of the screen they stand in for, so nothing
 * moves when the data lands. A spinner belongs only where the shape is
 * genuinely unknown, which on these screens it never is.
 */

/** The dark header block every portfolio screen opens with. */
function HeaderSkeleton({ dark = true, metrics = 4 }: { dark?: boolean; metrics?: number }) {
  return (
    <View style={[styles.header, dark ? styles.headerDark : styles.headerLight]}>
      <Shimmer width={110} height={11} style={dark ? styles.onDark : undefined} />
      <Shimmer width={240} height={38} style={[styles.gapLg, dark ? styles.onDark : undefined]} />
      <Shimmer width={160} height={13} style={[styles.gapMd, dark ? styles.onDark : undefined]} />
      <View style={styles.metricGrid}>
        {Array.from({ length: metrics }, (_, i) => (
          <View key={i} style={styles.metricCell}>
            <Shimmer width={90} height={10} style={dark ? styles.onDark : undefined} />
            <Shimmer width={120} height={22} style={[styles.gapSm, dark ? styles.onDark : undefined]} />
          </View>
        ))}
      </View>
    </View>
  );
}

/** A stack of ledger rows: a label, a sub-line and a figure on the right. */
function RowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <View style={styles.body}>
      <Shimmer width={120} height={11} />
      <View style={styles.gapLg} />
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={styles.row}>
          <View style={styles.rowLeft}>
            <Shimmer width={i % 3 === 0 ? "62%" : "46%"} height={15} />
            <Shimmer width="38%" height={11} style={styles.gapSm} />
          </View>
          <Shimmer width={72} height={15} />
        </View>
      ))}
    </View>
  );
}

/** Home, Holdings and Performance all open with a header over a list. */
export function ScreenSkeleton({
  dark = true,
  metrics = 4,
  rows = 6,
}: {
  dark?: boolean;
  metrics?: number;
  rows?: number;
}) {
  return (
    <View style={styles.screen} accessibilityLabel="Loading" accessibilityRole="progressbar">
      <SafeAreaView edges={["top"]} style={dark ? styles.safeDark : styles.safeLight}>
        <HeaderSkeleton dark={dark} metrics={metrics} />
      </SafeAreaView>
      <RowsSkeleton rows={rows} />
    </View>
  );
}

/** Screens that open on a light field with a back control rather than a band. */
export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <SafeAreaView edges={["top"]} style={styles.screen} accessibilityLabel="Loading" accessibilityRole="progressbar">
      <View style={styles.pageHead}>
        <Shimmer width={64} height={14} />
        <Shimmer width={180} height={30} style={styles.gapLg} />
        <Shimmer width={110} height={11} style={styles.gapXl} />
        <Shimmer width={230} height={34} style={styles.gapSm} />
      </View>
      <RowsSkeleton rows={rows} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfacePage },
  safeDark: { backgroundColor: colors.ink },
  safeLight: { backgroundColor: colors.surfacePage },
  header: { paddingHorizontal: layout.gutter, paddingTop: space.lg, paddingBottom: space.xl },
  headerDark: { backgroundColor: colors.ink },
  headerLight: { backgroundColor: colors.surfacePage },
  // On the dark band the inset surface is invisible, so the placeholder is a
  // light wash instead.
  onDark: { backgroundColor: "rgba(255,255,255,0.09)" },
  pageHead: { paddingHorizontal: layout.gutter, paddingTop: space.md, paddingBottom: space.xl },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: space.xl },
  metricCell: { width: "50%", paddingRight: space.lg, marginBottom: space.xl },
  body: { paddingHorizontal: layout.gutter, paddingTop: space.xl },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: space.md,
    minHeight: layout.hitMin,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.rule,
  },
  rowLeft: { flex: 1, paddingRight: space.lg },
  gapSm: { marginTop: space.xs },
  gapMd: { marginTop: space.sm },
  gapLg: { marginTop: space.md },
  gapXl: { marginTop: space.xl },
});
