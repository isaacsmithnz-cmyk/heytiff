/* The people screen's pure half. Two things carry the weight here: shaping
   must keep email/mobile OUT of nothing (import is the one sanctioned reader)
   while dropping rows that could never be shown or linked — and the row
   builder must never let one human become two records: linked wins over
   suggested wins over new, and a saved decision is never re-offered. */

import {
  buildSm8PeopleRows,
  shapeSm8Person,
  type ImportStaffCandidate,
  type Sm8Person,
} from "../sm8-people";
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

const person = (over: Partial<Sm8Person> & { uuid: string }): Sm8Person => ({
  first: "Dan",
  last: "Smith",
  name: over.name ?? "Dan Smith",
  jobTitle: null,
  email: null,
  mobile: null,
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

describe("shapeSm8Person", () => {
  it("picks exactly the import fields — email and mobile included", () => {
    expect(shapeSm8Person(raw())).toEqual({
      uuid: "u-1",
      first: "Dan",
      last: "Smith",
      name: "Dan Smith",
      jobTitle: "Technician",
      email: "dan@acme.com",
      mobile: "0412 000 111",
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

describe("buildSm8PeopleRows", () => {
  it("an existing link wins over any suggestion, and names the card", () => {
    const rows = buildSm8PeopleRows(
      [person({ uuid: "u-1", email: "dan@acme.com" })],
      [card({ staffProfileId: "s-1", name: "Dan Smith", email: "dan@acme.com" })],
      [link("s-1", "u-1")]
    );
    expect(rows).toEqual([
      { kind: "linked", person: expect.anything(), staffProfileId: "s-1", staffName: "Dan Smith" },
    ]);
  });

  it("suggests by email even when the names disagree", () => {
    const rows = buildSm8PeopleRows(
      [person({ uuid: "u-1", name: "Danny S", first: "Danny", last: "S", email: "dan@acme.com" })],
      [card({ staffProfileId: "s-1", name: "Dan Smith", email: "dan@acme.com" })],
      []
    );
    expect(rows[0]).toMatchObject({ kind: "suggested", staffProfileId: "s-1", reason: "email" });
  });

  it("suggests by name when there is exactly one plausible card", () => {
    const rows = buildSm8PeopleRows(
      [person({ uuid: "u-1", name: "Dan Smith" })],
      [card({ staffProfileId: "s-1", name: "Dan Smith", firstName: "Dan", lastName: "Smith" })],
      []
    );
    expect(rows[0]).toMatchObject({ kind: "suggested", staffProfileId: "s-1", reason: "name" });
  });

  it("offers NOTHING when two cards match one person equally", () => {
    // two Dans here, one Dan there — a guess links a stranger, so no row
    // gets a suggestion and the person lands importable
    const rows = buildSm8PeopleRows(
      [person({ uuid: "u-1", name: "Dan Smith" })],
      [
        card({ staffProfileId: "s-1", name: "Dan Smith", firstName: "Dan", lastName: "Smith" }),
        card({ staffProfileId: "s-2", name: "Dan Smith", firstName: "Dan", lastName: "Smith" }),
      ],
      []
    );
    expect(rows[0].kind).toBe("new");
  });

  it("a card already holding a link is never suggested for a second person", () => {
    const rows = buildSm8PeopleRows(
      [
        person({ uuid: "u-1", name: "Dan Smith" }),
        person({ uuid: "u-2", name: "Dan Smith", first: "Dan", last: "Smith" }),
      ],
      [card({ staffProfileId: "s-1", name: "Dan Smith", firstName: "Dan", lastName: "Smith" })],
      [link("s-1", "u-1")]
    );
    expect(rows[0].kind).toBe("linked");
    expect(rows[1].kind).toBe("new");
  });

  it("a linked card that has since been deleted still reads as linked, by its captured label", () => {
    const rows = buildSm8PeopleRows(
      [person({ uuid: "u-1" })],
      [],
      [{ ...link("s-gone", "u-1"), remoteLabel: "Dan Smith" }]
    );
    expect(rows[0]).toMatchObject({ kind: "linked", staffName: "Dan Smith" });
  });

  it("keeps the input order — grouping is the screen's decision", () => {
    const rows = buildSm8PeopleRows(
      [person({ uuid: "u-b", name: "B Person", first: "B", last: "Person" }), person({ uuid: "u-a", name: "A Person", first: "A", last: "Person" })],
      [],
      []
    );
    expect(rows.map((r) => r.person.uuid)).toEqual(["u-b", "u-a"]);
  });
});
