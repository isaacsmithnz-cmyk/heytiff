/* The SQL half of a staff ticket's terms — the module BOTH doors run.

   Your own Compliance card writes through app/actions/profile.ts and a
   manager's view of your card through app/actions/staff.ts. The gates differ
   and belong at those boundaries; the writes must not, or one of them would be
   the one that forgets to advance the cache. This file is why that split is
   safe: it tests the shared half once, directly, with no session anywhere.

   The fake is a real builder — these writes READ before they write (a renewal
   has to know the licence's cached expiry before it can decide whether to
   advance it) and a two-call chain cannot express that. `writes` is what the
   tests assert against: the operation, the table, the row, and the filters
   that scoped it. */

type Row = Record<string, unknown>;
type Write = { op: "insert" | "update" | "delete"; table: string; payload?: Row; eq: [string, unknown][] };

let tables: Record<string, Row[]> = {};
let writes: Write[] = [];
let writeError: { message: string } | null = null;

function builder(table: string) {
  const eq: [string, unknown][] = [];
  let op: Write["op"] | null = null;
  let payload: Row | undefined;
  let limit: number | null = null;
  let order: { col: string; asc: boolean } | null = null;

  const rows = () => {
    let list = tables[table] ?? [];
    for (const [col, val] of eq) list = list.filter((r) => r[col] === val);
    if (order) {
      const { col, asc } = order;
      list = [...list].sort((a, b) => String(a[col] ?? "").localeCompare(String(b[col] ?? "")) * (asc ? 1 : -1));
    }
    return limit == null ? list : list.slice(0, limit);
  };
  const settle = (single: boolean) => {
    if (op) {
      writes.push({ op, table, payload, eq: [...eq] });
      /* A delete really removes the rows, so the read that follows one sees
         what is left. removeTerm recomputes the cache from exactly that read,
         and a fake that kept the row would let a broken recompute pass. */
      if (op === "delete") {
        const gone = new Set(rows());
        tables[table] = (tables[table] ?? []).filter((r) => !gone.has(r));
      }
      /* An UPDATE answers with the rows it touched — that is how every
         adoption in this codebase tells "it landed" from "it refused". */
      const touched = op === "update" ? rows() : [{ id: `new-${table}`, ...(payload ?? {}) }];
      return {
        data: single ? (touched[0] ?? { id: `new-${table}`, ...(payload ?? {}) }) : touched,
        error: writeError,
      };
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
  chain.in = self;
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

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: { from: (table: string) => builder(table) },
}));
jest.mock("@/lib/dashboard/reminders", () => ({ remindAtFrom: () => "2026-07-08T07:00:00.000Z" }));
jest.mock("@/lib/dashboard/reminders-query", () => ({
  workdayHours: () => Promise.resolve({ start: "07:00", end: "15:30" }),
}));
jest.mock("@/lib/workboard/query", () => ({
  getSm8Timezone: () => Promise.resolve("Australia/Sydney"),
}));

import { fileLicenceDocument, recordTerm, removeTerm } from "../licence-writes";

const ORG = "org-1";
const STAFF = "staff-bob";
const ME = "staff-me";
const LIC = "lic-1";

const LICENCE = {
  id: LIC,
  org_id: ORG,
  staff_profile_id: STAFF,
  type_name: "ARC licence",
  expiry_date: "2026-08-07",
};

const wrote = (op: Write["op"], table: string) => writes.filter((w) => w.op === op && w.table === table);
const only = (op: Write["op"], table: string) => {
  const list = wrote(op, table);
  expect(list).toHaveLength(1);
  return list[0];
};

beforeEach(() => {
  writes = [];
  writeError = null;
  tables = { staff_licences: [{ ...LICENCE }] };
});

