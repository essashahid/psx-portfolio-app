import { Component } from "react";
import { StyleSheet, Text, View } from "react-native";
import type {
  AllocationArtifact,
  ArtifactSpec,
  BenchmarkExcessArtifact,
  ComparisonTableArtifact,
  GaugeArtifact,
  MetricStripArtifact,
  PortfolioAttributionArtifact,
  TableArtifact,
  TimelineArtifact,
} from "@psx/shared/chat/artifacts";
import { formatNumber } from "@psx/shared/format";
import { sectorColor } from "@psx/shared/sector-colors";
import { colors, fontSize, layout, letterSpacing, space, tracking } from "@/lib/theme";

/**
 * Artifact rendering for the phone.
 *
 * Eight of the twelve kinds draw natively here using proportional views, which
 * needs no charting library. The four that genuinely need a plotting engine
 * (price-chart, bar-chart, snowflake, vega-lite) fall back to the model's own
 * `fallback` prose, which every chart artifact carries for exactly this reason.
 * That reads as a sentence rather than an apology for a missing picture.
 */

const TONE: Record<string, string> = {
  positive: colors.textUp,
  negative: colors.textDown,
  neutral: colors.textStrong,
};

function Frame({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.frame}>
      {title ? <Text style={styles.frameTitle}>{title.toUpperCase()}</Text> : null}
      {description ? <Text style={styles.frameDescription}>{description}</Text> : null}
      {children}
    </View>
  );
}

function MetricStrip({ spec }: { spec: MetricStripArtifact }) {
  return (
    <Frame title={spec.title}>
      <View style={styles.metricGrid}>
        {spec.metrics.map((m, i) => (
          <View key={`${m.label}-${i}`} style={styles.metricCell}>
            <Text style={styles.metricLabel}>{m.label.toUpperCase()}</Text>
            <Text style={[styles.metricValue, { color: TONE[m.tone ?? "neutral"] }]}>{m.value}</Text>
            {m.delta ? <Text style={styles.metricDetail}>{m.delta}</Text> : null}
            {m.detail ? <Text style={styles.metricDetail}>{m.detail}</Text> : null}
          </View>
        ))}
      </View>
    </Frame>
  );
}

function cellText(value: string | number | null): string {
  if (value === null || value === undefined) return "—";
  return typeof value === "number" ? formatNumber(value, 2) : String(value);
}

function DataTable({ spec }: { spec: TableArtifact | ComparisonTableArtifact }) {
  // Three columns is what fits a phone without horizontal scrolling. Beyond
  // that the remaining columns are listed under each row instead of being cut
  // off at the screen edge.
  const primary = spec.columns.slice(0, 3);
  const overflow = spec.columns.slice(3);

  return (
    <Frame title={spec.title} description={spec.description}>
      <View style={styles.tableHead}>
        {primary.map((c, i) => (
          <Text key={c.key} style={[styles.tableHeadCell, i > 0 && styles.tableCellRight]}>
            {c.label}
          </Text>
        ))}
      </View>
      {spec.rows.map((row, ri) => (
        <View key={ri} style={styles.tableRow}>
          <View style={styles.tableLine}>
            {primary.map((c, i) => (
              <Text
                key={c.key}
                style={[styles.tableCell, i > 0 && styles.tableCellRight, i === 0 && styles.tableCellFirst]}
                numberOfLines={2}
              >
                {cellText(row[c.key])}
              </Text>
            ))}
          </View>
          {overflow.length > 0 ? (
            <Text style={styles.tableOverflow}>
              {overflow.map((c) => `${c.label} ${cellText(row[c.key])}`).join("   ")}
            </Text>
          ) : null}
        </View>
      ))}
    </Frame>
  );
}

function Timeline({ spec }: { spec: TimelineArtifact }) {
  return (
    <Frame title={spec.title} description={spec.description}>
      {spec.events.map((e, i) => (
        <View key={`${e.date}-${i}`} style={styles.timelineRow}>
          <Text style={styles.timelineDate}>{e.date}</Text>
          <View style={styles.timelineBody}>
            <Text style={styles.timelineLabel}>{e.label}</Text>
            {e.detail ? <Text style={styles.metricDetail}>{e.detail}</Text> : null}
          </View>
          {e.value ? <Text style={styles.timelineValue}>{e.value}</Text> : null}
        </View>
      ))}
    </Frame>
  );
}

/** A labelled row whose bar length is its share of the largest value. */
function ProportionRow({
  label,
  valueText,
  fraction,
  color,
}: {
  label: string;
  valueText: string;
  fraction: number;
  color: string;
}) {
  const width = `${Math.max(0, Math.min(1, fraction)) * 100}%` as const;
  return (
    <View style={styles.barRow}>
      <View style={styles.barHead}>
        <Text style={styles.barLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.barValue}>{valueText}</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width, backgroundColor: color }]} />
      </View>
    </View>
  );
}

