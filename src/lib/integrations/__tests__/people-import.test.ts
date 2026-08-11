/* The people screens' pure half, both providers. Two things carry the weight:
   each provider's mapper must drop what could never be shown or linked while
   carrying every field import may write — and the row builder must never let
   one human become two records: linked wins over suggested wins over new, and
   a saved decision is never re-offered.

   The builder is exercised through ImportCandidate directly, because it is
   deliberately blind to which provider a person came from. */

import { buildPeopleRows, type ImportCandidate, type ImportStaffCandidate } from "../people-import";
import { shapeSm8Person } from "../sm8-people";
import { xeroPersonOf } from "../xero-people";
import type { XeroEmployee } from "../xero-shape";
import type { IntegrationLink } from "../links";

const raw = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  uuid: "u-1",
  first: "Dan",
  last: "Smith",
  job_title: "Technician",
  email: "dan@acme.com",
  mobile: "0412 000 111",
  active: 1,
  ...over,
});

const person = (over: Partial<ImportCandidate> & { id: string }): ImportCandidate => ({
  first: "Dan",
  last: "Smith",
  name: over.name ?? "Dan Smith",
  jobTitle: null,
  email: null,
  phone: null,
  active: true,
  ...over,
});

const card = (
  over: Partial<ImportStaffCandidate> & { staffProfileId: string }
): ImportStaffCandidate => ({
  firstName: null,
  lastName: null,
  fullName: null,
  email: null,
  name: over.name ?? "Somebody Here",
  status: "Active",
  ...over,
});

const link = (staffProfileId: string, remoteId: string): IntegrationLink => ({
  id: `l-${remoteId}`,
  staffProfileId,
  remoteId,
  remoteLabel: null,
  matchedBy: "manual",
  linkedAt: "2026-08-10T00:00:00Z",
});

describe("shapeSm8Person — ServiceM8's mapper", () => {
  it("picks exactly the import fields — email and mobile included", () => {
    expect(shapeSm8Person(raw())).toEqual({
      id: "u-1",
      first: "Dan",
      last: "Smith",
      name: "Dan Smith",
      jobTitle: "Technician",
      email: "dan@acme.com",
      phone: "0412 000 111",
      active: true,
    });
  });

  it("drops a row with no uuid — nothing to store in remote_id", () => {
    expect(shapeSm8Person(raw({ uuid: "" }))).toBeNull();
    expect(shapeSm8Person(raw({ uuid: undefined }))).toBeNull();
  });

  it("drops a nameless row — no picker can show it", () => {
    expect(shapeSm8Person(raw({ first: "", last: null }))).toBeNull();
  });

  it("keeps a half-named person", () => {
    expect(shapeSm8Person(raw({ last: "" }))?.name).toBe("Dan");
  });

  it("reads active as 1/'1' and treats anything else as inactive", () => {
    expect(shapeSm8Person(raw({ active: 1 }))?.active).toBe(true);
    expect(shapeSm8Person(raw({ active: "1" }))?.active).toBe(true);
    expect(shapeSm8Person(raw({ active: 0 }))?.active).toBe(false);
    expect(shapeSm8Person(raw({ active: undefined }))?.active).toBe(false);
  });

  it("refuses non-objects rather than throwing", () => {
    expect(shapeSm8Person(null)).toBeNull();
    expect(shapeSm8Person("row")).toBeNull();
  });
});

