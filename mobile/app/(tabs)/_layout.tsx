import { StyleSheet, Text, View } from "react-native";
import { Tabs } from "expo-router";
import { Activity, Briefcase, LayoutDashboard, Menu, MessageSquare } from "lucide-react-native";
import { colors, fontFamily, layout, space } from "@/lib/theme";

/**
 * Five fixed slots: Home, Holdings, Market, Copilot, More. Everything else
 * lives behind More. Copilot sits in the bar on purpose rather than in the
 * sheet, since it is the shortest route from a number to an explanation.
 *
 * The active slot is a filled indigo pill rather than a tinted glyph, which is
 * what the handoff specifies and what survives being glanced at.
 */
const ICONS = {
  index: LayoutDashboard,
  holdings: Briefcase,
  market: Activity,
  copilot: MessageSquare,
  more: Menu,
} as const;

function Slot({ name, label, focused }: { name: keyof typeof ICONS; label: string; focused: boolean }) {
  const Icon = ICONS[name];
  return (
    <View style={[styles.slot, focused && styles.slotActive]}>
      <Icon size={19} color={focused ? "#ffffff" : colors.textMuted} strokeWidth={2} />
      {/* Five labels across a phone leaves each one very little room, and a
          wrapped "Ho / ldi / ngs" is worse than a slightly tight one. */}
      <Text numberOfLines={1} style={[styles.label, focused && styles.labelActive]}>
        {label}
      </Text>
    </View>
  );
}

export default function TabsLayout() {
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
        options={{ tabBarIcon: ({ focused }) => <Slot name="copilot" label="Copilot" focused={focused} /> }}
      />
      <Tabs.Screen
        name="more"
        options={{ tabBarIcon: ({ focused }) => <Slot name="more" label="More" focused={focused} /> }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 68,
    paddingTop: 7,
    paddingHorizontal: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.rule,
    backgroundColor: colors.surfaceRaised,
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
  slotActive: { backgroundColor: colors.accentPrimary },
  label: {
    fontFamily: fontFamily.uiSemibold,
    fontSize: 10,
    letterSpacing: -0.1,
    color: colors.textMuted,
  },
  labelActive: { color: "#ffffff" },
});
