import { useCallback } from "react";
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import Constants from "expo-constants";
import * as Haptics from "expo-haptics";
import {
  Bell,
  ChevronRight,
  Database,
  ExternalLink,
  FileText,
  HandCoins,
  LogOut,
  Newspaper,
  NotebookPen,
  PieChart,
  Radar,
  Search,
  Settings,
  Target,
  TrendingUp,
  Upload,
} from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/lib/use-api";
import type { AlertsResponse } from "@psx/shared/api/alerts";
import { Band, Ledger, LedgerRow } from "@/components/ui/layout";
import { Caps, Figure, PageTitle } from "@/components/ui/text";
import { APP_NAME } from "@/lib/brand";
import { colors, fontFamily, fontSize, layout, space } from "@/lib/theme";

type Entry = {
  icon: LucideIcon;
  label: string;
  /** A screen in the app. */
  href?: Href;
  /** Lives on the web; opens the browser rather than pretending to be here. */
  web?: string;
  badge?: number | null;
};

const WEB_BASE = process.env.EXPO_PUBLIC_WEB_URL ?? process.env.EXPO_PUBLIC_API_URL ?? "";

function Row({ entry }: { entry: Entry }) {
  const router = useRouter();
  const Icon = entry.icon;

  function open() {
    void Haptics.selectionAsync();
    if (entry.href) router.push(entry.href);
    else if (entry.web && WEB_BASE) void Linking.openURL(`${WEB_BASE}${entry.web}`);
  }

  return (
    <Pressable onPress={open} accessibilityRole="button">
      <LedgerRow>
        <Icon size={18} color={colors.textMuted} />
        <Text style={styles.label}>{entry.label}</Text>
        {entry.badge ? <Figure style={styles.badge}>{entry.badge}</Figure> : null}
        {entry.web ? (
          <ExternalLink size={15} color={colors.textFaint} />
        ) : (
          <ChevronRight size={17} color={colors.textFaint} />
        )}
      </LedgerRow>
    </Pressable>
  );
}

function Group({ title, entries }: { title: string; entries: Entry[] }) {
  return (
    <Band style={styles.group}>
      <Caps>{title}</Caps>
      <Ledger>
        {entries.map((entry) => (
          <Row key={entry.label} entry={entry} />
        ))}
      </Ledger>
    </Band>
  );
}

export default function MoreScreen() {
  const { session, signOut } = useAuth();
  const { data: alerts, refresh: refreshAlerts } = useApi<AlertsResponse>("/api/alerts", "");

  // This tab stays mounted, so a fetch on mount alone leaves the badge showing
  // whatever the count was when the app started. There is no pull-to-refresh
  // here either — it is a list of links, not data — so re-reading on focus is
  // the only thing keeping the number honest.
  useFocusEffect(
    useCallback(() => {
      void refreshAlerts();
    }, [refreshAlerts])
  );

  const email = session?.user.email ?? "";
  const initial = email.slice(0, 1).toUpperCase() || "?";

  function confirmSignOut() {
    Alert.alert("Sign out", "You will need to sign in again to see your portfolio.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void signOut() },
    ]);
  }

  return (
    <View style={styles.screen}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <SafeAreaView edges={["top"]} style={styles.header}>
          <PageTitle>More</PageTitle>
          <View style={styles.account}>
            <View style={styles.avatar}>
              <Text style={styles.avatarLetter}>{initial}</Text>
            </View>
            <View style={styles.accountText}>
              <Text style={styles.accountName} numberOfLines={1}>
                {email || "Not signed in"}
              </Text>
              <Text style={styles.accountMeta}>Signed in on this device</Text>
            </View>
          </View>
        </SafeAreaView>

        <Group
          title="Overview"
          entries={[
            { icon: HandCoins, label: "Dividends", href: "/dividends" },
            { icon: TrendingUp, label: "Performance", href: "/performance" },
          ]}
        />

        <Group
          title="Research"
          entries={[
            { icon: Search, label: "Stock Research", href: "/research" },
            { icon: FileText, label: "Saved reports", web: "/research" },
            { icon: Radar, label: "PSX Market Outlook", web: "/outlook" },
            { icon: Newspaper, label: "News Center", web: "/news" },
          ]}
        />

        <Group
          title="Planning"
          entries={[
            { icon: Target, label: "Goals & targets", web: "/goals" },
            { icon: PieChart, label: "Capital allocation", web: "/allocation" },
            { icon: NotebookPen, label: "Journal", web: "/journal" },
            { icon: Bell, label: "Alerts", href: "/alerts", badge: alerts?.openCount ?? null },
          ]}
        />

        <Group
          title="Data & setup"
          entries={[
            { icon: Upload, label: "Import Center", web: "/import" },
            { icon: Database, label: "Data Engine", web: "/coverage" },
            { icon: Settings, label: "Settings", web: "/settings" },
          ]}
        />

        <Band>
          <Pressable style={styles.signOut} onPress={confirmSignOut} accessibilityRole="button">
            <LogOut size={17} color={colors.textDown} />
            <Text style={styles.signOutLabel}>Sign out</Text>
          </Pressable>
          {/* Say plainly which things open a browser and why. */}
          <Text style={styles.footer}>
            {APP_NAME} version {Constants.expoConfig?.version ?? "0.1.0"}. Rows marked with an
            arrow open the web app, where there is room for importing, editing and long
            reports. Data is held in your own Supabase project with row-level security. For
            personal portfolio tracking and research support only. It is not financial advice.
          </Text>
        </Band>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfacePage },
  header: { paddingHorizontal: layout.gutter, paddingBottom: space.md },
  account: { flexDirection: "row", alignItems: "center", gap: space.md, marginTop: space.lg },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: layout.radiusPill,
    backgroundColor: colors.brandSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLetter: { fontFamily: fontFamily.uiBold, fontSize: fontSize.body, color: colors.textBrand },
  accountText: { flex: 1, gap: 1 },
  accountName: { fontFamily: fontFamily.uiSemibold, fontSize: fontSize.sm, color: colors.textStrong },
  accountMeta: { fontFamily: fontFamily.ui, fontSize: fontSize.xxs, color: colors.textFaint },
  group: { paddingBottom: space.xs },
  label: { flex: 1, marginLeft: space.md, fontFamily: fontFamily.ui, fontSize: fontSize.body, color: colors.textStrong },
  badge: {
    minWidth: 22,
    textAlign: "center",
    marginRight: space.sm,
    fontFamily: fontFamily.monoSemibold,
    fontSize: fontSize.xxs,
    color: colors.textBrand,
  },
  signOut: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.rule,
    borderRadius: layout.radiusPill,
    backgroundColor: colors.surfaceRaised,
  },
  signOutLabel: { fontFamily: fontFamily.uiSemibold, fontSize: fontSize.body, color: colors.textDown },
  footer: {
    marginTop: space.lg,
    fontFamily: fontFamily.ui,
    fontSize: fontSize.xxs,
    lineHeight: 17,
    color: colors.textFaint,
  },
});
