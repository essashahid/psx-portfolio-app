import { useEffect, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { ChevronLeft, LogOut } from "lucide-react-native";
import type { SettingsResponse } from "@psx/shared/api/settings";
import {
  EXPERIENCE_OPTIONS,
  OBJECTIVE_OPTIONS,
  RISK_OPTIONS,
  type ExperienceLevel,
  type Objective,
  type ProfilePatchRequest,
  type RiskProfile,
  type TaxPatchRequest,
} from "@psx/shared/api/settings";
import { formatNumber } from "@psx/shared/format";
import { useApi } from "@/lib/use-api";
import { apiWrite, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Band } from "@/components/ui/layout";
import { Caps, Figure, PageTitle } from "@/components/ui/text";
import { ErrorNote } from "@/components/status";
import { PageSkeleton } from "@/components/skeleton";
import { Field, Toggle } from "@/components/ui/field";
import { Cta } from "@/components/ui/button";
import { colors, fontFamily, fontSize, layout, palette, space } from "@/lib/theme";
import { APP_NAME } from "@/lib/brand";
import { makeStyles, useColors, useTheme, type ThemeMode } from "@/lib/theme-context";

/**
 * A row of options where exactly one is chosen, laid out down the page rather
 * than across it: these labels carry a line of explanation each, and a rail of
 * pills would truncate the part that makes the choice meaningful.
 */
const THEME_OPTIONS = [
  { value: "system" as const, label: "System", detail: "Follow your phone's appearance setting" },
  { value: "light" as const, label: "Light", detail: "Always the paper field" },
  { value: "dark" as const, label: "Dark", detail: "A true-black field, easier at night" },
];

function Choose<T extends string>({
  label,
  options,
  value,
  onChange,
  allowNone,
}: {
  label: string;
  options: readonly { value: T; label: string; detail?: string }[];
  value: T | null;
  onChange: (next: T | null) => void;
  allowNone?: boolean;
}) {
  const styles = useStyles();
  return (
    <View style={styles.block}>
      <Caps style={styles.blockHead}>{label}</Caps>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => {
              void Haptics.selectionAsync();
              onChange(allowNone && on ? null : option.value);
            }}
            style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
          >
            <View style={[styles.radio, on && styles.radioOn]}>
              {on ? <View style={styles.radioDot} /> : null}
            </View>
            <View style={styles.optionText}>
              <Text style={[styles.optionLabel, on && styles.optionLabelOn]}>{option.label}</Text>
              {option.detail ? <Text style={styles.optionDetail}>{option.detail}</Text> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function SettingsScreen() {
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const { signOut } = useAuth();
  const { data, error, loading, refreshing, refresh } = useApi<SettingsResponse>(
    "/api/portfolio/settings",
    "Could not load your settings."
  );

  const [experience, setExperience] = useState<ExperienceLevel>("intermediate");
  const [risk, setRisk] = useState<RiskProfile | null>(null);
  const [objective, setObjective] = useState<Objective | null>(null);
  const [freeCash, setFreeCash] = useState("");
  const [taxRate, setTaxRate] = useState("");
  const [filer, setFiler] = useState(true);
  const [showForecasts, setShowForecasts] = useState(true);
  const [autoConfirm, setAutoConfirm] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  // Seeded from the server once it answers, and again after a pull-to-refresh,
  // so a half-typed value is never overwritten mid-edit by a background load.
  useEffect(() => {
    if (!data) return;
    setExperience(data.profile.experienceLevel);
    setRisk(data.profile.riskProfile);
    setObjective(data.profile.objective);
    setFreeCash(data.profile.freeCash !== null ? String(data.profile.freeCash) : "");
    setFiler(data.tax.taxpayerStatus !== "non-filer");
    setTaxRate(data.tax.dividendTaxRate !== null ? String(Math.round(data.tax.dividendTaxRate * 1000) / 10) : "");
    setShowForecasts(data.tax.showForecastsInReview);
    setAutoConfirm(data.tax.autoCreateConfirmed);
  }, [data]);

  async function save() {
    setBusy(true);
    setFailure(null);
    setSaved(null);
    try {
      const cash = freeCash.trim() ? Number(freeCash.trim().replace(/,/g, "")) : null;
      if (cash !== null && (!Number.isFinite(cash) || cash < 0)) {
        setFailure("Free cash has to be a number, and not a negative one.");
        return;
      }
      const rate = taxRate.trim() ? Number(taxRate.trim()) : null;
      if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 100)) {
        setFailure("The dividend tax rate is a percentage between 0 and 100.");
        return;
      }

      const profile: ProfilePatchRequest = {
        experience_level: experience,
        risk_profile: risk,
        objective,
        free_cash: cash,
      };
      await apiWrite("/api/settings/profile", "PATCH", profile);

      // The tax route takes the whole profile, so unchanged fields are sent
      // back as they came rather than being reset to a default.
      if (data) {
        const tax: TaxPatchRequest = {
          taxpayer_status: filer ? "filer" : "non-filer",
          tax_year: data.tax.taxYear,
          dividend_tax_rate: rate === null ? 0 : rate / 100,
          default_payment_window_days: data.tax.defaultPaymentWindowDays,
          default_face_value: data.tax.defaultFaceValue,
          show_forecasts_in_review: showForecasts,
          auto_create_confirmed: autoConfirm,
        };
        await apiWrite("/api/settings/tax", "POST", tax);
      }

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSaved("Saved.");
      refresh();
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : "Could not save your settings.");
    } finally {
      setBusy(false);
    }
  }

  function confirmSignOut() {
    Alert.alert("Sign out", "You will need to sign in again to see your portfolio.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void signOut() },
    ]);
  }

  if (loading) return <PageSkeleton rows={5} />;

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.textMuted} />
        }
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back} accessibilityRole="button">
            <ChevronLeft size={20} color={colors.textMuted} />
            <Text style={styles.backLabel}>Back</Text>
          </Pressable>
          <PageTitle style={styles.title}>Settings</PageTitle>
          <Figure style={styles.account}>{data?.profile.email ?? ""}</Figure>
        </View>

        <Band>
          <ErrorNote message={error} />

          {/* Stated plainly because it is not obvious: these three answers
              change how every explanation in the app is written. */}
          <Text style={styles.lede}>
            These answers set how {APP_NAME} explains things to you. They do not change any figure,
            only how much is spelled out around it.
          </Text>

          <Choose
            label="Appearance"
            options={THEME_OPTIONS}
            value={themeMode}
            onChange={(next) => next && setThemeMode(next as ThemeMode)}
          />

          <Choose
            label="Experience"
            options={EXPERIENCE_OPTIONS}
            value={experience}
            onChange={(next) => next && setExperience(next)}
          />
          <Choose
            label="Risk comfort"
            options={RISK_OPTIONS}
            value={risk}
            onChange={setRisk}
            allowNone
          />
          <Choose
            label="What you are investing for"
            options={OBJECTIVE_OPTIONS}
            value={objective}
            onChange={setObjective}
            allowNone
          />
        </Band>

        <Band>
          <Caps style={styles.blockHead}>Cash and tax</Caps>
          {/* Band has no rhythm of its own, so the fields carry it here or a
              hint runs straight into the next label. */}
          <View style={styles.stack}>
          <Field
            label="Free cash with the broker"
            value={freeCash}
            onChangeText={setFreeCash}
            keyboardType="decimal-pad"
            placeholder="0"
            hint="Cash the ledger does not already account for. Leave blank if the ledger is complete."
          />
          <Field
            label="Dividend tax rate"
            value={taxRate}
            onChangeText={setTaxRate}
            keyboardType="decimal-pad"
            placeholder={filer ? "15" : "30"}
            hint="A percentage. Pakistan withholds more from non-filers."
          />
          <Toggle
            label="On the active taxpayer list"
            hint="Filers are withheld at the lower rate."
            value={filer}
            onChange={setFiler}
          />
          <Toggle
            label="Show forecast payouts"
            hint="Projected dividends appear alongside announced ones."
            value={showForecasts}
            onChange={setShowForecasts}
          />
          <Toggle
            label="Record confirmed payouts automatically"
            hint="A payout that matches an announcement is entered without asking."
            value={autoConfirm}
            onChange={setAutoConfirm}
          />

          </View>

          {failure ? <Text style={styles.failure}>{failure}</Text> : null}
          {saved ? <Text style={styles.saved}>{saved}</Text> : null}
          <View style={styles.saveRow}>
            <Cta label="Save settings" busy={busy} onPress={save} />
          </View>
        </Band>

        <Band>
          <Caps style={styles.blockHead}>Your data</Caps>
          <View style={styles.counts}>
            <View style={styles.count}>
              <Figure style={styles.countValue}>{formatNumber(data?.transactionCount ?? 0, 0)}</Figure>
              <Text style={styles.countLabel}>transactions</Text>
            </View>
            <View style={styles.count}>
              <Figure style={styles.countValue}>{formatNumber(data?.holdingsCount ?? 0, 0)}</Figure>
              <Text style={styles.countLabel}>holdings</Text>
            </View>
            <View style={styles.count}>
              <Figure style={styles.countValue}>{formatNumber(data?.watchlistCount ?? 0, 0)}</Figure>
              <Text style={styles.countLabel}>watched</Text>
            </View>
          </View>
          <Text style={styles.note}>
            Importing a broker statement, managing accounts and exporting your data all live on the
            web app, where the files are easier to handle.
          </Text>

          <Pressable style={styles.signOut} onPress={confirmSignOut} accessibilityRole="button">
            <LogOut size={17} color={colors.textDown} />
            <Text style={styles.signOutLabel}>Sign out</Text>
          </Pressable>
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
  title: { marginTop: space.xs },
  account: { marginTop: space.sm, fontSize: fontSize.xxs, color: c.textFaint },
  lede: {
    fontFamily: fontFamily.ui,
    fontSize: fontSize.sm,
    lineHeight: 21,
    color: c.textMuted,
    marginBottom: space.xl,
  },
  stack: { gap: space.lg },
  block: { marginBottom: space.xl },
  blockHead: { marginBottom: space.md },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: layout.hitMin,
    paddingVertical: space.sm,
  },
  optionPressed: { backgroundColor: c.surfaceSunken },
  radio: {
    width: 20,
    height: 20,
    borderRadius: layout.radiusPill,
    borderWidth: 1.5,
    borderColor: c.ruleStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  radioOn: { borderColor: c.ink },
  radioDot: { width: 10, height: 10, borderRadius: layout.radiusPill, backgroundColor: c.ink },
  optionText: { flex: 1, gap: 1 },
  optionLabel: { fontFamily: fontFamily.ui, fontSize: fontSize.body, color: c.textStrong },
  optionLabelOn: { fontFamily: fontFamily.uiSemibold },
  optionDetail: { fontFamily: fontFamily.ui, fontSize: fontSize.xxs, color: c.textFaint },
  saveRow: { marginTop: space.xl },
  failure: { fontFamily: fontFamily.ui, fontSize: fontSize.sm, lineHeight: 20, color: c.textDown, marginTop: space.md },
  saved: { fontFamily: fontFamily.ui, fontSize: fontSize.sm, color: palette.up2, marginTop: space.md },
  counts: { flexDirection: "row", gap: space.xxl, marginBottom: space.lg },
  count: { gap: 2 },
  countValue: { fontFamily: fontFamily.monoSemibold, fontSize: fontSize.h3, color: c.textStrong },
  countLabel: { fontFamily: fontFamily.ui, fontSize: fontSize.xxs, color: c.textFaint },
  note: { fontFamily: fontFamily.ui, fontSize: fontSize.sm, lineHeight: 20, color: c.textMuted },
  signOut: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    marginTop: space.xxl,
    minHeight: layout.hitMin,
  },
  signOutLabel: { fontFamily: fontFamily.uiMedium, fontSize: fontSize.body, color: c.textDown },
}));
