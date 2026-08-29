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
      sub.in = (col: string, val: unknown) => {
        filtersBy[table].push({ col: `in:${col}`, val });
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
  related_object_uuid: "job-1",
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
        { col: "in:related_object_uuid", val: ["job-1"] },
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
        { col: "in:sm8_job_uuid", val: ["job-1"] },
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
    /* what was SHOT ON SITE goes to one lens — video included, because a
       walkthrough clip is footage from the visit, not paperwork */
    expect(groups.photos.map((i) => i.remoteId)).toEqual(["p-1", "v-1"]);
    expect(groups.documents[0]).toMatchObject({ remoteId: "d-1", origin: "Invoice" });
    expect(groups.elsewhere).toHaveLength(0);
    expect(groups.truncated).toBe(false);
  });
});

/* ── files that arrived on a progress claim ──────────────────────────────
   ServiceM8 bills a staged job by cloning it, and a photo taken on site
   lands on whichever clone was open: 1,432 files sit on clones live, 622 of
   them photos. They are about the WORK, so the job's gallery takes them. */

describe("a job billed in stages gathers its claims' files", () => {
  const CLAIMS = [
    { remoteId: "job-1a", claimNumber: "2380A" },
    { remoteId: "job-1b", claimNumber: "2380B" },
  ];

  it("asks for the job and every claim in one read", async () => {
    attachmentRows = [attachment({ uuid: "a-1" })];
    await readJobMedia("org-1", "job-1", CLAIMS);

    expect(filtersBy["sm8_attachments"]).toEqual(
      expect.arrayContaining([
        { col: "in:related_object_uuid", val: ["job-1", "job-1a", "job-1b"] },
        { col: "active", val: 1 },
      ])
    );
    // the cached bytes have to follow the same set or a lifted photo has no URL
    expect(filtersBy["documents"]).toEqual(
      expect.arrayContaining([{ col: "in:sm8_job_uuid", val: ["job-1", "job-1a", "job-1b"] }])
    );
  });

  it("badges a lifted photo with the claim it came from", async () => {
    attachmentRows = [
      attachment({ uuid: "a-1", attachment_name: "IMG_1.jpg" }),
      attachment({ uuid: "a-2", attachment_name: "IMG_2.jpg", related_object_uuid: "job-1a" }),
    ];
    const read = await readJobMedia("org-1", "job-1", CLAIMS);

    expect(read.items.map((i) => [i.name, i.fromClaim])).toEqual([
      ["IMG_1.jpg", null],
      ["IMG_2.jpg", "2380A"],
    ]);
  });

  /* 470 of the 758 liftable files are copies ServiceM8 made when it cloned.
     Merge them naively and half the gallery appears twice. */
  it("shows a file copied onto a claim once, keeping the job's own copy", async () => {
    attachmentRows = [
      attachment({ uuid: "a-1", attachment_name: "IMG_4021.jpg" }),
      attachment({ uuid: "a-2", attachment_name: "IMG_4021.jpg", related_object_uuid: "job-1a" }),
    ];
    const read = await readJobMedia("org-1", "job-1", CLAIMS);

    expect(read.items).toHaveLength(1);
    expect(read.items[0].remoteId).toBe("a-1");
    expect(read.items[0].fromClaim).toBeNull();
  });

  /* THE BUG THAT HID 72% OF THE ACCOUNT. ServiceM8's own app names every
     phone upload literally `Photo`, so a flat name dedupe over the job's OWN
     files collapses a whole day's work into one tile. Job #907 holds 91 live
     attachments — 75 .jpg and 9 .avif all called `Photo` — and offered two.
     Account-wide: 28,828 of 39,952 dropped across 1,815 jobs. */
  it("keeps every one of a job's own files that ServiceM8 called `Photo`", async () => {
    attachmentRows = [
      attachment({ uuid: "a-1", attachment_name: "Photo" }),
      attachment({ uuid: "a-2", attachment_name: "Photo" }),
      attachment({ uuid: "a-3", attachment_name: "Photo" }),
    ];
    const read = await readJobMedia("org-1", "job-1", CLAIMS);
    expect(read.items.map((i) => i.remoteId)).toEqual(["a-1", "a-2", "a-3"]);
  });

  /* And a claim's own originals are not collapsed against each other either —
     a photo taken while one clone was open and a photo taken while another
     was open are two photographs, both called `Photo`. Only a copy of
     something the PARENT already holds is dropped. */
  it("keeps same-named originals that live on different claims", async () => {
    attachmentRows = [
      attachment({ uuid: "a-1", attachment_name: "Photo", related_object_uuid: "job-1a" }),
      attachment({ uuid: "a-2", attachment_name: "Photo", related_object_uuid: "job-1b" }),
    ];
    const read = await readJobMedia("org-1", "job-1", [
      { remoteId: "job-1a", claimNumber: "2380A" },
      { remoteId: "job-1b", claimNumber: "2380B" },
    ]);
    expect(read.items).toHaveLength(2);
  });

  /* A PDF sharing a photo's name is not the same file. */
  it("does not collapse two different files that share a name", async () => {
    attachmentRows = [
      attachment({ uuid: "a-1", attachment_name: "Report", file_type: ".pdf" }),
      attachment({ uuid: "a-2", attachment_name: "Report", file_type: ".jpg", related_object_uuid: "job-1a" }),
    ];
    const read = await readJobMedia("org-1", "job-1", CLAIMS);
    expect(read.items).toHaveLength(2);
  });

  /* The claim's own paperwork is about the billing, not the work — 426 live. */
  it("leaves the claim's own partial-invoice PDF with the claim", async () => {
    attachmentRows = [
      attachment({ uuid: "a-1", attachment_name: "IMG_4021.jpg" }),
      attachment({
        uuid: "a-2",
        attachment_name: "Partial Invoice #2380A",
        file_type: ".pdf",
        related_object_uuid: "job-1a",
      }),
    ];
    const read = await readJobMedia("org-1", "job-1", CLAIMS);

    expect(read.items.map((i) => i.name)).toEqual(["IMG_4021.jpg"]);
  });

  /* The JOB's own partial-invoice paper is a different thing — the parent is
     a claim too, and its paper is the one the job itself raised. */
  it("keeps a partial-invoice PDF that belongs to the job itself", async () => {
    attachmentRows = [
      attachment({ uuid: "a-1", attachment_name: "Partial Invoice #2380", file_type: ".pdf" }),
    ];
    const read = await readJobMedia("org-1", "job-1", CLAIMS);
    expect(read.items).toHaveLength(1);
  });
});

