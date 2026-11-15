/** @jest-environment node */
/* Link job moves a design's plans onto the job (plans-link-server.ts): the
   file onto the job's Documents, landed last; a plan in its Plans read as
   the design had it; nothing left behind when a step fails. The database
   and the storage are fakes; sharp draws the thumbnails for real. */

import sharp from "sharp";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const stored: Record<string, Record<string, Buffer>> = { "studio-plans": {}, documents: {} };
let failPlanInsert = false;

jest.mock("@/lib/workboard/job-notes-query", () => ({ staffDisplayNames: async () => new Map([["stf_1", "Isaac Smith"]]) }));
jest.mock("@/lib/supabase-server", () => {
  const query = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let insert: Row | null = null;
    let update: Row | null = null;
    let del = false;
    let id = 0;
    const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), q),
      insert: (r: Row) => ((insert = { ...r, id: r.id ?? `doc_${(id = (tables[table]?.length ?? 0) + 1)}` }), q),
      update: (r: Row) => ((update = r), q),
      delete: () => ((del = true), q),
      maybeSingle: async () => {
        if (insert) {
          (tables[table] ??= []).push(insert);
          return { data: insert, error: null };
        }
        return { data: rows()[0] ?? null, error: null };
      },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
        if (insert && table === "job_plans" && failPlanInsert) return Promise.resolve({ data: null, error: { message: "no" } }).then(res, rej);
        if (insert) (tables[table] ??= []).push(insert);
        if (update) for (const r of rows()) Object.assign(r, update);
        if (del) tables[table] = (tables[table] ?? []).filter((r) => !filters.every((f) => f(r)));
        return Promise.resolve({ data: rows(), error: null }).then(res, rej);
      },
    };
    return q;
  };
  const bucket = (name: string) => ({
    download: async (ref: string) => (stored[name][ref] ? { data: new Blob([new Uint8Array(stored[name][ref])]), error: null } : { data: null, error: { message: "missing" } }),
    upload: async (ref: string, bytes: Buffer) => ((stored[name][ref] = bytes), { error: null }),
    remove: async (refs: string[]) => (refs.forEach((r) => delete stored[name][r]), { error: null }),
  });
  return { supabaseAdmin: { from: query, storage: { from: bucket } } };
});

import { linkDesignPlans } from "../plans-link-server";

const ORG = "org1";
const JOB = "job-uuid-1";

async function design(read: boolean) {
  const png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#fff" } }).png().toBuffer();
  stored["studio-plans"][`org/${ORG}/src.jpeg`] = await sharp(png).jpeg().toBuffer();
  stored["studio-plans"][`org/${ORG}/page1.png`] = png;
  const doc = {
    id: "dsn_1",
    meta: { name: "Neridah idea" },
    floors: [{ id: "flr_gf", name: "Ground floor", level: 0, scaleMmPerUnit: null, northDeg: null, northPos: null, plans: [{ id: "sht_1", imageRef: `org/${ORG}/page1.png`, pageNumber: null, name: "Ground floor", width: 1200, height: 800, x: 0, y: 0 }] }],
    planImport: { sources: [{ ref: `org/${ORG}/src.jpeg`, kind: "image", name: "3465 5 Nov 08.49.jpg" }], placed: { 0: `org/${ORG}/page1.png` }, chosen: [0], names: {} },
    reading: read
      ? { at: "2026-11-14T00:00:00Z", model: "m", failed: [], floors: { flr_gf: [{ sheetId: "sht_1", spaces: ["Bed 1", "Bed 2", "Bath"].map((name) => ({ name, kind: "room", outline: [] })), openings: [], marks: [], furniture: [], checklist: [], flags: [], planUp: "N" }] } }
      : null,
  };
  tables.studio_designs = [{ id: "dsn_1", org_id: ORG, doc }];
  tables.sm8_jobs = [{ uuid: JOB, org_id: ORG }];
  tables.documents = [];
  tables.job_plans = [];
}

beforeEach(() => {
  failPlanInsert = false;
  for (const k of Object.keys(tables)) delete tables[k];
  stored["studio-plans"] = {};
  stored.documents = {};
});

it("puts the design's file on the job and its read plan in the job's Plans", async () => {
  await design(true);
  const out = await linkDesignPlans(ORG, JOB, "dsn_1", "stf_1");
  expect(out).toMatchObject({ ok: true, toRead: [] });
  const [doc] = tables.documents;
  expect(doc).toMatchObject({ kind: "job_document", sm8_job_uuid: JOB, file_name: "3465 5 Nov 08.49.jpg", mime_type: "image/jpeg" });
  expect(doc.uploaded_at).toBeTruthy();
  expect(stored.documents[doc.storage_ref as string]).toBeDefined();
  const [plan] = tables.job_plans;
  expect(out.ok && out.lead).toBe(plan.id);
  expect(plan).toMatchObject({ job_uuid: JOB, document_id: doc.id, source_ref: `org/${ORG}/src.jpeg`, source_kind: "image", state: "read", page_count: 1 });
  const page = (plan.pages as Row[])[0];
  expect(page).toMatchObject({ n: 1, kind: "floor", name: "Ground floor", ref: `org/${ORG}/page1.png` });
  /* a small picture made for the job's thumbnail */
  const meta = await sharp(stored["studio-plans"][page.preview as string]).metadata();
  expect(meta.width).toBe(480);
  expect(Object.keys((plan.reading as { floors: Row }).floors)).toEqual(["p1"]);
});

it("leaves one the design never read to be read on the job", async () => {
  await design(false);
  const out = await linkDesignPlans(ORG, JOB, "dsn_1", "stf_1");
  expect(out.ok && out.toRead).toEqual([tables.job_plans[0].id]);
  expect(tables.job_plans[0]).toMatchObject({ state: "reading", reading: null });
});

it("moves nothing for a design already made from this job's plan", async () => {
  await design(true);
  (tables.studio_designs[0].doc as { planImport: Row }).planImport.jobPlanId = "jplan_9";
  tables.job_plans.push({ id: "jplan_9", org_id: ORG, job_uuid: JOB });
  const out = await linkDesignPlans(ORG, JOB, "dsn_1", "stf_1");
  expect(out).toEqual({ ok: true, planIds: [], toRead: [], lead: "jplan_9" });
  expect(tables.documents).toHaveLength(0);
});

it("leaves nothing behind when the plan can't be added", async () => {
  await design(true);
  failPlanInsert = true;
  const out = await linkDesignPlans(ORG, JOB, "dsn_1", "stf_1");
  expect(out).toMatchObject({ ok: false });
  expect(!out.ok && out.error).toMatch(/Nothing was linked/);
  expect(tables.documents).toHaveLength(0);
  expect(Object.keys(stored.documents)).toHaveLength(0);
  /* only the design's own files are left in the plans bucket */
  expect(Object.keys(stored["studio-plans"]).sort()).toEqual([`org/${ORG}/page1.png`, `org/${ORG}/src.jpeg`]);
});

it("won't link to a job that isn't in ServiceM8's copy", async () => {
  await design(true);
  tables.sm8_jobs = [];
  expect(await linkDesignPlans(ORG, JOB, "dsn_1", "stf_1")).toMatchObject({ ok: false, error: "That job isn't in ServiceM8's copy any more." });
});
