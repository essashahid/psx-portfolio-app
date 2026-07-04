import { contextStartLabel, describeCards, toolDoneDetail, toolStartLabel } from "../../lib/chat/activity";

describe("chat research activity labels", () => {
  test("names ticker-specific tool starts from the actual input", () => {
    expect(toolStartLabel("get_quote", { ticker: "ffc" })).toBe("FFC \u2014 latest quote");
    expect(toolStartLabel("compute_indicator", { ticker: "mebl", indicator: "ema", period: 5 })).toBe("MEBL \u2014 EMA(5)");
  });

  test("names portfolio, sector, report, and web lookups from the actual input", () => {
    expect(toolStartLabel("get_performance", { days: 14 })).toBe("Portfolio \u2014 14-day performance history");
    expect(toolStartLabel("get_foreign_flows", { sector: "banks" })).toBe("PSX \u2014 banks foreign-flow read");
    expect(toolStartLabel("list_company_reports", { ticker: "FCCL" })).toBe("FCCL \u2014 saved research reports");
    expect(toolStartLabel("web_search", { query: "FFC Pakistan dividend announcement" })).toBe(
      "Web \u2014 \u201cFFC Pakistan dividend announcement\u201d"
    );
  });

  test("summarizes tool outcomes from returned fields", () => {
    expect(toolDoneDetail("get_thesis", { theses: [{ ticker: "MEBL" }] })).toBe("1 thesis record");
    expect(
      toolDoneDetail("get_position_history", {
        ledger: { rows: [{}, {}] },
        quantityReconciliation: { status: "reconciled" },
      })
    ).toBe("2 transactions, reconciled");
    expect(toolDoneDetail("get_sector_performance", { sectors: [{ sector: "Cement", avgReturn: 1.234 }] })).toBe(
      "Cement +1.23%"
    );
    expect(toolDoneDetail("list_company_reports", { reports: [{}, {}] })).toBe("2 reports");
  });

  test("describes gathered cards without duplicates", () => {
    expect(describeCards(["quote", "ratios", "quote", "technical", "holdings"])).toBe(
      "quotes, fundamentals, technicals and holdings"
    );
  });

  test("uses resolved tickers or sector in context phase", () => {
    expect(contextStartLabel(["MEBL", "UBL"], null)).toBe("Scanning your portfolio and MEBL, UBL context");
    expect(contextStartLabel([], "Cement")).toBe("Scanning your portfolio and the Cement sector");
  });
});
