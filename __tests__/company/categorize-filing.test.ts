import { categorizeFiling } from "../../lib/company/filings";

describe("categorizeFiling", () => {
  test("the plural results title is a result, not a generic announcement", () => {
    expect(categorizeFiling("FINANCIAL RESULTS FOR THE YEAR ENDED JUNE 30, 2026")).toBe("result");
    expect(categorizeFiling("Financial Result for the quarter ended March 31, 2026")).toBe("result");
  });
  test("dividends, board meetings and material information keep their categories", () => {
    expect(categorizeFiling("CREDIT OF INTERIM CASH DIVIDEND")).toBe("dividend");
    expect(categorizeFiling("BOARD MEETING AND CLOSED PERIOD")).toBe("board_meeting");
    expect(categorizeFiling("Disclosure of material information")).toBe("material");
    expect(categorizeFiling("Transfer of BESOS shares back to Government")).toBe("corporate_announcement");
  });
});
