/* How many hits a photo search asks for (2026-09-24). The Workboard's panel
   takes the whole cap; ⌘K takes a handful — and every hit costs a signed
   URL, so the number arriving from a client is clamped before it is used. */

const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
let rpcRows: Record<string, unknown>[] = [];
/* HeyTiff's own writes to ServiceM8, as the echo read finds them. */
let writeRows: Record<string, unknown>[] = [];

jest.mock("@/lib/permissions-server", () => ({
  requireOrg: async () => ({ orgId: "org-1", userId: "auth0|me" }),
}));
jest.mock("@/lib/documents/query", () => ({ DOCUMENTS_BUCKET: "documents", SIGNED_URL_SECONDS: 60 }));
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "not"]) q[m] = () => q;
      q.or = async () => ({ data: table === "sm8_writes" ? writeRows : [], error: null });
      q.then = (res: (v: { data: unknown[]; count: number }) => unknown) =>
        Promise.resolve({ data: [], count: 500 }).then(res);
      return q;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      // the database's LIMIT: rpcRows are every match, best first
      return { data: rpcRows.slice(0, Number(args.p_limit)), error: null };
    },
    storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }) }) },
  },
}));

import { searchPhotos } from "../photo-search";
import { PHOTO_SEARCH_LIMIT } from "@/lib/workboard/photo-search";

const row = (n: number) => ({
  sm8_attachment_uuid: `ph-${n}`,
  sm8_job_uuid: "j-1",
  job_number: "2380",
  client_name: null,
  photo_name: "Photo",
  photo_taken_at: null,
  subject: null,
  tags: [],
  caption: null,
  ocr_text: null,
  read_at: "2026-09-01T00:00:00",
  m_text: true,
  m_transcript: false,
  m_caption: false,
  m_tag: false,
});

beforeEach(() => {
  rpcCalls.length = 0;
  rpcRows = [];
  writeRows = [];
});

describe("searchPhotos' limit", () => {
  it("asks for more than it keeps — one to know whether the cap bound, and room for HeyTiff's own", async () => {
    rpcRows = Array.from({ length: 7 }, (_, n) => row(n));
    const found = await searchPhotos("plate", 6);
    expect(rpcCalls[0].args.p_limit).toBe(13);
    expect(found.hits).toHaveLength(6);
    expect(found.capped).toBe(true);
  });

  it("says the cap didn't bind when every match fits", async () => {
    rpcRows = Array.from({ length: 6 }, (_, n) => row(n));
    const found = await searchPhotos("plate", 6);
    expect(found.hits).toHaveLength(6);
    expect(found.capped).toBe(false);
  });

  it("takes the whole cap when none is named, and never more than it", async () => {
    await searchPhotos("plate");
    await searchPhotos("plate", 10_000);
    expect(rpcCalls.map((c) => c.args.p_limit)).toEqual([
      PHOTO_SEARCH_LIMIT * 2 + 1,
      PHOTO_SEARCH_LIMIT * 2 + 1,
    ]);
  });

  it("asks for at least one, whatever a client sends", async () => {
    await searchPhotos("plate", -4);
    await searchPhotos("plate", Number.NaN);
    expect(rpcCalls.map((c) => c.args.p_limit)).toEqual([3, PHOTO_SEARCH_LIMIT * 2 + 1]);
  });
});

/* A photo HeyTiff sent to ServiceM8 comes back in the mirror as one of
   ServiceM8's, and would be found twice — or found as a photo from site. */
describe("a photo HeyTiff sent", () => {
  const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const hit = (n: number) => ({ ...row(n), sm8_attachment_uuid: u(n) });

  it("is left out of the results", async () => {
    rpcRows = [hit(1), hit(2), hit(3)];
    writeRows = [{ remote_uuid: u(2), replaced_uuids: [] }];
    const found = await searchPhotos("plate", 6);
    expect(found.hits.map((h) => h.remoteId)).toEqual([u(1), u(3)]);
  });

  it("is left out before the cap is judged, so it can't push a real photo past it", async () => {
    // seven matches in all for a cap of six, one of them ours: six real photos, and the cap didn't bind
    rpcRows = Array.from({ length: 7 }, (_, n) => hit(n + 1));
    writeRows = [{ remote_uuid: u(4), replaced_uuids: [] }];
    const found = await searchPhotos("plate", 6);
    expect(found.hits).toHaveLength(6);
    expect(found.hits.map((h) => h.remoteId)).not.toContain(u(4));
    expect(found.capped).toBe(false);
  });

  it("still fills the cap, and says it bound, when more matches wait past one of ours", async () => {
    // twenty matches, one of ours among the first seven
    rpcRows = Array.from({ length: 20 }, (_, n) => hit(n + 1));
    writeRows = [{ remote_uuid: u(4), replaced_uuids: [] }];
    const found = await searchPhotos("plate", 6);
    expect(found.hits.map((h) => h.remoteId)).toEqual([u(1), u(2), u(3), u(5), u(6), u(7)]);
    expect(found.capped).toBe(true);
  });

  it("says the cap bound when a full answer was all ours, though nothing is left to show", async () => {
    // a cap of two asks for five; all five are ours, and three real ones wait past them
    rpcRows = Array.from({ length: 8 }, (_, n) => hit(n + 1));
    writeRows = [1, 2, 3, 4, 5].map((n) => ({ remote_uuid: u(n), replaced_uuids: [] }));
    const found = await searchPhotos("plate", 2);
    expect(found.hits).toHaveLength(0);
    expect(found.capped).toBe(true);
  });
});
