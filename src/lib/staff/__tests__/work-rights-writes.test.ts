/* The SQL half of a person's right-to-work checks — the module BOTH doors run.

   Same arrangement and the same argument as licence-writes.test.ts: the gates
   live in the two action files, the writes live in one module, and this tests
   the shared half once, directly, with no session anywhere.

   WHAT IS DIFFERENT HERE, and it is the whole reason this file exists
   separately: the cache is RECOMPUTED from the newest CHECK on every write,
   never advanced toward a later expiry. A check can say the entitlement got
   WORSE, and the card has to follow it down.

   The fake is the builder from licence-writes.test.ts — these writes read
   before they write, and a two-call chain cannot express that. */

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
      /* An INSERT really lands in the table, unlike the licence fake's, because
         syncCache RE-READS the records straight after writing one. A fake that
         only recorded the insert would make every cache assertion here read
         null and prove nothing. */
      if (op === "insert") {
        tables[table] = [...(tables[table] ?? []), { id: `new-${table}`, ...(payload ?? {}) }];
      }
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


import { attachCheckDocument, recordCheck, removeCheck, setWorkRightsReminder } from "../work-rights-writes";

const ORG = "org-1";
const BOB = "staff-bob";
const ME = "staff-me";

const wrote = (op: Write["op"], table: string) => writes.filter((w) => w.op === op && w.table === table);
const only = (op: Write["op"], table: string) => {
  const list = wrote(op, table);
  expect(list).toHaveLength(1);
  return list[0];
};
const cacheWrite = () => only("update", "staff_profiles").payload!;

const check = (over: Record<string, unknown> = {}) => ({
  id: "C1",
  org_id: ORG,
  staff_profile_id: BOB,
  status: "Full working rights (visa)",
  visa_type: "482 TSS",
  hours_condition: "No work limitation",
  expires_on: "2028-03-04",
  checked_on: "2026-02-03",
  created_at: "2026-02-03T00:00:00.000Z",
  ...over,
});

beforeEach(() => {
  writes = [];
  writeError = null;
  tables = { staff_profiles: [{ id: BOB, org_id: ORG, visa_expiry: "2028-03-04" }] };
});

