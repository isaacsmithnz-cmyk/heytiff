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

  /* The first live attempt died at Xero's consent screen with `invalid_scope`,
     because two broad accounting scopes were asked for and every Web app
     created since March 2026 is granular-only. Xero refuses the WHOLE request,
     so one stale name takes the entire integration down before the user sees a
     consent screen at all — pin the deprecated ones out. */
  it("asks for no scope Xero has deprecated in favour of a granular one", () => {
    const deprecated = [
      "accounting.transactions",
      "accounting.transactions.read",
      "accounting.reports.read",
    ];
    for (const d of deprecated) expect(XERO_SCOPE_LIST).not.toContain(d);
  });

  it("names the granular scopes that replaced them", () => {
    // bills + spend money, where accounting.transactions.read used to be
    expect(XERO_SCOPE_LIST).toContain("accounting.invoices.read");
    expect(XERO_SCOPE_LIST).toContain("accounting.banktransactions.read");
    // just the P&L, where accounting.reports.read used to be every report
    expect(XERO_SCOPE_LIST).toContain("accounting.reports.profitandloss.read");
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
    const dropped = "accounting.reports.profitandloss.read";
    const granted = XERO_SCOPE_LIST.filter((s) => s !== dropped).join(" ");
    expect(missingScopes(granted)).toEqual([dropped]);
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
