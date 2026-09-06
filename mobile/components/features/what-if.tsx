import { useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useApi } from "@/lib/use-api";
import { Segmented } from "@/components/segmented";
import { Caps, Figure } from "@/components/ui/text";
import { fontFamily, fontSize, space } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-context";
import { formatNumber, formatSignedPct } from "@psx/shared/format";
import { WHAT_IF_DEFAULT_AMOUNT, WHAT_IF_PRESETS, type WhatIfResponse } from "@psx/shared/api/what-if";

/**
 * "What if I had invested", reading the same route as the web calculator so
 * the answer is identical on both surfaces.
 */
const OPTIONS = WHAT_IF_PRESETS.map((p) => p.label) as unknown as readonly string[];

function yearsAgo(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function WhatIf({ ticker }: { ticker: string }) {
  const styles = useStyles();
  const colors = useColors();
  const [amountText, setAmountText] = useState(String(WHAT_IF_DEFAULT_AMOUNT));
  const [label, setLabel] = useState<string>(WHAT_IF_PRESETS[1].label);
  const typed = Number(amountText.replace(/[^0-9.]/g, "")) || 0;
  // An empty field keeps the last answer on screen rather than asking for zero.
  const amount = typed > 0 ? typed : WHAT_IF_DEFAULT_AMOUNT;
  const years = WHAT_IF_PRESETS.find((p) => p.label === label)?.years ?? 3;
  const from = useMemo(() => yearsAgo(years), [years]);
  const path = `/api/stocks/${encodeURIComponent(ticker)}/what-if?amount=${amount}&from=${from}`;
  const { data, error } = useApi<WhatIfResponse>(path, "Could not work this out right now.");
  const r = data ?? null;

  return (
    <View style={styles.block}>
      <Caps style={styles.blockCaps}>What if I had invested?</Caps>
      <View style={styles.controls}>
        <View style={styles.amountWrap}>
          <Caps>Amount, PKR</Caps>
          <TextInput
            value={amountText}
            onChangeText={setAmountText}
            keyboardType="number-pad"
            style={[styles.amount, { color: colors.textStrong, borderColor: colors.rule }]}
            accessibilityLabel="Amount in rupees"
          />
        </View>
        <Segmented options={OPTIONS} value={label} onChange={setLabel} />
      </View>
      {error ? <Text style={styles.reading}>{error}</Text> : null}
      {r ? (
        <>
          <Text style={styles.reading}>
            PKR {formatNumber(r.amount, 0)} on {longDate(r.startDate)} would be about PKR {formatNumber(r.total, 0)} today:{" "}
            {r.priceGain >= 0 ? "up" : "down"} {formatNumber(Math.abs(r.priceGain), 0)} on price
            {r.dividendCount > 0 ? ` plus ${formatNumber(r.dividends, 0)} in dividends before tax` : ""}, a {formatSignedPct(r.totalReturnPct)} return
            {r.annualisedPct !== null ? ` (${formatSignedPct(r.annualisedPct)} a year)` : ""}.
          </Text>
          <View style={styles.grid}>
            <Cell label="Worth today" value={formatNumber(r.total, 0)} sub={`${formatNumber(r.sharesNow, 0)} shares, today's terms`} />
            <Cell label="From price" value={`${r.priceGain >= 0 ? "+" : "-"}${formatNumber(Math.abs(r.priceGain), 0)}`} sub={`bought at ${formatNumber(r.startPrice)}`} tone={r.priceGain >= 0 ? colors.textUp : colors.textDown} />
            <Cell label="From dividends" value={r.dividendCount > 0 ? `+${formatNumber(r.dividends, 0)}` : "none"} sub={r.dividendCount > 0 ? `${r.dividendCount} payouts, before tax` : "on record"} />
            <Cell label="KSE-100, same money" value={r.benchmark ? formatNumber(r.benchmark.valueNow, 0) : "none"} sub={r.benchmark ? `${formatSignedPct(r.benchmark.returnPct)} on price alone` : "no index history"} />
          </View>
          <Text style={styles.footnote}>
            Built on daily closes on file from {longDate(r.earliestDate)} to {longDate(r.endDate)}, as the exchange reports them and
            adjusted for past bonus and split events, so share counts and buy prices are in today's share terms. The exchange serves
            five years; every day recorded here is kept, so the range grows.
            {r.dividendsIncomplete
              ? r.dividendsKnownFrom
                ? ` Cash dividends on record from ${longDate(r.dividendsKnownFrom)}; earlier ones are not counted, so the dividend line is an undercount.`
                : " No dividend record exists for this company yet, so none are counted."
              : " Every recorded cash dividend in the window is counted."}
            {" "}Dividends are before withholding tax. Prices are delayed closes.
            {r.bonusEvents > 0 ? ` Includes ${r.bonusEvents} bonus or split event${r.bonusEvents === 1 ? "" : "s"} in the window.` : ""} Arithmetic on the past, not a forecast.
          </Text>
        </>
      ) : null}
    </View>
  );
}

function Cell({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.cell}>
      <Caps>{label}</Caps>
      <Figure style={[styles.cellValue, tone ? { color: tone } : null]}>{value}</Figure>
      <Text style={styles.cellSub}>{sub}</Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  block: { paddingTop: space.lg, gap: space.sm },
  blockCaps: { marginBottom: space.xs },
  controls: { gap: space.sm },
  amountWrap: { gap: 4 },
  amount: {
    fontFamily: fontFamily.monoSemibold,
    fontSize: fontSize.body,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: space.sm,
    paddingVertical: 8,
  },
  reading: { fontFamily: fontFamily.ui, fontSize: fontSize.body, lineHeight: 22, color: c.textStrong, marginTop: space.xs },
  grid: { flexDirection: "row", flexWrap: "wrap", marginTop: space.xs },
  cell: { width: "50%", paddingVertical: space.xs, paddingRight: space.sm, gap: 2 },
  cellValue: { fontFamily: fontFamily.monoSemibold, fontSize: fontSize.h2, color: c.textStrong },
  cellSub: { fontFamily: fontFamily.ui, fontSize: fontSize.xxs, color: c.textMuted },
  footnote: { fontFamily: fontFamily.ui, fontSize: fontSize.xxs, lineHeight: 16, color: c.textFaint, marginTop: space.xs },
}));
