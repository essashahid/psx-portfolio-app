import { splitTablesFromMarkdown, splitContentWithMarkers, stripArtifactMarkers, artifactMarker } from "../../lib/chat/md-table";
import type { ArtifactSpec, TableArtifact } from "../../lib/chat/artifacts";

describe("splitTablesFromMarkdown", () => {
  test("passes plain prose through untouched", () => {
    const segs = splitTablesFromMarkdown("Just a paragraph.\n\nAnother one.");
    expect(segs).toHaveLength(1);
    expect(segs[0].type).toBe("text");
  });

  test("converts a GFM table into a table artifact between prose", () => {
    const text = [
      "The verdict first.",
      "",
      "| Holding | Weight | Return |",
      "|---|---:|---|",
      "| MEBL | 23.8 | +54.7% |",
      "| UBL | 19.3 | +58.6% |",
      "",
      "And a closing thought.",
    ].join("\n");
    const segs = splitTablesFromMarkdown(text);
    expect(segs.map((s) => s.type)).toEqual(["text", "table", "text"]);
    const spec = segs[1].spec as TableArtifact;
    expect(spec.kind).toBe("table");
    expect(spec.columns).toHaveLength(3);
    expect(spec.columns[1].format).toBe("number");
    expect(spec.columns[2].format).toBe("percent");
    expect(spec.rows[0].c0).toBe("MEBL");
    expect(spec.rows[0].c1).toBe(23.8);
    expect(spec.rows[1].c2).toBe(58.6);
  });

  test("mixed text columns stay text and keep alignment left", () => {
    const text = "| Metric | Read |\n|---|---|\n| P/E 9.4x | Cheap for the growth |";
    const segs = splitTablesFromMarkdown(text);
    const spec = segs[0].spec as TableArtifact;
    expect(spec.columns[1].format).toBe("text");
    expect(spec.columns[1].align).toBe("left");
    expect(spec.rows[0].c1).toBe("Cheap for the growth");
  });

  test("a lone pipe line without separator is not a table", () => {
    const segs = splitTablesFromMarkdown("Banks | tech | cement are my sleeves.");
    expect(segs).toHaveLength(1);
    expect(segs[0].type).toBe("text");
  });

  test("strips bold markers from header and cells", () => {
    const text = "| **Name** | Value |\n|---|---|\n| **UBL** | 12 |";
    const spec = splitTablesFromMarkdown(text)[0].spec as TableArtifact;
    expect(spec.columns[0].label).toBe("Name");
    expect(spec.rows[0].c0).toBe("UBL");
  });
});

describe("artifact position markers", () => {
  const specs = [
    { kind: "metric-strip", metrics: [] },
    { kind: "gauge", title: "g", value: 1, min: 0, max: 2, zones: [] },
  ] as unknown as ArtifactSpec[];

  test("restores interleaved layout from markers", () => {
    const content = `Verdict paragraph.${artifactMarker(0)}Middle analysis.${artifactMarker(1)}Closing.`;
    const parts = splitContentWithMarkers(content, specs);
    expect(parts.map((p) => p.type)).toEqual(["text", "artifact", "text", "artifact", "text"]);
    expect(parts[1].spec).toBe(specs[0]);
    expect(parts[3].spec).toBe(specs[1]);
  });

  test("appends unreferenced specs at the end (pre-marker messages)", () => {
    const parts = splitContentWithMarkers("Old saved answer with no markers.", specs);
    expect(parts.map((p) => p.type)).toEqual(["text", "artifact", "artifact"]);
  });

  test("ignores out-of-range and duplicate markers", () => {
    const content = `A${artifactMarker(7)}B${artifactMarker(0)}C${artifactMarker(0)}`;
    const parts = splitContentWithMarkers(content, specs);
    const artifactParts = parts.filter((p) => p.type === "artifact");
    expect(artifactParts).toHaveLength(2); // spec 0 once via marker, spec 1 appended
  });

  test("stripArtifactMarkers removes markers and collapses whitespace", () => {
    const content = `Lead.${artifactMarker(0)}Rest.`;
    expect(stripArtifactMarkers(content)).toBe("Lead.\n\nRest.");
  });
});
