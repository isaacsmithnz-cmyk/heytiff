import {
  missingScopes,
  providerById,
  PROVIDERS,
  XERO_SCOPES,
  XERO_SCOPE_LIST,
} from "../providers";

/* The registry is what the consent URL, the screen and this suite all read, so
   these tests pin the things that would silently diverge: a scope asked for
   but never explained, a duplicate that doubles the ask, and — the one that
   matters most — a WRITE scope appearing in what is documented as a read-only
   integration. */

describe("PROVIDERS", () => {
  it("has unique ids and finds them", () => {
    const ids = PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(providerById("xero")?.name).toBe("Xero");
    expect(providerById("nope")).toBeUndefined();
  });

  it("names the three things Xero is here to power", () => {
    const areas = providerById("xero")!.uses.map((u) => u.area);
    expect(areas).toEqual(["Time & Pay", "Expenses", "Rate Calculator"]);
  });
});

describe("XERO_SCOPES", () => {
  it("lists every scope exactly once", () => {
    expect(new Set(XERO_SCOPE_LIST).size).toBe(XERO_SCOPE_LIST.length);
  });

  it("gives every scope a reason", () => {
    for (const s of XERO_SCOPES) {
      expect(s.why.trim().length).toBeGreaterThan(0);
    }
  });

  it("asks for offline_access, or the connection dies in 30 minutes", () => {
    expect(XERO_SCOPE_LIST).toContain("offline_access");
  });

  /* The screen tells owners "read-only, every one of them". Xero's write
     scopes are the bare names — `accounting.transactions` grants writes where
     `accounting.transactions.read` doesn't — so anything outside the identity
     set that isn't `.read` is a write scope that just crept in. */
  it("asks for nothing that can write to Xero", () => {
    const identity = new Set(["openid", "profile", "email", "offline_access"]);
    const writes = XERO_SCOPE_LIST.filter((s) => !identity.has(s) && !s.endsWith(".read"));
    expect(writes).toEqual([]);
  });

  it("covers all three areas", () => {
    const areas = new Set(XERO_SCOPES.map((s) => s.area).filter(Boolean));
    expect(areas).toEqual(new Set(["Time & Pay", "Expenses", "Rate Calculator"]));
  });
});

describe("missingScopes", () => {
  it("is empty when the grant carries everything we ask for", () => {
    expect(missingScopes(XERO_SCOPE_LIST.join(" "))).toEqual([]);
  });

  it("ignores order and extra scopes the grant happens to carry", () => {
    const granted = [...XERO_SCOPE_LIST].reverse().join(" ") + " something.else";
    expect(missingScopes(granted)).toEqual([]);
  });

  it("names what an older grant predates", () => {
    const granted = XERO_SCOPE_LIST.filter((s) => s !== "accounting.reports.read").join(" ");
    expect(missingScopes(granted)).toEqual(["accounting.reports.read"]);
  });

  it("treats no grant as missing everything", () => {
    expect(missingScopes(null)).toEqual(XERO_SCOPE_LIST);
    expect(missingScopes("")).toEqual(XERO_SCOPE_LIST);
    expect(missingScopes(undefined)).toEqual(XERO_SCOPE_LIST);
  });

  it("survives the ragged whitespace a stored string can pick up", () => {
    expect(missingScopes("  " + XERO_SCOPE_LIST.join("  ") + " \n")).toEqual([]);
  });
});
