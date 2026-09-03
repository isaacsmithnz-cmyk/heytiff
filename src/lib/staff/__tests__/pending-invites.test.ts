/* The Pending tab's name — the one place an invitation is drawn before its
   person exists.

   THIS FUNCTION HAD NO TEST AT ALL, which is how it kept printing an email
   prefix where a name belongs: "ben.fletcher", bold, above
   "ben.fletcher@gmail.com". The directory's own suite is fed PRE-SPLIT
   fixtures, so it asserts the rendering and never the derivation — the split
   could be changed today with a fully green run. Supabase's clients here are
   untyped and the pre-push hook runs no tsc, so a wrong column string reaches
   Vercel unremarked. A test on the mapper is the only guard there is. */

import type { PendingInviteRow } from "../types";

type Query = { table: string; cols: string };
const queries: Query[] = [];

/** invitations rows the first select returns — null `error` unless asked */
let inviteRows: Record<string, unknown>[] = [];
/** staff_profiles rows the card-name batch returns */
let cardRows: Record<string, unknown>[] = [];
/** make the `name`-carrying select fail, standing in for a deploy that
    precedes docs/migrations/invitation_name.sql */
let nameColumnMissing = false;

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const q: Query = { table, cols: "" };
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.eq = self;
      chain.is = self;
      /* the card batch is awaited straight off .in(), so that is where it
         resolves; the invitations read is awaited off .order() below */
      chain.in = () => Promise.resolve({ data: cardRows, error: null });
      chain.select = (cols: string) => {
        q.cols = cols;
        queries.push(q);
        return chain;
      };
      chain.order = () =>
        Promise.resolve(
          nameColumnMissing && q.cols.includes("name")
            ? { data: null, error: { message: 'column invitations.name does not exist' } }
            : { data: inviteRows, error: null },
        );
      return chain;
    },
  },
}));

import { listPendingInvites } from "../query";

const NOW = new Date("2026-09-03T00:00:00.000Z");
const invite = (over: Record<string, unknown> = {}) => ({
  id: "inv-1",
  email: "ben.fletcher@gmail.com",
  role: "staff",
  token: "tok",
  expires_at: "2026-09-09T00:00:00.000Z",
  accepted_at: null,
  name: null,
  staff_profile_id: null,
  ...over,
});

const only = async (): Promise<PendingInviteRow> =>
  (await listPendingInvites("org-1", { withLinks: true }, NOW))[0];

beforeEach(() => {
  queries.length = 0;
  inviteRows = [invite()];
  cardRows = [];
  nameColumnMissing = false;
});

describe("the name on a pending invitation", () => {
  it("is the one the inviter typed", async () => {
    inviteRows = [invite({ name: "Dan Whitfield" })];
    expect((await only()).name).toBe("Dan Whitfield");
  });

  it("comes off the claimed card when the invite points at one", async () => {
    // A card-claiming invite stores no name — the card is the org's own
    // answer, and a second copy would be a second thing to keep in step.
    inviteRows = [invite({ staff_profile_id: "card-7" })];
    cardRows = [{ id: "card-7", full_name: "Dan Whitfield", preferred_name: null }];
    expect((await only()).name).toBe("Dan Whitfield");
  });

  it("prefers what the card says they are CALLED", async () => {
    inviteRows = [invite({ staff_profile_id: "card-7" })];
    cardRows = [{ id: "card-7", full_name: "Daniel Whitfield", preferred_name: "Dan" }];
    expect((await only()).name).toBe("Dan");
  });

  it("falls back to the address for an invitation written before names", async () => {
    // Every existing row. There is nothing to backfill them from — the address
    // is the very thing that must stop standing in for a name — so the old
    // split survives exactly where it is still the only thing known.
    expect((await only()).name).toBe("ben.fletcher");
  });

  it("never prints an address as a name, whatever column it arrived in", async () => {
    // profiles.name holds one for these same users; a Name field is where
    // somebody pastes an address by reflex.
    inviteRows = [invite({ name: "dan@whitfield.com" })];
    expect((await only()).name).toBe("ben.fletcher");
  });

  it("does not read cards when no invitation claims one", async () => {
    await listPendingInvites("org-1", { withLinks: true }, NOW);
    expect(queries.some((q) => q.table === "staff_profiles")).toBe(false);
  });
});

describe("before the migration lands", () => {
  /* The house rule is that a screen behaves exactly as it did until its
     migration is applied. Resolving to "nothing pending" would satisfy the
     letter of that and BLANK a populated tab, which is worse than the split
     it replaces — so the read retries without the new column. */
  it("still lists the invitations, using the old split", async () => {
    nameColumnMissing = true;
    const rows = await listPendingInvites("org-1", { withLinks: true }, NOW);

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("ben.fletcher");
    expect(queries.filter((q) => q.table === "invitations")).toHaveLength(2);
    expect(queries[1].cols).not.toContain("name");
  });
});

describe("what leaves the database", () => {
  it("withholds the token and id from a viewer who may not invite", async () => {
    // the token IS the invite — possessing the link is what joins someone to
    // the org — so it is absent from the payload, not hidden in the UI
    const [row] = await listPendingInvites("org-1", {}, NOW);
    expect(row.token).toBeNull();
    expect(row.id).toBeNull();
    expect(queries[0].cols).not.toContain("token");
  });

  it("asks for the name either way", async () => {
    await listPendingInvites("org-1", {}, NOW);
    expect(queries[0].cols).toContain("name");
    expect(queries[0].cols).toContain("staff_profile_id");
  });
});
