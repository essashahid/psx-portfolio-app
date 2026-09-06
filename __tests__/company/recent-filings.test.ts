import { recentFilings } from "@/lib/company/overview";
import type { Filing } from "@psx/shared/company/types";

const filing = (date: string | null, category: string, title = "Notice"): Filing => ({
  date,
  title,
  category,
  url: `https://dps.psx.com.pk/announcement/${title}`,
  source: "psx",
});

const NOW = new Date("2026-09-07T12:00:00Z");

describe("recentFilings", () => {
  it("keeps only the four categories that matter, within 120 days, newest first", () => {
    const rows = recentFilings(
      [
        filing("2026-06-01", "corporate_announcement"),
        filing("2026-08-20", "dividend", "Final cash dividend"),
        filing("2026-09-01", "result", "Annual accounts"),
        filing("2026-04-01", "result", "Too old"),
        filing(null, "material", "Undated"),
        filing("2026-07-15", "board_meeting", "Board to consider accounts"),
      ],
      NOW
    );
    expect(rows.map((r) => [r.date, r.label])).toEqual([
      ["2026-09-01", "Financial results"],
      ["2026-08-20", "Dividend announced"],
      ["2026-07-15", "Board meeting"],
    ]);
    expect(rows[0].url).toMatch(/^https:\/\/dps\.psx\.com\.pk/);
  });

  it("caps at six rows", () => {
    const many = Array.from({ length: 10 }, (_, i) => filing(`2026-08-${String(10 + i).padStart(2, "0")}`, "material", `m${i}`));
    expect(recentFilings(many, NOW)).toHaveLength(6);
  });

  it("returns nothing when nothing recent is on file", () => {
    expect(recentFilings([filing("2025-01-01", "result")], NOW)).toEqual([]);
  });
});
