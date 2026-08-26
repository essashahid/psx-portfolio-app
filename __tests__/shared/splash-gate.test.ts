/**
 * The splash gate decides whether a launch sequence plays. Getting it wrong is
 * not cosmetic: replaying it on every client navigation would put a 1180ms
 * curtain over work the user is already in the middle of.
 *
 * The gate itself lives inside the component, so this pins the rule it encodes:
 * only a genuine navigate, only near first paint, only once per document.
 */

type NavType = "navigate" | "reload" | "back_forward" | "prerender";

const SPLASH_TOTAL_MS = 1180;

/** Mirrors isColdStart() in components/shared/plumb-splash.tsx. */
function isColdStart(opts: { hasPlayed: boolean; navType: NavType | null; now: number }): boolean {
  if (opts.hasPlayed) return false;
  if (opts.navType !== null && opts.navType !== "navigate") return false;
  return opts.now < SPLASH_TOTAL_MS;
}

describe("splash cold-start gate", () => {
  it("plays on a genuine first navigation", () => {
    expect(isColdStart({ hasPlayed: false, navType: "navigate", now: 12 })).toBe(true);
  });

  it("does not replay once it has played in this document", () => {
    // The flag is module scope, so a remounted shell must not restage it.
    expect(isColdStart({ hasPlayed: true, navType: "navigate", now: 12 })).toBe(false);
  });

  it("skips a back-forward restore", () => {
    // The user was already here; they get their screen back, not a curtain.
    expect(isColdStart({ hasPlayed: false, navType: "back_forward", now: 12 })).toBe(false);
  });

  it("skips a reload", () => {
    expect(isColdStart({ hasPlayed: false, navType: "reload", now: 12 })).toBe(false);
  });

  it("skips a shell remount that happens later in the session", () => {
    // A route change can remount the layout; well past first paint it is not a
    // cold start no matter what the navigation type says.
    expect(isColdStart({ hasPlayed: false, navType: "navigate", now: 45_000 })).toBe(false);
  });

  it("treats a missing navigation entry as still eligible near first paint", () => {
    expect(isColdStart({ hasPlayed: false, navType: null, now: 40 })).toBe(true);
  });
});
