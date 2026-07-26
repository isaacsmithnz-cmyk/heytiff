/* WHO MAY UPLOAD WHAT, decided on the server, per kind.

   Three tiers, and this file pins all three:

     intrinsic     a licence scan, work-rights evidence, your own photo — and
                   your own RECEIPT. They are about YOU, so anybody signed in
                   may upload them.
     management    everything else, `team` — a notice attachment
     owner-only    org_logo, and only org_logo: it is the company's face, on the
                   sidebar of everyone who signs in, and a delegated admin
                   manages people rather than the company's identity

   The gate runs before a slot is handed out, so a refused kind never reaches
   storage at all. */

let capTeam = true;
let dbRole: string | null = "owner";

const insert = jest.fn();

const from = jest.fn(() => ({
  insert: (row: Record<string, unknown>) => {
    insert(row);
    return {
      select: () => ({ maybeSingle: async () => ({ data: { id: "doc-1" }, error: null }) }),
    };
  },
  update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
  delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
}));

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (...a: unknown[]) => from(...(a as [])),
    storage: {
      from: () => ({
        createSignedUploadUrl: async () => ({ data: { token: "tok" }, error: null }),
      }),
    },
  },
}));
jest.mock("@/lib/auth0", () => ({
  auth0: {
    getSession: jest.fn().mockResolvedValue({ user: { sub: "auth0|u" }, orgId: "org-1" }),
  },
}));
jest.mock("@/lib/permissions-server", () => ({
  can: jest.fn(async () => capTeam),
  getDbRole: jest.fn(async () => dbRole),
}));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: jest.fn(async () => "staff-1") }));

import { beginUpload } from "../documents";

const png = { fileName: "logo.png", mimeType: "image/png", sizeBytes: 2048 };

beforeEach(() => {
  insert.mockClear();
  from.mockClear();
  capTeam = true;
  dbRole = "owner";
});

describe("org_logo is owner-only", () => {
  it("hands an owner a slot", async () => {
    const slot = await beginUpload({ kind: "org_logo", ...png });
    expect(slot.ok).toBe(true);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "org_logo" }));
  });

  /* An admin holds `team` — which is exactly why this needed its own branch.
     Under the old default they could have swapped the company logo. */
  it("refuses an admin who holds team, before any row is created", async () => {
    dbRole = "admin";
    expect(await beginUpload({ kind: "org_logo", ...png })).toEqual({
      ok: false,
      error: "You can't upload that.",
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("refuses a staff member", async () => {
    dbRole = "staff";
    capTeam = false;
    expect(await beginUpload({ kind: "org_logo", ...png })).toMatchObject({ ok: false });
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("every other kind is unchanged", () => {
  it("keeps the intrinsic kinds intrinsic — no role, no capability", async () => {
    dbRole = "staff";
    capTeam = false;
    for (const kind of ["licence", "work_rights", "staff_photo"]) {
      insert.mockClear();
      expect((await beginUpload({ kind, ...png })).ok).toBe(true);
    }
  });

  /* A receipt used to fall through to `team`, which would have locked every
     staff member out of the expense claim they are the entire point of.
     Spending your own money on the job and wanting it back is not a
     privilege. */
  it("lets any signed-in member upload their own receipt", async () => {
    dbRole = "staff";
    capTeam = false;
    expect((await beginUpload({ kind: "receipt", ...png })).ok).toBe(true);
  });

  it("keeps everything else on `team`", async () => {
    dbRole = "admin";
    capTeam = true;
    expect((await beginUpload({ kind: "notice_attachment", ...png })).ok).toBe(true);

    capTeam = false;
    dbRole = "staff";
    expect(await beginUpload({ kind: "notice_attachment", ...png })).toMatchObject({ ok: false });
  });

  it("still refuses a kind nothing stores", async () => {
    expect(await beginUpload({ kind: "passport_scan", ...png })).toEqual({
      ok: false,
      error: "That isn't something we store.",
    });
  });
});
