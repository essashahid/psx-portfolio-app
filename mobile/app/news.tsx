import { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import { Bookmark, BookmarkCheck, ChevronLeft, EyeOff, RefreshCw } from "lucide-react-native";
import type { NewsEventSummary, NewsResponse } from "@psx/shared/api/news";
import { formatPctSigned } from "@psx/shared/format";
import { useApi } from "@/lib/use-api";
import { apiWrite } from "@/lib/api";
import { useMarkSeen } from "@/lib/use-mark-seen";
import { Band, Ledger, LedgerRow } from "@/components/ui/layout";
import { Caps, Figure, PageTitle } from "@/components/ui/text";
import { ErrorNote } from "@/components/status";
import { PageSkeleton } from "@/components/skeleton";
import { Rise } from "@/components/ui/motion";
import {
  colors,
  directionColor,
  fontFamily,
  fontSize,
  layout,
  letterSpacing,
  palette,
  space,
  tracking,
} from "@/lib/theme";

const TABS = [
  { id: "suggested", label: "For you" },
  { id: "market", label: "Market" },
  { id: "companies", label: "Companies" },
  { id: "policy", label: "Policy" },
  { id: "upcoming", label: "Upcoming" },
  { id: "saved", label: "Saved" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const WINDOWS = [
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "all", label: "All" },
] as const;

/** Importance is the one place colour is spent in this screen. */
const IMPORTANCE_COLOR: Record<string, string> = {
  Critical: palette.down2,
  High: palette.saffron2,
};

function open(url: string) {
  void WebBrowser.openBrowserAsync(url, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
  });
}

function Story({
  event,
  lead = false,
  onAct,
}: {
  event: NewsEventSummary;
  /** The lead story gets the summary and a heavier title. */
  lead?: boolean;
  onAct: (event: NewsEventSummary, field: "saved" | "ignored", value: boolean) => void;
}) {
  const importance = IMPORTANCE_COLOR[event.importance];
  return (
    <View style={[styles.story, lead && styles.storyLead]}>
      <Pressable onPress={() => open(event.url)} accessibilityRole="link" accessibilityLabel={event.title}>
        <View style={styles.storyMeta}>
          {event.color ? <View style={[styles.dot, { backgroundColor: event.color }]} /> : null}
          <Figure style={styles.source} numberOfLines={1}>
            {event.source}
          </Figure>
          <Figure style={styles.time}>{event.timeLabel}</Figure>
          {importance ? (
            <Text style={[styles.importance, { color: importance }]}>{event.importance}</Text>
          ) : null}
        </View>

        <Text style={[styles.title, lead && styles.titleLead]}>{event.title}</Text>

        {lead && event.summary ? (
          <Text style={styles.summary} numberOfLines={4}>
            {event.summary}
          </Text>
        ) : null}

        {event.affectedHoldings.length > 0 ? (
          <Figure style={styles.holdings} numberOfLines={1}>
            {event.affectedHoldings.join(" · ")}
            {event.relatedCount > 1 ? `  ·  ${event.relatedCount} sources` : ""}
          </Figure>
        ) : event.relatedCount > 1 ? (
          <Figure style={styles.holdings}>{event.relatedCount} sources</Figure>
        ) : null}

        {/* Why this was surfaced, in the app's own words, so a suggestion is
            never a black box. */}
        {lead && event.whySuggested ? <Text style={styles.why}>{event.whySuggested}</Text> : null}
      </Pressable>

      <View style={styles.storyActions}>
        <Pressable
          onPress={() => onAct(event, "saved", !event.saved)}
          hitSlop={10}
          style={styles.action}
          accessibilityRole="button"
          accessibilityLabel={event.saved ? "Remove from saved" : "Save for later"}
        >
          {event.saved ? (
            <BookmarkCheck size={16} color={colors.textStrong} />
          ) : (
            <Bookmark size={16} color={colors.textFaint} />
          )}
          <Text style={[styles.actionLabel, event.saved && styles.actionLabelOn]}>
            {event.saved ? "Saved" : "Save"}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => onAct(event, "ignored", true)}
          hitSlop={10}
          style={styles.action}
          accessibilityRole="button"
          accessibilityLabel="Hide this story"
        >
          <EyeOff size={16} color={colors.textFaint} />
          <Text style={styles.actionLabel}>Hide</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function NewsScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("suggested");
  const [windowId, setWindowId] = useState<string>("week");
  const [ticker, setTicker] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const path = useMemo(() => {
    const params = new URLSearchParams({ tab, window: windowId });
    if (ticker) params.set("ticker", ticker);
    return `/api/portfolio/news?${params.toString()}`;
  }, [tab, windowId, ticker]);

  const { data, error, loading, refreshing, refresh } = useApi<NewsResponse>(
    path,
    "Could not load the news."
  );

  // Stamped once the feed is actually on screen. The count above was read from
  // this same response, so it survives the visit and the next one measures
  // from here.
  useMarkSeen("news", data !== null);

  const act = useCallback(
    async (event: NewsEventSummary, field: "saved" | "ignored", value: boolean) => {
      void Haptics.selectionAsync();
      try {
        await apiWrite("/api/news/article-action", "POST", {
          // The action writes against the article row, not the event cluster.
          id: event.articleId,
          storage: event.storage,
          field,
          value,
        });
        refresh();
      } catch {
        // The list is still readable and the action is repeatable, so a failed
        // save does not deserve a blocking alert.
      }
    },
    [refresh]
  );

  /** Fetching sources is slow enough that it needs its own busy state. */
  const refreshSources = useCallback(async () => {
    void Haptics.selectionAsync();
    setBusy(true);
    try {
      await apiWrite("/api/news/refresh", "POST", {});
      refresh();
    } catch {
      /* the existing feed is still on screen */
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  if (loading) return <PageSkeleton rows={7} />;

  const groups = data?.groups ?? [];
  const empty = !data || (data.count === 0 && tab !== "upcoming");
  // A tab with nothing in it should point at one that has something, rather
  // than leaving the reader to hunt for it.
  const busiest = (data?.tabs ?? [])
    .filter((entry) => entry.id !== tab && entry.count > 0)
    .sort((a, b) => b.count - a.count)[0];

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.textMuted} />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headRow}>
            <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back} accessibilityRole="button">
              <ChevronLeft size={20} color={colors.textMuted} />
              <Text style={styles.backLabel}>Back</Text>
            </Pressable>
            <Pressable
              onPress={refreshSources}
              hitSlop={12}
              disabled={busy}
              style={styles.refresh}
              accessibilityRole="button"
              accessibilityLabel="Fetch the latest from every source"
            >
              <RefreshCw size={16} color={busy ? colors.textFaint : colors.textMuted} />
            </Pressable>
          </View>
          <PageTitle style={styles.pageTitle}>News</PageTitle>
          <Figure style={styles.health}>{data?.sourceHealth ?? ""}</Figure>
          {data && data.newSinceLastVisit > 0 ? (
            <Figure style={styles.since}>{data.newSinceLastVisit} since your last visit</Figure>
          ) : null}
        </View>

        {/* Tabs first, then the date window: what you are reading about, then
            how far back. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.rail}
        >
          {TABS.map((entry) => {
            const count = data?.tabs.find((t) => t.id === entry.id)?.count ?? 0;
            const on = entry.id === tab;
            return (
              <Pressable
                key={entry.id}
                onPress={() => {
                  void Haptics.selectionAsync();
                  setTab(entry.id);
                }}
                style={styles.tab}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.tabLabel, on && styles.tabLabelOn]}>{entry.label}</Text>
                <Figure style={styles.tabCount}>{count > 0 ? count : " "}</Figure>
                <View style={[styles.tabRule, on && styles.tabRuleOn]} />
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Saved is a place you put things deliberately, so a date window has
            no business hiding them, and showing one selected would imply it
            does. Upcoming is dated forwards and the window looks backwards. */}
        <View style={styles.windowRow}>
          {(tab === "saved" || tab === "upcoming" ? [] : WINDOWS).map((entry) => {
            const on = entry.id === windowId;
            return (
              <Pressable
                key={entry.id}
                onPress={() => {
                  void Haptics.selectionAsync();
                  setWindowId(entry.id);
                }}
                style={[styles.chip, on && styles.chipOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{entry.label}</Text>
              </Pressable>
            );
          })}
          {ticker ? (
            <Pressable
              onPress={() => setTicker(null)}
              style={[styles.chip, styles.chipOn]}
              accessibilityRole="button"
              accessibilityLabel={`Clear the ${ticker} filter`}
            >
              <Text style={styles.chipLabelOn}>{ticker} ✕</Text>
            </Pressable>
          ) : null}
        </View>

        <Band>
          <ErrorNote message={error} />

          {tab === "upcoming" ? (
            data && data.upcoming.length > 0 ? (
              <Ledger>
                {data.upcoming.map((item, i) => (
                  <Rise key={item.id} index={i}>
                    <LedgerRow onPress={item.href ? () => open(item.href!) : undefined}>
                      <Figure style={styles.upcomingDate}>{item.date.slice(5)}</Figure>
                      <View style={styles.upcomingBody}>
                        <Text style={styles.upcomingTitle}>{item.title}</Text>
                        <Figure style={styles.upcomingMeta} numberOfLines={1}>
                          {item.topic} · {item.relevance}
                        </Figure>
                      </View>
                    </LedgerRow>
                  </Rise>
                ))}
              </Ledger>
            ) : (
              <Text style={styles.empty}>
                Nothing scheduled. Confirmed payouts and PSX events appear here as they are
                announced.
              </Text>
            )
          ) : empty ? (
            <View style={styles.emptyBlock}>
              <Text style={styles.empty}>
                {tab === "saved"
                  ? "Nothing saved yet. Save a story from any tab and it waits for you here."
                  : windowId === "today"
                    ? "Nothing published today in this section."
                    : "Nothing in this section for the period you picked."}
              </Text>
              <View style={styles.emptyLinks}>
                {tab !== "saved" && windowId !== "all" ? (
                  <Pressable onPress={() => setWindowId("all")} accessibilityRole="button" hitSlop={8}>
                    <Text style={styles.link}>Look at all time</Text>
                  </Pressable>
                ) : null}
                {busiest ? (
                  <Pressable
                    onPress={() => setTab(busiest.id as TabId)}
                    accessibilityRole="button"
                    hitSlop={8}
                  >
                    <Text style={styles.link}>
                      {busiest.count} stories under {busiest.label}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ) : (
            <>
              {data?.featured ? (
                <Rise>
                  <Story event={data.featured} lead onAct={act} />
                </Rise>
              ) : null}

              {groups.map((group) => (
                <View key={group.dateKey} style={styles.group}>
                  <Caps style={styles.groupHead}>{group.label}</Caps>
                  {group.events.map((event, i) => (
                    <Rise key={event.id} index={i}>
                      <Story event={event} onAct={act} />
                    </Rise>
                  ))}
                </View>
              ))}
            </>
          )}
        </Band>

        {/* The symbols rail sits under the feed rather than above it: it is a
            way to narrow what you are already reading, not the way in. */}
        {data && data.symbols.length > 0 ? (
          <Band style={styles.symbolBand}>
            <Caps style={styles.groupHead}>Filter by holding</Caps>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.symbols}>
              {data.symbols.map((symbol) => (
                <Pressable
                  key={symbol.ticker}
                  onPress={() => {
                    void Haptics.selectionAsync();
                    setTicker(ticker === symbol.ticker ? null : symbol.ticker);
                  }}
                  style={[styles.symbol, ticker === symbol.ticker && styles.symbolOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: ticker === symbol.ticker }}
                >
                  <Text style={[styles.symbolTicker, ticker === symbol.ticker && styles.symbolTickerOn]}>
                    {symbol.ticker}
                  </Text>
                  <Figure
                    style={[
                      styles.symbolMove,
                      { color: ticker === symbol.ticker ? colors.textOnDarkMuted : directionColor(symbol.move) },
                    ]}
                  >
                    {symbol.move === null ? "—" : formatPctSigned(symbol.move, 1)}
                  </Figure>
                  {symbol.count > 0 ? (
                    <Figure
                      style={[
                        styles.symbolCount,
                        ticker === symbol.ticker && styles.symbolTickerOn,
                      ]}
                    >
                      {symbol.count}
                    </Figure>
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>
          </Band>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfacePage },
  header: { paddingHorizontal: layout.gutter, paddingBottom: space.md },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  back: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 36, marginLeft: -4 },
  backLabel: { fontFamily: fontFamily.uiMedium, fontSize: fontSize.sm, color: colors.textMuted },
  refresh: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  pageTitle: { marginTop: space.xs },
  health: { marginTop: space.sm, fontSize: fontSize.xxs, color: colors.textFaint },
  since: { marginTop: 2, fontSize: fontSize.xxs, color: colors.textMuted },

  rail: { paddingHorizontal: layout.gutter, gap: space.lg, alignItems: "flex-start" },
  tab: { alignItems: "center", paddingBottom: 0 },
  tabLabel: { fontFamily: fontFamily.uiMedium, fontSize: fontSize.sm, color: colors.textMuted },
  tabLabelOn: { fontFamily: fontFamily.uiSemibold, color: colors.textStrong },
  tabCount: { fontSize: 10, lineHeight: 14, color: colors.textFaint, marginTop: 1 },
  // The rule carries the state, so the label itself does not have to shout.
  tabRule: { height: 2, width: "100%", marginTop: space.xs, backgroundColor: "transparent" },
  tabRuleOn: { backgroundColor: colors.ink },

  windowRow: {
    flexDirection: "row",
    gap: space.xs,
    paddingHorizontal: layout.gutter,
    paddingTop: space.lg,
    paddingBottom: space.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.rule,
  },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: layout.radiusPill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
  },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipLabel: { fontFamily: fontFamily.uiMedium, fontSize: fontSize.xxs, color: colors.textMuted },
  chipLabelOn: { fontFamily: fontFamily.uiMedium, fontSize: fontSize.xxs, color: colors.textOnDark },

  group: { marginBottom: space.lg },
  groupHead: { marginBottom: space.md },
  story: {
    paddingVertical: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.rule,
    gap: space.xs,
  },
  storyLead: {
    paddingTop: 0,
    paddingBottom: space.xl,
    marginBottom: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.ruleStrong,
  },
  storyMeta: { flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: 2 },
  dot: { width: 7, height: 7, borderRadius: 2 },
  source: { fontSize: fontSize.xxs, color: colors.textMuted, flexShrink: 1 },
  time: { fontSize: fontSize.xxs, color: colors.textFaint },
  importance: { fontFamily: fontFamily.uiSemibold, fontSize: 10, letterSpacing: 0.3 },
  title: {
    fontFamily: fontFamily.uiSemibold,
    fontSize: fontSize.body,
    lineHeight: 22,
    color: colors.textStrong,
  },
  titleLead: {
    fontFamily: fontFamily.display,
    fontSize: fontSize.h2,
    lineHeight: 32,
    letterSpacing: letterSpacing(fontSize.h2, tracking.editorial),
  },
  summary: { fontFamily: fontFamily.ui, fontSize: fontSize.sm, lineHeight: 21, color: colors.textMuted },
  holdings: { fontSize: fontSize.xxs, color: colors.textFaint, marginTop: 2 },
  why: { fontFamily: fontFamily.ui, fontSize: fontSize.xxs, lineHeight: 17, color: colors.textMuted, marginTop: space.xs },
  storyActions: { flexDirection: "row", gap: space.xl, marginTop: space.sm },
  action: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 32 },
  actionLabel: { fontFamily: fontFamily.uiMedium, fontSize: fontSize.xxs, color: colors.textFaint },
  actionLabelOn: { color: colors.textStrong },

  upcomingDate: { fontSize: fontSize.xxs, color: colors.textMuted, width: 46 },
  upcomingBody: { flex: 1, gap: 1 },
  upcomingTitle: { fontFamily: fontFamily.uiMedium, fontSize: fontSize.sm, color: colors.textStrong, lineHeight: 20 },
  upcomingMeta: { fontSize: fontSize.xxs, color: colors.textFaint },

  symbolBand: { paddingBottom: space.xxl },
  symbols: { gap: space.sm, paddingRight: layout.gutter },
  symbol: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: layout.radiusSm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
    alignItems: "center",
    minWidth: 74,
    gap: 1,
  },
  symbolOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  symbolTicker: { fontFamily: fontFamily.uiSemibold, fontSize: fontSize.xxs, color: colors.textStrong },
  symbolTickerOn: { color: colors.textOnDark },
  symbolMove: { fontSize: 10 },
  symbolCount: { fontSize: 10, color: colors.textFaint },

  emptyBlock: { gap: space.md, alignItems: "flex-start" },
  emptyLinks: { gap: space.md },
  empty: { fontFamily: fontFamily.ui, fontSize: fontSize.sm, color: colors.textMuted, lineHeight: 20 },
  link: { fontFamily: fontFamily.uiMedium, fontSize: fontSize.sm, color: colors.textStrong },
});
