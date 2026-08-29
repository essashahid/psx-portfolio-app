import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Pencil, Trash2 } from "lucide-react-native";
import type { ChatThreadSummary } from "@psx/shared/api/threads";
import { api, apiWrite, ApiError } from "@/lib/api";
import { Sheet, SheetError } from "@/components/ui/sheet";
import { Field } from "@/components/ui/field";
import { Cta, Ghost } from "@/components/ui/button";
import { Shimmer } from "@/components/ui/motion";
import { colors, fontFamily, fontSize, layout, space } from "@/lib/theme";

/**
 * "Yesterday", "3 days ago", then the date. A saved conversation is found by
 * roughly when you had it, so the exact minute is noise.
 */
function whenLabel(value: string | null): string {
  if (!value) return "no messages";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) {
    const mins = Math.max(1, Math.round((Date.now() - date.getTime()) / 60_000));
    if (mins < 60) return `${mins} min ago`;
    return `${Math.round(mins / 60)}h ago`;
  }
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString("en-PK", { day: "numeric", month: "short" });
}

/**
 * Past conversations, as a sheet rather than a screen.
 *
 * Picking up an old thread is an interruption to the one you are in, not a
 * destination of its own, and it returns you to the same place either way.
 */
export function ThreadHistory({
  open,
  currentId,
  onClose,
  onOpenThread,
}: {
  open: boolean;
  currentId: string | null;
  onClose: () => void;
  /** Called with the thread to load. The screen owns the loading. */
  onOpenThread: (id: string) => void;
}) {
  const [threads, setThreads] = useState<ChatThreadSummary[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<ChatThreadSummary | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setFailure(null);
    try {
      const res = await api<{ threads: ChatThreadSummary[] }>("/api/chat/threads");
      setThreads(res.threads);
    } catch (err) {
      setThreads([]);
      setFailure(err instanceof ApiError ? err.message : "Could not load your saved chats.");
    }
  }, []);

  // Reloaded on every open: a conversation you had since last looking should
  // be here, and the list is cheap.
  useEffect(() => {
    if (!open) return;
    setRenaming(null);
    void load();
  }, [open, load]);

  async function saveTitle() {
    if (!renaming) return;
    const next = title.trim();
    if (!next) return;
    setBusy(true);
    try {
      await apiWrite(`/api/chat/threads/${renaming.id}`, "PATCH", { title: next });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setRenaming(null);
      await load();
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : "Could not rename that chat.");
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete(thread: ChatThreadSummary) {
    Alert.alert("Delete this chat", `"${thread.title}" and everything in it goes for good.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await apiWrite(`/api/chat/threads/${thread.id}`, "DELETE");
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            await load();
          } catch (err) {
            setFailure(err instanceof ApiError ? err.message : "Could not delete that chat.");
          }
        },
      },
    ]);
  }

  if (renaming) {
    return (
      <Sheet
        open={open}
        title="Rename chat"
        onClose={() => setRenaming(null)}
        footer={
          <View style={styles.footer}>
            <Cta label="Save name" busy={busy} onPress={saveTitle} />
            <Ghost label="Cancel" onPress={() => setRenaming(null)} disabled={busy} />
          </View>
        }
      >
        <SheetError message={failure} />
        <Field label="Name" value={title} onChangeText={setTitle} autoFocus />
      </Sheet>
    );
  }

  return (
    <Sheet open={open} title="Past chats" onClose={onClose}>
      <SheetError message={failure} />

      {threads === null ? (
        <View style={styles.loading}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={styles.loadingRow}>
              <Shimmer width="70%" height={15} />
              <Shimmer width="40%" height={11} style={styles.gap} />
            </View>
          ))}
        </View>
      ) : threads.length === 0 ? (
        <Text style={styles.empty}>
          Nothing saved yet. A conversation is kept as soon as you ask something, and you can come
          back to it here.
        </Text>
      ) : (
        <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
          {threads.map((thread) => {
            const current = thread.id === currentId;
            return (
              <View key={thread.id} style={styles.row}>
                <Pressable
                  onPress={() => {
                    void Haptics.selectionAsync();
                    onOpenThread(thread.id);
                  }}
                  style={({ pressed }) => [styles.rowMain, pressed && styles.rowPressed]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: current }}
                  accessibilityLabel={`Open ${thread.title}`}
                >
                  <Text style={[styles.title, current && styles.titleCurrent]} numberOfLines={1}>
                    {thread.title}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {current ? "open now · " : ""}
                    {whenLabel(thread.last_message_at ?? thread.updated_at)}
                    {thread.summary ? ` · ${thread.summary}` : ""}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    void Haptics.selectionAsync();
                    setTitle(thread.title);
                    setRenaming(thread);
                  }}
                  hitSlop={10}
                  style={styles.action}
                  accessibilityRole="button"
                  accessibilityLabel={`Rename ${thread.title}`}
                >
                  <Pencil size={16} color={colors.textFaint} />
                </Pressable>
                <Pressable
                  onPress={() => confirmDelete(thread)}
                  hitSlop={10}
                  style={styles.action}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${thread.title}`}
                >
                  <Trash2 size={16} color={colors.textFaint} />
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  footer: { gap: space.sm },
  loading: { gap: space.lg },
  loadingRow: { gap: 2 },
  gap: { marginTop: space.xs },
  list: { maxHeight: 420 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.rule,
  },
  rowMain: {
    flex: 1,
    minHeight: layout.hitMin,
    justifyContent: "center",
    paddingVertical: space.sm,
    gap: 2,
  },
  rowPressed: { backgroundColor: colors.surfaceSunken },
  title: { fontFamily: fontFamily.uiMedium, fontSize: fontSize.body, color: colors.textStrong },
  titleCurrent: { fontFamily: fontFamily.uiSemibold },
  meta: { fontFamily: fontFamily.ui, fontSize: fontSize.xxs, color: colors.textFaint },
  action: { width: 40, height: layout.hitMin, alignItems: "center", justifyContent: "center" },
  empty: { fontFamily: fontFamily.ui, fontSize: fontSize.sm, lineHeight: 20, color: colors.textMuted },
});
