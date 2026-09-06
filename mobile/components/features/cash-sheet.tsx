import { useEffect, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";
import type { CashMovementPatchRequest, CashMovementWriteRequest } from "@psx/shared/api/cash-movements";
import { apiWrite, ApiError } from "@/lib/api";
import { Sheet, SheetError } from "@/components/ui/sheet";
import { Field, Choice } from "@/components/ui/field";
import { Cta, Ghost } from "@/components/ui/button";
import { space } from "@/lib/theme";
import { makeStyles } from "@/lib/theme-context";

const TYPES = ["CASH_IN", "CASH_OUT", "FEE", "TAX", "DIVIDEND"] as const;
type CashType = (typeof TYPES)[number];

const TYPE_LABEL: Record<CashType, string> = {
  CASH_IN: "Deposit",
  CASH_OUT: "Withdrawal",
  FEE: "Fee",
  TAX: "Tax",
  DIVIDEND: "Dividend",
};

export interface CashDraft {
  id?: string;
  movement_date?: string;
  type?: CashType;
  amount?: number;
  description?: string | null;
}

const today = () => new Date().toISOString().slice(0, 10);

export function CashSheet({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial?: CashDraft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const styles = useStyles();
  const editing = Boolean(initial?.id);
  const [date, setDate] = useState(today());
  const [type, setType] = useState<CashType>("CASH_IN");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDate(initial?.movement_date ?? today());
    setType(initial?.type ?? "CASH_IN");
    setAmount(initial?.amount != null ? String(initial.amount) : "");
    setDescription(initial?.description ?? "");
    setErrors({});
    setFailure(null);
  }, [open, initial]);

  function validate(): number | null {
    const next: Record<string, string> = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) next.date = "Use YYYY-MM-DD.";
    const n = Number(amount.trim().replace(/,/g, ""));
    // The route takes a positive amount and reads direction from the type, so a
    // signed figure here would be silently misread.
    if (!amount.trim() || !Number.isFinite(n) || n <= 0) {
      next.amount = "Enter an amount above zero. The type sets the direction.";
    }
    setErrors(next);
    return Object.keys(next).length > 0 ? null : n;
  }

  async function save() {
    const value = validate();
    if (value === null) return;
    setBusy(true);
    setFailure(null);
    try {
      const body: CashMovementWriteRequest = {
        movement_date: date.trim(),
        type,
        amount: value,
        description: description.trim() || undefined,
      };
      if (editing) {
        const patch: CashMovementPatchRequest = body;
        await apiWrite(`/api/cash-movements/${initial!.id}`, "PATCH", patch);
      }
      else await apiWrite("/api/cash-movements", "POST", body);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved();
      onClose();
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : "Could not save that movement.");
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete() {
    Alert.alert("Delete movement", "Your cash balance will be recalculated without it.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            await apiWrite(`/api/cash-movements/${initial!.id}`, "DELETE");
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            onSaved();
            onClose();
          } catch (err) {
            setFailure(err instanceof ApiError ? err.message : "Could not delete that movement.");
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
      title={editing ? "Edit cash movement" : "Add cash movement"}
      onClose={onClose}
      footer={
        <View style={styles.footer}>
          <Cta label={editing ? "Save changes" : "Add movement"} busy={busy} onPress={save} />
          {editing ? <Ghost label="Delete" onPress={confirmDelete} disabled={busy} /> : null}
        </View>
      }
    >
      <SheetError message={failure} />
      <Choice
        label="Type"
        options={TYPES}
        value={type}
        onChange={setType}
        labelFor={(t) => TYPE_LABEL[t as CashType]}
      />
      <Field
        label="Date"
        value={date}
        onChangeText={setDate}
        keyboardType="numbers-and-punctuation"
        placeholder="2026-08-27"
        error={errors.date}
        hint="YYYY-MM-DD"
      />
      <Field
        label="Amount"
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholder="50000"
        error={errors.amount}
      />
      <Field
        label="Description"
        value={description}
        onChangeText={setDescription}
        placeholder="Optional"
        multiline
      />
    </Sheet>
  );
}

const useStyles = makeStyles((c) => ({ footer: { gap: space.sm } }));
