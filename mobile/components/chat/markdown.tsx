import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, fontFamily, fontSize, space } from "@/lib/theme";

/**
 * Renders the Copilot's markdown the way the app's own screens are set: the
 * display face for headings, the UI face for body, the mono face for numbers.
 *
 * Purpose-built rather than a library because the model emits a small, known
 * subset (headings, bold, italics, lists) and the answer must look like the
 * rest of the app, not like a README. Anything unrecognised falls through as
 * plain text, so a new construct can never garble an answer.
 *
 * Built to be streamed into: the text arrives in deltas, so half-finished
 * constructs are the normal case, not the edge case. An unterminated **run
 * renders as its content without the markers rather than showing literal
 * asterisks until the closing pair lands.
 */

type Run = { text: string; bold?: boolean; italic?: boolean; code?: boolean };

/** Split one line into styled runs: **bold**, *italic*, `code`. */
function inlineRuns(line: string): Run[] {
  const runs: Run[] = [];
  // Bold first (its marker contains the italic one), then italic, then code.
  const pattern = /(\*\*([^*]+)\*\*?|\*([^*\n]+)\*|`([^`\n]+)`)/g;
  let last = 0;
  for (const match of line.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) runs.push({ text: line.slice(last, index) });
    if (match[2] !== undefined) runs.push({ text: match[2], bold: true });
    else if (match[3] !== undefined) runs.push({ text: match[3], italic: true });
    else if (match[4] !== undefined) runs.push({ text: match[4], code: true });
    last = index + match[0].length;
  }
  if (last < line.length) {
    // A dangling opener mid-stream: show the words, drop the marker.
    runs.push({ text: line.slice(last).replace(/\*\*?|`/g, "") });
  }
  return runs;
}

/**
 * A bold run that is a signed figure ("+83.9%", "-12k", "+PKR 145,696") takes
 * the up/down colour, the same rule the web answers follow. Anything with
 * words in it stays ink: colouring prose reads as shouting.
 */
function runColor(run: Run): string | undefined {
  if (!run.bold) return undefined;
  const s = run.text.trim();
  if (/^\+(PKR\s*)?[\d,.]+[km]?%?$/i.test(s)) return colors.textUp;
  if (/^-(PKR\s*)?[\d,.]+[km]?%?$/i.test(s)) return colors.textDown;
  return undefined;
}

function Line({ line, base }: { line: string; base: object }) {
  return (
    <Text style={base}>
      {inlineRuns(line).map((run, i) => (
        <Text
          key={i}
          style={[
            run.bold && styles.bold,
            run.italic && styles.italic,
            run.code && styles.code,
            runColor(run) ? { color: runColor(run) } : null,
          ]}
        >
          {run.text}
        </Text>
      ))}
    </Text>
  );
}

export const Markdown = memo(function Markdown({ children }: { children: string }) {
  const blocks: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let key = 0;

  const flush = () => {
    if (paragraph.length === 0) return;
    blocks.push(<Line key={key++} line={paragraph.join(" ")} base={styles.body} />);
    paragraph = [];
  };

  for (const raw of children.split("\n")) {
    const line = raw.trimEnd();

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*(\d+)\.\s+(.*)$/);

    if (line.trim() === "") {
      flush();
    } else if (heading) {
      flush();
      blocks.push(
        <Line
          key={key++}
          line={heading[2]}
          base={heading[1].length === 1 ? styles.h1 : styles.h2}
        />
      );
    } else if (bullet || numbered) {
      flush();
      const text = bullet ? bullet[1] : numbered![2];
      blocks.push(
        <View key={key++} style={styles.item}>
          <Text style={styles.marker}>{bullet ? "•" : `${numbered![1]}.`}</Text>
          <View style={styles.itemBody}>
            <Line line={text} base={styles.body} />
          </View>
        </View>
      );
    } else if (line.trim().startsWith("|")) {
      // Tables become artifacts before they reach the phone; a stray one is
      // shown as mono rows rather than a wall of pipes.
      flush();
      const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
      if (!cells.every((c) => /^[-: ]+$/.test(c))) {
        blocks.push(
          <Text key={key++} style={styles.tableRow} numberOfLines={1}>
            {cells.join("   ")}
          </Text>
        );
      }
    } else {
      paragraph.push(line.trim());
    }
  }
  flush();

  return <View style={styles.root}>{blocks}</View>;
});

const styles = StyleSheet.create({
  root: { gap: space.sm + 2 },
  body: {
    fontFamily: fontFamily.ui,
    fontSize: fontSize.body,
    lineHeight: 24,
    color: colors.textBody,
  },
  h1: {
    fontFamily: fontFamily.display,
    fontSize: fontSize.h2,
    lineHeight: 26,
    color: colors.textStrong,
    marginTop: space.xs,
  },
  h2: {
    fontFamily: fontFamily.uiSemibold,
    fontSize: fontSize.body,
    lineHeight: 24,
    color: colors.textStrong,
    marginTop: space.xs,
  },
  bold: { fontFamily: fontFamily.uiSemibold, color: colors.textStrong },
  italic: { fontStyle: "italic" },
  code: { fontFamily: fontFamily.mono, fontSize: fontSize.sm },
  item: { flexDirection: "row", gap: space.sm, paddingLeft: 2 },
  marker: {
    fontFamily: fontFamily.ui,
    fontSize: fontSize.body,
    lineHeight: 24,
    color: colors.textMuted,
  },
  itemBody: { flex: 1 },
  tableRow: { fontFamily: fontFamily.mono, fontSize: fontSize.xs, lineHeight: 20, color: colors.textBody },
});
