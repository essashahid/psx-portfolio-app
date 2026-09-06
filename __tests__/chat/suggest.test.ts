import { validateSuggestion } from "../../lib/chat/suggest";

const HELD = new Set(["MEBL", "UBL", "FCCL", "SEARL", "SYS"]);

describe("suggestion validation gate", () => {
  test("accepts a clean portfolio-specific question", () => {
    const s = validateSuggestion("Is my 43% allocation to commercial banks too concentrated?", HELD, []);
    expect(s).toBe("Is my 43% allocation to commercial banks too concentrated?");
  });

  test("strips list numbering and quotes", () => {
    expect(validateSuggestion('1. "Why is MEBL below 20% of my book now?"', HELD, [])).toBe("Why is MEBL below 20% of my book now?");
  });

  test("rejects tickers the user does not hold", () => {
    expect(validateSuggestion("Should I buy HUBC for the dividend yield it offers?", HELD, [])).toBeNull();
  });

  test("allows market acronyms that are not holdings", () => {
    expect(
      validateSuggestion("How does my book compare to the KSE100 after the SBP hike this year?", HELD, [])
    ).not.toBeNull();
  });

  test("rejects trading constructs", () => {
    expect(validateSuggestion("Where should I set a stop-loss on my MEBL position today?", HELD, [])).toBeNull();
    expect(validateSuggestion("What is the best entry point for SYS before the breakout comes?", HELD, [])).toBeNull();
    expect(validateSuggestion("Which of my stocks should I buy tomorrow morning at the open?", HELD, [])).toBeNull();
  });

  test("rejects verdict-seeking questions, keeps explanations", () => {
    expect(validateSuggestion("Should I buy more MEBL at this weight and price?", HELD, [])).toBeNull();
    expect(validateSuggestion("Is UBL worth adding to before the next payout?", HELD, [])).toBeNull();
    expect(validateSuggestion("What does UBL's PKR 11 dividend mean for me after tax?", HELD, [])).not.toBeNull();
    expect(validateSuggestion("Why did SEARL move today, and was it company news?", HELD, [])).not.toBeNull();
  });

  test("rejects near-duplicates of prior questions", () => {
    const prior = ["Which of my holdings look most attractively valued right now today?"];
    expect(
      validateSuggestion("Which of my holdings look most attractively valued right now, and why is that?", HELD, prior)
    ).toBeNull();
  });

  test("rejects junk: too short, too long, markup", () => {
    expect(validateSuggestion("Buy MEBL?", HELD, [])).toBeNull();
    expect(validateSuggestion("A".repeat(200), HELD, [])).toBeNull();
    expect(validateSuggestion("Should I <script>alert(1)</script> trim UBL?", HELD, [])).toBeNull();
  });

  test("strips em dashes to house style", () => {
    const s = validateSuggestion("Review my FCCL sizing — did the June adds erode my margin of safety?", HELD, []);
    expect(s).not.toBeNull();
    expect(s).not.toContain("—");
  });
});
