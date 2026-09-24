/* How many hits a photo search asks for (2026-09-24). The Workboard's panel
   takes the whole cap; ⌘K takes a handful — and every hit costs a signed
   URL, so the number arriving from a client is clamped before it is used. */

const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
let rpcRows: Record<string, unknown>[] = [];

jest.mock("@/lib/permissions-server", () => ({
  requireOrg: async () => ({ orgId: "org-1", userId: "auth0|me" }),
}));
jest.mock("@/lib/documents/query", () => ({ DOCUMENTS_BUCKET: "documents", SIGNED_URL_SECONDS: 60 }));
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "not"]) q[m] = () => q;
      q.then = (res: (v: { data: unknown[]; count: number }) => unknown) =>
        Promise.resolve({ data: [], count: 500 }).then(res);
      return q;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return { data: rpcRows, error: null };
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
});

describe("searchPhotos' limit", () => {
  it("asks for one more than it keeps, to know whether the cap bound", async () => {
    rpcRows = Array.from({ length: 7 }, (_, n) => row(n));
    const found = await searchPhotos("plate", 6);
    expect(rpcCalls[0].args.p_limit).toBe(7);
    expect(found.hits).toHaveLength(6);
    expect(found.capped).toBe(true);
  });

  it("takes the whole cap when none is named, and never more than it", async () => {
    await searchPhotos("plate");
    await searchPhotos("plate", 10_000);
    expect(rpcCalls.map((c) => c.args.p_limit)).toEqual([
      PHOTO_SEARCH_LIMIT + 1,
      PHOTO_SEARCH_LIMIT + 1,
    ]);
  });

  it("asks for at least one, whatever a client sends", async () => {
    await searchPhotos("plate", -4);
    await searchPhotos("plate", Number.NaN);
    expect(rpcCalls.map((c) => c.args.p_limit)).toEqual([2, PHOTO_SEARCH_LIMIT + 1]);
  });
});
