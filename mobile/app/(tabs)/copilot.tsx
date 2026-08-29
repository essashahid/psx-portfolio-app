import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { ArrowUp, Plus } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import type { ArtifactSpec } from "@psx/shared/chat/artifacts";
import { readableChatError } from "@psx/shared/chat/stream";
import { streamChat } from "@/lib/chat-stream";
import { ModelChip, ModelPicker } from "@/components/features/model-picker";
import { api } from "@/lib/api";
import {
  CHAT_MODELS,
  DEFAULT_MODEL_ID,
  firstAvailableModel,
  providerReady,
  type ChatModelId,
  type ProviderStatus,
} from "@psx/shared/ai/models";
import { Artifact } from "@/components/chat/artifacts";
import { Caps, PageTitle } from "@/components/ui/text";
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

export default function CopilotScreen() {
  const { q } = useLocalSearchParams<{ q?: string }>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadId = useRef<string | null>(null);
  const [model, setModel] = useState<ChatModelId>(DEFAULT_MODEL_ID);
  const [providers, setProviders] = useState<ProviderStatus | null>(null);
  const [pickingModel, setPickingModel] = useState(false);

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
        setError(err instanceof Error ? err.message : "The Copilot could not answer.");
        updateLast((m) => ({ ...m, status: undefined }));
      } finally {
        setBusy(false);
      }
    },
    [busy, updateLast]
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
            <Pressable
              onPress={() => {
                void Haptics.selectionAsync();
                threadId.current = null;
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
                      <Text key={pi} style={styles.answerText}>
                        {part.content}
                      </Text>
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfacePage },
  flex: { flex: 1 },
  header: {
    paddingHorizontal: layout.gutter,
    paddingBottom: space.md + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.rule,
  },
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
    color: colors.textFaint,
  },
  scroll: { paddingHorizontal: layout.gutter, paddingTop: space.lg, paddingBottom: space.lg, gap: space.lg },
  intro: { fontFamily: fontFamily.ui, fontSize: fontSize.body, lineHeight: 23, color: colors.textMuted },
  userRow: { alignItems: "flex-end" },
  userBubble: {
    maxWidth: "82%",
    borderRadius: 12,
    backgroundColor: colors.ink,
    paddingHorizontal: 15,
    paddingVertical: 12,
    fontFamily: fontFamily.ui,
    fontSize: fontSize.body,
    lineHeight: 22,
    color: colors.textOnDark,
  },
  answer: { gap: space.xs },
  answerText: { fontFamily: fontFamily.ui, fontSize: fontSize.body, lineHeight: 24, color: colors.textBody },
  statusRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.xs },
  status: { fontFamily: fontFamily.ui, fontSize: fontSize.xxs, color: colors.textFaint },
  error: { fontFamily: fontFamily.ui, fontSize: fontSize.sm, lineHeight: 20, color: colors.textDown },
  disclaimer: { fontFamily: fontFamily.ui, fontSize: fontSize.xxs, lineHeight: 17, color: colors.textFaint },
  composer: {
    paddingHorizontal: layout.gutter,
    paddingTop: space.md,
    paddingBottom: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.rule,
    backgroundColor: colors.surfacePage,
  },
  prompts: { gap: space.sm, paddingBottom: space.md },
  prompt: {
    minHeight: 38,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.ruleStrong,
    borderRadius: layout.radiusPill,
    paddingHorizontal: 15,
  },
  promptText: { fontFamily: fontFamily.ui, fontSize: fontSize.xxs, color: colors.textMuted },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 9 },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.ruleStrong,
    borderRadius: layout.radiusPill,
    backgroundColor: colors.surfacePage,
    paddingHorizontal: 16,
    paddingTop: 13,
    paddingBottom: 13,
    fontFamily: fontFamily.ui,
    fontSize: 16,
    color: colors.textStrong,
  },
  send: {
    width: 48,
    height: 48,
    borderRadius: layout.radiusPill,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  sendInert: { opacity: 0.35 },
});