describe("the cap is per lens, after the split", () => {
  /* THE DEFECT THIS PINS: capping the flat list first made the photo/
     document split a split of the newest 120 FILES, so a paper-heavy job
     crowded its own photos out of the photo lens. */
  it("a wall of paperwork cannot crowd photos out of the photo lens", async () => {
    attachmentRows = [
      ...Array.from({ length: 125 }, (_, i) =>
        attachment({ uuid: `d-${i}`, attachment_name: `Invoice ${i}.pdf`, file_type: ".pdf" })
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        attachment({ uuid: `p-${i}`, attachment_name: `IMG_${i}.jpg` })
      ),
    ];
    const groups = await readJobMediaGroups("org-1", "job-1");
    expect(groups.photos).toHaveLength(10);
    expect(groups.documents).toHaveLength(120);
    expect(groups.truncated).toBe(true);
  });

  it("says nothing was left off when nothing was", async () => {
    attachmentRows = [attachment({ uuid: "p-1" })];
    const groups = await readJobMediaGroups("org-1", "job-1");
    expect(groups.truncated).toBe(false);
  });
});

describe("dimensions ride the read", () => {
  it("passes real pixels through and turns the 0 sentinel into null", async () => {
    attachmentRows = [
      attachment({ uuid: "p-1", photo_width: 4032, photo_height: 3024 }),
      attachment({ uuid: "p-2", attachment_name: "IMG_2.jpg", photo_width: 0, photo_height: 0 }),
    ];
    const read = await readJobMedia("org-1", "job-1");
    expect(read.items[0]).toMatchObject({ width: 4032, height: 3024 });
    expect(read.items[1]).toMatchObject({ width: null, height: null });
  });
});
