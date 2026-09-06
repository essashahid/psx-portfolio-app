import { useEffect, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import type { HoldingPatchRequest } from "@psx/shared/api/holdings";
import { apiWrite, ApiError } from "@/lib/api";
import { Sheet, SheetError } from "@/components/ui/sheet";
import { Field, Toggle } from "@/components/ui/field";
import { Cta, Ghost } from "@/components/ui/button";
import { fontFamily, fontSize, space } from "@/lib/theme";
import { makeStyles } from "@/lib/theme-context";

export interface PositionDraft {
  quantity: number;
  avgCost: number | null;
  notes: string | null;
  hidden: boolean;
}

/**
 * Editing a position directly, rather than through the trade that created it.
 *
 * The route treats a quantity or cost change as an adjusting ledger entry, so
 * this is the right tool for correcting an opening balance or a bad import,
 * not for recording a trade — a buy belongs in the transaction sheet, where it
 * keeps its date and its price.
 */
export function PositionSheet({
  open,
  ticker,
  initial,
  onClose,
  onSaved,
  onRemoved,
}: {
  open: boolean;
  ticker: string;
  initial: PositionDraft | null;
  onClose: () => void;
  onSaved: () => void;
  /** Called after the ticker and everything attached to it is gone. */
  onRemoved: () => void;
}) {
  const styles = useStyles();
  const [quantity, setQuantity] = useState("");
  const [avgCost, setAvgCost] = useState("");
  const [notes, setNotes] = useState("");
  const [hidden, setHidden] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuantity(initial ? String(initial.quantity) : "");
    setAvgCost(initial?.avgCost != null ? String(initial.avgCost) : "");
    setNotes(initial?.notes ?? "");
    setHidden(initial?.hidden ?? false);
    setErrors({});
    setFailure(null);
  }, [open, initial]);

  async function save() {
    const next: Record<string, string> = {};
    const q = Number(quantity.trim().replace(/,/g, ""));
    const c = avgCost.trim() ? Number(avgCost.trim().replace(/,/g, "")) : null;
    if (!quantity.trim() || !Number.isFinite(q) || q <= 0) {
      next.quantity = "A position needs a quantity above zero. To close it out, record a sell.";
    }
    if (c !== null && (!Number.isFinite(c) || c < 0)) next.avgCost = "That is not a cost.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    setFailure(null);
    try {
      // Hiding is a flag flip the route handles on its own and returns early
      // from, so it cannot travel with a quantity change in one request.
      if (hidden !== (initial?.hidden ?? false)) {
        const flip: HoldingPatchRequest = { hidden };
        await apiWrite(`/api/holdings/${ticker}`, "PATCH", flip);
      }
      const changedQty = q !== initial?.quantity;
      const changedCost = c !== null && c !== initial?.avgCost;
      const changedNotes = notes.trim() !== (initial?.notes ?? "");
      if (changedQty || changedCost || changedNotes) {
        const patch: HoldingPatchRequest = {
          ...(changedQty ? { quantity: q } : {}),
          ...(changedCost ? { avg_cost: c } : {}),
          ...(changedNotes ? { notes: notes.trim() } : {}),
        };
        await apiWrite(`/api/holdings/${ticker}`, "PATCH", patch);
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved();
      onClose();
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : "Could not save that position.");
    } finally {
      setBusy(false);
    }
  }

  function confirmRemove() {
    // This is not "remove the position": it deletes every trade, payout, alert
    // and note for the ticker. The wording has to say so, because it cannot be
    // undone and the ledger is the only record of it.
    Alert.alert(
      `Remove ${ticker} entirely`,
      `This deletes every ${ticker} transaction, dividend, alert, target and journal note. Your ledger will no longer show that you ever held it. Hiding the position keeps the history instead.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete everything",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              await apiWrite(`/api/holdings/${ticker}`, "DELETE");
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              onRemoved();
              onClose();
            } catch (err) {
              setFailure(err instanceof ApiError ? err.message : `Could not remove ${ticker}.`);
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  }

  return (
    <Sheet
      open={open}
      title={`Edit ${ticker} position`}
      onClose={onClose}
      footer={
        <View style={styles.footer}>
          <Cta label="Save changes" busy={busy} onPress={save} />
          <Ghost label={`Remove ${ticker} entirely`} onPress={confirmRemove} disabled={busy} />
        </View>
      }
    >
      <SheetError message={failure} />
      <Text style={styles.lede}>
        Correcting an opening balance or a bad import. A trade belongs in the ledger instead, where
        it keeps its date and its price.
      </Text>
      <Field
        label="Shares held"
        value={quantity}
        onChangeText={setQuantity}
        keyboardType="decimal-pad"
        placeholder="500"
        error={errors.quantity}
      />
      <Field
        label="Average cost"
        value={avgCost}
        onChangeText={setAvgCost}
        keyboardType="decimal-pad"
        placeholder="152.93"
        error={errors.avgCost}
        hint="Per share, including what you paid in charges."
      />
      <Field label="Notes" value={notes} onChangeText={setNotes} placeholder="Optional" multiline />
      <Toggle
        label="Hide from analysis"
        hint="Kept in the ledger, left out of every figure and chart."
        value={hidden}
        onChange={setHidden}
      />
    </Sheet>
  );
}

const useStyles = makeStyles((c) => ({
  footer: { gap: space.sm },
  lede: {
    fontFamily: fontFamily.ui,
    fontSize: fontSize.sm,
    lineHeight: 20,
    color: c.textMuted,
  },
}));