describe("recordTerm", () => {
  it("inserts a term and advances the ticket's cache to it", async () => {
    const res = await recordTerm(ORG, STAFF, ME, LIC, {
      number: "AU999",
      issuer: "Australian Refrigeration Council",
      issuingState: "NSW",
      expiresOn: "2028-08-07",
      startsOn: "2026-08-07",
      source: "scan",
    });
    expect(res).toEqual({ ok: true });

    expect(only("insert", "staff_licence_records").payload).toMatchObject({
      org_id: ORG,
      licence_id: LIC,
      staff_profile_id: STAFF,
      number: "AU999",
      issuing_state: "NSW",
      expires_on: "2028-08-07",
      source: "scan",
    });
    expect(only("update", "staff_licences").payload).toMatchObject({
      expiry_date: "2028-08-07",
      licence_number: "AU999",
    });
  });

  it("files an OLDER card into the history without retiring the ticket in force", async () => {
    await recordTerm(ORG, STAFF, ME, LIC, { expiresOn: "2024-08-07" });
    expect(wrote("insert", "staff_licence_records")).toHaveLength(1);
    // the ticket still points at 2026-08-07 — nothing updated it
    expect(wrote("update", "staff_licences")).toHaveLength(0);
  });

  it("validates before it writes anything", async () => {
    expect(await recordTerm(ORG, STAFF, ME, LIC, { number: "AU1" })).toEqual({
      ok: false,
      error: "An expiry date is what makes this a term — pick one.",
    });
    expect(writes).toHaveLength(0);
  });

  /* SCOPED TO THE PERSON, not just to the id. A licence id belonging to
     somebody else in the same org must be as unreachable as one that does not
     exist — which is the same answer to the caller. */
  it("refuses a licence that is not that person's", async () => {
    expect(await recordTerm(ORG, "staff-someone-else", ME, LIC, { expiresOn: "2028-08-07" })).toEqual({
      ok: false,
      error: "That licence is no longer on file.",
    });
    expect(writes).toHaveLength(0);
  });

  /* The UPLOADER is the actor, not the subject: a manager scanning Bob's
     ticket uploaded that file, and adoption only ever accepts the uploader's
     own, confirmed, still-unowned file of the right kind. */
  it("adopts the scanned photo under the term, as the uploader's own", async () => {
    tables.documents = [{ id: "doc-9", org_id: ORG, uploaded_by: ME, kind: "licence" }];
    await recordTerm(ORG, STAFF, ME, LIC, { expiresOn: "2028-08-07", documentId: "doc-9", source: "scan" });

    const adoption = only("update", "documents");
    expect(adoption.payload).toEqual({
      staff_licence_id: LIC,
      licence_record_id: "new-staff_licence_records",
    });
    expect(adoption.eq).toEqual(
      expect.arrayContaining([
        ["org_id", ORG],
        ["id", "doc-9"],
        ["uploaded_by", ME],
        ["kind", "licence"],
      ])
    );
  });

  it("un-claims a document that refused adoption, rather than pointing at it", async () => {
    // nothing in `documents` matches, so the update touches no rows
    tables.documents = [];
    await recordTerm(ORG, STAFF, ME, LIC, { expiresOn: "2028-08-07", documentId: "doc-9" });
    const cleared = wrote("update", "staff_licence_records");
    expect(cleared).toHaveLength(1);
    expect(cleared[0].payload).toEqual({ document_id: null });
  });

});

describe("removeTerm", () => {
  beforeEach(() => {
    tables.staff_licence_records = [
      { id: "T1", org_id: ORG, licence_id: LIC, staff_profile_id: STAFF, expires_on: "2028-08-07", number: "AU999" },
      { id: "T0", org_id: ORG, licence_id: LIC, staff_profile_id: STAFF, expires_on: "2026-08-07", number: "AU123" },
    ];
  });

  it("hands the ticket back to whatever term is left underneath", async () => {
    await removeTerm(ORG, STAFF, "T1");
    expect(only("delete", "staff_licence_records").eq).toEqual([
      ["org_id", ORG],
      ["staff_profile_id", STAFF],
      ["id", "T1"],
    ]);
    // recomputed from what remains, never assumed
    expect(only("update", "staff_licences").payload).toMatchObject({
      expiry_date: "2026-08-07",
      licence_number: "AU123",
    });
  });

  it("clears the ticket's expiry when the last term goes", async () => {
    tables.staff_licence_records = [
      { id: "T1", org_id: ORG, licence_id: LIC, staff_profile_id: STAFF, expires_on: "2028-08-07" },
    ];
    await removeTerm(ORG, STAFF, "T1");
    expect(only("update", "staff_licences").payload).toMatchObject({ expiry_date: null });
  });

  it("is a no-op on a term that is not that person's", async () => {
    expect(await removeTerm(ORG, "staff-someone-else", "T1")).toEqual({ ok: true });
    expect(writes).toHaveLength(0);
  });
});