describe("xeroPersonOf — Xero's mapper", () => {
  const employee = (over: Partial<XeroEmployee> = {}): XeroEmployee => ({
    employeeId: "x-1",
    firstName: "Dan",
    lastName: "Smith",
    name: "Dan Smith",
    email: "dan@acme.com",
    jobTitle: "Technician",
    active: true,
    employmentType: "EMPLOYEE",
    payrollCalendarId: "cal-1",
    ...over,
  });

  it("carries the four importable fields and nothing else", () => {
    expect(xeroPersonOf(employee())).toEqual({
      id: "x-1",
      first: "Dan",
      last: "Smith",
      name: "Dan Smith",
      jobTitle: "Technician",
      email: "dan@acme.com",
      // Xero's payroll list has no number; a null here would imply we looked
      phone: null,
      active: true,
    });
  });

  it("NEVER carries employment type — that belongs to the drift lane", () => {
    // copying CONTRACTOR in at import would make this screen a second, quieter
    // writer of a pay-adjacent field HeyTiff owns
    const mapped = xeroPersonOf(employee({ employmentType: "CONTRACTOR" })) as Record<string, unknown>;
    expect("employmentType" in mapped).toBe(false);
    expect(Object.values(mapped)).not.toContain("CONTRACTOR");
  });

  it("carries nothing pay-shaped at all", () => {
    const keys = Object.keys(xeroPersonOf(employee()));
    expect(keys).not.toEqual(expect.arrayContaining(["payrollCalendarId", "hourlyRate", "wage"]));
  });

  it("a terminated employee maps to inactive — importable, but not onto the roster", () => {
    expect(xeroPersonOf(employee({ active: false })).active).toBe(false);
  });

  it("blank name halves become null rather than empty strings", () => {
    const mapped = xeroPersonOf(employee({ firstName: "", lastName: "", name: "Dan Smith" }));
    expect(mapped.first).toBeNull();
    expect(mapped.last).toBeNull();
  });
});

describe("buildPeopleRows — provider-blind", () => {
  it("an existing link wins over any suggestion, and names the card", () => {
    const rows = buildPeopleRows(
      [person({ id: "u-1", email: "dan@acme.com" })],
      [card({ staffProfileId: "s-1", name: "Dan Smith", email: "dan@acme.com" })],
      [link("s-1", "u-1")]
    );
    expect(rows).toEqual([
      { kind: "linked", person: expect.anything(), staffProfileId: "s-1", staffName: "Dan Smith" },
    ]);
  });

  it("suggests by email even when the names disagree", () => {
    const rows = buildPeopleRows(
      [person({ id: "u-1", name: "Danny S", first: "Danny", last: "S", email: "dan@acme.com" })],
      [card({ staffProfileId: "s-1", name: "Dan Smith", email: "dan@acme.com" })],
      []
    );
    expect(rows[0]).toMatchObject({ kind: "suggested", staffProfileId: "s-1", reason: "email" });
  });

  it("suggests by name when there is exactly one plausible card", () => {
    const rows = buildPeopleRows(
      [person({ id: "u-1", name: "Dan Smith" })],
      [card({ staffProfileId: "s-1", name: "Dan Smith", firstName: "Dan", lastName: "Smith" })],
      []
    );
    expect(rows[0]).toMatchObject({ kind: "suggested", staffProfileId: "s-1", reason: "name" });
  });

  it("offers NOTHING when two cards match one person equally", () => {
    // two Dans here, one Dan there — a guess links a stranger, so no row
    // gets a suggestion and the person lands importable
    const rows = buildPeopleRows(
      [person({ id: "u-1", name: "Dan Smith" })],
      [
        card({ staffProfileId: "s-1", name: "Dan Smith", firstName: "Dan", lastName: "Smith" }),
        card({ staffProfileId: "s-2", name: "Dan Smith", firstName: "Dan", lastName: "Smith" }),
      ],
      []
    );
    expect(rows[0].kind).toBe("new");
  });

  it("a card already holding a link is never suggested for a second person", () => {
    const rows = buildPeopleRows(
      [
        person({ id: "u-1", name: "Dan Smith" }),
        person({ id: "u-2", name: "Dan Smith", first: "Dan", last: "Smith" }),
      ],
      [card({ staffProfileId: "s-1", name: "Dan Smith", firstName: "Dan", lastName: "Smith" })],
      [link("s-1", "u-1")]
    );
    expect(rows[0].kind).toBe("linked");
    expect(rows[1].kind).toBe("new");
  });

  it("a linked card that has since been deleted still reads as linked, by its captured label", () => {
    const rows = buildPeopleRows(
      [person({ id: "u-1" })],
      [],
      [{ ...link("s-gone", "u-1"), remoteLabel: "Dan Smith" }]
    );
    expect(rows[0]).toMatchObject({ kind: "linked", staffName: "Dan Smith" });
  });

  it("keeps the input order — grouping is the screen's decision", () => {
    const rows = buildPeopleRows(
      [person({ id: "u-b", name: "B Person", first: "B", last: "Person" }), person({ id: "u-a", name: "A Person", first: "A", last: "Person" })],
      [],
      []
    );
    expect(rows.map((r: { person: ImportCandidate }) => r.person.id)).toEqual(["u-b", "u-a"]);
  });
});
