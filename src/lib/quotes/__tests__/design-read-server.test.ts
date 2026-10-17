/**
 * @jest-environment node
 */
/* The job's Studio design, read for Tiff: the designs whose sm8_job_uuid is
   the job, inside the business, the newest unless she names another, read
   with its brand's pack off disk as the Studio reads it. */
jest.mock("server-only", () => ({}));

type Row = Record<string, unknown>;
let TABLES: Record<string, Row[]> = {};
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const filters: ((r: Row) => boolean)[] = [];
      let sort: { col: string; asc: boolean } | null = null;
      let max = Infinity;
      const rows = () => {
        const hit = (TABLES[table] ?? []).filter((r) => filters.every((f) => f(r)));
        if (sort) hit.sort((a, b) => (String(a[sort!.col]) < String(b[sort!.col]) ? -1 : 1) * (sort!.asc ? 1 : -1));
        return hit.slice(0, max);
      };
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        order: (col: string, o?: { ascending?: boolean }) => ((sort = { col, asc: o?.ascending !== false }), q),
        limit: (n: number) => ((max = n), q),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (v: { data: Row[]; error: null }) => void) => resolve({ data: rows(), error: null }),
      };
      return q;
    },
  },
}));

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "@/lib/studio/packs/schema";
import { assemblePack, type PackSource } from "@/lib/studio/packs/loader";
import { createDesign, type DesignObject } from "@/lib/studio/document";
import type { RoomObj } from "@/lib/studio/loads-room";
import { addSplit } from "@/lib/studio/builder";
import { designsOnJob, readJobDesign } from "../design-read-server";

const DIR = join(__dirname, "../../../../data/packs/mitsubishi-electric@2026.1");
function loadPack(): DataPack {
  const meta = JSON.parse(readFileSync(join(DIR, "meta.json"), "utf8")) as PackMeta;
  const sections: PackSource["sections"] = {};
  for (const s of PACK_SECTIONS) {
    const f = join(DIR, `${s}.json`);
    if (existsSync(f)) sections[s] = JSON.parse(readFileSync(f, "utf8"));
  }
  return assemblePack({ meta, sections });
}
const pack = loadPack();

/** a bedroom on a split, saved as the Studio saves it */
function design(name: string) {
  const doc = createDesign({ name, mode: "blank", now: "2026-10-15T09:00:00.000Z" });
  doc.settings.climateZone = "5";
  doc.objects.push({ id: "bed1", type: "room", systemId: null, floorId: doc.floors[0]!.id, plane: "room", geometry: { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }] }, props: { name: "Bed 1" } } as RoomObj as DesignObject);
  return addSplit(doc, pack, { roomId: "bed1", iduModel: "MSZ-AP25VGD2", oduModel: "MUZ-AP25VG2" }).doc;
}
const row = (id: string, org: string, job: string | null, updated: string, doc: unknown, name = String((doc as { meta?: { name?: string } })?.meta?.name ?? id)) => ({
  id,
  org_id: org,
  sm8_job_uuid: job,
  name,
  system_count: 1,
  updated_at: updated,
  doc,
});

beforeEach(() => {
  TABLES = {
    studio_designs: [
      row("dsn_old", "org-1", "job-1", "2026-10-02T01:00:00+00:00", design("First go")),
      row("dsn_new", "org-1", "job-1", "2026-10-15T09:00:00+00:00", design("12 Example St")),
      /* another job's, and another business's on the same job id */
      row("dsn_other", "org-1", "job-2", "2026-10-16T09:00:00+00:00", design("Elsewhere")),
      row("dsn_theirs", "org-2", "job-1", "2026-10-17T09:00:00+00:00", design("Not yours")),
    ],
  };
});

it("lists the job's designs inside the business, newest first", async () => {
  expect(await designsOnJob("org-1", "job-1")).toEqual([
    { id: "dsn_new", name: "12 Example St", saved: "15 Oct 2026", systems: 1 },
    { id: "dsn_old", name: "First go", saved: "2 Oct 2026", systems: 1 },
  ]);
  expect(await designsOnJob("org-1", "")).toEqual([]);
});

it("reads the newest, with its brand's pack off disk, and names the job's others", async () => {
  const got = await readJobDesign("org-1", "job-1");
  if (!got.found) throw new Error(got.reason);
  expect(got.read.design.name).toBe("12 Example St");
  expect(got.read.systems[0]).toMatchObject({ kind: "Split", brand: "Mitsubishi Electric", outdoor: "MUZ-AP25VG2", combination: "valid" });
  expect(got.read.systems[0]!.rooms[0]).toMatchObject({ room: "Bed 1", area_m2: 12, unit: "MSZ-AP25VGD2", capacity_kw: 2.5, covers: "yes" });
  expect(got.others).toEqual([{ id: "dsn_old", name: "First go", saved: "2 Oct 2026" }]);
});

it("reads the one she names, and says which are the job's when it isn't one of them", async () => {
  const old = await readJobDesign("org-1", "job-1", "dsn_old");
  expect(old.found && old.read.design.name).toBe("First go");
  expect(await readJobDesign("org-1", "job-1", "dsn_theirs")).toEqual({
    found: false,
    reason: "That design isn't linked to this job.",
    designs: [
      { id: "dsn_new", name: "12 Example St", saved: "15 Oct 2026" },
      { id: "dsn_old", name: "First go", saved: "2 Oct 2026" },
    ],
  });
});

it("says plainly when the job has no design, or one that can't be read", async () => {
  expect(await readJobDesign("org-1", "job-9")).toEqual({ found: false, reason: "There's no Studio design linked to this job." });
  TABLES.studio_designs = [row("dsn_bad", "org-1", "job-1", "2026-10-15T09:00:00+00:00", { not: "a design" }, "Broken")];
  expect(await readJobDesign("org-1", "job-1")).toMatchObject({ found: false, reason: 'The design "Broken" couldn\'t be read.' });
});