describe("recordCheck", () => {
  const ok = { status: "Full working rights (visa)", checkedOn: "2026-07-24" };

  it("inserts a check and re-derives all five cached columns from it", async () => {
    tables.staff_work_rights_records = [];
    const res = await recordCheck(ORG, BOB, ME, {
      ...ok,
      visaType: "482 TSS",
      hoursCondition: "No work limitation",
      expiresOn: "2028-03-04",
      source: "vevo",
    });
    expect(res).toEqual({ ok: true });

    expect(only("insert", "staff_work_rights_records").payload).toMatchObject({
      org_id: ORG,
      staff_profile_id: BOB,
      status: "Full working rights (visa)",
      checked_on: "2026-07-24",
      source: "vevo",
    });
    expect(cacheWrite()).toMatchObject({
      work_rights_status: "Full working rights (visa)",
      visa_type: "482 TSS",
      hours_condition: "No work limitation",
      visa_expiry: "2028-03-04",
      // the column keeps the VEVO name; what it holds is "when was this last
      // established", which is what every form has always written into it
      vevo_checked_at: "2026-07-24",
    });
  });

  /* THE INVERSION, end to end. A check that makes the entitlement WORSE and
     expires SOONER must still take the card, because it is the most recent
     thing anybody verified. A "latest expiry wins" cache would leave the card
     saying this person may work until 2030. */
  it("follows the newest check DOWN to a worse entitlement", async () => {
    tables.staff_work_rights_records = [
      check({ id: "OLD", checked_on: "2024-06-01", expires_on: "2030-01-01" }),
      check({
        id: "NEW",
        checked_on: "2026-07-24",
        expires_on: "2026-08-20",
        status: "Conditional working rights (visa)",
        visa_type: "Bridging visa A",
        created_at: "2026-07-24T00:00:00.000Z",
      }),
    ];
    await recordCheck(ORG, BOB, ME, { ...ok, expiresOn: "2026-08-20" });

    expect(cacheWrite()).toMatchObject({
      work_rights_status: "Conditional working rights (visa)",
      visa_type: "Bridging visa A",
      visa_expiry: "2026-08-20",
    });
  });

  it("leaves the card alone when an OLDER check is filed after the fact", async () => {
    tables.staff_work_rights_records = [
      check({ id: "CURRENT", checked_on: "2026-07-24", expires_on: "2028-03-04" }),
      check({ id: "FOUND", checked_on: "2024-01-01", expires_on: "2025-01-01", status: "No working rights" }),
    ];
    await recordCheck(ORG, BOB, ME, { ...ok, checkedOn: "2024-01-01" });
    // the newest check is still July's, so that is what the card says
    expect(cacheWrite()).toMatchObject({ visa_expiry: "2028-03-04" });
  });

  it("validates before it writes anything", async () => {
    expect(await recordCheck(ORG, BOB, ME, { status: "Full working rights (visa)" })).toEqual({
      ok: false,
      error: "A check needs the date it was made — pick one.",
    });
    expect(writes).toHaveLength(0);
  });

  it("refuses a person who is not in the caller's org", async () => {
    tables.staff_profiles = [];
    expect(await recordCheck(ORG, BOB, ME, ok)).toEqual({
      ok: false,
      error: "That staff member doesn't exist.",
    });
    expect(writes).toHaveLength(0);
  });

  it("adopts the evidence as the uploader's own, on the work_rights kind", async () => {
    tables.staff_work_rights_records = [];
    tables.documents = [{ id: "doc-9", org_id: ORG, uploaded_by: ME, kind: "work_rights" }];
    await recordCheck(ORG, BOB, ME, { ...ok, documentId: "doc-9", source: "scan" });

    const adoption = only("update", "documents");
    expect(adoption.payload).toEqual({
      work_rights_staff_id: BOB,
      work_rights_record_id: "new-staff_work_rights_records",
    });
    expect(adoption.eq).toEqual(
      expect.arrayContaining([["uploaded_by", ME], ["kind", "work_rights"]])
    );
  });

  it("un-claims evidence that refused adoption", async () => {
    tables.staff_work_rights_records = [];
    tables.documents = [];
    await recordCheck(ORG, BOB, ME, { ...ok, documentId: "doc-9" });
    const cleared = wrote("update", "staff_work_rights_records");
    expect(cleared).toHaveLength(1);
    expect(cleared[0].payload).toEqual({ document_id: null });
  });

  it("moves every reminder counting down to the old date", async () => {
    tables.staff_work_rights_records = [check({ checked_on: "2026-07-24", expires_on: "2029-03-04" })];
    tables.tasks = [
      { id: "t1", org_id: ORG, work_rights_staff_id: BOB, assigned_to: ME, lead_days: 30, status: "open" },
    ];
    await recordCheck(ORG, BOB, ME, { ...ok, expiresOn: "2029-03-04" });

    const moved = wrote("update", "tasks");
    expect(moved).toHaveLength(1);
    expect(moved[0].payload).toMatchObject({ due_date: "2029-02-02", reminder_emailed_at: null });
  });

  /* Somebody became a permanent resident. There is no longer anything to count
     down to, and a task due against a date that no longer exists would nag
     forever about a question that has been answered. */
  it("CLOSES open reminders when the new check has no expiry", async () => {
    tables.staff_work_rights_records = [];
    tables.tasks = [
      { id: "t1", org_id: ORG, work_rights_staff_id: BOB, assigned_to: ME, lead_days: 30, status: "open" },
    ];
    await recordCheck(ORG, BOB, ME, { status: "Permanent resident", checkedOn: "2026-07-24" });

    expect(wrote("update", "tasks")).toHaveLength(0);
    expect(only("delete", "tasks").eq).toEqual(
      expect.arrayContaining([["work_rights_staff_id", BOB], ["status", "open"]])
    );
  });
});

