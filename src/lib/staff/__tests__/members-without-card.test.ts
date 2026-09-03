/* A membership with no staff card — the state nothing in the app could see.

   `staffProfileIdFor` returns null without a card, and sixteen call sites then
   refuse with "No staff record for this account": commenting, reacting,
   RSVPing, poll votes, task acknowledgement, every document upload. The Team
   directory reads `staff_profiles` and decorates those rows with memberships —
   card to membership, never the reverse — so the person contributes no row and
   cannot even be counted. The only symptom is an absence, and an absence looks
   exactly like somebody who was never here.

   Production holds one: a staff membership written 2026-06-23, twenty-six days
   before `staff_profiles` existed. */

type Query = { table: string; cols: string; filters: string[]; eq: Record<string, unknown> };
const queries: Query[] = [];

let memberRows: Record<string, unknown>[] = [];
let cardRows: Record<string, unknown>[] = [];
let profileRows: Record<string, unknown>[] = [];
/** tables whose read comes back `{ data: null, error }` — a timeout, a dropped
    connection, anything postgrest resolves rather than throws */
let failing = new Set<string>();

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const q: Query = { table, cols: "", filters: [], eq: {} };
      const chain: Record<string, unknown> = {};
      const rows = () =>
        table === "memberships" ? memberRows : table === "profiles" ? profileRows : cardRows;
      chain.select = (cols: string) => {
        q.cols = cols;
        queries.push(q);
        return chain;
      };
      /* Recorded, not just tolerated — the test below asserts these are never
         reached on the cards read. */
      chain.not = (col: string, op: string) => {
        q.filters.push(`not:${col}:${op}`);
        return chain;
      };
      chain.is = (col: string) => {
        q.filters.push(`is:${col}`);
        return chain;
      };
      chain.neq = (col: string) => {
        q.filters.push(`neq:${col}`);
        return chain;
      };
      chain.in = (col: string, vals: unknown) => {
        q.eq[col] = vals;
        return chain;
      };
      chain.eq = (col: string, val: unknown) => {
        q.eq[col] = val;
        return chain;
      };
      /* Thenable rather than resolving on a particular link, so a filter added
         anywhere in the chain is recorded instead of crashing the builder —
         a mock that dies on the mutation proves nothing about the guard. */
      chain.then = (res: (v: { data: unknown; error: unknown }) => unknown) =>
        Promise.resolve(
          failing.has(table)
            ? { data: null, error: { code: "57014", message: "statement timeout" } }
            : { data: rows(), error: null },
        ).then(res);
      return chain;
    },
  },
}));

import { listMembersWithoutCard } from "../query";

beforeEach(() => {
  queries.length = 0;
  memberRows = [];
  cardRows = [];
  profileRows = [];
  failing = new Set();
});