function Attribution({ spec }: { spec: PortfolioAttributionArtifact }) {
  const largest = Math.max(...spec.items.map((i) => Math.abs(i.value)), 1);
  return (
    <Frame title={spec.title} description={spec.description}>
      {spec.items.map((item, i) => (
        <ProportionRow
          key={`${item.label}-${i}`}
          label={item.label}
          valueText={
            item.percent !== undefined
              ? `${formatNumber(item.percent, 1)}%`
              : formatNumber(item.value, 0)
          }
          fraction={Math.abs(item.value) / largest}
          color={
            item.tone === "positive"
              ? colors.chartUp
              : item.tone === "negative"
                ? colors.chartDown
                : item.value < 0
                  ? colors.chartDown
                  : colors.chartLine
          }
        />
      ))}
    </Frame>
  );
}

function Allocation({ spec }: { spec: AllocationArtifact }) {
  // A donut needs a drawing surface; on a narrow screen a ranked set of bars
  // reads better anyway, and keeps the sector colours the rest of the app uses.
  const total = spec.segments.reduce((sum, s) => sum + s.value, 0) || 1;
  const segments = [...spec.segments].sort((a, b) => b.value - a.value);
  return (
    <Frame title={spec.title} description={spec.description}>
      {spec.centerValue ? (
        <View style={styles.centerBlock}>
          <Text style={styles.centerValue}>{spec.centerValue}</Text>
          {spec.centerLabel ? <Text style={styles.metricDetail}>{spec.centerLabel}</Text> : null}
        </View>
      ) : null}
      {segments.map((s, i) => (
        <ProportionRow
          key={`${s.label}-${i}`}
          label={s.label}
          valueText={`${formatNumber((s.value / total) * 100, 1)}%`}
          fraction={s.value / total}
          color={s.color ?? (spec.bySector ? sectorColor(s.label) : colors.chartLine)}
        />
      ))}
    </Frame>
  );
}

function BenchmarkExcess({ spec }: { spec: BenchmarkExcessArtifact }) {
  const benchmark = spec.benchmarkLabel ?? "KSE-100";
  return (
    <Frame title={spec.title} description={spec.description}>
      {spec.items.map((item, i) => {
        const excess = item.returnPct - item.benchmarkPct;
        return (
          <View key={`${item.label}-${i}`} style={styles.excessRow}>
            <Text style={styles.barLabel} numberOfLines={1}>
              {item.label}
            </Text>
            <View style={styles.excessNumbers}>
              <Text style={styles.metricDetail}>
                {formatNumber(item.returnPct, 1)}% vs {formatNumber(item.benchmarkPct, 1)}%
              </Text>
              <Text
                style={[
                  styles.barValue,
                  { color: excess > 0 ? colors.textUp : excess < 0 ? colors.textDown : colors.textMuted },
                ]}
              >
                {excess > 0 ? "+" : ""}
                {formatNumber(excess, 1)}% vs {benchmark}
              </Text>
            </View>
          </View>
        );
      })}
    </Frame>
  );
}

function Gauge({ spec }: { spec: GaugeArtifact }) {
  const span = spec.max - spec.min || 1;
  const position = Math.max(0, Math.min(1, (spec.value - spec.min) / span));
  return (
    <Frame title={spec.title} description={spec.description}>
      <Text style={styles.gaugeValue}>
        {formatNumber(spec.value, 2)}
        {spec.unit ? <Text style={styles.gaugeUnit}> {spec.unit}</Text> : null}
      </Text>
      <View style={styles.gaugeTrack}>
        {spec.zones.map((zone, i) => {
          const start = i === 0 ? spec.min : spec.zones[i - 1].upTo;
          const width = `${(Math.max(0, zone.upTo - start) / span) * 100}%` as const;
          return (
            <View
              key={`${zone.label}-${i}`}
              style={[styles.gaugeZone, { width, backgroundColor: TONE[zone.tone] ?? colors.rule, opacity: 0.28 }]}
            />
          );
        })}
        <View style={[styles.gaugeMarker, { left: `${position * 100}%` }]} />
      </View>
      <View style={styles.gaugeScale}>
        {spec.zones.map((zone, i) => (
          <Text key={`${zone.label}-label-${i}`} style={styles.metricDetail}>
            {zone.label}
          </Text>
        ))}
      </View>
      {spec.markerLabel ? <Text style={styles.metricDetail}>{spec.markerLabel}</Text> : null}
      {spec.caption ? <Text style={styles.frameDescription}>{spec.caption}</Text> : null}
    </Frame>
  );
}

/** For the kinds that need a plotting engine we do not ship yet. */
function Described({ title, description, fallback }: { title: string; description?: string; fallback?: string }) {
  return (
    <Frame title={title} description={description}>
      <Text style={styles.fallback}>
        {fallback ?? "This chart is available on the web version."}
      </Text>
    </Frame>
  );
}

/**
 * Renders one artifact, or nothing if it cannot be rendered.
 *
 * A saved conversation is exactly where an artifact written by an older
 * version of the app turns up, and a spec whose shape has since changed used
 * to throw inside its renderer and take the whole conversation down with it.
 * One unreadable chart is a far smaller loss than the answer around it, so it
 * is caught here and the prose survives.
 */
