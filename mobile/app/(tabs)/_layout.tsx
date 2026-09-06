import { useEffect } from "react";
import { StyleSheet, Text } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { Tabs } from "expo-router";
import { Activity, Briefcase, LayoutDashboard, Menu, MessageSquare } from "lucide-react-native";
import { ease, useMotion } from "@/lib/motion";
import { colors, fontFamily, layout, space } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-context";

/**
 * Five fixed slots: Home, Holdings, Market, Ask, More. Everything else
 * lives behind More. Ask sits in the bar on purpose rather than in the
 * sheet, since it is the shortest route from a number to an explanation.
 *
 * The active slot is a filled indigo pill rather than a tinted glyph, which is
 * what the handoff specifies and what survives being glanced at. The fill
 * grows in rather than appearing, so the eye can follow where it went.
 */
const ICONS = {
  index: LayoutDashboard,
  holdings: Briefcase,
  market: Activity,
  copilot: MessageSquare,
  more: Menu,
} as const;

function Slot({ name, label, focused }: { name: keyof typeof ICONS; label: string; focused: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  const Icon = ICONS[name];
  const { ms } = useMotion();
  const fill = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    fill.value = ease(focused ? 1 : 0, ms("fast"));
  }, [focused, fill, ms]);

  const pill = useAnimatedStyle(() => ({ opacity: fill.value }));

  return (
    <Animated.View style={styles.slot}>
      <Animated.View style={[styles.slotFill, pill]} pointerEvents="none" />
      <Icon size={19} color={focused ? "#ffffff" : colors.textMuted} strokeWidth={2} />
      {/* Five labels across a phone leaves each one very little room, and a
          wrapped "Ho / ldi / ngs" is worse than a slightly tight one. */}
      <Text numberOfLines={1} style={[styles.label, focused && styles.labelActive]}>
        {label}
      </Text>
    </Animated.View>
  );
}

export default function TabsLayout() {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: styles.bar,
        tabBarItemStyle: styles.item,
        // The slot draws its own icon and label together so the active state
        // can be one pill behind both. That means the icon container has to be
        // the whole slot, otherwise the label is measured against an icon-sized
        // box and truncates to "Co…".
        tabBarIconStyle: styles.iconSlot,
        sceneStyle: { backgroundColor: colors.surfacePage },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ tabBarIcon: ({ focused }) => <Slot name="index" label="Home" focused={focused} /> }}
      />
      <Tabs.Screen
        name="holdings"
        options={{ tabBarIcon: ({ focused }) => <Slot name="holdings" label="Holdings" focused={focused} /> }}
      />
      <Tabs.Screen
        name="market"
        options={{ tabBarIcon: ({ focused }) => <Slot name="market" label="Market" focused={focused} /> }}
      />
      <Tabs.Screen
        name="copilot"
        options={{ tabBarIcon: ({ focused }) => <Slot name="copilot" label="Ask" focused={focused} /> }}
      />
      <Tabs.Screen
        name="more"
        options={{ tabBarIcon: ({ focused }) => <Slot name="more" label="More" focused={focused} /> }}
      />
    </Tabs>
  );
}

const useStyles = makeStyles((c) => ({
  bar: {
    height: 68,
    paddingTop: 7,
    paddingHorizontal: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.rule,
    backgroundColor: c.surfaceRaised,
    elevation: 0,
  },
  item: { paddingHorizontal: 0 },
  iconSlot: { flex: 1, width: "100%", alignSelf: "stretch" },
  slot: {
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    alignSelf: "stretch",
    minHeight: 50,
    width: "100%",
    paddingHorizontal: 2,
    borderRadius: layout.radiusSm,
  },
  // The fill sits behind the glyph and the label so it can fade on its own
  // without taking their colour with it.
  slotFill: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: c.accentPrimary,
    borderRadius: layout.radiusSm,
  },
  label: {
    fontFamily: fontFamily.uiSemibold,
    fontSize: 10,
    letterSpacing: -0.1,
    color: c.textMuted,
  },
  labelActive: { color: "#ffffff" },
}));
