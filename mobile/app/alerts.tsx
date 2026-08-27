import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import type { AlertRow, AlertsResponse, AlertSeverity } from "@psx/shared/api/alerts";
import { useApi } from "@/lib/use-api";
import { Band } from "@/components/ui/layout";
import { Caps, Figure, PageTitle } from "@/components/ui/text";
import { Loading, ErrorNote } from "@/components/status";
import { colors, fontFamily, fontSize, layout, space } from "@/lib/theme";

/** Severity reads as a coloured left edge, as it does on the web rows. */
const EDGE: Record<AlertSeverity, string> = {
  critical: colors.statusDanger,
  warning: colors.statusWarn,
  info: colors.ruleStrong,
};

function Alert({ row }: { row: AlertRow }) {
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
  const router = useRouter();
  const { data, error, loading, refreshing, refresh } = useApi<AlertsResponse>(
    "/api/alerts",
    "Could not load alerts."
  );

  if (loading) return <Loading />;

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
          <Caps style={styles.count}>
            {data ? `${data.rows.length} open` : ""}
          </Caps>
        </View>

        <Band>
          <ErrorNote message={error} />
          {(data?.rows.length ?? 0) === 0 ? (
            error ? null : (
              <Text style={styles.empty}>
                Nothing needs your attention. Alerts appear here when a position crosses a
                target, a thesis falls due, or the data engine finds a problem.
              </Text>
            )
          ) : (
            data?.rows.map((row) => <Alert key={row.id} row={row} />)
          )}
        </Band>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfacePage },
  header: { paddingHorizontal: layout.gutter, paddingBottom: space.sm },
  back: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 36, marginLeft: -4 },
  backLabel: { fontFamily: fontFamily.uiMedium, fontSize: fontSize.sm, color: colors.textMuted },
  pageTitle: { marginTop: space.xs },
  count: { marginTop: space.sm },
  alert: {
    borderLeftWidth: 2,
    paddingLeft: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.rule,
    gap: space.xs,
  },
  alertHead: { flexDirection: "row", justifyContent: "space-between", gap: space.md },
  title: { flex: 1, fontFamily: fontFamily.uiSemibold, fontSize: fontSize.h3, color: colors.textStrong },
  ticker: { fontFamily: fontFamily.mono, fontSize: fontSize.xs, color: colors.textMuted },
  message: { fontFamily: fontFamily.ui, fontSize: fontSize.sm, lineHeight: 20, color: colors.textBody },
  date: { fontSize: fontSize.xxs, color: colors.textFaint },
  empty: { fontFamily: fontFamily.ui, fontSize: fontSize.sm, lineHeight: 20, color: colors.textMuted },
});
