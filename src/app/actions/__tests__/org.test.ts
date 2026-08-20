/* saveOrgSection — owner-only, section-allowlisted, ABN-checked — and the two
   logo actions, which verify the DOCUMENT rather than trusting the id they were
   handed. */

const update = jest.fn();

/* The logo actions read before they write, so `from` serves a select chain as
   well as an update one. `docRow`/`orgRow` are what those selects return; the
   tests that only write ignore them. */
let docRow: Record<string, unknown> | null = null;
let orgRow: Record<string, unknown> | null = null;
let updateError: { message: string } | null = null;

const deleteDocument = jest.fn().mockResolvedValue({ ok: true });

const from = jest.fn((table: string) => {
  const chain: Record<string, unknown> = {};
  chain.eq = () => chain;
  chain.select = () => chain;
  chain.maybeSingle = async () => ({
    data: table === "documents" ? docRow : orgRow,
    error: null,
  });
  chain.update = (patch: Record<string, unknown>) => {
    update(patch, table);
    return { eq: () => Promise.resolve({ error: updateError }) };
  };
  return chain;
});

let dbRole: string | null = "owner";
/* getOrgBrand is gated on `studio`, not on ownership — see the note on the
   action. Every other test in this file leaves it alone. */
let studioAllowed = true;

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: { from: (...a: unknown[]) => from(...(a as [string])) },
}));
jest.mock("../documents", () => ({
  deleteDocument: (...a: unknown[]) => deleteDocument(...a),
}));
jest.mock("@/lib/auth0", () => ({
  auth0: {
    getSession: jest.fn().mockResolvedValue({
      user: { sub: "auth0|owner" },
      orgId: "org-1",
    }),
  },
}));
jest.mock("@/lib/permissions-server", () => ({
  getDbRole: jest.fn(() => Promise.resolve(dbRole)),
  can: jest.fn(() => Promise.resolve(studioAllowed)),
}));
jest.mock("@/lib/org/query", () => ({
  orgBrand: jest.fn(async (orgId: string) => ({
    name: `brand for ${orgId}`,
    logoUrl: "https://signed.example/logo.png",
    abn: null,
    phone: null,
    email: null,
    website: null,
  })),
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { clearOrgLogo, getOrgBrand, saveOrgSection, setOrgLogo } from "../org";

const LOGO_REF = "org/org-1/org_logo/doc-1.png";

beforeEach(() => {
  update.mockClear();
  from.mockClear();
  deleteDocument.mockClear();
  dbRole = "owner";
  studioAllowed = true;
  updateError = null;
  docRow = null;
  orgRow = null;
});

describe("saveOrgSection", () => {
  it("saves an identity patch for an owner", async () => {
    const res = await saveOrgSection("identity", { trading_name: "Smith Air" });
    expect(res).toEqual({ ok: true });
    expect(from).toHaveBeenCalledWith("organizations");
    expect(update.mock.calls[0][0]).toMatchObject({ trading_name: "Smith Air" });
    expect(update.mock.calls[0][0]).toHaveProperty("updated_at");
  });

  it("refuses a non-owner — admins don't edit the company profile", async () => {
    dbRole = "admin";
    const res = await saveOrgSection("identity", { trading_name: "x" });
    expect(res).toEqual({ ok: false, error: "Only an owner can change organisation settings." });
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses an unknown section without touching the database", async () => {
    const res = await saveOrgSection("payroll", { hourly_wage: "999" });
    expect(res.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses a bad ABN before writing", async () => {
    const res = await saveOrgSection("identity", { abn: "51824753557" });
    expect(res.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("normalizes a valid spaced ABN", async () => {
    await saveOrgSection("identity", { abn: "51 824 753 556" });
    expect(update.mock.calls[0][0]).toMatchObject({ abn: "51824753556" });
  });

  it("converts the GST segmented control to a boolean, and empty to null", async () => {
    await saveOrgSection("identity", { gst_registered: "Yes" });
    expect(update.mock.calls[0][0]).toMatchObject({ gst_registered: true });
    update.mockClear();
    await saveOrgSection("identity", { gst_registered: "No" });
    expect(update.mock.calls[0][0]).toMatchObject({ gst_registered: false });
    update.mockClear();
    await saveOrgSection("identity", { gst_registered: "", trading_name: "keep" });
    expect(update.mock.calls[0][0]).toMatchObject({ gst_registered: null });
  });

  /* The compliance card is gone: those five columns are org_credentials rows
     now, and this action is no longer a way to reach them — not even by POSTing
     the section name it used to answer to. */
  it("refuses the retired compliance section", async () => {
    const res = await saveOrgSection("compliance", { insurance_expiry: "01/03/2027" });
    expect(res).toEqual({ ok: false, error: "That section can't be edited here." });
    expect(update).not.toHaveBeenCalled();
  });

  it("marks the field a rejected ABN or ACN came from", async () => {
    expect(await saveOrgSection("identity", { abn: "51824753557" })).toMatchObject({
      fields: ["abn"],
    });
    expect(await saveOrgSection("identity", { acn: "12345" })).toMatchObject({ fields: ["acn"] });
  });

  it("never lets a patch reach ownership or the legacy name", async () => {
    await saveOrgSection("identity", {
      trading_name: "Smith Air",
      primary_owner_user_id: "auth0|attacker",
      name: "overwrite-seed",
    });
    const patch = update.mock.calls[0][0];
    expect(patch).not.toHaveProperty("primary_owner_user_id");
    expect(patch).not.toHaveProperty("name");
  });
});

/* setOrgLogo takes a document id from the browser, so it trusts NOTHING about
   it: the row is re-read inside the caller's org, and its kind, its upload
   state and its storage path are all re-checked. A Server Function is reachable
   by direct POST — "the picker only offered your own upload" is not a control. */
describe("setOrgLogo", () => {
  const good = { kind: "org_logo", storage_ref: LOGO_REF, uploaded_at: "2026-07-25T00:00:00Z" };

  it("points the org at a confirmed logo it owns", async () => {
    docRow = good;
    const res = await setOrgLogo("doc-1");
    expect(res).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ logo_url: LOGO_REF }),
      "organizations"
    );
  });

  it("refuses a non-owner", async () => {
    dbRole = "admin";
    docRow = good;
    const res = await setOrgLogo("doc-1");
    expect(res).toEqual({ ok: false, error: "Only an owner can change organisation settings." });
    expect(update).not.toHaveBeenCalled();
  });

  /* Another org's document simply isn't found: every read is scoped by org_id,
     so the id addresses nothing. */
  it("refuses a document that isn't this org's", async () => {
    docRow = null;
    expect(await setOrgLogo("doc-other")).toEqual({
      ok: false,
      error: "That upload no longer exists.",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses a document of the wrong kind — a receipt is not a logo", async () => {
    docRow = { ...good, kind: "receipt" };
    expect(await setOrgLogo("doc-1")).toEqual({ ok: false, error: "That file isn't a logo." });
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses an upload that never finished", async () => {
    docRow = { ...good, uploaded_at: null };
    expect(await setOrgLogo("doc-1")).toEqual({ ok: false, error: "That upload didn't finish." });
    expect(update).not.toHaveBeenCalled();
  });

  /* Belt and braces with the org-scoped read: the path itself carries the org,
     so a ref that doesn't start with this org's prefix is refused even if a row
     somehow came back. */
  it("refuses a storage ref belonging to another org", async () => {
    docRow = { ...good, storage_ref: "org/org-2/org_logo/doc-1.png" };
    expect(await setOrgLogo("doc-1")).toEqual({
      ok: false,
      error: "That file doesn't belong to this organisation.",
    });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("clearOrgLogo", () => {
  it("clears the column and takes the file with it", async () => {
    orgRow = { logo_url: LOGO_REF };
    docRow = { id: "doc-1" };
    const res = await clearOrgLogo();
    expect(res).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ logo_url: null }),
      "organizations"
    );
    // an object nothing points at is invisible and still billable
    expect(deleteDocument).toHaveBeenCalledWith("doc-1");
  });

  it("does nothing when there is no logo", async () => {
    orgRow = { logo_url: null };
    expect(await clearOrgLogo()).toEqual({ ok: true });
    expect(update).not.toHaveBeenCalled();
    expect(deleteDocument).not.toHaveBeenCalled();
  });

  it("refuses a non-owner", async () => {
    dbRole = "admin";
    orgRow = { logo_url: LOGO_REF };
    expect(await clearOrgLogo()).toEqual({
      ok: false,
      error: "Only an owner can change organisation settings.",
    });
    expect(deleteDocument).not.toHaveBeenCalled();
  });

  it("keeps the file when the column couldn't be cleared", async () => {
    orgRow = { logo_url: LOGO_REF };
    updateError = { message: "nope" };
    expect(await clearOrgLogo()).toEqual({ ok: false, error: "Couldn't remove that logo." });
    expect(deleteDocument).not.toHaveBeenCalled();
  });
});


/* The letterhead read — the only thing in actions/org.ts that is not a write,
   and the only one not gated on ownership. It is asked by whoever is printing
   a design, which is a studio act, not an owner's. */
describe("getOrgBrand", () => {
  it("answers for the active org when the caller may use the studio", async () => {
    expect(await getOrgBrand()).toMatchObject({ name: "brand for org-1" });
  });

  /* Server Functions are reachable by direct POST, so the gate is here and not
     only on the screen that calls it. NO_BRAND, not a throw: every caller
     falls back to its own platform wording, so a refusal reads as "this
     workspace has no logo" rather than breaking a print. */
  it("returns nothing at all when the caller may not use the studio", async () => {
    studioAllowed = false;
    expect(await getOrgBrand()).toEqual({
      name: "",
      logoUrl: null,
      abn: null,
      phone: null,
      email: null,
      website: null,
    });
  });
});
