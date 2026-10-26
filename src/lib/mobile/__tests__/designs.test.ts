/**
 * @jest-environment node
 */

/* The designs, for the phone to look at: only the workspace's own, newest
   first and narrowed by name, job or client; one design with its floors'
   plans signed, rooms with their area and load, units sized off the floor's
   scale, and the Summary's own figures. */

jest.mock("server-only", () => ({}));
import { createDesign } from "@/lib/studio/document";

const doc = (() => {
  const d = createDesign({ name: "Railway Avenue", mode: "blank", jobNumber: "2935", client: "Ferris", site: "72 Railway Ave", job: { remoteId: "j-2935", jobNumber: "2935" } });
  const floor = d.floors[0]!;
  floor.plans.push({ id: "pl1", imageRef: "org/o1/plan_a.png", pageNumber: 1, name: "Ground", width: 2000, height: 1400, x: 0, y: 0 });
  d.systems.push({ id: "sys1", type: "multi-split", brand: "mitsubishi-electric", colour: "#2563EB", name: "Multi 1", settings: {} });
  d.objects.push(
    { id: "r1", type: "room", systemId: null, floorId: floor.id, plane: "floor" as never, props: { name: "Kitchen" }, geometry: { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }] } },
    { id: "u1", type: "unit", systemId: "sys1", floorId: floor.id, plane: "wall" as never, props: { role: "idu", model: "MSZ-AP60VGKD", widthMm: 1100, depthMm: 250 }, geometry: { kind: "point", at: { x: 200, y: 10 }, rotation: 90 } },
  );
  return d;
})();

type Row = Record<string, unknown>;
let rows: Row[] = [];
const signed: string[] = [];
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => {
      const f: Record<string, unknown> = {};
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: unknown) => ((f[c] = v), q),
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: rows.find((r) => r.org_id === f.org_id && r.id === f.id) ?? null, error: null }),
        then: (res: (v: unknown) => unknown) => res({ data: rows.filter((r) => r.org_id === f.org_id), error: null }),
      };
      return q;
    },
    storage: {
      from: () => ({
        createSignedUrl: async (ref: string) => (signed.push(ref), { data: { signedUrl: `https://signed/${ref}` }, error: null }),
      }),
    },
  },
}));

import { listDesigns, readDesign, readScene } from "../designs";

beforeEach(() => {
  signed.length = 0;
  rows = [
    { id: "d1", org_id: "o1", name: "Railway Avenue", floor_count: 1, system_count: 1, updated_at: "2026-10-26T01:00:00Z", job_number: "2935", client: "Ferris", thumb_ref: "org/o1/plan_a.png", doc },
    { id: "d2", org_id: "o1", name: "Rosemont", floor_count: 1, system_count: 2, updated_at: "2026-10-24T01:00:00Z", job_number: "543", client: "Laing", thumb_ref: null, doc },
    { id: "x1", org_id: "o2", name: "Someone else's", floor_count: 1, system_count: 1, updated_at: "2026-10-26T02:00:00Z", job_number: "1", client: "Other", thumb_ref: null, doc },
  ];
});

it("lists only the workspace's designs, each with its plan signed", async () => {
  const list = await listDesigns("o1");
  expect(list.map((d) => d.id)).toEqual(["d1", "d2"]);
  expect(list[0]).toMatchObject({ name: "Railway Avenue", jobNumber: "2935", client: "Ferris", floors: 1, systems: 1, thumbUrl: "https://signed/org/o1/plan_a.png" });
  expect(list[1]!.thumbUrl).toBeNull();
});

it("narrows by name, job number or client", async () => {
  expect((await listDesigns("o1", "laing")).map((d) => d.id)).toEqual(["d2"]);
  expect((await listDesigns("o1", "2935")).map((d) => d.id)).toEqual(["d1"]);
});

it("reads one design as the phone draws it: plan, rooms with area and load, units sized off the scale", async () => {
  const d = (await readDesign("o1", "d1"))!;
  expect(d).toMatchObject({ name: "Railway Avenue", jobNumber: "2935", client: "Ferris", site: "72 Railway Ave", jobUuid: "j-2935" });
  const floor = d.floors[0]!;
  expect(floor.sheets).toEqual([{ url: "https://signed/org/o1/plan_a.png", x: 0, y: 0, width: 2000, height: 1400, crop: null }]);
  // 400 × 300 units at 10 mm a unit is 4 m × 3 m
  expect(floor.rooms).toEqual([{ id: "r1", name: "Kitchen", points: expect.any(Array), areaM2: 12, loadKw: expect.any(Number) }]);
  expect(floor.units).toEqual([{ id: "u1", role: "idu", model: "MSZ-AP60VGKD", at: { x: 200, y: 10 }, rotation: 90, w: 110, h: 25, colour: "#2563EB" }]);
  expect(d.snapshot).toMatchObject({ floorCount: 1, roomCount: 1, iduCount: 1 });
});

it("is not there for another workspace", async () => {
  expect(await readDesign("o1", "x1")).toBeNull();
});

it("hands the phone the Studio's own 3D scene, with each floor's shown name", async () => {
  const s = (await readScene("o1", "d1"))!;
  // no reading of the plans, so the floor draws the zone drawn: 4 m by 3 m at 10 mm a unit
  expect(s.scene.floors).toHaveLength(1);
  expect(s.scene.floors[0]!.spaces).toEqual([{ name: "Kitchen", kind: "zone", pts: [[0, 0], [4, 0], [4, 3], [0, 3]], existing: false }]);
  expect(s.scene.units).toEqual([expect.objectContaining({ id: "u1", outdoor: false, label: "MSZ-AP60VGKD", w: 1.1, d: 0.25, rot: 90 })]);
  expect(s.floors).toEqual([{ id: s.scene.floors[0]!.id, name: "Ground floor" }]);
  expect(await readScene("o1", "x1")).toBeNull();
});
