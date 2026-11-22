/* THE ROOMS OFF THE JOB'S PLANS, WITH THEIR SIZES (Isaac, 11 November 2026:
   "This seems very complicated ... surely there's a better way", on Tiff
   working a plan photo's rooms out in a quote's chat: 22 close looks, each
   room's corners marked by eye, and the turn out of rounds with no answer).

   A plan is read once, when it goes into the job's Plans (plans.ts), and the
   reading is kept: every room's outline, in the page's pixels. A room's m²
   is that outline at the page's scale, and the scale comes from, in order:
     1. the scale the title block prints ("1:100 @ A3");
     2. the lengths printed along its dimension lines, read once with the
        plan (reading.ts scaleFromDimensions): a photographed sketch has these
        and no title block;
     3. the sizes written inside its rooms, each against its own outline;
   and where a page has none of the three, a room keeps the size written in
   it, or is said to have no size. So a quote, the heat load and the Studio
   size a room the same way off the one read, and nobody marks a corner.

   Pure: no I/O. The server side is plans-server.ts jobPlanRooms. */

import { area, parseWritten, type ReadPoint, type ReadSpace } from "@/lib/studio/reading";
import { floorPagesOf, pageKey, pageScale, scaleFromWritten, type JobPlan } from "./plans";

/** What an air conditioner might serve, and the halls between: not cupboards, stairs, voids or outside. */
const ROOM_KINDS = new Set<ReadSpace["kind"]>(["room", "wet", "garage", "circulation"]);

export type PlanRoom = {
  name: string;
  kind: "room" | "wet" | "garage" | "circulation";
  /** null: nothing on the plan sizes it */
  area_m2: number | null;
  /** "about 5 × 4 m": its box, for a sanity check against what's known */
  about?: string;
  /** the size as written in it, where the plan writes one */
  written?: string;
};

export type PlanFloorRooms = {
  floor: string;
  page: number;
  /** what the sizes rest on, said to the person; null when the page has no scale */
  sized_by: string | null;
  /** false: one figure alone, or nothing to check it against */
  sure: boolean;
  rooms: PlanRoom[];
};

export type PlanRooms = {
  plan: string;
  state: JobPlan["state"];
  /** why it needs a look, or couldn't be read */
  said?: string;
  floors: PlanFloorRooms[];
};

/** What a quote is handed: the job's plans' rooms, and what to say of them. */
export type JobPlanRooms = { plans: PlanRooms[]; said: string };

const r1 = (n: number) => Math.round(n * 10) / 10;

export { pageScale, scaleFromWritten };

const box = (outline: readonly ReadPoint[]) => {
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};

/** A plan's rooms by floor, each with its m² and what the sizes rest on. */
export function planRoomsOf(plan: JobPlan): PlanRooms {
  const floors: PlanFloorRooms[] = floorPagesOf(plan).map((page) => {
    const spaces = (plan.reading?.floors[pageKey(page.n)] ?? []).flatMap((s) => s.spaces).filter((s) => ROOM_KINDS.has(s.kind) && s.outline.length >= 3);
    /* on its set's scale, as the plan's line, its m² and a design take it */
    const scale = pageScale(page, spaces, plan.pages);
    const rooms = spaces.map((s): PlanRoom => {
      const written = parseWritten(s.written);
      const base = { name: s.name, kind: s.kind as PlanRoom["kind"], ...(s.written ? { written: s.written } : {}) };
      if (scale) {
        const b = box(s.outline);
        const [long, short] = [Math.max(b.w, b.h), Math.min(b.w, b.h)].map((px) => r1((px * scale.mmPerPx) / 1000));
        return { ...base, area_m2: r1(area(s.outline) * scale.mmPerPx * scale.mmPerPx * 1e-6), about: `about ${long} × ${short} m` };
      }
      return { ...base, area_m2: written ? r1(written[0] * written[1]) : null };
    });
    const anyWritten = !scale && rooms.some((r) => r.area_m2 != null);
    return {
      floor: page.name || `Page ${page.n}`,
      page: page.n,
      sized_by: scale ? scale.from : anyWritten ? "the size written in each room that has one" : null,
      sure: scale ? scale.sure : anyWritten,
      rooms,
    };
  });
  return { plan: plan.name, state: plan.state, ...(plan.said ? { said: plan.said } : {}), floors };
}

/** What she's told with the rooms: what to say of them, and what's missing. */
export function planRoomsSaid(plans: readonly PlanRooms[]): string {
  if (plans.length === 0)
    return "No plan is in this job's Plans. If one of the job's files is its floor plan (job_files), have it read by its id (add): it's read once, about a minute, and kept on the job. With no plan, ask for the room sizes.";
  const reading = plans.filter((p) => p.state === "reading");
  const floors = plans.flatMap((p) => p.floors);
  const said: string[] = [];
  if (floors.some((f) => f.rooms.length)) said.push("Sizes are as read off the plan: say what they rest on, and ask to confirm the ones the load rests on.");
  if (floors.some((f) => f.sized_by && !f.sure)) said.push("A scale off one figure alone is less sure: say so.");
  if (floors.some((f) => f.rooms.some((r) => r.area_m2 == null))) said.push("A room with no m² has nothing on the plan to size it: ask for its size, or one wall's length.");
  if (reading.length) said.push(`${reading.map((p) => p.plan).join(", ")} is still being read: say it will be a minute or two, and to ask again.`);
  if (plans.some((p) => p.state === "failed")) said.push("A plan that couldn't be read is said so: ask for the room sizes.");
  if (!said.length) said.push("No rooms were found on the plans read: ask for the room sizes.");
  return said.join(" ");
}
