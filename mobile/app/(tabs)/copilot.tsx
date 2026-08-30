import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { ArrowUp, History, Plus } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import type { ArtifactSpec } from "@psx/shared/chat/artifacts";
import { readableChatError } from "@psx/shared/chat/stream";
import { streamChat } from "@/lib/chat-stream";
import { ModelChip, ModelPicker } from "@/components/features/model-picker";
import { ThreadHistory } from "@/components/features/thread-history";
import { splitContentWithMarkers, stripArtifactMarkers } from "@psx/shared/chat/md-table";
import type { SavedChatMessage, ThreadDetailResponse } from "@psx/shared/api/threads";
import { api, ApiError } from "@/lib/api";
import {
  CHAT_MODELS,
  DEFAULT_MODEL_ID,
  firstAvailableModel,
  providerReady,
  type ChatModelId,
  type ProviderStatus,
} from "@psx/shared/ai/models";
import { Artifact } from "@/components/chat/artifacts";
import { Markdown } from "@/components/chat/markdown";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Caps, PageTitle } from "@/components/ui/text";
import { makeStyles, useColors } from "@/lib/theme-context";
import {
  colors,
  fontFamily,
  fontSize,
  layout,
  letterSpacing,
  space,
  tracking,
} from "@/lib/theme";

type Part = { type: "text"; content: string } | { type: "artifact"; spec: ArtifactSpec };
type Message = { role: "user" | "assistant"; parts: Part[]; status?: string };

const PROMPTS = [
  "What should I trim?",
  "Dividend outlook",
  "Which holding carries the most risk?",
  "How am I doing against the KSE-100?",
];

const MODEL_KEY = "plumb.chat.model";

