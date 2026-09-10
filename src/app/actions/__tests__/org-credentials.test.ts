/* The business's own licences, policies and their TERMS — owner-only,
   org-scoped, validated before anything is written. Modelled on org.test.ts,
   because the gate is the same one: these are the company's papers, not a
   staff record, so a delegated admin is refused exactly as they are on the
   rest of the org profile.

   THE FAKE IS A REAL BUILDER now rather than a two-call chain, because the
   actions behind the redesigned screen read before they write: a renewal has
   to know the card's cached expiry before it can decide whether to advance it,
   and a reminder has to know there is an expiry at all. `writes` is what the
   tests assert against — the operation, the table, the row, and the filters
   that scoped it. */

type Row = Record<string, unknown>;
type Write = {
  op: "insert" | "update" | "delete";
  table: string;
  payload?: Row;
  eq: [string, unknown][];
  /* `.in` IS RECORDED, not swallowed. Document adoption's ownership guard moved
     from one exact kind to the org's two, and a fake that answered `.in` with
     itself would have let that guard vanish while every test still passed. */
  in: [string, unknown[]][];
};

/** What a select on each table finds. A table with nothing set finds nothing. */
let tables: Record<string, Row[]> = {};
let writes: Write[] = [];
let writeError: { message: string } | null = null;
const from = jest.fn();

function builder(table: string) {
  const eq: [string, unknown][] = [];
  const ins: [string, unknown[]][] = [];
  let op: Write["op"] | null = null;
  let payload: Row | undefined;
  let limit: number | null = null;
  let order: { col: string; asc: boolean } | null = null;

  const rows = () => {
    let list = tables[table] ?? [];
    for (const [col, val] of eq) list = list.filter((r) => r[col] === val);
    for (const [col, vals] of ins) list = list.filter((r) => vals.includes(r[col]));
    if (order) {
      const { col, asc } = order;
      list = [...list].sort((a, b) => String(a[col] ?? "").localeCompare(String(b[col] ?? "")) * (asc ? 1 : -1));
    }
    return limit == null ? list : list.slice(0, limit);
  };
  const settle = (single: boolean) => {
    if (op) {
      writes.push({ op, table, payload, eq: [...eq], in: [...ins] });
      /* A delete really removes the rows, so a read that follows one sees what
         is left. removeCredentialTerm recomputes the card's cache from exactly
         that read, and a fake that kept the row would let a broken recompute
         pass. */
      if (op === "delete") {
        const gone = new Set(rows());
        tables[table] = (tables[table] ?? []).filter((r) => !gone.has(r));
      }
      /* AN UPDATE ANSWERS WITH THE ROWS IT TOUCHED — but only once a test has
         put rows in that table. That is how adoption tells "it landed" from "it
         refused": a refused certificate matches nothing, the update comes back
         empty, and the term disowns it. Answering every update with a made-up
         row meant no test here could ever reach that path — the one that failed
         in production. A test that never populates the table still gets the old
         always-landed answer, so nothing written before this had to change. */
      if (op === "update" && tables[table]) {
        const touched = rows();
        return { data: single ? (touched[0] ?? null) : touched, error: writeError };
      }
      // an insert answers with the row it made, so a caller can file against it
      return { data: single ? { id: `new-${table}`, ...(payload ?? {}) } : [{ id: `new-${table}` }], error: writeError };
    }
    const list = rows();
    return { data: single ? (list[0] ?? null) : list, error: null, count: list.length };
  };

  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = () => chain;
  chain.eq = (col: string, val: unknown) => {
    eq.push([col, val]);
    return chain;
  };
  chain.not = self;
  chain.is = self;
  chain.in = (col: string, vals: unknown[]) => {
    ins.push([col, vals]);
    return chain;
  };
  chain.order = (col: string, opts?: { ascending?: boolean }) => {
    order = { col, asc: opts?.ascending !== false };
    return chain;
  };
  chain.limit = (n: number) => {
    limit = n;
    return chain;
  };
  chain.insert = (row: Row) => {
    op = "insert";
    payload = row;
    return chain;
  };
  chain.update = (patch: Row) => {
    op = "update";
    payload = patch;
    return chain;
  };
  chain.delete = () => {
    op = "delete";
    return chain;
  };
  chain.single = () => Promise.resolve(settle(true));
  chain.maybeSingle = () => Promise.resolve(settle(true));
  chain.then = (resolve: (v: unknown) => void) => resolve(settle(false));
  return chain;
}

