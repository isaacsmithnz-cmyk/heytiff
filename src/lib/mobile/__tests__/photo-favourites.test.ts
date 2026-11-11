/**
 * @jest-environment node
 */

/* The phone's stars are the web's: ServiceM8's photo by its own id, one
   taken with the phone by the copy it was sent as, and never one that
   hasn't reached ServiceM8. */

const writes = [{ subject: "document:doc-1", remote_uuid: "att-1", status: "sent", kind: "attachment" }];
jest.mock("server-only", () => ({}));
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => {
      const f: Record<string, unknown> = {};
      const rows = () => writes.filter((w) => (!f.subject || w.subject === f.subject) && (!f.in || (f.in as string[]).includes(w.remote_uuid)));
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => ((f[c] = v), q),
        not: () => q,
        order: () => q,
        limit: () => q,
        in: (_c: string, v: unknown) => ((f.in = v), q),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (res: (v: unknown) => unknown) => res({ data: rows(), error: null }),
      };
      return q;
    },
  },
}));
jest.mock("@/lib/workboard/all-jobs-query", () => ({ resolveJobCard: async (_o: string, id: string) => ({ parentRemoteId: `parent-${id}` }) }));
jest.mock("@/lib/mobile/auth", () => ({ actAsPhoneUser: (_ctx: unknown, fn: () => unknown) => fn() }));
const set: string[] = [];
jest.mock("@/app/actions/job-photo-favourites", () => ({
  listJobPhotoFavourites: async () => [{ remoteId: "att-1", addedAt: "" }, { remoteId: "att-9", addedAt: "" }],
  setJobPhotoFavourite: async (job: string, uuid: string, starred: boolean) => (set.push(`${job} ${uuid} ${starred}`), { ok: true, starred, note: null }),
}));

import { readPhoneFavourites, setPhoneFavourite } from "../photo-favourites";

const ctx = { orgId: "org-1", userId: "u-1" } as never;

beforeEach(() => (set.length = 0));

it("stars ServiceM8's photo by its own id, on the job the card is", async () => {
  expect(await setPhoneFavourite(ctx, "job-1", "att-9", true)).toEqual({ ok: true, starred: true, error: null });
  expect(set).toEqual(["parent-job-1 att-9 true"]);
});

it("stars one taken with the phone by the copy it was sent as", async () => {
  await setPhoneFavourite(ctx, "job-1", "doc:doc-1", true);
  expect(set).toEqual(["parent-job-1 att-1 true"]);
});

it("can't star one that hasn't reached ServiceM8", async () => {
  expect(await setPhoneFavourite(ctx, "job-1", "doc:doc-2", true)).toEqual({ ok: false, starred: false, error: "That photo can be a favourite once it's in ServiceM8." });
  expect(set).toEqual([]);
});

it("reads the stars in the phone's ids, ours by ours", async () => {
  expect(await readPhoneFavourites(ctx, "job-1")).toEqual(["att-1", "doc:doc-1", "att-9"]);
});