/* FILING A DOCUMENT, with a term and without one.

   THE SECOND CASE IS WHY THIS TAKES A LICENCE ID AT ALL. A term is a period
   and expires_on is NOT NULL, so a ticket that never lapses — a white card,
   one of the four seeded types — can hold no term. While this took only a term
   id, that ticket could never have a document filed against it at all: the
   only "Add document" on the screen lived inside the current term's card. */
/* NO TASK ROW, EVER. Recording a term used to move every open reminder
   counting down to the old date; there are no such rows to move now — the
   org's expiry window is derived at read (lib/expiry.ts), and a task is
   something Tiff makes from a note. A term write that touches `tasks` is a
   door growing back. */
describe("recordTerm and the tasks table", () => {
  it("touches no task row — the org's expiry window nudges, not a task", async () => {
    await recordTerm(ORG, STAFF, ME, LIC, { expiresOn: "2027-08-07" });
    expect(writes.filter((w) => w.table === "tasks")).toEqual([]);
  });
});

describe("fileLicenceDocument", () => {
  beforeEach(() => {
    tables.staff_licence_records = [
      { id: "T1", org_id: ORG, licence_id: LIC, staff_profile_id: STAFF, expires_on: "2026-08-07" },
    ];
    tables.documents = [{ id: "doc-9", org_id: ORG, uploaded_by: ME, kind: "licence" }];
  });

  it("files a document under a term, on the kind a licence scan is", async () => {
    expect(await fileLicenceDocument(ORG, STAFF, ME, LIC, "T1", "doc-9")).toEqual({ ok: true });
    const write = only("update", "documents");
    expect(write.payload).toEqual({ staff_licence_id: LIC, licence_record_id: "T1" });
    expect(write.eq).toEqual(expect.arrayContaining([["kind", "licence"]]));
  });

  /* A WHITE CARD. It owns the document; nothing owns the filing, which is
     exactly the row looseTermDocuments reads back. */
  it("files it against the TICKET ITSELF when the ticket has no term", async () => {
    tables.staff_licence_records = [];
    expect(await fileLicenceDocument(ORG, STAFF, ME, LIC, null, "doc-9")).toEqual({ ok: true });
    const write = only("update", "documents");
    expect(write.payload).toEqual({ staff_licence_id: LIC, licence_record_id: null });
    expect(write.eq).toEqual(expect.arrayContaining([["kind", "licence"]]));
  });

  it("refuses a licence that is not that person's, term or no term", async () => {
    for (const term of ["T1", null]) {
      writes = [];
      expect(await fileLicenceDocument(ORG, "staff-someone-else", ME, LIC, term, "doc-9")).toEqual({
        ok: false,
        error: "That licence is no longer on file.",
      });
      expect(writes).toHaveLength(0);
    }
  });

  /* The term id comes from a client, so it is checked against THIS licence and
     not merely against the org — a document filed under another ticket's term
     would sit in a history it does not belong to. */
  it("refuses a term that belongs to a different ticket", async () => {
    tables.staff_licence_records = [
      { id: "T1", org_id: ORG, licence_id: "lic-other", staff_profile_id: STAFF, expires_on: "2026-08-07" },
    ];
    expect(await fileLicenceDocument(ORG, STAFF, ME, LIC, "T1", "doc-9")).toEqual({
      ok: false,
      error: "That term is no longer on file.",
    });
    expect(writes).toHaveLength(0);
  });

  it("refuses a document that is not the uploader's own to give away", async () => {
    tables.documents = [{ id: "doc-9", org_id: ORG, uploaded_by: "staff-someone-else", kind: "licence" }];
    expect(await fileLicenceDocument(ORG, STAFF, ME, LIC, null, "doc-9")).toEqual({
      ok: false,
      error: "That document couldn't be filed.",
    });
  });
});

