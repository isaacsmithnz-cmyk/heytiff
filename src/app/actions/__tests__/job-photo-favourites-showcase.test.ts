/**
 * @jest-environment node
 *
 * The showcase marks the copies it draws as shown (the 30-day cap,
 * lib/integrations/sm8-file-cache). A starred copy is never evicted anyway,
 * so the stamp is the record, not the keeper: it must name exactly the
 * copies the showcase signed, in this workspace, and nothing when there
 * are none to sign.
 */

const touched: { org: string; refs: string[] }[] = [];
jest.mock("@/lib/integrations/sm8-file-cache", () => ({
  touchSm8Files: jest.fn(async (org: string, refs: string[]) => void touched.push({ org, refs: [...refs] })),
}));

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/permissions-server", () => ({
  requireOrg: async () => ({ orgId: "org-1", userId: "auth0|me" }),
}));
jest.mock("@/lib/documents/query", () => ({ DOCUMENTS_BUCKET: "documents", SIGNED_URL_SECONDS: 60 }));
jest.mock("../workboard-media", () => ({ cacheJobFiles: jest.fn() }));
jest.mock("../photo-readings", () => ({ readJobPhotos: jest.fn() }));

/* The stars; the cached copies (documents); what the bucket signs. */
let stars: Record<string, unknown>[] = [];
let docs: Record<string, unknown>[] = [];
const signedPaths: string[][] = [];
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "not", "order"]) q[m] = () => q;
      q.then = (res: (v: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve({
          data: table === "job_photo_favourites" ? stars : table === "documents" ? docs : [],
          error: null,
        }).then(res);
      return q;
    },
    storage: {
      from: () => ({
        createSignedUrls: async (paths: string[]) => {
          signedPaths.push([...paths]);
          return { data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}` })) };
        },
      }),
    },
  },
}));

import { listShowcase } from "../job-photo-favourites";

const starOf = (uuid: string) => ({
  sm8_attachment_uuid: uuid,
  sm8_job_uuid: "j-1",
  job_number: "2380",
  client_name: null,
  photo_name: "Photo",
  photo_taken_at: null,
  document_id: null,
  added_at: "2026-09-01T00:00:00Z",
});

beforeEach(() => {
  stars = [];
  docs = [];
  touched.length = 0;
  signedPaths.length = 0;
});

describe("the showcase's stamp", () => {
  it("marks shown exactly the cached copies it signed, in its own workspace", async () => {
    stars = [starOf("ph-1"), starOf("ph-2"), starOf("ph-3")];
    /* ph-2 has no cached copy: a plate, nothing to stamp */
    docs = [
      { remote_ref: "ph-1", storage_ref: "org/org-1/job_file/ph-1.jpg" },
      { remote_ref: "ph-3", storage_ref: "org/org-1/job_file/ph-3.jpg" },
    ];
    const shown = await listShowcase();
    expect(touched).toEqual([{ org: "org-1", refs: ["ph-1", "ph-3"] }]);
    expect(signedPaths).toEqual([["org/org-1/job_file/ph-1.jpg", "org/org-1/job_file/ph-3.jpg"]]);
    expect(shown.map((p) => p.url)).toEqual([
      "https://signed/org/org-1/job_file/ph-1.jpg",
      null,
      "https://signed/org/org-1/job_file/ph-3.jpg",
    ]);
  });

  it("stamps nothing when no star has a cached copy", async () => {
    stars = [starOf("ph-1")];
    const shown = await listShowcase();
    expect(touched).toEqual([]);
    expect(shown[0].url).toBeNull();
  });
});
