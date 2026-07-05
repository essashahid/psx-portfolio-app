import { stripEmDashes, tidyTypography } from "@/lib/chat/sanitize";

describe("stripEmDashes", () => {
  it("turns a dash between digits into a range", () => {
    expect(stripEmDashes("PKR 2—3/sh")).toBe("PKR 2 to 3/sh");
    expect(stripEmDashes("232–235")).toBe("232 to 235");
  });

  it("keeps a dash used as a minus sign before a number", () => {
    expect(stripEmDashes("AIRLINK at –37%")).toBe("AIRLINK at -37%");
    expect(stripEmDashes("PAEL at —31% vs the index")).toBe("PAEL at -31% vs the index");
    expect(stripEmDashes("(−43%)")).toBe("(-43%)");
  });

  it("normalises U+2212 minus anywhere", () => {
    expect(stripEmDashes("return of −5.2%")).toBe("return of -5.2%");
  });

  it("still rewrites prose dashes to commas", () => {
    expect(stripEmDashes("strong quarter — margins held")).toBe("strong quarter, margins held");
  });

  it("leaves hyphens alone", () => {
    expect(stripEmDashes("KSE-100 52-week high")).toBe("KSE-100 52-week high");
  });
});

describe("tidyTypography", () => {
  it("collapses space before punctuation outside tables", () => {
    expect(tidyTypography("held , and rose")).toBe("held, and rose");
  });
});
