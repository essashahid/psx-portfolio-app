import { secretsMatch, isCronAuthorized, requireCronAuth } from "@/lib/shared/cron-auth";

// The scheduled jobs run with the service-role client, so this check is the
// only thing between a public URL and unrestricted database writes. It had no
// test at all before, despite being copied into nine route files.

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function req(init?: { auth?: string; key?: string }) {
  const url = init?.key
    ? `https://example.test/api/cron/daily?key=${encodeURIComponent(init.key)}`
    : "https://example.test/api/cron/daily";
  return new Request(url, init?.auth ? { headers: { authorization: init.auth } } : undefined);
}

describe("secretsMatch", () => {
  it("accepts an exact match", () => {
    expect(secretsMatch("s3cret", "s3cret")).toBe(true);
  });

  it("rejects a different value of the same length", () => {
    expect(secretsMatch("aaaaaa", "bbbbbb")).toBe(false);
  });

  it("rejects a correct prefix", () => {
    // The failure mode that matters: a guessed prefix must not be treated as
    // closer to correct than any other wrong answer.
    expect(secretsMatch("s3cr", "s3cret")).toBe(false);
    expect(secretsMatch("s3cretXX", "s3cret")).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(secretsMatch("", "s3cret")).toBe(false);
  });

  it("compares by bytes, not by unicode normalization", () => {
    // Same glyphs, different encodings: precomposed U+00E9 against e + U+0301.
    // Written as escapes so an editor cannot silently normalize the file and
    // turn this into a comparison of two identical strings.
    const precomposed = "caf\u00e9";
    const decomposed = "cafe\u0301";
    expect(precomposed).not.toBe(decomposed);
    expect(secretsMatch(precomposed, decomposed)).toBe(false);
  });
});

describe("isCronAuthorized", () => {
  it("accepts a Bearer header", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(isCronAuthorized(req({ auth: "Bearer s3cret" }))).toBe(true);
  });

  it("accepts a bare header without the Bearer prefix", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(isCronAuthorized(req({ auth: "s3cret" }))).toBe(true);
  });

  it("accepts a ?key= query parameter by default", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(isCronAuthorized(req({ key: "s3cret" }))).toBe(true);
  });

  it("rejects a wrong secret", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(isCronAuthorized(req({ auth: "Bearer wrong" }))).toBe(false);
    expect(isCronAuthorized(req({ key: "wrong" }))).toBe(false);
  });

  it("rejects a request carrying no secret", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(isCronAuthorized(req())).toBe(false);
  });

  it("rejects everything when CRON_SECRET is unset", () => {
    delete process.env.CRON_SECRET;
    // Notably including a request that presents an empty secret, which would
    // match an unset variable under a naive equality check.
    expect(isCronAuthorized(req({ auth: "Bearer anything" }))).toBe(false);
    expect(isCronAuthorized(req({ key: "" }))).toBe(false);
    expect(isCronAuthorized(req())).toBe(false);
  });

  it("ignores the query parameter once CRON_REJECT_QUERY_KEY is set", () => {
    process.env.CRON_SECRET = "s3cret";
    process.env.CRON_REJECT_QUERY_KEY = "true";
    expect(isCronAuthorized(req({ key: "s3cret" }))).toBe(false);
    expect(isCronAuthorized(req({ auth: "Bearer s3cret" }))).toBe(true);
  });

  it("does not fall back to the query parameter when a header is present", () => {
    // A wrong header must fail outright rather than letting a valid ?key=
    // rescue it, so the header stays the authoritative signal.
    process.env.CRON_SECRET = "s3cret";
    const request = new Request("https://example.test/api/cron/daily?key=s3cret", {
      headers: { authorization: "Bearer wrong" },
    });
    expect(isCronAuthorized(request)).toBe(false);
  });
});

describe("requireCronAuth", () => {
  it("returns null when the caller is authorized", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(requireCronAuth(req({ auth: "Bearer s3cret" }))).toBeNull();
  });

  it("answers 401 for a bad secret", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(requireCronAuth(req({ auth: "Bearer wrong" }))?.status).toBe(401);
  });

  it("answers 503 when the server has no secret configured", () => {
    // Distinct from 401 on purpose: the job is not unauthorized, the server is
    // not set up to run it, and those need different fixes.
    delete process.env.CRON_SECRET;
    expect(requireCronAuth(req({ auth: "Bearer anything" }))?.status).toBe(503);
  });
});
