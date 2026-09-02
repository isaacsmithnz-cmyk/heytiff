/* Invite actions — the two-tier gate (may they invite AT ALL, and at THIS
   role), org scoping on every write, and the accepted-invite protections. */

import { CAPABILITIES, type Capability } from "@/lib/permissions";

type Call = { table: string; op: string; payload?: Record<string, unknown>; filters: Record<string, unknown> };

const calls: Call[] = [];
/** The row an insert or a guarded update hands back — what the letter is
    built from. Its token is the secret that write minted. */
const LETTER_ROW = {
  email: "new@hire.com",
  role: "staff",
  token: "tok-abc",
  expires_at: "2026-09-09T00:00:00.000Z",
};
/** what a select on `invitations` finds — null = no such row for this org */
let inviteRow: { id: string; accepted_at: string | null } | null = { id: "inv-1", accepted_at: null };
/** what createInvite's duplicate check finds — [] = no open invite for the address yet */
let openInvites: Record<string, unknown>[] = [];
/** what a card-claiming invite's staff_profiles lookup finds — null = not ours / gone */
let staffCardRow: { id: string; user_id: string | null } | null = null;
/** open invites already holding the card — the one-per-card twin of openInvites */
let cardOpenInvites: Record<string, unknown>[] = [];
/** the org the letter names */
let orgRow: Record<string, unknown> | null = { trading_name: "Diamond Air", legal_name: null, name: null };
/** what renewInvite's guarded update matches — null = accepted in between */
let renewedRow: Record<string, unknown> | null = LETTER_ROW;
/** make the insert fail, to pin that a dead write never posts a letter */
let insertFails = false;
/** every card in the org — what lookupInvitee reads to resolve an address */
let staffRows: Record<string, unknown>[] = [];
/** integration_links rows, so a resolved card can say where it came from */
let linkRows: Record<string, unknown>[] = [];
/** whether the caller may read other people's cards (`team`) */
let canTeam = true;
/** the INVITER's own staff card and profile row — the letter's name sources */
let inviterCard: Record<string, unknown> | null = { full_name: "Isaac Smith" };
let inviterProfile: Record<string, unknown> | null = { name: "Isaac Smith" };

let role: string | null = "owner";
let caps: Set<Capability> = new Set(CAPABILITIES);
let session: unknown = {
  orgId: "org-1",
  user: { sub: "auth0|boss", email: "boss@example.com", name: "Bossy Boots" },
};

