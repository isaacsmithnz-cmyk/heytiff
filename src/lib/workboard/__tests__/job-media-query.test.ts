/* The job-files read. The case that matters most here isn't a shape, it's a
   FILTER: ServiceM8 soft-deletes, those rows keep arriving, and 456 of them
   are sitting in the live mirror right now — 414 of those photos. Somebody
   removed each one on purpose. A read that forgets `active = 1` doesn't show
   a stale grid, it un-deletes them. */

type Filter = { col: string; val: unknown };

let attachmentRows: Record<string, unknown>[] = [];
let documentRows: Record<string, unknown>[] = [];
const filtersBy: Record<string, Filter[]> = {};
let signedFor: string[] = [];

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      filtersBy[table] = filtersBy[table] ?? [];
      const sub: Record<string, unknown> = {};
      sub.select = () => sub;
      sub.eq = (col: string, val: unknown) => {
        filtersBy[table].push({ col, val });
        return sub;
      };
      sub.not = (col: string, _op: string, val: unknown) => {
        filtersBy[table].push({ col: `not:${col}`, val });
        return sub;
      };
      sub.order = () => sub;
      sub.limit = () => Promise.resolve({ data: attachmentRows });
      sub.then = (res: (v: { data: unknown[] }) => unknown) =>
        Promise.resolve({ data: table === "documents" ? documentRows : attachmentRows }).then(res);
      return sub;
    },
    storage: {
      from: () => ({
        createSignedUrls: async (paths: string[]) => {
          signedFor = paths;
          return { data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}` })) };
        },
      }),
    },
  },
}));

import { readJobMedia, readJobMediaGroups } from "@/lib/workboard/job-media-query";

const attachment = (over: Record<string, unknown> & { uuid: string }) => ({
  attachment_name: "IMG_4021.jpg",
  file_type: ".jpg",
  attachment_source: "PHOTO",
  timestamp: "2026-08-01 10:00:00",
  ...over,
});

beforeEach(() => {
  attachmentRows = [];
  documentRows = [];
  signedFor = [];
  for (const k of Object.keys(filtersBy)) delete filtersBy[k];
});

describe("deleted files stay deleted", () => {
  it("asks ServiceM8's mirror only for live rows", async () => {
    attachmentRows = [attachment({ uuid: "a-1" })];
    await readJobMedia("org-1", "job-1");

    const applied = filtersBy["sm8_attachments"];
    expect(applied).toEqual(
      expect.arrayContaining([
        { col: "org_id", val: "org-1" },
        { col: "related_object_uuid", val: "job-1" },
        // The guard. 414 deleted photos in the live account depend on it.
        { col: "active", val: 1 },
      ])
    );
  });

  it("scopes the cached-copy read to this org and job, and to confirmed uploads", async () => {
    attachmentRows = [attachment({ uuid: "a-1" })];
    await readJobMedia("org-1", "job-1");

    const applied = filtersBy["documents"];
    expect(applied).toEqual(
      expect.arrayContaining([
        { col: "org_id", val: "org-1" },
        { col: "source", val: "servicem8" },
        { col: "sm8_job_uuid", val: "job-1" },
        // A slot handed out and never filled must not render as a broken tile.
        { col: "not:uploaded_at", val: null },
      ])
    );
  });
});

describe("what the sheet gets back", () => {
  it("hands a cached photo its signed URL and leaves an uncached one null", async () => {
    attachmentRows = [
      attachment({ uuid: "cached" }),
      attachment({ uuid: "not-yet", attachment_name: "IMG_4022.jpg" }),
    ];
    documentRows = [{ remote_ref: "cached", storage_ref: "org/org-1/sm8_media/cached.jpg" }];

    const { items } = await readJobMedia("org-1", "job-1");

    expect(items.find((i) => i.remoteId === "cached")!.url).toBe(
      "https://signed/org/org-1/sm8_media/cached.jpg"
    );
    expect(items.find((i) => i.remoteId === "not-yet")!.url).toBeNull();
  });

  it("signs a whole job in ONE call rather than one per photo", async () => {
    attachmentRows = Array.from({ length: 20 }, (_, i) => attachment({ uuid: `p-${i}` }));
    documentRows = attachmentRows.map((_, i) => ({
      remote_ref: `p-${i}`,
      storage_ref: `org/org-1/sm8_media/p-${i}.jpg`,
    }));

    await readJobMedia("org-1", "job-1");
    expect(signedFor).toHaveLength(20);
  });

  it("never asks storage to sign anything when nothing is cached", async () => {
    attachmentRows = [attachment({ uuid: "a-1" })];
    await readJobMedia("org-1", "job-1");
    expect(signedFor).toEqual([]);
  });

  it("names an untitled file rather than rendering a blank row", async () => {
    attachmentRows = [attachment({ uuid: "a-1", attachment_name: "   " })];
    const { items } = await readJobMedia("org-1", "job-1");
    expect(items[0].name).toBe("Untitled file");
  });

  it("groups a real job's mix the way the sheet renders it", async () => {
    attachmentRows = [
      attachment({ uuid: "p-1" }),
      attachment({
        uuid: "d-1",
        attachment_name: "Invoice #3137.pdf",
        file_type: ".pdf",
        attachment_source: "INVOICE",
      }),
      attachment({ uuid: "v-1", attachment_name: "walkthrough.mp4", file_type: ".mp4" }),
    ];

    const groups = await readJobMediaGroups("org-1", "job-1");
    expect(groups.photos.map((i) => i.remoteId)).toEqual(["p-1"]);
    expect(groups.documents[0]).toMatchObject({ remoteId: "d-1", paperwork: "Invoice" });
    expect(groups.elsewhere.map((i) => i.remoteId)).toEqual(["v-1"]);
    expect(groups.truncated).toBe(false);
  });
});