let dbRole: string | null = "owner";

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      from(table);
      return builder(table);
    },
  },
}));
jest.mock("@/lib/auth0", () => ({
  auth0: {
    getSession: jest.fn().mockResolvedValue({ user: { sub: "auth0|owner" }, orgId: "org-1" }),
  },
}));
jest.mock("@/lib/permissions-server", () => ({
  getDbRole: jest.fn(() => Promise.resolve(dbRole)),
}));
jest.mock("@/lib/dashboard/reminders", () => ({
  remindAtFrom: () => "2026-07-08T07:00:00.000Z",
}));
jest.mock("@/lib/dashboard/reminders-query", () => ({
  workdayHours: () => Promise.resolve({ start: "07:00", end: "15:30" }),
}));
jest.mock("@/lib/workboard/query", () => ({
  getSm8Timezone: () => Promise.resolve("Australia/Sydney"),
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import {
  addOrgCredential,
  fileCredentialDocument,
  recordCredentialTerm,
  removeCredentialTerm,
  removeOrgCredential,
  setCredentialReminder,
  updateOrgCredential,
} from "../org-credentials";

const NOT_OWNER = "Only an owner can change organisation settings.";

/** The one staff card every test's owner has, so a document or a reminder has
    somebody to belong to. */
const STAFF = { id: "staff-1", org_id: "org-1", user_id: "auth0|owner" };

const wrote = (op: Write["op"], table: string) => writes.filter((w) => w.op === op && w.table === table);
const only = (op: Write["op"], table: string) => {
  const list = wrote(op, table);
  expect(list).toHaveLength(1);
  return list[0];
};

beforeEach(() => {
  from.mockClear();
  writes = [];
  tables = { staff_profiles: [STAFF] };
  writeError = null;
  dbRole = "owner";
});

describe("addOrgCredential", () => {
  it("inserts a validated row against the caller's own org", async () => {
    const res = await addOrgCredential({
      kind: "insurance",
      name: "Public liability",
      number: "PL-9",
      issuer: "QBE",
      expiryDate: "2027-03-01",
      color: "#2E68FF",
    });
    expect(res).toEqual({ ok: true });
    expect(from).toHaveBeenCalledWith("org_credentials");
    expect(only("insert", "org_credentials").payload).toEqual({
      org_id: "org-1",
      kind: "insurance",
      name: "Public liability",
      number: "PL-9",
      issuer: "QBE",
      expiry_date: "2027-03-01",
      color: "#2E68FF",
    });
  });

  it("refuses a non-owner before touching the table", async () => {
    dbRole = "admin";
    expect(await addOrgCredential({ kind: "licence", name: "ARC" })).toEqual({
      ok: false,
      error: NOT_OWNER,
    });
    expect(writes).toHaveLength(0);
  });

  it("refuses an unnamed credential, and an impossible date", async () => {
    expect(await addOrgCredential({ kind: "licence", name: "  " })).toEqual({
      ok: false,
      error: "Give this licence or policy a name.",
    });
    expect(
      await addOrgCredential({ kind: "licence", name: "ARC", expiryDate: "31/02/2027" })
    ).toEqual({ ok: false, error: "Check the expiry date — use dd/mm/yyyy." });
    expect(writes).toHaveLength(0);
  });

  it("refuses a kind the table's CHECK would reject anyway", async () => {
    expect(await addOrgCredential({ kind: "warranty", name: "x" })).toEqual({
      ok: false,
      error: "Choose whether this is a licence or an insurance policy.",
    });
    expect(writes).toHaveLength(0);
  });

  it("reports a write failure rather than claiming it saved", async () => {
    writeError = { message: "boom" };
    expect(await addOrgCredential({ kind: "licence", name: "ARC" })).toEqual({
      ok: false,
      error: "Couldn't add that.",
    });
  });
});

describe("updateOrgCredential", () => {
  it("scopes the update by org AND id, and stamps updated_at", async () => {
    const res = await updateOrgCredential("cred-1", {
      kind: "licence",
      name: "Contractor licence",
      number: "VBA-1",
    });
    expect(res).toEqual({ ok: true });
    const write = only("update", "org_credentials");
    expect(write.payload).toMatchObject({
      kind: "licence",
      name: "Contractor licence",
      number: "VBA-1",
    });
    expect(write.payload).toHaveProperty("updated_at");
    expect(write.eq).toEqual([
      ["org_id", "org-1"],
      ["id", "cred-1"],
    ]);
  });

  /* ONCE A TERM OWNS THE NUMBER, THE ISSUER AND THE EXPIRY they are a cache of
     it, and the details screen stops offering them. Writing them here from an
     empty draft would blank the very columns the dashboard chip reads. */
  it("leaves the cached columns alone once a term exists", async () => {
    tables.org_credential_records = [{ id: "R1", org_id: "org-1", credential_id: "cred-1" }];
    await updateOrgCredential("cred-1", { kind: "insurance", name: "Public liability" });

    const payload = only("update", "org_credentials").payload!;
    expect(payload).toMatchObject({ kind: "insurance", name: "Public liability" });
    expect(payload).not.toHaveProperty("expiry_date");
    expect(payload).not.toHaveProperty("number");
    expect(payload).not.toHaveProperty("issuer");
  });

  it("refuses a non-owner", async () => {
    dbRole = "admin";
    expect(await updateOrgCredential("cred-1", { kind: "licence", name: "x" })).toEqual({
      ok: false,
      error: NOT_OWNER,
    });
    expect(writes).toHaveLength(0);
  });

  it("validates before writing", async () => {
    expect(await updateOrgCredential("cred-1", { kind: "licence", name: "" })).toEqual({
      ok: false,
      error: "Give this licence or policy a name.",
    });
    expect(writes).toHaveLength(0);
  });
});

describe("removeOrgCredential", () => {
  it("deletes only within the caller's org", async () => {
    expect(await removeOrgCredential("cred-1")).toEqual({ ok: true });
    expect(only("delete", "org_credentials").eq).toEqual([
      ["org_id", "org-1"],
      ["id", "cred-1"],
    ]);
  });

  it("refuses a non-owner", async () => {
    dbRole = "admin";
    expect(await removeOrgCredential("cred-1")).toEqual({ ok: false, error: NOT_OWNER });
    expect(writes).toHaveLength(0);
  });
});

/* ---------------------------------------------------------------------------
   THE TERMS — the whole point of the redesign.

   The rule every test here is really about: A RENEWAL NEVER OVERWRITES THE
   TERM BEFORE IT. It inserts a row, and the card's three cached columns follow
   it only when it is genuinely newer. Filing a certificate found in a drawer
   must add to the history without retiring the cover the business actually
   holds.
--------------------------------------------------------------------------- */

const CARD = {
  id: "cred-1",
  org_id: "org-1",
  kind: "insurance",
  name: "Public liability",
  expiry_date: "2026-08-07",
};

describe("recordCredentialTerm", () => {
  beforeEach(() => {
    tables.org_credentials = [CARD];
  });

  it("inserts a term and advances the card's cache to it", async () => {
    const res = await recordCredentialTerm("cred-1", {
      issuer: "CGU",
      number: "PL-10",
      expiresOn: "2027-08-07",
      startsOn: "2026-08-07",
      premium: "2,400",
      source: "scan",
    });
    expect(res).toEqual({ ok: true });

    expect(only("insert", "org_credential_records").payload).toMatchObject({
      org_id: "org-1",
      credential_id: "cred-1",
      issuer: "CGU",
      number: "PL-10",
      expires_on: "2027-08-07",
      premium: 2400,
      source: "scan",
    });
    expect(only("update", "org_credentials").payload).toMatchObject({
      expiry_date: "2027-08-07",
      number: "PL-10",
      issuer: "CGU",
    });
  });

  it("files an older certificate into the history WITHOUT retiring the cover in force", async () => {
    await recordCredentialTerm("cred-1", { issuer: "QBE", expiresOn: "2025-08-07" });
    expect(wrote("insert", "org_credential_records")).toHaveLength(1);
    // the card still points at 2026-08-07 — nothing updated it
    expect(wrote("update", "org_credentials")).toHaveLength(0);
  });

  it("validates before it writes anything", async () => {
    expect(await recordCredentialTerm("cred-1", { issuer: "QBE" })).toEqual({
      ok: false,
      error: "An expiry date is what makes this a term — pick one.",
    });
    expect(writes).toHaveLength(0);
  });

  it("refuses a card that isn't in the caller's org", async () => {
    tables.org_credentials = [];
    expect(await recordCredentialTerm("cred-1", { expiresOn: "2027-08-07" })).toEqual({
      ok: false,
      error: "That card is no longer on file.",
    });
    expect(writes).toHaveLength(0);
  });

  it("refuses a non-owner", async () => {
    dbRole = "admin";
    expect(await recordCredentialTerm("cred-1", { expiresOn: "2027-08-07" })).toEqual({
      ok: false,
      error: NOT_OWNER,
    });
    expect(writes).toHaveLength(0);
  });

  /* A document may only be adopted by the term if it is the uploader's own,
     confirmed, still-unowned file OF THE RIGHT KIND — the kind is what stops a
     staff licence scan being filed as the company's. */
  it("adopts the scanned document under the term it was read from", async () => {
    await recordCredentialTerm("cred-1", { expiresOn: "2027-08-07", documentId: "doc-9", source: "scan" });
    const adoption = only("update", "documents");
    expect(adoption.payload).toEqual({
      org_credential_id: "cred-1",
      credential_record_id: "new-org_credential_records",
      kind: "org_insurance",
    });
    expect(adoption.eq).toEqual(
      expect.arrayContaining([
        ["org_id", "org-1"],
        ["id", "doc-9"],
        ["uploaded_by", "staff-1"],
      ])
    );
    /* EITHER of the org's own kinds is adopted and the stamp is corrected on
       the way in — the file is uploaded before the card is named, so the Type
       box can still move under it. Isaac's icare certificate of currency was
       stamped `org_licence` by a scan panel that had not been told what it was
       holding; the insurance card it created could not adopt it, and the term
       read "scanned from the document" over "No paperwork filed under this
       term yet" with the file owned by nothing. */
    expect(adoption.in).toEqual([["kind", ["org_licence", "org_insurance"]]]);
  });

  it("adopts a certificate stamped the OTHER org kind, and corrects the stamp", async () => {
    await recordCredentialTerm("cred-1", { expiresOn: "2027-08-07", documentId: "doc-9", source: "scan" });
    const adoption = only("update", "documents");
    // the card is insurance; the scan panel had stamped org_licence
    expect(adoption.payload).toMatchObject({ kind: "org_insurance" });
    expect(adoption.in[0][1]).toContain("org_licence");
    // and the boundary that matters is untouched: no staff or vehicle kind
    expect(adoption.in[0][1]).not.toContain("licence");
    expect(adoption.in[0][1]).not.toContain("insurance_policy");
  });

  it("moves every reminder counting down to the old date", async () => {
    tables.tasks = [{ id: "t1", org_id: "org-1", org_credential_id: "cred-1", assigned_to: "staff-1", lead_days: 30, status: "open" }];
    await recordCredentialTerm("cred-1", { expiresOn: "2027-08-07" });

    const moved = wrote("update", "tasks");
    expect(moved).toHaveLength(1);
    expect(moved[0].payload).toMatchObject({
      due_date: "2027-07-08",
      // the letter that went out named the old date, so it has not been delivered
      reminder_emailed_at: null,
    });
  });
});

describe("removeCredentialTerm", () => {
  beforeEach(() => {
    tables.org_credentials = [CARD];
    tables.org_credential_records = [
      { id: "R1", org_id: "org-1", credential_id: "cred-1", expires_on: "2027-08-07", number: "PL-10", issuer: "CGU" },
      { id: "R2", org_id: "org-1", credential_id: "cred-1", expires_on: "2026-08-07", number: "PL-9", issuer: "QBE" },
    ];
  });

  it("hands the card back to whatever term is left underneath", async () => {
    await removeCredentialTerm("R1");
    expect(only("delete", "org_credential_records").eq).toEqual([
      ["org_id", "org-1"],
      ["id", "R1"],
    ]);
    // recomputed from what remains, never assumed
    expect(only("update", "org_credentials").payload).toMatchObject({
      expiry_date: "2026-08-07",
      number: "PL-9",
      issuer: "QBE",
    });
  });

  it("clears the card's expiry when the last term goes", async () => {
    tables.org_credential_records = [
      { id: "R1", org_id: "org-1", credential_id: "cred-1", expires_on: "2027-08-07" },
    ];
    await removeCredentialTerm("R1");
    expect(only("update", "org_credentials").payload).toMatchObject({ expiry_date: null });
  });
});

/* FILING A DOCUMENT, with a term and without one.

   THE SECOND CASE IS WHY THIS TAKES A CREDENTIAL ID AT ALL. A term is a period
   and expires_on is NOT NULL, so a licence with no renewal date on it can hold
   no term. While this took only a record id, that card could never have a
   certificate filed against it at all: the only "Add document" on the screen
   lived inside the current term's card. */
describe("fileCredentialDocument", () => {
  beforeEach(() => {
    tables.org_credentials = [CARD];
    tables.org_credential_records = [{ id: "R1", org_id: "org-1", credential_id: "cred-1" }];
  });

  it("files a document under a term, on the kind the card is", async () => {
    expect(await fileCredentialDocument("cred-1", "R1", "doc-9")).toEqual({ ok: true });
    const write = only("update", "documents");
    expect(write.payload).toEqual({
      org_credential_id: "cred-1",
      credential_record_id: "R1",
      kind: "org_insurance",
    });
    expect(write.in).toEqual([["kind", ["org_licence", "org_insurance"]]]);
  });

  /* A CARD WITH NO EXPIRY. It owns the document; nothing owns the filing,
     which is exactly the row looseDocuments reads back. */
  it("files it against the CARD ITSELF when the card has no term", async () => {
    tables.org_credential_records = [];
    expect(await fileCredentialDocument("cred-1", null, "doc-9")).toEqual({ ok: true });
    const write = only("update", "documents");
    expect(write.payload).toEqual({
      org_credential_id: "cred-1",
      credential_record_id: null,
      kind: "org_insurance",
    });
    expect(write.in).toEqual([["kind", ["org_licence", "org_insurance"]]]);
  });

  it("refuses a card that isn't in the caller's org, term or no term", async () => {
    tables.org_credentials = [];
    for (const record of ["R1", null]) {
      writes = [];
      expect(await fileCredentialDocument("cred-1", record, "doc-9")).toEqual({
        ok: false,
        error: "That card is no longer on file.",
      });
      expect(writes).toHaveLength(0);
    }
  });

  /* The record id comes from a client, so it is checked against THIS card and
     not merely against the org — a certificate filed under another card's term
     would sit in a history it does not belong to. */
  it("refuses a term that belongs to a different card", async () => {
    tables.org_credential_records = [{ id: "R1", org_id: "org-1", credential_id: "cred-other" }];
    expect(await fileCredentialDocument("cred-1", "R1", "doc-9")).toEqual({
      ok: false,
      error: "That term is no longer on file.",
    });
    expect(writes).toHaveLength(0);
  });

  it("is owner-only, like every other write on this screen", async () => {
    dbRole = "admin";
    expect(await fileCredentialDocument("cred-1", null, "doc-9")).toEqual({ ok: false, error: NOT_OWNER });
    expect(writes).toHaveLength(0);
  });
});

describe("setCredentialReminder", () => {
  beforeEach(() => {
    tables.org_credentials = [CARD];
    tables.organizations = [{ id: "org-1", trading_name: "Diamond Air Solutions" }];
  });

  it("creates one open task of the caller's own, due the lead before the expiry", async () => {
    expect(await setCredentialReminder("cred-1", 30, true)).toEqual({ ok: true });
    expect(only("insert", "tasks").payload).toMatchObject({
      org_id: "org-1",
      title: "Renew Public liability — Diamond Air Solutions",
      detail: "Expires 7 Aug 2026 · 30 days' notice",
      assigned_to: "staff-1",
      due_date: "2026-07-08",
      status: "open",
      org_credential_id: "cred-1",
      lead_days: 30,
    });
  });

  it("needs an expiry to count from", async () => {
    tables.org_credentials = [{ ...CARD, expiry_date: null }];
    expect(await setCredentialReminder("cred-1", 30, true)).toEqual({
      ok: false,
      error: "Record the renewal first — a reminder needs an expiry to count from.",
    });
    expect(writes).toHaveLength(0);
  });

  it("is a no-op when the chip is already on", async () => {
    tables.tasks = [{ id: "t1", org_id: "org-1", org_credential_id: "cred-1", assigned_to: "staff-1", lead_days: 30, status: "open" }];
    expect(await setCredentialReminder("cred-1", 30, true)).toEqual({ ok: true });
    expect(wrote("insert", "tasks")).toHaveLength(0);
  });

  /* PERSONAL, like every other reminder: turning yours off deletes YOUR task,
     scoped to your own staff id, and leaves the other owner's alone. */
  it("deletes only the caller's own reminder when the chip goes off", async () => {
    expect(await setCredentialReminder("cred-1", 30, false)).toEqual({ ok: true });
    expect(only("delete", "tasks").eq).toEqual([
      ["org_id", "org-1"],
      ["assigned_to", "staff-1"],
      ["org_credential_id", "cred-1"],
      ["lead_days", 30],
      ["status", "open"],
    ]);
  });

  it("refuses a lead the chips don't offer", async () => {
    expect(await setCredentialReminder("cred-1", 45, true)).toEqual({
      ok: false,
      error: "Couldn't set that reminder.",
    });
    expect(writes).toHaveLength(0);
  });

  it("refuses a non-owner", async () => {
    dbRole = "admin";
    expect(await setCredentialReminder("cred-1", 30, true)).toEqual({ ok: false, error: NOT_OWNER });
    expect(writes).toHaveLength(0);
  });
});

/* ---------------------------------------------------------------------------
   WHAT ACTUALLY LANDS, AND WHAT IS TURNED AWAY.

   Every adoption test above checks the RULE — which kinds the filter names.
   None of them puts a real document in the table and watches what happens to
   it, so none of them could see the path that failed in production: a
   certificate the filter refuses is disowned by its term, and the file ends up
   owned by nothing. These do, now that an update answers with the rows it
   actually touched.

   Each "turned away" case has a "keeps" case beside it. Without those, a fake
   that matched nothing at all would pass every disown test here.
--------------------------------------------------------------------------- */
describe("adoption outcomes", () => {
  const uploaded = (over: Row = {}): Row => ({
    id: "doc-9",
    org_id: "org-1",
    uploaded_by: "staff-1",
    kind: "org_insurance",
    uploaded_at: "2026-09-08T00:00:00.000Z",
    org_credential_id: null,
    ...over,
  });

  describe("scanned in with a renewal", () => {
    beforeEach(() => {
      tables.org_credentials = [CARD]; // an INSURANCE card
    });

    const scan = () =>
      recordCredentialTerm("cred-1", { expiresOn: "2027-08-07", documentId: "doc-9", source: "scan" });

    it("keeps a certificate stamped the card's own kind", async () => {
      tables.documents = [uploaded()];
      await scan();
      expect(only("update", "documents").payload).toMatchObject({ org_credential_id: "cred-1" });
      expect(wrote("update", "org_credential_records")).toHaveLength(0);
    });

    /* Isaac's icare certificate, reproduced: stamped org_licence by a scan
       panel that had not been told it was holding insurance. It must LAND on
       the insurance card, with its stamp corrected, and stay filed. */
    it("keeps a certificate stamped the OTHER org kind, and corrects the stamp", async () => {
      tables.documents = [uploaded({ kind: "org_licence" })];
      await scan();
      expect(only("update", "documents").payload).toMatchObject({ kind: "org_insurance" });
      expect(wrote("update", "org_credential_records")).toHaveLength(0);
    });

    it.each([
      ["licence", "a staff ticket"],
      ["insurance_policy", "a vehicle policy"],
      ["fuel_receipt", "a fuel docket"],
    ])("turns away %s (%s), and the term disowns it", async (kind) => {
      tables.documents = [uploaded({ kind })];
      await scan();
      expect(only("update", "org_credential_records").payload).toEqual({ document_id: null });
    });

    it("turns away a file somebody else uploaded, and the term disowns it", async () => {
      tables.documents = [uploaded({ uploaded_by: "staff-someone-else" })];
      await scan();
      expect(only("update", "org_credential_records").payload).toEqual({ document_id: null });
    });
  });

  describe("filed by hand", () => {
    beforeEach(() => {
      tables.org_credentials = [CARD];
      tables.org_credential_records = [{ id: "R1", org_id: "org-1", credential_id: "cred-1" }];
    });

    it("files a certificate stamped the OTHER org kind", async () => {
      tables.documents = [uploaded({ kind: "org_licence" })];
      expect(await fileCredentialDocument("cred-1", "R1", "doc-9")).toEqual({ ok: true });
    });

    it("turns away a staff ticket, and says so", async () => {
      tables.documents = [uploaded({ kind: "licence" })];
      expect(await fileCredentialDocument("cred-1", "R1", "doc-9")).toEqual({
        ok: false,
        error: "That document couldn't be filed.",
      });
    });
  });
});
