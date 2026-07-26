import { decodeState, encodeState, stateMatches } from "../oauth-state";
import { connectMessage, CONNECT_ERRORS } from "../outcome";

/* State is the whole CSRF story for this flow, plus the guard that stops a
   consent begun in one org from landing in another. Every one of these cases
   is a way the callback could be talked into saving a grant it shouldn't. */

describe("encode / decode", () => {
  it("round-trips", () => {
    const value = { state: "abc123", orgId: "11111111-2222-3333-4444-555555555555" };
    expect(decodeState(encodeState(value))).toEqual(value);
  });

  it("splits on the first colon only, so an odd org id survives", () => {
    expect(decodeState("abc:org:with:colons")).toEqual({ state: "abc", orgId: "org:with:colons" });
  });

  it("rejects anything that isn't both halves", () => {
    expect(decodeState(undefined)).toBeNull();
    expect(decodeState(null)).toBeNull();
    expect(decodeState("")).toBeNull();
    expect(decodeState("nocolon")).toBeNull();
    expect(decodeState(":orgonly")).toBeNull();
    expect(decodeState("stateonly:")).toBeNull();
  });
});

describe("stateMatches", () => {
  const cookie = { state: "s-good", orgId: "org-1" };

  it("accepts the flow we started", () => {
    expect(stateMatches(cookie, "s-good", "org-1")).toBe(true);
  });

  it("rejects a state we never issued", () => {
    expect(stateMatches(cookie, "s-other", "org-1")).toBe(false);
  });

  /* The org-switch case: consent begun as one company, finished while the
     session points at another. Without this the books land on the wrong org
     silently — no error, no way to tell afterwards. */
  it("rejects a session that moved org mid-consent", () => {
    expect(stateMatches(cookie, "s-good", "org-2")).toBe(false);
  });

  it("rejects a missing cookie or a missing returned state", () => {
    expect(stateMatches(null, "s-good", "org-1")).toBe(false);
    expect(stateMatches(cookie, null, "org-1")).toBe(false);
    expect(stateMatches(cookie, "", "org-1")).toBe(false);
  });
});

describe("connectMessage", () => {
  it("turns each known code into its sentence", () => {
    for (const code of Object.keys(CONNECT_ERRORS)) {
      expect(connectMessage(code)).toBe(CONNECT_ERRORS[code as keyof typeof CONNECT_ERRORS]);
    }
  });

  it("is null when nothing went wrong", () => {
    expect(connectMessage(null)).toBeNull();
    expect(connectMessage(undefined)).toBeNull();
    expect(connectMessage("")).toBeNull();
  });

  /* A message in a query string is a message anyone can put there: an unknown
     code must render OUR generic line, never its own text. */
  it("never echoes an unrecognised code back at the page", () => {
    const injected = "Your account is locked, call 1800-SCAM";
    expect(connectMessage(injected)).not.toContain("SCAM");
    expect(connectMessage(injected)).toBe(connectMessage("anything-else"));
  });

  it("ignores inherited object keys", () => {
    expect(connectMessage("toString")).toBe(connectMessage("unknown"));
    expect(connectMessage("__proto__")).toBe(connectMessage("unknown"));
  });
});