const table = (name: string) => {
  const call: Call = { table: name, op: "select", filters: {} };
  const c: Record<string, unknown> = {};
  const chain = () => c;
  c.eq = (k: string, v: unknown) => {
    call.filters[k] = v;
    return chain();
  };
  c.is = (k: string, v: unknown) => {
    call.filters[k] = v;
    return chain();
  };
  c.select = () => chain();
  c.limit = () => chain();
  /* The insert RETURNS ITS ROW now — the letter needs the token this write
     minted, and reading it back afterwards would be a second chance to fetch
     the wrong one. So the builder continues instead of resolving. */
  c.insert = (row: Record<string, unknown>) => {
    call.op = "insert";
    call.payload = row;
    calls.push(call);
    return chain();
  };
  c.update = (row: Record<string, unknown>) => {
    call.op = "update";
    call.payload = row;
    calls.push(call);
    return chain();
  };
  c.delete = () => {
    call.op = "delete";
    calls.push(call);
    return chain();
  };
  c.single = () => Promise.resolve({ data: insertFails ? null : LETTER_ROW, error: insertFails ? { message: "nope" } : null });
  c.maybeSingle = () => {
    // the inviter's OWN card and profile — where the letter gets a NAME. The
    // card lookup is told from the invitee's by its user_id filter.
    if (name === "staff_profiles" && call.filters.user_id !== undefined)
      return Promise.resolve({ data: inviterCard, error: null });
    if (name === "profiles") return Promise.resolve({ data: inviterProfile, error: null });
    if (name === "staff_profiles") return Promise.resolve({ data: staffCardRow, error: null });
    /* The company the letter names. Its own branch because `invitations` and
       `organizations` both answer maybeSingle here and they are different
       shapes — before this, deliver() read an invite row as an org. */
    if (name === "organizations") return Promise.resolve({ data: orgRow, error: null });
    // a write that asked for its row back (renew) vs. the open-invite lookup
    if (call.op === "update") return Promise.resolve({ data: renewedRow, error: null });
    return Promise.resolve({ data: inviteRow, error: inviteRow ? null : { message: "no rows" } });
  };
  /* Awaiting the chain resolves it: a still-`select` chain is a LIST read
     (a duplicate check), recorded so its filters can be asserted; anything
     else (delete/update, already recorded) resolves like a write. The two
     invitations duplicate checks are told apart by what they filtered on. */
  c.then = (res: (v: { data?: unknown; error: null }) => unknown) => {
    if (call.op === "select") {
      calls.push(call);
      const rows =
        name === "staff_profiles" ? staffRows
        : name === "integration_links" ? linkRows
        : name !== "invitations" ? []
        : call.filters.staff_profile_id !== undefined ? cardOpenInvites
        : openInvites;
      return Promise.resolve({ data: rows, error: null }).then(res);
    }
    return Promise.resolve({ error: null }).then(res);
  };
  return c;
};

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: (n: string) => table(n) } }));
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: jest.fn(async () => session) } }));
jest.mock("@/lib/permissions-server", () => ({
  getDbRole: jest.fn(async () => role),
  getCapabilities: jest.fn(async () => caps),
  can: jest.fn(async (c: string) => (c === "team" ? canTeam : caps.has(c as Capability))),
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("next/headers", () => ({
  headers: async () => new Map([["host", "go.hey-tiff.com"]]),
}));

/* The transport is stubbed, not the letter: what gets POSTED is the thing
   worth asserting, and rendering it for real is what catches a link built
   against the wrong origin or a token that never reached the envelope. */
const sent: { to: string; subject: string; html: string; replyTo?: string }[] = [];
let sendResult: unknown = { ok: true };
jest.mock("@/lib/email/send", () => ({
  isEmailConfigured: () => true,
  sendEmail: jest.fn(async (letter: { to: string; subject: string; html: string; replyTo?: string }) => {
    sent.push(letter);
    return sendResult;
  }),
}));

import { createInvite, lookupInvitee, renewInvite, revokeInvite } from "../invite";

const DAY = 86_400_000;
/* The action keeps its window private — a "use server" module may only export
   async functions — so it is restated here, matching the DB default on
   invitations.expires_at (now() + '7 days'). */
const INVITE_WINDOW_DAYS = 7;
const writes = (op: string) => calls.filter((c) => c.op === op);
const payloadOf = (c: Call): Record<string, string> => (c.payload ?? {}) as Record<string, string>;

beforeEach(() => {
  calls.length = 0;
  sent.length = 0;
  sendResult = { ok: true };
  inviteRow = { id: "inv-1", accepted_at: null };
  openInvites = [];
  staffCardRow = null;
  cardOpenInvites = [];
  orgRow = { trading_name: "Diamond Air", legal_name: null, name: null };
  staffRows = [];
  linkRows = [];
  canTeam = true;
  inviterCard = { full_name: "Isaac Smith" };
  inviterProfile = { name: "Isaac Smith" };
  renewedRow = LETTER_ROW;
  insertFails = false;
  role = "owner";
  caps = new Set(CAPABILITIES);
  session = {
    orgId: "org-1",
    user: { sub: "auth0|boss", email: "boss@example.com", name: "Bossy Boots" },
  };
});

describe("createInvite — who may invite, and at what role", () => {
  it("refuses a staff member with no `invites` capability", async () => {
    role = "staff";
    caps = new Set(["toolbox"] as Capability[]);
    const res = await createInvite({ email: "new@heytiff.co", role: "staff" });
    expect(res.ok).toBe(false);
    expect(writes("insert")).toHaveLength(0);
  });

  it("lets an `invites` holder create a staff invite", async () => {
    role = "admin";
    caps = new Set(["invites"] as Capability[]);
    expect((await createInvite({ email: "new@heytiff.co", role: "staff" })).ok).toBe(true);
    expect(payloadOf(writes("insert")[0])).toMatchObject({ role: "staff", org_id: "org-1" });
  });

  it("refuses an `invites` holder asking for admin — that's a role assignment", async () => {
    role = "admin";
    caps = new Set(["invites"] as Capability[]);
    const res = await createInvite({ email: "new@heytiff.co", role: "admin" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/role/i);
    expect(writes("insert")).toHaveLength(0);
  });

  it("lets the owner create an admin invite", async () => {
    expect((await createInvite({ email: "boss2@heytiff.co", role: "admin" })).ok).toBe(true);
    expect(payloadOf(writes("insert")[0])).toMatchObject({ role: "admin" });
  });

  it("refuses owner as a role — the DB check says admin|staff", async () => {
    const res = await createInvite({ email: "new@heytiff.co", role: "owner" });
    expect(res.ok).toBe(false);
    expect(writes("insert")).toHaveLength(0);
  });

  it("validates the email and normalises it", async () => {
    expect((await createInvite({ email: "not-an-email", role: "staff" })).ok).toBe(false);
    expect(writes("insert")).toHaveLength(0);

    expect((await createInvite({ email: "  New@Heytiff.co ", role: "staff" })).ok).toBe(true);
    expect(payloadOf(writes("insert")[0])).toMatchObject({ email: "new@heytiff.co" });
  });

  it("refuses a second open invite for the same address", async () => {
    openInvites = [{ id: "inv-existing" }];
    const res = await createInvite({ email: "New@Heytiff.co", role: "staff" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/pending invite/i);
    expect(writes("insert")).toHaveLength(0);
  });

  it("scopes the duplicate check to the org and the normalised address", async () => {
    // lowercased on the read as well as the write, or Re-inviting `New@…`
    // would sail straight past the open invite for `new@…`
    await createInvite({ email: "  New@Heytiff.co ", role: "staff" });
    const check = calls.find((c) => c.table === "invitations" && c.op === "select");
    expect(check?.filters).toMatchObject({
      org_id: "org-1",
      email: "new@heytiff.co",
      accepted_at: null,
    });
    expect(writes("insert")).toHaveLength(1);
  });

  it("stamps the org, the inviter and a window of its own", async () => {
    await createInvite({ email: "new@heytiff.co", role: "staff" });
    const payload = payloadOf(writes("insert")[0]);
    expect(payload.org_id).toBe("org-1");
    expect(payload.invited_by).toBe("auth0|boss");
    const ahead = new Date(payload.expires_at).getTime() - Date.now();
    expect(ahead).toBeGreaterThan((INVITE_WINDOW_DAYS - 0.1) * DAY);
    expect(ahead).toBeLessThanOrEqual(INVITE_WINDOW_DAYS * DAY);
  });

  it("refuses when there's no session at all", async () => {
    session = null;
    expect((await createInvite({ email: "new@heytiff.co", role: "staff" })).ok).toBe(false);
    expect(writes("insert")).toHaveLength(0);
  });
});

/* Card-claiming invites — the bridge from an imported/pre-seeded card to a
   real login. The card must be this org's and still unclaimed, and a card can
   hold at most one open invite, mirroring the per-address rule. */
describe("createInvite — claiming a staff card", () => {
  it("stamps the card on the invite row", async () => {
    staffCardRow = { id: "card-1", user_id: null };
    const res = await createInvite({
      email: "new@heytiff.co",
      role: "staff",
      staffProfileId: "card-1",
    });
    expect(res.ok).toBe(true);
    expect(payloadOf(writes("insert")[0]).staff_profile_id).toBe("card-1");
  });

  it("a plain invite's payload carries no card key at all", async () => {
    await createInvite({ email: "new@heytiff.co", role: "staff" });
    expect("staff_profile_id" in payloadOf(writes("insert")[0])).toBe(false);
  });

  it("refuses a card that is gone — or another org's, which reads the same", async () => {
    staffCardRow = null;
    const res = await createInvite({
      email: "new@heytiff.co",
      role: "staff",
      staffProfileId: "card-elsewhere",
    });
    expect(res.ok).toBe(false);
    expect(writes("insert")).toHaveLength(0);
  });

  it("refuses a claimed card — they already have an account", async () => {
    staffCardRow = { id: "card-1", user_id: "auth0|already-here" };
    const res = await createInvite({
      email: "new@heytiff.co",
      role: "staff",
      staffProfileId: "card-1",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/already have an account/i);
    expect(writes("insert")).toHaveLength(0);
  });

  it("refuses a second open invite for the same card", async () => {
    staffCardRow = { id: "card-1", user_id: null };
    cardOpenInvites = [{ id: "inv-9" }];
    const res = await createInvite({
      email: "another.address@heytiff.co",
      role: "staff",
      staffProfileId: "card-1",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/pending invite/i);
    expect(writes("insert")).toHaveLength(0);
  });
});

describe("revokeInvite", () => {
  it("refuses someone without the capability", async () => {
    role = "staff";
    caps = new Set(["toolbox"] as Capability[]);
    expect((await revokeInvite("inv-1")).ok).toBe(false);
    expect(writes("delete")).toHaveLength(0);
  });

  it("refuses an invitation that has already been accepted", async () => {
    inviteRow = { id: "inv-1", accepted_at: "2026-07-01T00:00:00Z" };
    const res = await revokeInvite("inv-1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/accepted/i);
    expect(writes("delete")).toHaveLength(0);
  });

  it("refuses an id that isn't this org's", async () => {
    inviteRow = null; // the org-scoped read finds nothing
    expect((await revokeInvite("someone-elses")).ok).toBe(false);
    expect(writes("delete")).toHaveLength(0);
  });

  it("deletes the row, scoped to the org and still unaccepted", async () => {
    expect((await revokeInvite("inv-1")).ok).toBe(true);
    const del = writes("delete")[0];
    expect(del.table).toBe("invitations");
    expect(del.filters).toMatchObject({ org_id: "org-1", id: "inv-1", accepted_at: null });
  });
});

describe("renewInvite", () => {
  it("refuses someone without the capability", async () => {
    role = "staff";
    caps = new Set(["toolbox"] as Capability[]);
    expect((await renewInvite("inv-1")).ok).toBe(false);
    expect(writes("update")).toHaveLength(0);
  });

  it("refuses an accepted invitation", async () => {
    inviteRow = { id: "inv-1", accepted_at: "2026-07-01T00:00:00Z" };
    expect((await renewInvite("inv-1")).ok).toBe(false);
    expect(writes("update")).toHaveLength(0);
  });

  it("pushes expiry out by the same window a new invite gets, org-scoped", async () => {
    expect((await renewInvite("inv-1")).ok).toBe(true);
    const up = writes("update")[0];
    expect(up.filters).toMatchObject({ org_id: "org-1", id: "inv-1", accepted_at: null });
    const ahead = new Date(payloadOf(up).expires_at).getTime() - Date.now();
    expect(ahead).toBeGreaterThan((INVITE_WINDOW_DAYS - 0.1) * DAY);
    expect(ahead).toBeLessThanOrEqual(INVITE_WINDOW_DAYS * DAY);
  });
});

/* THE LETTER. It replaced a link the inviter had to copy and paste somewhere
   themselves, so what matters is that it carries the exact token the write
   minted, points at the right deployment, and reports honestly when it does
   not go — the row is the invitation, the post is only its delivery. */
describe("the invitation is posted", () => {
  it("sends to the invited address, with the token in an absolute accept link", async () => {
    const res = await createInvite({ email: "New@Hire.com", role: "staff" });

    expect(res).toEqual({ ok: true, delivery: { sent: true, to: "new@hire.com" } });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("new@hire.com");
    expect(sent[0].html).toContain("https://go.hey-tiff.com/invite/accept?token=tok-abc");
  });

  /* A no-reply address with no human behind it is indistinguishable from a
     phish, which is the whole reason the inviter is carried through. */
  it("names the company and the inviter, and replies to the inviter", async () => {
    await createInvite({ email: "new@hire.com", role: "staff" });

    /* The STAFF CARD is the name, not the session claim — the org's own answer
       to who this person is beats anything the identity provider relayed. */
    expect(sent[0].subject).toBe("Isaac Smith invited you to Diamond Air on HeyTiff");
    expect(sent[0].html).toContain("Isaac Smith");
    expect(sent[0].html).toContain("Diamond Air");
    expect(sent[0].replyTo).toBe("boss@example.com");
  });

  /* The address the invite is bound to is a RULE the recipient cannot see:
     the accept route refuses any other signed-in identity, and someone
     hitting that has no way to tell a rule from a broken link. */
  it("tells the recipient which address it works for", async () => {
    await createInvite({ email: "new@hire.com", role: "staff" });

    expect(sent[0].html).toContain("new@hire.com");
    expect(sent[0].html).toContain("sign in with that address");
  });

  /* The body is HTML and the subject is not, and a trade name with an
     ampersand in it is the common case, not the edge. */
  it("escapes the company in the body and leaves the subject alone", async () => {
    orgRow = { trading_name: "Smith & <b>Sons</b>", legal_name: null, name: null };

    await createInvite({ email: "new@hire.com", role: "staff" });

    expect(sent[0].subject).toContain("Smith & <b>Sons</b>");
    expect(sent[0].html).toContain("Smith &amp; &lt;b&gt;Sons&lt;/b&gt;");
    expect(sent[0].html).not.toContain("<b>Sons</b>");
  });

  it("posts nothing when the invite was never written", async () => {
    insertFails = true;

    expect((await createInvite({ email: "new@hire.com", role: "staff" })).ok).toBe(false);
    expect(sent).toHaveLength(0);
  });

  /* Local checkouts, previews and CI have no key. The invite still exists and
     the Pending tab's link still works, so this is a fact to report, not a
     failure to raise. */
  it("still creates the invite when the mailer is unconfigured, and says so", async () => {
    sendResult = { ok: false, reason: "unconfigured" };

    const res = await createInvite({ email: "new@hire.com", role: "staff" });

    expect(res).toEqual({
      ok: true,
      delivery: { sent: false, to: "new@hire.com", reason: "unconfigured" },
    });
    expect(writes("insert")).toHaveLength(1);
  });

  it("reports a provider refusal without leaking its words to the screen", async () => {
    const quiet = jest.spyOn(console, "error").mockImplementation(() => {});
    sendResult = { ok: false, reason: "failed", detail: "422 address suppressed" };

    const res = await createInvite({ email: "new@hire.com", role: "staff" });

    expect(res).toEqual({
      ok: true,
      delivery: { sent: false, to: "new@hire.com", reason: "failed" },
    });
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });

  /* Renewing without resending leaves a live invitation nobody has been told
     about — the two were only separable while there was no mailer. */
  it("renew posts the letter again, on the unchanged token", async () => {
    expect((await renewInvite("inv-1")).ok).toBe(true);

    expect(sent).toHaveLength(1);
    expect(sent[0].html).toContain("token=tok-abc");
  });

  it("renew posts nothing when the invite was accepted between check and write", async () => {
    renewedRow = null;

    const res = await renewInvite("inv-1");

    expect(res).toEqual({ ok: false, error: "That invite has already been accepted." });
    expect(sent).toHaveLength(0);
  });

  it("revoking posts nothing", async () => {
    expect((await revokeInvite("inv-1")).ok).toBe(true);
    expect(sent).toHaveLength(0);
  });
});

/* WHAT THE TYPED ADDRESS ALREADY MEANS HERE.

   The modal used to say nothing until the action refused, and an unclaimed
   card holding the address was invisible from that screen — so attaching to it
   meant knowing to start from the directory row instead. Two doors, and the
   difference between them was a duplicate person. */
describe("lookupInvitee", () => {
  const card = (over: Record<string, unknown> = {}) => ({
    id: "card-1",
    user_id: null,
    contact_email: "dan@reilly.com",
    full_name: "Dan Reilly",
    ...over,
  });

  it("says nothing useful to someone who may not invite", async () => {
    role = "staff";
    caps = new Set(["toolbox"] as Capability[]);
    staffRows = [card()];

    expect(await lookupInvitee("dan@reilly.com")).toEqual({ kind: "new" });
  });

  it("finds the unclaimed card holding that address, and where it came from", async () => {
    staffRows = [card()];
    linkRows = [{ provider: "servicem8" }];

    expect(await lookupInvitee("dan@reilly.com")).toEqual({
      kind: "card",
      staffProfileId: "card-1",
      name: "Dan Reilly",
      importedFrom: "ServiceM8",
    });
  });

  /* No `ilike` anywhere near this: `_` is a wildcard there and common in real
     addresses, so it can invent a match. Both sides go through normEmail —
     the same comparison the accept route makes, because the two have to agree
     on what "this person's card" means. */
  it("matches on the normalised address, whatever case was typed", async () => {
    staffRows = [card({ contact_email: "Dan@Reilly.com  " })];

    expect((await lookupInvitee("  DAN@reilly.COM ")).kind).toBe("card");
  });

  it("does not match a neighbouring address that differs by an underscore", async () => {
    staffRows = [card({ contact_email: "dan_reilly@example.com" })];

    expect(await lookupInvitee("danxreilly@example.com")).toEqual({ kind: "new" });
  });

  it("reports a claimed card as somebody who is already here", async () => {
    staffRows = [card({ user_id: "auth0|dan" })];

    expect(await lookupInvitee("dan@reilly.com")).toEqual({
      kind: "member",
      name: "Dan Reilly",
    });
  });

  /* Two cards holding one address is an admin mess this cannot resolve, and
     the accept route already refuses to pick between them. Saying so is the
     value; guessing would be the bug. */
  it("refuses to guess between two unclaimed cards", async () => {
    staffRows = [card(), card({ id: "card-2" })];

    expect(await lookupInvitee("dan@reilly.com")).toEqual({ kind: "ambiguous", count: 2 });
  });

  it("reports an invitation that is already open, before anything is pressed", async () => {
    openInvites = [{ id: "inv-1" }];
    staffRows = [card()];

    expect(await lookupInvitee("dan@reilly.com")).toEqual({ kind: "pending" });
  });

  /* The name is the one thing here that createInvite's own refusals do not
     already give the same caller, so it rides on `team` — the capability that
     governs reading other people's cards. The resolution still arrives. */
  it("withholds the name from an inviter who may not read cards", async () => {
    canTeam = false;
    staffRows = [card()];

    expect(await lookupInvitee("dan@reilly.com")).toEqual({
      kind: "card",
      staffProfileId: "card-1",
      name: null,
      importedFrom: null,
    });
  });

  it("says nothing about an address that is not one", async () => {
    staffRows = [card()];

    expect(await lookupInvitee("   ")).toEqual({ kind: "new" });
  });
});

/* WHO THE LETTER SAYS INVITED YOU.

   The first invitation ever sent from production went out reading
   "isaacsmithnz1@gmail.com has invited you to join Diamond Air Solutions",
   twice, auto-linked by the mail client — while its reply-to carried
   isaac@diamondairsolutions.com, a DIFFERENT address. Two addresses, neither
   labelled, one of them not even the account's.

   The cause was reaching for Auth0's `name` claim, which for an identity that
   never set one IS the sign-in address — and `profiles.name`, written from
   that claim on every login, holds the same address. The staff card said
   "Isaac Smith" the whole time. */
describe("the letter names a person, not an address", () => {
  it("prefers the staff card — the org's own answer to who someone is", async () => {
    inviterCard = { full_name: "Isaac Smith" };
    inviterProfile = { name: "isaacsmithnz1@gmail.com" };

    await createInvite({ email: "new@hire.com", role: "staff" });

    expect(sent[0].subject).toBe("Isaac Smith invited you to Diamond Air on HeyTiff");
    expect(sent[0].html).toContain("Isaac Smith has invited you");
  });

  it("falls back to first + last when the card has no full name", async () => {
    inviterCard = { full_name: null, first_name: "Isaac", last_name: "Smith" };

    await createInvite({ email: "new@hire.com", role: "staff" });

    expect(sent[0].html).toContain("Isaac Smith has invited you");
  });

  /* THE GUARD IS ON THE VALUE, NOT THE SOURCE. Any column can hold an address;
     none of them may print one where a person belongs. */
  it.each([
    ["a card whose name is an address", { full_name: "isaacsmithnz1@gmail.com" }],
    ["a card with nothing on it", { full_name: null, first_name: null, last_name: null }],
  ])("names the company instead, given %s", async (_label, card) => {
    inviterCard = card;
    inviterProfile = { name: "isaacsmithnz1@gmail.com" };
    /* The whole chain has to be addresses for the fallback to be reached, and
       in production it WAS: Auth0's `name` claim is the sign-in address for an
       identity that never set one, and profiles.name is written from it. */
    session = {
      orgId: "org-1",
      user: {
        sub: "auth0|boss",
        email: "isaac@diamondairsolutions.com",
        name: "isaacsmithnz1@gmail.com",
      },
    };

    await createInvite({ email: "new@hire.com", role: "staff" });

    expect(sent[0].html).not.toContain("isaacsmithnz1@gmail.com");
    expect(sent[0].subject).not.toContain("@");
    expect(sent[0].subject).toBe("You've been invited to Diamond Air on HeyTiff");
    expect(sent[0].html).toContain("You've been invited to join Diamond Air");
    // and the renew footnote cannot say "ask <nobody>"
    expect(sent[0].html).toContain("ask the person who invited you to renew it");
  });

  /* The human is still reachable with no name printed — that is what makes
     the company framing honest rather than evasive. */
  it("still replies to the real person when it cannot name them", async () => {
    inviterCard = { full_name: "isaacsmithnz1@gmail.com" };
    inviterProfile = { name: "isaacsmithnz1@gmail.com" };
    session = {
      orgId: "org-1",
      user: {
        sub: "auth0|boss",
        email: "isaac@diamondairsolutions.com",
        name: "isaacsmithnz1@gmail.com",
      },
    };

    await createInvite({ email: "new@hire.com", role: "staff" });

    expect(sent[0].html).not.toContain("isaacsmithnz1@gmail.com");
    expect(sent[0].replyTo).toBe("isaac@diamondairsolutions.com");
  });

  it("takes the profile name when the card has none and it is a real name", async () => {
    inviterCard = null;
    inviterProfile = { name: "Isaac Smith" };

    await createInvite({ email: "new@hire.com", role: "staff" });

    expect(sent[0].html).toContain("Isaac Smith has invited you");
  });
});
