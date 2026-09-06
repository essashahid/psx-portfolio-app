import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import type { AlertRow, AlertsResponse, AlertSeverity } from "@psx/shared/api/alerts";
import { ALERT_KINDS } from "@psx/shared/api/alert-kinds";
import { useApi } from "@/lib/use-api";
import { Band } from "@/components/ui/layout";
import { Caps, Figure, PageTitle } from "@/components/ui/text";
import { ErrorNote } from "@/components/status";
import { Rise } from "@/components/ui/motion";
import { PageSkeleton } from "@/components/skeleton";
import { colors, fontFamily, fontSize, layout, space } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-context";

/** Severity reads as a coloured left edge, as it does on the web rows. */
const EDGE: Record<AlertSeverity, string> = {
  critical: colors.statusDanger,
  warning: colors.statusWarn,
  info: colors.ruleStrong,
};

function Alert({ row }: { row: AlertRow }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={[styles.alert, { borderLeftColor: EDGE[row.severity] ?? colors.rule }]}>
      <View style={styles.alertHead}>
        <Text style={styles.title}>{row.title}</Text>
        {row.ticker ? <Text style={styles.ticker}>{row.ticker}</Text> : null}
      </View>
      {row.message ? <Text style={styles.message}>{row.message}</Text> : null}
      <Figure style={styles.date}>{row.createdAt.slice(0, 10)}</Figure>
    </View>
  );
}

export default function AlertsScreen() {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const { data, error, loading, refreshing, refresh } = useApi<AlertsResponse>(
    "/api/alerts",
    "Could not load alerts."
  );

  if (loading) return <PageSkeleton rows={4} />;

  const rows = data?.rows ?? [];
  const bySeverity = { critical: 0, warning: 0, info: 0 };
  for (const row of rows) bySeverity[row.severity] = (bySeverity[row.severity] ?? 0) + 1;
  const breakdown = (["critical", "warning", "info"] as const)
    .filter((severity) => bySeverity[severity] > 0)
    .map((severity) => `${bySeverity[severity]} ${severity}`)
    .join(", ");

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
          <PageTitle style={styles.pageTitle}>Alerts</PageTitle>
          <Caps style={styles.count}>{data ? `${rows.length} open` : ""}</Caps>
          {breakdown ? <Figure style={styles.breakdown}>{breakdown}</Figure> : null}
        </View>

        <Band>
          <ErrorNote message={error} />
          {rows.length === 0 ? (
            error ? null : (
              <Text style={styles.empty}>Nothing needs your attention.</Text>
            )
          ) : (
            rows.map((row, i) => (
              <Rise key={row.id} index={i}>
                <Alert row={row} />
              </Rise>
            ))
          )}
        </Band>

        {/* An empty screen is only reassuring if you know what would have
            fired. This is the actual rule set, not a description of it. */}
        <Band style={styles.watchBand}>
          <Caps style={styles.watchHead}>What PortfolioOS PK is watching</Caps>
          {ALERT_KINDS.map((entry) => (
            <View key={entry.kind} style={styles.watchRow}>
              <View style={styles.watchDot} />
              <Text style={styles.watchLabel}>{entry.label}</Text>
            </View>
          ))}
          <Text style={styles.watchNote}>
            Price targets and review levels come from what you set on a holding. Thesis reminders
            need a thesis, which is written on the web app.
          </Text>
        </Band>
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.surfacePage },
  header: { paddingHorizontal: layout.gutter, paddingBottom: space.sm },
  back: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 36, marginLeft: -4 },
  backLabel: { fontFamily: fontFamily.uiMedium, fontSize: fontSize.sm, color: c.textMuted },
  pageTitle: { marginTop: space.xs },
  count: { marginTop: space.sm },
  alert: {
    borderLeftWidth: 2,
    paddingLeft: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.rule,
    gap: space.xs,
  },
  alertHead: { flexDirection: "row", justifyContent: "space-between", gap: space.md },
  title: { flex: 1, fontFamily: fontFamily.uiSemibold, fontSize: fontSize.h3, color: c.textStrong },
  ticker: { fontFamily: fontFamily.mono, fontSize: fontSize.xs, color: c.textMuted },
  message: { fontFamily: fontFamily.ui, fontSize: fontSize.sm, lineHeight: 20, color: c.textBody },
  date: { fontSize: fontSize.xxs, color: c.textFaint },
  breakdown: { marginTop: space.xs, fontSize: fontSize.xxs, color: c.textFaint },
  watchBand: { paddingBottom: space.xxl },
  watchHead: { marginBottom: space.md },
  watchRow: { flexDirection: "row", alignItems: "flex-start", gap: space.md, paddingVertical: 7 },
  watchDot: {
    width: 5,
    height: 5,
    borderRadius: layout.radiusPill,
    backgroundColor: c.ruleStrong,
    marginTop: 7,
  },
  watchLabel: {
    flex: 1,
    fontFamily: fontFamily.ui,
    fontSize: fontSize.sm,
    lineHeight: 20,
    color: c.textBody,
  },
  watchNote: {
    fontFamily: fontFamily.ui,
    fontSize: fontSize.xxs,
    lineHeight: 17,
    color: c.textFaint,
    marginTop: space.lg,
  },
  empty: { fontFamily: fontFamily.ui, fontSize: fontSize.sm, lineHeight: 20, color: c.textMuted },
}));
