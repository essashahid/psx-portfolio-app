import {
  ADMIN_ONLY_FEATURES,
  ALL_APP_FEATURES,
  HIDDEN_FROM_NAV,
  LAUNCH_DEFAULT_FEATURES,
  featureAllowed,
  featureForPath,
  isUnreleased,
  normalizeEnabledFeatures,
  type AppFeatureHref,
} from "@psx/shared/features";

/**
 * Access control had no test at all before this. The gating model was two
 * lists enforced identically plus a nav filter, and it was collapsed to one
 * admin list plus a nav filter. These lock the behaviour that must not move:
 * what a launch account can reach, and what only an admin can.
 */

const LAUNCH = [...LAUNCH_DEFAULT_FEATURES];
const reader = (href: AppFeatureHref) => featureAllowed(href, LAUNCH, false);
const admin = (href: AppFeatureHref) => featureAllowed(href, LAUNCH, true);

describe("featureAllowed", () => {
  test("a launch account reaches exactly the launch tabs, plus alerts and settings", () => {
    const reachable = ALL_APP_FEATURES.filter(reader).sort();
    expect(reachable).toEqual([...LAUNCH_DEFAULT_FEATURES, "/alerts", "/settings"].sort());
  });

  test("news is part of the launch default and open to a reader", () => {
    expect(LAUNCH_DEFAULT_FEATURES).toContain("/news");
    expect(reader("/news")).toBe(true);
    // An older stored list without /news still resolves it as absent, so the
    // backfill in migration 0047 is what makes it reachable, not this code.
    expect(featureAllowed("/news", ["/dashboard", "/holdings"], false)).toBe(false);
  });

  test("no admin-only route is reachable without admin", () => {
    for (const href of ADMIN_ONLY_FEATURES) {
      expect(reader(href)).toBe(false);
    }
  });

  test("every route hidden from the menu is also closed to non-admins", () => {
    // The nav filter is presentation. If a route were only hidden and not
    // gated, its URL would still be reachable by anyone who guessed it.
    for (const href of HIDDEN_FROM_NAV) {
      expect(reader(href as AppFeatureHref)).toBe(false);
    }
  });

  test("an admin still needs the feature enabled on the account", () => {
    // Being admin lifts the admin gate, not the account's own flag list.
    expect(admin("/coverage")).toBe(false);
    expect(featureAllowed("/coverage", [...LAUNCH, "/coverage"], true)).toBe(true);
    expect(featureAllowed("/coverage", [...LAUNCH, "/coverage"], false)).toBe(false);
  });

  test("dashboard, alerts and settings survive an empty or junk flag list", () => {
    for (const flags of [[], null, undefined, "nonsense", [123, "/not-a-route"]]) {
      expect(featureAllowed("/dashboard", flags, false)).toBe(true);
      expect(featureAllowed("/alerts", flags, false)).toBe(true);
      expect(featureAllowed("/settings", flags, false)).toBe(true);
    }
  });
});

describe("normalizeEnabledFeatures", () => {
  test("an unset list falls back to the launch default", () => {
    expect(normalizeEnabledFeatures(undefined).sort())
      .toEqual([...LAUNCH_DEFAULT_FEATURES, "/alerts", "/settings"].sort());
  });

  test("unknown entries and duplicates are dropped", () => {
    const out = normalizeEnabledFeatures(["/stocks", "/stocks", "/nope", 7]);
    expect(out.filter((h) => h === "/stocks")).toHaveLength(1);
    expect(out).not.toContain("/nope");
  });
});

describe("featureForPath", () => {
  test("a nested path resolves to its section", () => {
    expect(featureForPath("/stocks/HBL")).toBe("/stocks");
    expect(featureForPath("/outlook/research")).toBe("/outlook");
  });

  test("the longest matching prefix wins", () => {
    expect(featureForPath("/stocks")).toBe("/stocks");
  });

  test("an unknown path is ungated rather than guessed at", () => {
    expect(featureForPath("/onboarding")).toBeNull();
  });
});

describe("isUnreleased", () => {
  test("reports only the nav-hidden list", () => {
    expect(isUnreleased("/performance")).toBe(true);
    expect(isUnreleased("/dashboard")).toBe(false);
  });
});
