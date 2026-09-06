import { chooseMode, asksForView } from "../../lib/chat/mode";

describe("chooseMode", () => {
  test("defaults to explain for beginner and intermediate accounts, even when they ask for a view", () => {
    expect(chooseMode({ experienceLevel: "beginner", message: "Should I buy more MEBL?" })).toBe("explain");
    expect(chooseMode({ experienceLevel: "intermediate", message: "What is your view on UBL?" })).toBe("explain");
    expect(chooseMode({ experienceLevel: null, message: "Would you recommend trimming SYS?" })).toBe("explain");
    expect(chooseMode({ experienceLevel: undefined, message: "Should I sell HUBC?" })).toBe("explain");
  });

  test("advanced accounts get advise only when the message asks for a view", () => {
    expect(chooseMode({ experienceLevel: "advanced", message: "Should I add PKR 100k to LUCK?" })).toBe("advise");
    expect(chooseMode({ experienceLevel: "advanced", message: "What is your view on OGDC after the settlement?" })).toBe("advise");
    expect(chooseMode({ experienceLevel: "advanced", message: "Would you trim UBL at this weight?" })).toBe("advise");
    expect(chooseMode({ experienceLevel: "advanced", message: "Do you recommend FFC for income?" })).toBe("advise");
  });

  test("advanced accounts still get explain for questions that do not ask for a view", () => {
    expect(chooseMode({ experienceLevel: "advanced", message: "Why is my portfolio down today?" })).toBe("explain");
    expect(chooseMode({ experienceLevel: "advanced", message: "What does P/E mean, and what is MEBL's?" })).toBe("explain");
    expect(chooseMode({ experienceLevel: "advanced", message: "Explain FFC's latest results simply" })).toBe("explain");
  });

  test("asksForView matches the explicit phrasings only", () => {
    expect(asksForView("your view?")).toBe(true);
    expect(asksForView("should I buy")).toBe(true);
    expect(asksForView("How has the shoulder season affected cement?")).toBe(false);
    expect(asksForView("What are the important developments in my holdings?")).toBe(false);
  });
});
