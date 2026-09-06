import { useEffect, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";
import type { DividendDeleteRequest, DividendWriteRequest } from "@psx/shared/api/dividends";
import { apiWrite, ApiError } from "@/lib/api";
import { Sheet, SheetError } from "@/components/ui/sheet";
import { Field, Choice } from "@/components/ui/field";
import { Cta, Ghost } from "@/components/ui/button";
import { space } from "@/lib/theme";
import { makeStyles } from "@/lib/theme-context";

const STATUSES = ["received", "announced", "expected", "missing"] as const;
type Status = (typeof STATUSES)[number];

export interface DividendDraft {
  id?: string;
  ticker?: string;
  payment_date?: string | null;
  ex_date?: string | null;
  dividend_per_share?: number | null;
  quantity_held?: number | null;
  amount?: number | null;
  tax?: number | null;
  status?: Status;
  notes?: string | null;
}

const today = () => new Date().toISOString().slice(0, 10);

function parseNum(raw: string): number | null | "invalid" {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : "invalid";
}

export function DividendSheet({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial?: DividendDraft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const styles = useStyles();
  const editing = Boolean(initial?.id);
  const [ticker, setTicker] = useState("");
  const [payDate, setPayDate] = useState(today());
  const [exDate, setExDate] = useState("");
  const [perShare, setPerShare] = useState("");
  const [shares, setShares] = useState("");
  const [gross, setGross] = useState("");
  const [tax, setTax] = useState("");
  const [status, setStatus] = useState<Status>("received");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTicker(initial?.ticker ?? "");
    setPayDate(initial?.payment_date ?? today());
    setExDate(initial?.ex_date ?? "");
    setPerShare(initial?.dividend_per_share != null ? String(initial.dividend_per_share) : "");
    setShares(initial?.quantity_held != null ? String(initial.quantity_held) : "");
    setGross(initial?.amount != null ? String(initial.amount) : "");
    setTax(initial?.tax != null ? String(initial.tax) : "");
    setStatus(initial?.status ?? "received");
    setNotes(initial?.notes ?? "");
    setErrors({});
    setFailure(null);
  }, [open, initial]);

  const ps = parseNum(perShare);
  const sh = parseNum(shares);
  // Rate times holding is what the broker note shows, so the gross fills itself
  // in from the two numbers the user actually has in front of them.
  const derivedGross =
    typeof ps === "number" && typeof sh === "number" ? Math.round(ps * sh * 100) / 100 : null;
  const grossValue = gross.trim() ? parseNum(gross) : derivedGross;

  function validate() {
    const next: Record<string, string> = {};
    if (ticker.trim().length < 1) next.ticker = "A ticker is required.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payDate.trim())) next.payDate = "Use YYYY-MM-DD.";
    if (exDate.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(exDate.trim())) next.exDate = "Use YYYY-MM-DD.";
    const t = parseNum(tax);
    if (t === "invalid") next.tax = "That is not a number.";
    if (typeof t === "number" && t < 0) next.tax = "Tax cannot be negative.";
    if (ps === "invalid") next.perShare = "That is not a number.";
    if (sh === "invalid") next.shares = "That is not a number.";
    if (grossValue === "invalid") next.gross = "That is not a number.";
    if (grossValue === null) next.gross = "Enter the gross amount, or the rate and shares held.";
    else if (typeof grossValue === "number" && grossValue < 0) next.gross = "The amount cannot be negative.";
    setErrors(next);
    if (Object.keys(next).length > 0) return null;
    return { amount: grossValue as number, tax: t === "invalid" ? null : t };
  }

  async function save() {
    const parsed = validate();
    if (!parsed) return;
    setBusy(true);
    setFailure(null);
    try {
      const body: DividendWriteRequest = {
        id: initial?.id,
        ticker: ticker.trim().toUpperCase(),
        payment_date: payDate.trim(),
        ex_date: exDate.trim() || null,
        dividend_per_share: typeof ps === "number" ? ps : null,
        quantity_held: typeof sh === "number" ? sh : null,
        amount: parsed.amount,
        tax: parsed.tax,
        status,
        notes: notes.trim() || null,
      };
      await apiWrite("/api/dividends", editing ? "PATCH" : "POST", body);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved();
      onClose();
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : "Could not save that dividend.");
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete() {
    Alert.alert("Delete dividend", "This removes it from your income record.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          // The sheet only offers delete when it opened on a saved row, so an
          // id is always present here; the guard keeps the request type honest.
          const id = initial?.id;
          if (!id) return;
          setBusy(true);
          try {
            const body: DividendDeleteRequest = { id };
            await apiWrite("/api/dividends", "DELETE", body);
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            onSaved();
            onClose();
          } catch (err) {
            setFailure(err instanceof ApiError ? err.message : "Could not delete that dividend.");
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  return (
    <Sheet
      open={open}
      title={editing ? "Edit dividend" : "Record dividend"}
      onClose={onClose}
      footer={
        <View style={styles.footer}>
          <Cta label={editing ? "Save changes" : "Record dividend"} busy={busy} onPress={save} />
          {editing ? <Ghost label="Delete" onPress={confirmDelete} disabled={busy} /> : null}
        </View>
      }
    >
      <SheetError message={failure} />
      <Field
        label="Ticker"
        value={ticker}
        onChangeText={setTicker}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="MEBL"
        error={errors.ticker}
      />
      <Field
        label="Payment date"
        value={payDate}
        onChangeText={setPayDate}
        keyboardType="numbers-and-punctuation"
        placeholder="2026-08-27"
        error={errors.payDate}
        hint="YYYY-MM-DD"
      />
      <Field
        label="Rate per share"
        value={perShare}
        onChangeText={setPerShare}
        keyboardType="decimal-pad"
        placeholder="4.00"
        error={errors.perShare}
      />
      <Field
        label="Shares held"
        value={shares}
        onChangeText={setShares}
        keyboardType="decimal-pad"
        placeholder="500"
        error={errors.shares}
      />
      <Field
        label="Gross amount"
        value={gross}
        onChangeText={setGross}
        keyboardType="decimal-pad"
        placeholder={derivedGross != null ? String(derivedGross) : "2000"}
        error={errors.gross}
        hint={
          derivedGross != null && !gross.trim()
            ? `Rate times shares gives ${derivedGross.toLocaleString("en-PK")}. Leave blank to use it.`
            : "Before withholding tax."
        }
      />
      <Field
        label="Withholding tax"
        value={tax}
        onChangeText={setTax}
        keyboardType="decimal-pad"
        placeholder="0"
        error={errors.tax}
      />
      <Field
        label="Ex-date"
        value={exDate}
        onChangeText={setExDate}
        keyboardType="numbers-and-punctuation"
        placeholder="Optional"
        error={errors.exDate}
      />
      <Choice label="Status" options={STATUSES} value={status} onChange={setStatus} />
      <Field label="Notes" value={notes} onChangeText={setNotes} placeholder="Optional" multiline />
    </Sheet>
  );
}

const useStyles = makeStyles((c) => ({ footer: { gap: space.sm } }));