export class Artifact extends Component<{ spec: ArtifactSpec }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(previous: { spec: ArtifactSpec }) {
    // A new spec deserves a fresh attempt; without this a single bad artifact
    // would keep every later one in the same slot blank.
    if (previous.spec !== this.props.spec && this.state.failed) this.setState({ failed: false });
  }

  render() {
    if (this.state.failed) {
      return (
        <Frame title="Chart unavailable">
          <Text style={styles.errorText}>
            This chart was saved in a format this version cannot draw.
          </Text>
        </Frame>
      );
    }
    return <ArtifactBody spec={this.props.spec} />;
  }
}

function ArtifactBody({ spec }: { spec: ArtifactSpec }) {
  switch (spec.kind) {
    case "metric-strip":
      return <MetricStrip spec={spec} />;
    case "table":
    case "comparison-table":
      return <DataTable spec={spec} />;
    case "timeline":
      return <Timeline spec={spec} />;
    case "portfolio-attribution":
      return <Attribution spec={spec} />;
    case "allocation":
      return <Allocation spec={spec} />;
    case "benchmark-excess":
      return <BenchmarkExcess spec={spec} />;
    case "gauge":
      return <Gauge spec={spec} />;
    case "price-chart":
    case "bar-chart":
    case "snowflake":
    case "vega-lite":
      return <Described title={spec.title} description={spec.description} fallback={spec.fallback} />;
    case "error":
      return (
        <Frame title={spec.title}>
          <Text style={styles.errorText}>{spec.message}</Text>
        </Frame>
      );
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  frame: {
    marginVertical: space.md,
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
    gap: space.sm,
  },
  frameTitle: {
    fontSize: fontSize.xxs,
    color: colors.textMuted,
    letterSpacing: letterSpacing(fontSize.xxs, tracking.caps),
  },
  frameDescription: { fontSize: fontSize.xs, color: colors.textMuted, lineHeight: 18 },
  metricGrid: { flexDirection: "row", flexWrap: "wrap" },
  metricCell: { flexBasis: "50%", paddingVertical: space.sm, paddingRight: space.md, gap: 2 },
  metricLabel: {
    fontSize: fontSize.xxs,
    color: colors.textMuted,
    letterSpacing: letterSpacing(fontSize.xxs, tracking.caps),
  },
  metricValue: { fontSize: fontSize.h2 },
  metricDetail: { fontSize: fontSize.xs, color: colors.textFaint },
  tableHead: {
    flexDirection: "row",
    paddingBottom: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.rule,
  },
  tableHeadCell: { flex: 1, fontSize: fontSize.xxs, color: colors.textMuted },
  tableRow: {
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.rule,
    gap: 2,
  },
  tableLine: { flexDirection: "row" },
  tableCell: { flex: 1, fontSize: fontSize.sm, color: colors.textBody },
  tableCellFirst: { color: colors.textStrong },
  tableCellRight: { textAlign: "right" },
  tableOverflow: { fontSize: fontSize.xs, color: colors.textFaint },
  timelineRow: {
    flexDirection: "row",
    gap: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.rule,
  },
  timelineDate: { fontSize: fontSize.xs, color: colors.textFaint, width: 78 },
  timelineBody: { flex: 1, gap: 2 },
  timelineLabel: { fontSize: fontSize.sm, color: colors.textStrong },
  timelineValue: { fontSize: fontSize.sm, color: colors.textBody },
  barRow: { paddingVertical: space.sm, gap: space.xs },
  barHead: { flexDirection: "row", justifyContent: "space-between", gap: space.md },
  barLabel: { flex: 1, fontSize: fontSize.sm, color: colors.textBody },
  barValue: { fontSize: fontSize.sm, color: colors.textStrong },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceSunken, overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3 },
  centerBlock: { paddingBottom: space.sm, gap: 2 },
  centerValue: { fontSize: fontSize.title, color: colors.textStrong },
  excessRow: {
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.rule,
    gap: 2,
  },
  excessNumbers: { flexDirection: "row", justifyContent: "space-between", gap: space.md },
  gaugeValue: { fontSize: fontSize.title, color: colors.textStrong },
  gaugeUnit: { fontSize: fontSize.body, color: colors.textMuted },
  gaugeTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.surfaceSunken,
    flexDirection: "row",
    overflow: "hidden",
    position: "relative",
  },
  gaugeZone: { height: 10 },
  gaugeMarker: {
    position: "absolute",
    top: -3,
    width: 2,
    height: 16,
    marginLeft: -1,
    backgroundColor: colors.textStrong,
  },
  gaugeScale: { flexDirection: "row", justifyContent: "space-between", gap: space.sm },
  fallback: { fontSize: fontSize.sm, color: colors.textBody, lineHeight: 20 },
  errorText: { fontSize: fontSize.sm, color: colors.textDown, lineHeight: 20 },
});
