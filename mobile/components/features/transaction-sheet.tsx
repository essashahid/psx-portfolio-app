import { useEffect, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";
import { apiWrite, ApiError } from "@/lib/api";
import { Sheet, SheetError } from "@/components/ui/sheet";
import { Field, Choice } from "@/components/ui/field";
import { Cta, Ghost } from "@/components/ui/button";
import { space } from "@/lib/theme";

/** Mirrors the enum the transactions route validates against. */
const TYPES = ["BUY", "SELL", "DIVIDEND", "BONUS", "RIGHT", "SPLIT"] as const;
type TxnType = (typeof TYPES)[number];

export interface TransactionDraft {
  id?: string;
  ticker?: string;
  trade_date?: string;
  type?: TxnType;
  quantity?: number | null;
  price?: number | null;
  commission?: number | null;
  tax?: number | null;
  net_amount?: number | null;
  notes?: string | null;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Empty means "not given"; a bad number must not silently become zero. */
function parseNum(raw: string): number | null | "invalid" {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : "invalid";
}

export function TransactionSheet({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial?: TransactionDraft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = Boolean(initial?.id);
  const [ticker, setTicker] = useState("");
  const [date, setDate] = useState(today());
  const [type, setType] = useState<TxnType>("BUY");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [commission, setCommission] = useState("");
  const [tax, setTax] = useState("");
  const [net, setNet] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset from the draft each time it opens, so a cancelled edit does not leak
  // into the next one.
  useEffect(() => {
    if (!open) return;
    setTicker(initial?.ticker ?? "");
    setDate(initial?.trade_date ?? today());
    setType(initial?.type ?? "BUY");
    setQuantity(initial?.quantity != null ? String(initial.quantity) : "");
    setPrice(initial?.price != null ? String(initial.price) : "");
    setCommission(initial?.commission != null ? String(initial.commission) : "");
    setTax(initial?.tax != null ? String(initial.tax) : "");
    setNet(initial?.net_amount != null ? String(initial.net_amount) : "");
    setNotes(initial?.notes ?? "");
    setErrors({});
    setFailure(null);
  }, [open, initial]);

  const qn = parseNum(quantity);
  const pn = parseNum(price);
  const cn = parseNum(commission);
  const tn = parseNum(tax);

  /**
   * Cash actually leaving or entering the account. The ledger reads net_amount
   * for the debit and credit columns, so leaving it empty would record a trade
   * that never moved any money and quietly overstate cash on hand. Charges add
   * to what a buy costs and come out of what a sell returns.
   */
  const derivedNet =
    typeof qn === "number" && typeof pn === "number"
      ? Math.round(
          (qn * pn +
            (type === "SELL" ? -1 : 1) * ((typeof cn === "number" ? cn : 0) + (typeof tn === "number" ? tn : 0))) *
            100
        ) / 100
      : null;
  const netValue = net.trim() ? parseNum(net) : derivedNet;

  function validate() {
    const next: Record<string, string> = {};
    if (ticker.trim().length < 2) next.ticker = "A ticker is at least two characters.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) next.date = "Use YYYY-MM-DD.";

    if (qn === "invalid") next.quantity = "That is not a number.";
    if (pn === "invalid") next.price = "That is not a number.";
    if (cn === "invalid") next.commission = "That is not a number.";
    if (tn === "invalid") next.tax = "That is not a number.";
    if (netValue === "invalid") next.net = "That is not a number.";
    // A buy or a sell without a quantity cannot be applied to a position, so it
    // is refused here rather than accepted and quietly ignored.
    if (type === "BUY" || type === "SELL") {
      if (qn === null || (typeof qn === "number" && qn <= 0)) {
        next.quantity = "A buy or sell needs a quantity above zero.";
      }
      if (pn === null) next.price = "A buy or sell needs a price.";
    } else if (type !== "DIVIDEND" && (qn === null || qn === 0)) {
      next.quantity = `A ${type.toLowerCase()} needs a quantity.`;
    }
    if (typeof pn === "number" && pn < 0) next.price = "A price cannot be negative.";
    if (typeof cn === "number" && cn < 0) next.commission = "A charge cannot be negative.";
    if (typeof tn === "number" && tn < 0) next.tax = "A charge cannot be negative.";
    if (type === "DIVIDEND" && netValue === null) {
      next.net = "A dividend needs a net amount, or a quantity and a per-share rate.";
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return null;
    return {
      q: qn === "invalid" ? null : qn,
      p: pn === "invalid" ? null : pn,
      c: cn === "invalid" ? null : cn,
      t: tn === "invalid" ? null : tn,
      net: netValue === "invalid" ? null : netValue,
    };
  }

  async function save() {
    const parsed = validate();
    if (!parsed) return;
    setBusy(true);
    setFailure(null);
    try {
      const body = {
        ticker: ticker.trim().toUpperCase(),
        trade_date: date.trim(),
        type,
        quantity: parsed.q ?? undefined,
        price: parsed.p ?? undefined,
        commission: parsed.c ?? undefined,
        tax: parsed.t ?? undefined,
        net_amount: parsed.net ?? undefined,
        notes: notes.trim() || undefined,
      };
      if (editing) {
        // The PATCH schema does not accept DIVIDEND, since a dividend row is
        // owned by the dividends ledger. Leave the type untouched there rather
        // than sending a value the route will refuse.
        const { type: t, ...rest } = body;
        await apiWrite(`/api/transactions/${initial!.id}`, "PATCH", t === "DIVIDEND" ? rest : body);
      } else {
        await apiWrite("/api/transactions", "POST", body);
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved();
      onClose();
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : "Could not save that transaction.");
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete() {
    Alert.alert("Delete transaction", "This removes it from the ledger and rebuilds your position.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            await apiWrite(`/api/transactions/${initial!.id}`, "DELETE");
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            onSaved();
            onClose();
          } catch (err) {
            setFailure(err instanceof ApiError ? err.message : "Could not delete that transaction.");
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  const isDividend = type === "DIVIDEND";

  return (
    <Sheet
      open={open}
      title={editing ? "Edit transaction" : "Add transaction"}
      onClose={onClose}
      footer={
        <View style={styles.footer}>
          <Cta label={editing ? "Save changes" : "Add transaction"} busy={busy} onPress={save} />
          {editing ? <Ghost label="Delete" onPress={confirmDelete} disabled={busy} /> : null}
        </View>
      }
    >
      <SheetError message={failure} />
      <Choice label="Type" options={TYPES} value={type} onChange={setType} />
      <Field
        label="Ticker"
        value={ticker}
        onChangeText={setTicker}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="OGDC"
        error={errors.ticker}
      />
      <Field
        label="Trade date"
        value={date}
        onChangeText={setDate}
        placeholder="2026-08-27"
        keyboardType="numbers-and-punctuation"
        error={errors.date}
        hint="YYYY-MM-DD"
      />
      <Field
        label="Quantity"
        value={quantity}
        onChangeText={setQuantity}
        keyboardType="decimal-pad"
        placeholder="500"
        error={errors.quantity}
      />
      <Field
        label={isDividend ? "Rate per share" : "Price per share"}
        value={price}
        onChangeText={setPrice}
        keyboardType="decimal-pad"
        placeholder="135.50"
        error={errors.price}
      />
      <Field
        label="Commission"
        value={commission}
        onChangeText={setCommission}
        keyboardType="decimal-pad"
        placeholder="0"
        error={errors.commission}
        hint="Brokerage and fees on this trade."
      />
      <Field
        label="Tax"
        value={tax}
        onChangeText={setTax}
        keyboardType="decimal-pad"
        placeholder="0"
        error={errors.tax}
      />
      <Field
        label={type === "SELL" ? "Net proceeds" : "Net amount"}
        value={net}
        onChangeText={setNet}
        keyboardType="decimal-pad"
        placeholder={derivedNet != null ? String(derivedNet) : "0"}
        error={errors.net}
        hint={
          derivedNet != null && !net.trim()
            ? `Leave blank to use ${derivedNet.toLocaleString("en-PK")}, which is what moves in your ledger.`
            : "The cash that actually moved. Your ledger balance uses this."
        }
      />
      <Field label="Notes" value={notes} onChangeText={setNotes} placeholder="Optional" multiline />
    </Sheet>
  );
}

const styles = StyleSheet.create({ footer: { gap: space.sm } });
