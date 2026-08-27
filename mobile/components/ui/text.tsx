import { StyleSheet, Text, type TextProps, type TextStyle } from "react-native";
import { colors, fontFamily, fontSize, letterSpacing, tracking } from "@/lib/theme";

/**
 * The type roles from the handoff. Newsreader carries the brand, Manrope runs
 * the interface, Geist Mono runs every figure. Screens use these rather than
 * bare Text so a weight or a face changes in one place.
 */

type Props = TextProps & { onDark?: boolean };

/** The small uppercase eyebrow that labels a band or a metric. */
export function Caps({ style, onDark, ...rest }: Props) {
  return (
    <Text
      {...rest}
      style={[styles.caps, onDark && { color: colors.textOnDarkFaint }, style]}
    />
  );
}

/** A screen or section title, set in the display serif. */
export function PageTitle({ style, onDark, ...rest }: Props) {
  return (
    <Text {...rest} style={[styles.pageTitle, onDark && { color: colors.textOnDark }, style]} />
  );
}

/**
 * Any number a reader might compare down a column: monospaced and tabular, so
 * digits line up and a column does not shimmer as values change.
 */
export function Figure({ style, onDark, ...rest }: Props) {
  return (
    <Text {...rest} style={[styles.figure, onDark && { color: colors.textOnDark }, style]} />
  );
}

/** Body copy. */
export function Body({ style, onDark, ...rest }: Props) {
  return <Text {...rest} style={[styles.body, onDark && { color: colors.textOnDarkMuted }, style]} />;
}

/** The quiet footnote at the bottom of a band. */
export function Note({ style, onDark, ...rest }: Props) {
  return <Text {...rest} style={[styles.note, onDark && { color: colors.textOnDarkFaint }, style]} />;
}

/** A row label: interface face, readable weight. */
export function Label({ style, onDark, ...rest }: Props) {
  return <Text {...rest} style={[styles.label, onDark && { color: colors.textOnDark }, style]} />;
}

export const textStyles: Record<string, TextStyle> = StyleSheet.create({
  caps: {
    fontFamily: fontFamily.uiBold,
    fontSize: fontSize.xxxs,
    textTransform: "uppercase",
    letterSpacing: letterSpacing(fontSize.xxxs, tracking.caps),
    color: colors.textFaint,
  },
  pageTitle: {
    fontFamily: fontFamily.display,
    fontSize: fontSize.h2,
    letterSpacing: letterSpacing(fontSize.h2, tracking.editorial),
    color: colors.textStrong,
  },
  figure: {
    fontFamily: fontFamily.mono,
    fontSize: fontSize.sm,
    color: colors.textStrong,
  },
  body: {
    fontFamily: fontFamily.ui,
    fontSize: fontSize.body,
    lineHeight: 22,
    color: colors.textBody,
  },
  note: {
    fontFamily: fontFamily.ui,
    fontSize: fontSize.xxs,
    lineHeight: 17,
    color: colors.textFaint,
  },
  label: {
    fontFamily: fontFamily.uiMedium,
    fontSize: fontSize.sm,
    color: colors.textStrong,
  },
});

const styles = textStyles;