describe("finding the members no card can see", () => {
  it("returns the member whose card is missing, and nobody else", async () => {
    memberRows = [
      { user_id: "auth0|owner", role: "owner" },
      { user_id: "auth0|orphan", role: "staff" },
    ];
    cardRows = [{ user_id: "auth0|owner" }];
    profileRows = [
      { user_id: "auth0|orphan", email: "sam@rivers.com", name: "Sam Rivers" },
    ];

    const rows = await listMembersWithoutCard("org-1");

    expect(rows).toEqual([
      { userId: "auth0|orphan", name: "Sam Rivers", email: "sam@rivers.com", role: "Staff" },
    ]);
  });

  it("says nothing when every member has one", async () => {
    memberRows = [{ user_id: "auth0|owner", role: "owner" }];
    cardRows = [{ user_id: "auth0|owner" }];

    expect(await listMembersWithoutCard("org-1")).toEqual([]);
    // and does not go looking up profiles for an empty list
    expect(queries.some((q) => q.table === "profiles")).toBe(false);
  });

  /* THE TRAP THIS AVOIDS, and it is a trap this codebase has already paid for:
     a bare `neq`/`not is null` on a NULLABLE column silently drops the null
     rows, and the Supabase mock everyone writes cannot catch it. An unclaimed
     card — imported from ServiceM8, or pre-seeded before onboarding — has
     `user_id` null, so filtering them out at the database is the obvious move.
     It is also unnecessary: nulls cannot enter a Set of strings and so cannot
     match anybody. The assertion is on the QUERY, because that is where the
     mistake would be made and the result would look identical here. */
  it("filters the cards read on nothing — the nulls are harmless", async () => {
    memberRows = [{ user_id: "auth0|orphan", role: "staff" }];
    cardRows = [{ user_id: null }];
    profileRows = [{ user_id: "auth0|orphan", email: "sam@rivers.com", name: null }];

    await listMembersWithoutCard("org-1");

    const cards = queries.find((q) => q.table === "staff_profiles");
    expect(cards?.filters).toEqual([]);
  });

  it("is not fooled by unclaimed cards", async () => {
    memberRows = [{ user_id: "auth0|orphan", role: "staff" }];
    cardRows = [{ user_id: null }, { user_id: null }];
    profileRows = [{ user_id: "auth0|orphan", email: "sam@rivers.com", name: null }];

    const rows = await listMembersWithoutCard("org-1");

    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe("auth0|orphan");
  });

  it("never offers an address as a name", async () => {
    // profiles.name is written from Auth0's claim on every login, and that
    // claim IS the sign-in address for an identity that never set one — which
    // is exactly the case for the member in production.
    memberRows = [{ user_id: "auth0|orphan", role: "staff" }];
    profileRows = [
      { user_id: "auth0|orphan", email: "sam@rivers.com", name: "sam@rivers.com" },
    ];

    expect((await listMembersWithoutCard("org-1"))[0].name).toBeNull();
  });

  it("names the role the way the directory spells it", async () => {
    memberRows = [
      { user_id: "a", role: "owner" },
      { user_id: "b", role: "admin" },
      { user_id: "c", role: "staff" },
    ];
    profileRows = [
      { user_id: "a", email: "a@x.com", name: null },
      { user_id: "b", email: "b@x.com", name: null },
      { user_id: "c", email: "c@x.com", name: null },
    ];

    expect((await listMembersWithoutCard("org-1")).map((r) => r.role)).toEqual([
      "Owner",
      "Admin",
      "Staff",
    ]);
  });

  /* THE FAILURE THAT AMPLIFIES. Every other read in this file degrades by
     OMISSION — a missing licence, a missing role, one less thing on screen. A
     failed CARDS read here would degrade by INVENTION: `claimed` comes back
     empty, every membership falls through the filter, and the Team page tells
     the reader that everyone in the workspace including the owner has no staff
     card — while the directory below, from an independent read, lists them all
     correctly. An advisory that cannot see its evidence must be absent. */
  it.each([["staff_profiles"], ["memberships"], ["profiles"]])(
    "says nothing at all when the %s read fails",
    async (table) => {
      memberRows = [
        { user_id: "auth0|owner", role: "owner" },
        { user_id: "auth0|orphan", role: "staff" },
      ];
      cardRows = [{ user_id: "auth0|owner" }];
      profileRows = [{ user_id: "auth0|orphan", email: "sam@rivers.com", name: null }];
      failing.add(table);

      expect(await listMembersWithoutCard("org-1")).toEqual([]);
    },
  );

  /* ORG SCOPING IS THE ONE THING HERE THAT IS NOT COSMETIC. This read walks
     `memberships` and `staff_profiles` directly rather than through any of the
     org-scoped helpers, so an omitted `.eq("org_id", …)` would put every
     workspace's members in one list — and the result would look perfectly
     plausible on a single-org database, which is what production is. */
  it("scopes both roster reads to the org", async () => {
    memberRows = [{ user_id: "auth0|orphan", role: "staff" }];
    profileRows = [{ user_id: "auth0|orphan", email: "sam@rivers.com", name: null }];

    await listMembersWithoutCard("org-1");

    for (const t of ["memberships", "staff_profiles"]) {
      expect(queries.find((q) => q.table === t)?.eq).toEqual({ org_id: "org-1" });
    }
    // profiles is global by design — it is keyed by the Auth0 sub, and the
    // subs it is given already came out of an org-scoped read.
    expect(queries.find((q) => q.table === "profiles")?.eq).toEqual({
      user_id: ["auth0|orphan"],
    });
  });

  it("survives a member with no profile row at all", async () => {
    memberRows = [{ user_id: "auth0|ghost", role: "staff" }];

    const rows = await listMembersWithoutCard("org-1");

    expect(rows).toEqual([
      { userId: "auth0|ghost", name: null, email: "", role: "Staff" },
    ]);
  });
});
