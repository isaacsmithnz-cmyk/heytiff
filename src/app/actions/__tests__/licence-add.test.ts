/* Adding a staff ticket from a scan, through BOTH doors: your own card
   (actions/profile.ts) and a manager adding to someone else's
   (actions/staff.ts).

   A term is a period and `expires_on` is NOT NULL, so a white card, which
   never lapses, cannot be one. The add screen used to send nothing for it,
   and the photo it had already uploaded was left owned by nothing, with the
   number read off it. The scan goes with the save now, and each door files
   the photo against the new ticket itself. Both doors are run because each
   writes that line for itself.

   The fake is the builder from lib/staff/__tests__/licence-writes.test.ts,
   with two things made real that these need: an INSERT adds its row, because
   the photo is filed by reading back the ticket that was just made; and an
   UPDATE changes the rows it matches, so a test can look at the document
   afterwards and see who owns it. */

import type { LicenceInput } from "@/lib/staff/licence";
import type { LicenceTermInput } from "@/lib/staff/licence-records";

type Row = Record<string, unknown>;
type Write = { op: "insert" | "update" | "delete"; table: string; payload?: Row; eq: [string, unknown][] };

let tables: Record<string, Row[]> = {};
let writes: Write[] = [];

function builder(table: string) {
  const eq: [string, unknown][] = [];
  let op: Write["op"] | null = null;
  let payload: Row | undefined;

  const rows = () => {
    let list = tables[table] ?? [];
    for (const [col, val] of eq) list = list.filter((r) => r[col] === val);
    return list;
  };
  const settle = (single: boolean) => {
    if (op === "insert") {
      writes.push({ op, table, payload, eq: [...eq] });
      const made = { id: `new-${table}`, ...(payload ?? {}) };
      tables[table] = [...(tables[table] ?? []), made];
      return { data: single ? made : [made], error: null };
    }
    if (op) {
      writes.push({ op, table, payload, eq: [...eq] });
      const touched = rows();
      if (op === "update") for (const r of touched) Object.assign(r, payload);
      return { data: single ? (touched[0] ?? null) : touched, error: null };
    }
    const list = rows();
    return { data: single ? (list[0] ?? null) : list, error: null, count: list.length };
  };

  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = self;
  chain.eq = (col: string, val: unknown) => {
    eq.push([col, val]);
    return chain;
  };
  chain.not = self;
  chain.is = self;
  chain.in = self;
  chain.order = self;
  chain.limit = self;
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
jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn(async () => ({ user: { sub: "auth0|me" }, orgId: "org-1" })) },
}));
// you, adding to your own card — and the same you, holding `team`, adding to Bob's
jest.mock("@/lib/permissions-server", () => ({
  requireOrg: jest.fn(async () => ({ orgId: "org-1", userId: "auth0|me" })),
  getCapabilities: jest.fn(async () => new Set(["team"])),
  getOwnership: jest.fn(async () => ({ role: "admin", userId: "auth0|me", primaryOwnerUserId: "auth0|owner" })),
}));
// the uploader is the ACTOR on the manager's door — you, not Bob
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: jest.fn(async () => "staff-me") }));
jest.mock("@/lib/integrations/drift-sweep", () => ({ clearDrift: jest.fn(async () => {}) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { addMyLicence } from "../profile";
import { addStaffLicence } from "../staff";

const wrote = (op: Write["op"], table: string) => writes.filter((w) => w.op === op && w.table === table);
const only = (op: Write["op"], table: string) => {
  const list = wrote(op, table);
  expect(list).toHaveLength(1);
  return list[0];
};

/** The photo the scan panel uploaded, still owned by nothing. */
const photo = (over: Row = {}): Row => ({
  id: "doc-7",
  org_id: "org-1",
  uploaded_by: "staff-me",
  kind: "licence",
  ...over,
});

const WHITE_CARD: LicenceInput = { typeName: "White card" };
const undated: LicenceTermInput = {
  number: "WC-12345",
  issuer: "SafeWork NSW",
  issuingState: "NSW",
  startsOn: "2019-03-02",
  expiresOn: "",
  documentId: "doc-7",
  source: "scan",
};

beforeEach(() => {
  writes = [];
  tables = {
    staff_profiles: [
      { id: "staff-me", org_id: "org-1", user_id: "auth0|me" },
      { id: "staff-bob", org_id: "org-1", user_id: null },
    ],
    documents: [photo()],
  };
});

type Add = (input: LicenceInput, scan?: LicenceTermInput) => Promise<{ ok: boolean }>;
const DOORS: [string, Add, string][] = [
  ["on your own card", (input, scan) => addMyLicence(input, scan), "staff-me"],
  ["on someone else's, as a manager", (input, scan) => addStaffLicence("staff-bob", input, scan), "staff-bob"],
];

describe.each(DOORS)("adding a ticket from a scan %s", (_door, add, holder) => {
  it("files the photo of a card with no expiry against the new ticket, and puts its number on the ticket", async () => {
    expect(await add(WHITE_CARD, undated)).toEqual({ ok: true });

    expect(only("insert", "staff_licences").payload).toMatchObject({
      staff_profile_id: holder,
      type_name: "White card",
      licence_number: "WC-12345",
      expiry_date: null,
    });
    expect(wrote("insert", "staff_licence_records")).toHaveLength(0);
    // the ticket OWNS it, and nothing owns the filing
    expect(tables.documents[0]).toMatchObject({ staff_licence_id: "new-staff_licences", licence_record_id: null });
  });

  it("turns away a photo somebody else uploaded, and still adds the ticket", async () => {
    tables.documents = [photo({ uploaded_by: "staff-someone-else" })];
    expect(await add(WHITE_CARD, undated)).toEqual({ ok: true });
    expect(wrote("insert", "staff_licences")).toHaveLength(1);
    expect(tables.documents[0].staff_licence_id).toBeUndefined();
  });

  it("still makes a card WITH an expiry the ticket's first term, its photo under that term", async () => {
    expect(await add({ typeName: "ARC licence" }, { ...undated, expiresOn: "2027-05-01" })).toEqual({ ok: true });

    expect(only("insert", "staff_licences").payload).toMatchObject({
      licence_number: "WC-12345",
      expiry_date: "2027-05-01",
    });
    expect(only("insert", "staff_licence_records").payload).toMatchObject({
      licence_id: "new-staff_licences",
      expires_on: "2027-05-01",
      document_id: "doc-7",
    });
    expect(tables.documents[0]).toMatchObject({
      staff_licence_id: "new-staff_licences",
      licence_record_id: "new-staff_licence_records",
    });
  });

  it("files nothing when no photo came with the scan", async () => {
    expect(await add(WHITE_CARD, { ...undated, documentId: null })).toEqual({ ok: true });
    expect(wrote("update", "documents")).toHaveLength(0);
    expect(only("insert", "staff_licences").payload).toMatchObject({ licence_number: "WC-12345" });
  });
});