export default function CopilotScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { q } = useLocalSearchParams<{ q?: string }>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadId = useRef<string | null>(null);
  const [model, setModelState] = useState<ChatModelId>(DEFAULT_MODEL_ID);

  // The picker choice survives restarts. Without this the state reset to the
  // default on every launch, so a question quietly went to a model the user
  // had moved away from, and its provider's errors made no sense to them.
  const setModel = useCallback((next: React.SetStateAction<ChatModelId>) => {
    setModelState((current) => {
      const value = typeof next === "function" ? next(current) : next;
      AsyncStorage.setItem(MODEL_KEY, value).catch(() => {});
      return value;
    });
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(MODEL_KEY)
      .then((stored) => {
        if (stored && CHAT_MODELS.some((m) => m.id === stored)) {
          setModelState(stored as ChatModelId);
        }
      })
      .catch(() => {});
  }, []);
  const [providers, setProviders] = useState<ProviderStatus | null>(null);
  const [pickingModel, setPickingModel] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);

  /**
   * Which providers this account may use. Loaded once: it changes when a key
   * or an account setting changes, neither of which happens mid-conversation.
   * The default is only overridden when it turns out to be unusable, so a
   * working choice is never quietly swapped out from under the user.
   */
  useEffect(() => {
    let live = true;
    void api<{ providers: ProviderStatus }>("/api/chat/models")
      .then((res) => {
        if (!live) return;
        setProviders(res.providers);
        setModel((current) => {
          const def = CHAT_MODELS.find((m) => m.id === current);
          if (def && providerReady(res.providers, def.provider)) return current;
          return firstAvailableModel(res.providers);
        });
      })
      .catch(() => {
        // The chat route decides for itself what it can run, so a failed
        // lookup costs the picker its labels, not the conversation.
      });
    return () => {
      live = false;
    };
  }, []);
  const scrollRef = useRef<ScrollView>(null);

  const updateLast = useCallback((fn: (m: Message) => Message) => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const copy = [...prev];
      copy[copy.length - 1] = fn(copy[copy.length - 1]);
      return copy;
    });
  }, []);

  /**
   * A saved message back into the shape the screen renders.
   *
   * The artifacts were persisted as cards under kind "artifact", and their
   * place in the prose as [[artifact:N]] markers. Restoring both is what makes
   * a reopened answer read the way it did when it streamed, rather than as a
   * wall of text with every chart dumped underneath it.
   */
  const restoreMessage = useCallback((row: SavedChatMessage): Message => {
    const cards = Array.isArray(row.cards) ? row.cards : [];
    const specs = cards
      .filter((card) => card.kind === "artifact")
      .map((card) => card.data as ArtifactSpec);
    // RestoredPart has both fields optional, so each is narrowed rather than
    // trusted: a marker pointing at a spec that is no longer there would
    // otherwise render as an empty artifact.
    const parts: Part[] = [];
    for (const part of splitContentWithMarkers(row.content, specs)) {
      if (part.type === "artifact" && part.spec) parts.push({ type: "artifact", spec: part.spec });
      else if (part.content) parts.push({ type: "text", content: part.content });
    }
    return {
      role: row.role,
      parts: parts.length > 0 ? parts : [{ type: "text", content: stripArtifactMarkers(row.content) }],
    };
  }, []);

  const openThread = useCallback(
    async (id: string) => {
      if (busy) return;
      setHistoryOpen(false);
      setError(null);
      try {
        const data = await api<ThreadDetailResponse>(`/api/chat/threads/${id}`);
        threadId.current = data.thread.id;
        setCurrentThreadId(data.thread.id);
        setMessages(data.messages.map(restoreMessage));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not open that chat.");
      }
    },
    [busy, restoreMessage]
  );

  const ask = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || busy) return;

      void Haptics.selectionAsync();
      setInput("");
      setError(null);
      setBusy(true);
      setMessages((prev) => [
        ...prev,
        { role: "user", parts: [{ type: "text", content: text }] },
        { role: "assistant", parts: [{ type: "text", content: "" }], status: "Reading your book" },
      ]);

      try {
        await streamChat({ message: text, threadId: threadId.current, model }, (event) => {
          switch (event.type) {
            case "thread":
              threadId.current = event.thread.id;
              setCurrentThreadId(event.thread.id);
              break;
            case "text":
              updateLast((m) => {
                const parts = [...m.parts];
                const last = parts[parts.length - 1];
                if (last?.type === "text") {
                  parts[parts.length - 1] = { type: "text", content: last.content + event.delta };
                } else {
                  parts.push({ type: "text", content: event.delta });
                }
                return { ...m, parts };
              });
              break;
            case "artifact":
              updateLast((m) => ({ ...m, parts: [...m.parts, { type: "artifact", spec: event.spec }] }));
              break;
            case "reset":
              updateLast((m) => ({ ...m, parts: [{ type: "text", content: "" }] }));
              break;
            case "activity":
              updateLast((m) => ({ ...m, status: event.done ? m.status : event.label }));
              break;
            case "status":
              updateLast((m) => ({ ...m, status: event.text }));
              break;
            case "incomplete":
              updateLast((m) => ({
                ...m,
                parts: [
                  ...m.parts,
                  {
                    type: "text",
                    content:
                      "\n\nThis answer may be cut short. Ask a narrower follow-up to get the rest.",
                  },
                ],
              }));
              break;
            case "error":
              // The server explained what went wrong; showing it beats an empty
              // answer, which is what happens when a client ignores an event
              // type it does not recognise.
              setError(readableChatError(event.message));
              updateLast((m) => ({ ...m, status: undefined }));
              break;
            case "done":
              updateLast((m) => ({ ...m, status: undefined }));
              break;
            case "meta":
            case "thinking":
            case "cards":
            case "parse-error":
              break;
          }
        });
      } catch (err) {
        const label = CHAT_MODELS.find((m) => m.id === model)?.label ?? model;
        const detail = err instanceof Error ? err.message : "The Copilot could not answer.";
        setError(`${label}: ${detail}`);
        updateLast((m) => ({ ...m, status: undefined }));
      } finally {
        setBusy(false);
      }
    },
    [busy, updateLast, model]
  );

  // Arriving from a company page with a question already in mind.
  const deepLink = useRef(false);
  useEffect(() => {
    if (q && !deepLink.current) {
      deepLink.current = true;
      setInput(q);
    }
  }, [q]);

  const empty = messages.length === 0;

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      {/* From react-native-keyboard-controller, not react-native: Android 15
          enforces edge-to-edge, so the window no longer resizes for the
          keyboard and the built-in one has nothing to measure. */}
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <View style={styles.header}>
          <View style={styles.headerBar}>
            <View style={styles.titleRow}>
              <PageTitle>Copilot</PageTitle>
              <ModelChip
                label={CHAT_MODELS.find((m) => m.id === model)?.label ?? "Model"}
                onPress={() => setPickingModel(true)}
              />
            </View>
            <View style={styles.headerActions}>
              <Pressable
                onPress={() => {
                  void Haptics.selectionAsync();
                  setHistoryOpen(true);
                }}
                hitSlop={12}
                accessibilityLabel="Past chats"
                accessibilityRole="button"
              >
                <History size={19} color={colors.textMuted} />
              </Pressable>
              <Pressable
                onPress={() => {
                  void Haptics.selectionAsync();
                  threadId.current = null;
                  setCurrentThreadId(null);
                  setMessages([]);
                  setError(null);
                }}
                hitSlop={12}
                accessibilityLabel="New conversation"
                accessibilityRole="button"
              >
                <Plus size={19} color={colors.textMuted} />
              </Pressable>
            </View>
          </View>
          <Text style={styles.grounding}>Grounded in your holdings, dividends and PSX data</Text>
        </View>

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {empty ? (
            <Text style={styles.intro}>
              Ask about your holdings, a company, or how the book is doing. Answers read your
              actual portfolio, so they are specific to what you own.
            </Text>
          ) : null}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <View key={i} style={styles.userRow}>
                <Text style={styles.userBubble}>
                  {m.parts.map((p) => (p.type === "text" ? p.content : "")).join("")}
                </Text>
              </View>
            ) : (
              <View key={i} style={styles.answer}>
                {m.parts.map((part, pi) =>
                  part.type === "text" ? (
                    part.content ? (
                      <Markdown key={pi}>{part.content}</Markdown>
                    ) : null
                  ) : (
                    <Artifact key={pi} spec={part.spec} />
                  )
                )}
                {m.status ? (
                  <View style={styles.statusRow}>
                    <ActivityIndicator size="small" color={colors.textFaint} />
                    <Text style={styles.status}>{m.status}</Text>
                  </View>
                ) : null}
              </View>
            )
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {!empty ? (
            <Text style={styles.disclaimer}>
              For personal portfolio tracking and research support only. It is not financial
              advice.
            </Text>
          ) : null}
        </ScrollView>

        <View style={styles.composer}>
          {empty ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.prompts}
              keyboardShouldPersistTaps="handled"
            >
              {PROMPTS.map((prompt) => (
                <Pressable key={prompt} style={styles.prompt} onPress={() => void ask(prompt)}>
                  <Text style={styles.promptText}>{prompt}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder="Ask about your book"
              placeholderTextColor={colors.textFaint}
              editable={!busy}
              multiline
              onSubmitEditing={() => void ask(input)}
            />
            <Pressable
              style={[styles.send, (!input.trim() || busy) && styles.sendInert]}
              onPress={() => void ask(input)}
              disabled={!input.trim() || busy}
              accessibilityLabel="Send"
              accessibilityRole="button"
            >
              {busy ? (
                <ActivityIndicator size="small" color={colors.textOnDark} />
              ) : (
                <ArrowUp size={18} color={colors.textOnDark} />
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      <ThreadHistory
        open={historyOpen}
        currentId={currentThreadId}
        onClose={() => setHistoryOpen(false)}
        onOpenThread={openThread}
      />

      <ModelPicker
        open={pickingModel}
        value={model}
        providers={providers}
        onClose={() => setPickingModel(false)}
        onChange={setModel}
      />
    </SafeAreaView>
  );
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.surfacePage },
  flex: { flex: 1 },
  header: {
    paddingHorizontal: layout.gutter,
    paddingBottom: space.md + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.rule,
  },
  headerActions: { flexDirection: "row", alignItems: "center", gap: space.lg },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 46,
  },
  grounding: {
    marginTop: 6,
    fontFamily: fontFamily.ui,
    fontSize: fontSize.xxs,
    color: c.textFaint,
  },
  scroll: { paddingHorizontal: layout.gutter, paddingTop: space.lg, paddingBottom: space.lg, gap: space.lg },
  intro: { fontFamily: fontFamily.ui, fontSize: fontSize.body, lineHeight: 23, color: c.textMuted },
  userRow: { alignItems: "flex-end" },
  userBubble: {
    maxWidth: "82%",
    borderRadius: 12,
    backgroundColor: c.ink,
    paddingHorizontal: 15,
    paddingVertical: 12,
    fontFamily: fontFamily.ui,
    fontSize: fontSize.body,
    lineHeight: 22,
    color: c.textOnDark,
  },
  answer: { gap: space.xs },
  answerText: { fontFamily: fontFamily.ui, fontSize: fontSize.body, lineHeight: 24, color: c.textBody },
  statusRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.xs },
  status: { fontFamily: fontFamily.ui, fontSize: fontSize.xxs, color: c.textFaint },
  error: { fontFamily: fontFamily.ui, fontSize: fontSize.sm, lineHeight: 20, color: c.textDown },
  disclaimer: { fontFamily: fontFamily.ui, fontSize: fontSize.xxs, lineHeight: 17, color: c.textFaint },
  composer: {
    paddingHorizontal: layout.gutter,
    paddingTop: space.md,
    paddingBottom: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.rule,
    backgroundColor: c.surfacePage,
  },
  prompts: { gap: space.sm, paddingBottom: space.md },
  prompt: {
    minHeight: 38,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: c.ruleStrong,
    borderRadius: layout.radiusPill,
    paddingHorizontal: 15,
  },
  promptText: { fontFamily: fontFamily.ui, fontSize: fontSize.xxs, color: c.textMuted },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 9 },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: c.ruleStrong,
    borderRadius: layout.radiusPill,
    backgroundColor: c.surfacePage,
    paddingHorizontal: 16,
    paddingTop: 13,
    paddingBottom: 13,
    fontFamily: fontFamily.ui,
    fontSize: 16,
    color: c.textStrong,
  },
  send: {
    width: 48,
    height: 48,
    borderRadius: layout.radiusPill,
    backgroundColor: c.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  sendInert: { opacity: 0.35 },
}));
