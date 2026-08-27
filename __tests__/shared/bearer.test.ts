import { bearerTokenFrom } from "@/lib/supabase/bearer";

// This parser decides which credential requireUser() trusts. Returning a token
// where none was sent would route a cookie request down the bearer path and log
// the user out; returning null for a valid header would lock the mobile app out
// entirely. Both directions are worth pinning down.

describe("bearerTokenFrom", () => {
  it("reads the token from a well formed header", () => {
    expect(bearerTokenFrom("Bearer abc.def.ghi")).toBe("abc.def.ghi");
  });

  it("accepts the scheme in any case, as HTTP allows", () => {
    expect(bearerTokenFrom("bearer abc.def.ghi")).toBe("abc.def.ghi");
    expect(bearerTokenFrom("BEARER abc.def.ghi")).toBe("abc.def.ghi");
  });

  it("tolerates extra whitespace around the token", () => {
    expect(bearerTokenFrom("Bearer   abc.def.ghi  ")).toBe("abc.def.ghi");
  });

  it("returns null when the header is absent", () => {
    expect(bearerTokenFrom(null)).toBeNull();
    expect(bearerTokenFrom(undefined)).toBeNull();
    expect(bearerTokenFrom("")).toBeNull();
  });

  it("returns null for a scheme it does not understand", () => {
    // Falling through to cookie auth is the right move here, not a 401.
    expect(bearerTokenFrom("Basic dXNlcjpwYXNz")).toBeNull();
    expect(bearerTokenFrom("abc.def.ghi")).toBeNull();
  });

  it("returns null when the scheme carries no token", () => {
    expect(bearerTokenFrom("Bearer")).toBeNull();
    expect(bearerTokenFrom("Bearer ")).toBeNull();
    expect(bearerTokenFrom("Bearer    ")).toBeNull();
  });
});