describe("removeCheck", () => {
  beforeEach(() => {
    tables.staff_work_rights_records = [
      check({ id: "C2", checked_on: "2026-07-24", expires_on: "2029-01-01" }),
      check({ id: "C1", checked_on: "2026-02-03", expires_on: "2028-03-04" }),
    ];
  });

  it("hands the card back to whatever check is left underneath", async () => {
    await removeCheck(ORG, BOB, "C2");
    expect(only("delete", "staff_work_rights_records").eq).toEqual([
      ["org_id", ORG],
      ["staff_profile_id", BOB],
      ["id", "C2"],
    ]);
    expect(cacheWrite()).toMatchObject({ visa_expiry: "2028-03-04", vevo_checked_at: "2026-02-03" });
  });

  it("blanks the card when the last check goes", async () => {
    tables.staff_work_rights_records = [check({ id: "C2" })];
    await removeCheck(ORG, BOB, "C2");
    expect(cacheWrite()).toMatchObject({
      work_rights_status: null,
      visa_expiry: null,
      vevo_checked_at: null,
    });
  });

  it("is a no-op on a check that is not that person's", async () => {
    expect(await removeCheck(ORG, "staff-someone-else", "C2")).toEqual({ ok: true });
    expect(writes).toHaveLength(0);
  });
});

describe("attachCheckDocument", () => {
  beforeEach(() => {
    tables.staff_work_rights_records = [check()];
    tables.documents = [{ id: "doc-9", org_id: ORG, uploaded_by: ME, kind: "work_rights" }];
  });

  it("files evidence under a check", async () => {
    expect(await attachCheckDocument(ORG, BOB, ME, "C1", "doc-9")).toEqual({ ok: true });
    expect(only("update", "documents").payload).toEqual({
      work_rights_staff_id: BOB,
      work_rights_record_id: "C1",
    });
  });

  it("refuses a check that is not that person's", async () => {
    expect(await attachCheckDocument(ORG, "staff-someone-else", ME, "C1", "doc-9")).toEqual({
      ok: false,
      error: "That check is no longer on file.",
    });
    expect(writes).toHaveLength(0);
  });
});

describe("setWorkRightsReminder", () => {
  it("creates one open task of the VIEWER's own, asking for a CHECK", async () => {
    expect(await setWorkRightsReminder(ORG, ME, BOB, "Bob Smith", 30, true)).toEqual({ ok: true });
    expect(only("insert", "tasks").payload).toMatchObject({
      title: "Check right to work — Bob Smith",
      detail: "Expires 4 Mar 2028 · 30 days' notice",
      assigned_to: ME,
      due_date: "2028-02-03",
      work_rights_staff_id: BOB,
      lead_days: 30,
    });
  });

  it("refuses when there is no expiry to count from", async () => {
    tables.staff_profiles = [{ id: BOB, org_id: ORG, visa_expiry: null }];
    expect(await setWorkRightsReminder(ORG, ME, BOB, null, 30, true)).toEqual({
      ok: false,
      error: "There's no expiry to count from — record a check with one first.",
    });
    expect(writes).toHaveLength(0);
  });

  it("deletes only the viewer's own when the chip goes off", async () => {
    expect(await setWorkRightsReminder(ORG, ME, BOB, null, 30, false)).toEqual({ ok: true });
    expect(only("delete", "tasks").eq).toEqual([
      ["org_id", ORG],
      ["assigned_to", ME],
      ["work_rights_staff_id", BOB],
      ["lead_days", 30],
      ["status", "open"],
    ]);
  });

  it("is a no-op when the chip is already on", async () => {
    tables.tasks = [
      { id: "t1", org_id: ORG, work_rights_staff_id: BOB, assigned_to: ME, lead_days: 30, status: "open" },
    ];
    expect(await setWorkRightsReminder(ORG, ME, BOB, null, 30, true)).toEqual({ ok: true });
    expect(wrote("insert", "tasks")).toHaveLength(0);
  });

  it("refuses a lead the chips don't offer", async () => {
    expect(await setWorkRightsReminder(ORG, ME, BOB, null, 45, true)).toEqual({
      ok: false,
      error: "Couldn't set that reminder.",
    });
    expect(writes).toHaveLength(0);
  });
});
