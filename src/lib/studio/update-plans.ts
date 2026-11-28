import { designFromPlan, floorPagesOf, pageCaption, pageKey, readingOnto, type JobPlan, type JobPlanPage } from "@/lib/jobs/plans";
import type { DesignDocument, DesignObject, PlanSheet } from "./document";
import { areaUnitsToM2, polygonArea } from "./geometry";
import { plansInDesign, withJobPlans } from "./job-plan-floors";
import { roomLoadKw, type RoomObj } from "./loads-room";
import { keepFound, readHeightOf, readyFloor } from "./room-edit";
import { handFields, keptRow, markHand, valuesOf, type KeptField } from "./building-kept";
import { glassM2, glassOf } from "./rooms-from-reading";
import type { PlanReading, ReadOpening, ReadSpace } from "./reading";

/* UPDATE PLANS (Isaac, 11 November 2026, "new plans can get uploaded, which
   you can then select update plans"; the boards "Newer plans land on the
   job" and "Update plans" on https://claude.ai/artifact/6FP52g4ropVpfAqqzNLk2c,
   carried into https://claude.ai/artifact/61nqwanqUAtQx4iG6AxoYs; 15
   November 2026: "Yes, Update plans").

   A design made from a job's plans is told when a newer set is on the job:
   a set of drawings read since the newest one it holds. Update plans says
   what the new set changed, page by page, off Tiff's two reads, and what
   that does to the design: each room drawn from a room that changed is
   offered its new name, outline and windows, ticked, with its load before
   and after; a room new on the plans is offered to be marked; a room the
   new set no longer has stays as it was drawn. Taking it swaps the old
   set's sheets for the new one's, each in the old one's place, so nothing
   drawn moves; units, ducts and the Scope stay as they were made.

   PLANS UPDATED (Isaac, 23 November 2026: "it could say plans updated, use
   on this design or something on the canvas"). A set Tiff read again (its
   pages drawn again, her read redone) is offered the same way: the design's
   read of the set is set beside her new one, page by page, and taking it
   puts her new read under the design, its walls, openings, roof and site,
   with each room drawn from a room that changed offered as above.

   Pure. The new set's pages are matched to the old one's by floor, in page
   order; its rooms to the old rooms by where they sit, then by name. */

/** A room she read, with its place in her read and its glass. */
type Space = { i: number; s: ReadSpace; glass: ReadOpening[] };

/** One page of the new set beside the page it takes the place of. */
type PagePair = { old: JobPlanPage | null; now: JobPlanPage };

/** `again`: a set the design holds, read again since the read it holds; `was` is then the set as the design has it */
export type NewerPlan = { plan: JobPlan; was: JobPlan | null; again?: boolean };

/** A change offered to the design: a room's, ticked to take it. */
export type RoomOffer = { id: string; title: string; line: string };

export type PlanUpdate = NewerPlan & {
  /** what the plans changed, by page of the new set */
  pages: { n: number; title: string; lines: string[] }[];
  /** what it does to the design, each to be ticked */
  offers: RoomOffer[];
  /** what it does that isn't asked: a room gone from the plans, a floor new on them */
  said: { title: string; line: string }[];
  /** what somebody set by hand that the new plans say otherwise, kept as they set it;
      each id ticked in takes the plans' instead (building-kept.ts) */
  kept: RoomOffer[];
};

/** The id that takes the plans' value over what was set by hand on a zone. */
export const plansValueId = (roomId: string) => `plans:${roomId}`;

const read = (p: JobPlan) => p.state === "read" || p.state === "check";
const drawingsOf = (plans: readonly JobPlan[]) => plans.filter((p) => p.kind !== "spec" && read(p) && floorPagesOf(p).length > 0);
const time = (iso: string) => Date.parse(iso) || 0;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The job's newest set of drawings read since the newest the design holds,
    and the set of the design's it takes the place of: the one sharing the
    most floors with it. Null when the design holds none of the job's plans,
    or nothing newer is on the job. */
export function newerPlan(doc: Pick<DesignDocument, "floors" | "planImport" | "reading">, plans: readonly JobPlan[]): NewerPlan | null {
  const drawings = drawingsOf(plans);
  const mine = new Set(plansInDesign(doc, drawings));
  const held = drawings.filter((p) => mine.has(p.id));
  if (held.length === 0) return null;
  const passed = new Set(doc.planImport?.passed ?? []);
  const newest = Math.max(...held.map((p) => time(p.addedAt)));
  const plan = drawings
    .filter((p) => !mine.has(p.id) && !passed.has(p.id) && time(p.addedAt) > newest)
    .sort((a, b) => time(b.addedAt) - time(a.addedAt))[0];
  if (!plan) return readAgain(doc, held);
  const levels = new Set(floorPagesOf(plan).map((p) => p.level ?? 0));
  const was =
    held
      .map((p) => ({ p, shared: floorPagesOf(p).filter((pg) => levels.has(pg.level ?? 0)).length }))
      .filter((x) => x.shared > 0)
      .sort((a, b) => b.shared - a.shared || time(b.p.addedAt) - time(a.p.addedAt))[0]?.p ?? null;
  return { plan, was };
}

type Held = Pick<DesignDocument, "floors" | "planImport" | "reading">;

/** A set the design holds that Tiff has read again since the read the
    design holds, the one it was made from first; null when there's none.
    The design's read of it stands in as the old set's. */
function readAgain(doc: Held, held: readonly JobPlan[]): NewerPlan | null {
  const since = doc.reading ? time(doc.reading.at) : 0;
  if (!since) return null;
  const lead = (p: JobPlan) => Number(p.id === doc.planImport?.jobPlanId);
  const plan = held
    .filter((p) => p.reading && time(p.reading.at) > since && floorPagesOf(p).some((pg) => sheetForPage(doc, p, pg)))
    .sort((a, b) => lead(b) - lead(a) || time(b.reading!.at) - time(a.reading!.at))[0];
  return plan ? { plan, was: asDrawn(doc, plan), again: true } : null;
}

/** The design's sheet of a page of one of its sets: the one showing the
    page's picture, else, for the set it was made from, the one it placed
    for that page (a set read again draws its pages again, as new pictures). */
function sheetForPage(doc: Pick<DesignDocument, "floors" | "planImport">, plan: JobPlan, page: JobPlanPage): { floorId: string; sheet: PlanSheet } | null {
  const placed = doc.planImport?.jobPlanId === plan.id ? doc.planImport.placed[page.n - 1] : undefined;
  for (const ref of [page.ref, placed]) {
    if (!ref) continue;
    for (const f of doc.floors) {
      const sheet = f.plans.find((s) => s.imageRef === ref);
      if (sheet) return { floorId: f.id, sheet };
    }
  }
  return null;
}

/** A set as the design has it: each page the picture on its sheet, her read the one the design holds. */
function asDrawn(doc: Held, plan: JobPlan): JobPlan {
  const floors: PlanReading["floors"] = {};
  const pages = plan.pages.map((pg) => {
    const at = pg.kind === "floor" ? sheetForPage(doc, plan, pg) : null;
    if (!at) return pg;
    floors[pageKey(pg.n)] = (doc.reading?.floors[at.floorId] ?? []).filter((s) => s.sheetId === at.sheet.id);
    return { ...pg, ref: at.sheet.imageRef, width: at.sheet.width, height: at.sheet.height };
  });
  return { ...plan, pages, reading: doc.reading ? { at: doc.reading.at, model: doc.reading.model, floors, failed: [] } : null };
}

/** The design with a set read again under it: each page's new picture on
    the page's sheet, where it sat, and her new read of the set in the old
    one's place; its roof and site too when it's the set the design was made
    from. What's drawn is left to updatePlans. */
function readUnder(doc: DesignDocument, plan: JobPlan): DesignDocument {
  const at = new Map<string, { floorId: string; sheetId: string }>();
  const swap = new Map<string, PlanSheet>();
  for (const pg of floorPagesOf(plan)) {
    const was = sheetForPage(doc, plan, pg);
    if (!was || !pg.ref) continue;
    at.set(pageKey(pg.n), { floorId: was.floorId, sheetId: was.sheet.id });
    const same = was.sheet.width === pg.width;
    const { crop, shape, ...rest } = was.sheet;
    swap.set(was.sheet.id, {
      ...rest,
      imageRef: pg.ref,
      pageNumber: plan.sourceKind === "pdf" ? pg.n : was.sheet.pageNumber,
      width: pg.width,
      height: pg.height,
      ...(same && crop ? { crop } : pg.trim ? { crop: { ...pg.trim } } : {}),
      ...(same && shape ? { shape } : {}),
    });
  }
  const floors = doc.floors.map((f) => ({ ...f, plans: f.plans.map((s) => swap.get(s.id) ?? s) }));
  const lead = doc.planImport?.jobPlanId === plan.id;
  /* the import record follows the set's new pictures, words and measures */
  const fresh = lead ? designFromPlan(plan).planImport : null;
  const planImport =
    doc.planImport && fresh
      ? { ...doc.planImport, sources: fresh.sources, placed: fresh.placed, ...(fresh.words ? { words: fresh.words } : {}), ...(fresh.measured ? { measured: fresh.measured } : {}) }
      : doc.planImport;
  if (!plan.reading) return { ...doc, floors, planImport };
  const now = readingOnto(plan.reading, (key) => at.get(key) ?? null);
  const base = doc.reading ?? { at: now.at, model: now.model, floors: {}, failed: [] };
  const mine = new Set(swap.keys());
  const kept: PlanReading["floors"] = {};
  for (const [id, sheets] of Object.entries(base.floors)) kept[id] = sheets.filter((s) => !mine.has(s.sheetId));
  for (const [id, sheets] of Object.entries(now.floors)) kept[id] = [...(kept[id] ?? []), ...sheets];
  const reading: PlanReading = {
    ...base,
    at: now.at,
    model: now.model,
    floors: Object.fromEntries(Object.entries(kept).filter(([, s]) => s.length > 0)),
    failed: [...base.failed.filter((f) => !mine.has(f.sheetId)), ...now.failed],
  };
  /* her new roof and site, as she read them: one she couldn't read is left to be read again */
  if (lead) {
    delete reading.roof;
    delete reading.site;
    if (now.roof !== undefined) reading.roof = now.roof;
    if (now.site !== undefined) reading.site = now.site;
  }
  return { ...doc, floors, planImport, reading };
}

/** The new set's floor pages, each beside the old set's page on its floor, in page order. */
function pagePairs(was: JobPlan | null, plan: JobPlan): PagePair[] {
  /* by building, then level: a garage's ground floor is no house's (buildings.ts) */
  const where = (pg: JobPlanPage) => `${(pg.building ?? "").toLowerCase()}:${pg.level ?? 0}`;
  const byLevel = (p: JobPlan | null) => {
    const out = new Map<string, JobPlanPage[]>();
    for (const pg of p ? floorPagesOf(p) : []) out.set(where(pg), [...(out.get(where(pg)) ?? []), pg]);
    return out;
  };
  const olds = byLevel(was);
  return floorPagesOf(plan).map((now) => {
    const at = floorPagesOf(plan).filter((p) => where(p) === where(now)).indexOf(now);
    return { old: olds.get(where(now))?.[at] ?? null, now };
  });
}

/** The rooms she read off a page, as the Studio offers them (rooms-from-reading suggestionsFor). */
function spacesOf(plan: JobPlan | null, n: number): Space[] {
  const out: Space[] = [];
  for (const r of plan?.reading?.floors[pageKey(n)] ?? [])
    for (const [i, s] of r.spaces.entries()) {
      if (s.outline.length < 3 || ["void", "notch", "outdoor", "stair"].includes(s.kind) || s.existing) continue;
      out.push({ i, s, glass: r.openings.filter((o) => norm(o.room) === norm(s.name) && glassOf(s, o)) });
    }
  return out;
}

type Box = { x0: number; y0: number; x1: number; y1: number };
const boxOf = (pts: readonly { x: number; y: number }[], k = 1): Box => ({
  x0: Math.min(...pts.map((p) => p.x * k)),
  y0: Math.min(...pts.map((p) => p.y * k)),
  x1: Math.max(...pts.map((p) => p.x * k)),
  y1: Math.max(...pts.map((p) => p.y * k)),
});
function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (w <= 0 || h <= 0) return 0;
  const both = w * h;
  return both / ((a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - both);
}

/* a room this much over the old one is the same room; this much over, unchanged in shape */
const SAME_ROOM = 0.5;
const SAME_SHAPE = 0.85;
const SAME_AREA = 0.05;

type Match = { old: Space; now: Space; fit: number };

/** The new page's rooms against the old page's: by where they sit (the new
    page's pixels brought to the old one's size), then by name. */
function matchSpaces(old: Space[], now: Space[], k: number): { pairs: Match[]; gone: Space[]; added: Space[] } {
  const scored: Match[] = [];
  for (const o of old) for (const n of now) scored.push({ old: o, now: n, fit: overlap(boxOf(o.s.outline), boxOf(n.s.outline, k)) });
  scored.sort((a, b) => b.fit - a.fit);
  const pairs: Match[] = [];
  const usedOld = new Set<number>();
  const usedNow = new Set<number>();
  for (const m of scored) {
    if (m.fit < SAME_ROOM || usedOld.has(m.old.i) || usedNow.has(m.now.i)) continue;
    pairs.push(m);
    usedOld.add(m.old.i);
    usedNow.add(m.now.i);
  }
  for (const o of old) {
    if (usedOld.has(o.i)) continue;
    const n = now.find((x) => !usedNow.has(x.i) && norm(x.s.name) === norm(o.s.name));
    if (!n) continue;
    pairs.push({ old: o, now: n, fit: overlap(boxOf(o.s.outline), boxOf(n.s.outline, k)) });
    usedOld.add(o.i);
    usedNow.add(n.i);
  }
  return { pairs, gone: old.filter((o) => !usedOld.has(o.i)), added: now.filter((n) => !usedNow.has(n.i)) };
}

const FACING: Record<string, string> = { N: "north", NE: "north-east", E: "east", SE: "south-east", S: "south", SW: "south-west", W: "west", NW: "north-west" };
const facingsOf = (s: Space) => new Set(s.glass.filter((o) => o.external).map((o) => FACING[o.facing.toUpperCase().trim()]).filter(Boolean));
const m2 = (n: number) => `${n < 10 ? n.toFixed(1) : Math.round(n)} m²`;

/* a room's glass, as its load takes it (rooms-from-reading glassM2): null where a width isn't read */
const glassRead = (x: Space) => glassM2({ windows: x.glass, kind: x.s.kind });

/** What changed about one room, or null when it's as it was. `mm`: the old page's millimetres per pixel.
    `glass`: its windows are where they were and as many, and how much glass
    they are isn't (Isaac's job 3570, 24 November 2026: read again with its
    door and window schedule, its windows had their heights and its rooms
    kept the glazing of the read before, the house 20 kW under). */
function roomChange(m: Match, k: number, mm: number | null): { renamed: boolean; reshaped: boolean; windows: boolean; glass: boolean; said: string } | null {
  const renamed = norm(m.old.s.name) !== norm(m.now.s.name);
  const a0 = polygonArea(m.old.s.outline);
  const a1 = polygonArea(m.now.s.outline) * k * k;
  const reshaped = m.fit < SAME_SHAPE || Math.abs(a1 - a0) > a0 * SAME_AREA;
  const before = facingsOf(m.old);
  const after = facingsOf(m.now);
  const gained = [...after].filter((f) => !before.has(f));
  const lost = [...before].filter((f) => !after.has(f));
  const windows = gained.length > 0 || lost.length > 0 || m.old.glass.length !== m.now.glass.length;
  const g0 = glassRead(m.old);
  const g1 = glassRead(m.now);
  const glass = !windows && ((g0 == null) !== (g1 == null) || (g0 != null && g1 != null && Math.abs(g1 - g0) > Math.max(g0, g1) * SAME_AREA));
  if (!renamed && !reshaped && !windows && !glass) return null;
  const size = mm ? m2(areaUnitsToM2(a1, mm)) : null;
  const facing = [gained.length ? `with a window to the ${gained.join(" and ")}` : null, lost.length ? `no window to the ${lost.join(" and ")}` : null]
    .filter(Boolean)
    .join(" and ");
  const sized = g1 == null ? "glass that isn't sized" : g0 == null ? "its glass sized" : g1 > g0 ? "more glass" : "less glass";
  const said = renamed
    ? `${m.old.s.name} is ${m.now.s.name} now${size ? `, ${size}` : ""}${facing ? ` ${facing}` : ""}`
    : reshaped
      ? `${m.now.s.name} is ${size ? `${size} now, was ${m2(areaUnitsToM2(a0, mm!))}` : "a new shape"}${facing ? `, ${facing}` : ""}`
      : windows
        ? `${m.now.s.name} has ${gained.length ? `a window to the ${gained.join(" and ")}` : lost.length ? `no window to the ${lost.join(" and ")}` : "different windows"} now`
        : `${m.now.s.name} has ${sized} now`;
  return { renamed, reshaped, windows, glass, said };
}

/** A room whose glass alone changed: it keeps its outline, and takes its glazing and the way it faces. */
const glassOnly = (c: { renamed: boolean; reshaped: boolean; windows: boolean; glass: boolean }) => c.glass && !c.renamed && !c.reshaped && !c.windows;

/** Where the old page sits in the design: its sheet and floor. */
function sheetOfRef(doc: DesignDocument, ref: string | null): { floorId: string; sheet: PlanSheet; mm: number | null } | null {
  if (!ref) return null;
  for (const f of doc.floors) {
    const sheet = f.plans.find((s) => s.imageRef === ref);
    if (sheet) return { floorId: f.id, sheet, mm: f.scaleMmPerUnit };
  }
  return null;
}

/** The design's rooms drawn from one of her rooms on a sheet, by her room's place in the read. */
function roomsFrom(doc: DesignDocument, floorId: string, sheetId: string, old: Space[]): Map<number, DesignObject[]> {
  const out = new Map<number, DesignObject[]>();
  const add = (i: number, o: DesignObject) => out.set(i, [...(out.get(i) ?? []), o]);
  for (const o of doc.objects) {
    if (o.type !== "room" || o.floorId !== floorId) continue;
    const key = typeof o.props.readKey === "string" ? o.props.readKey : null;
    if (key?.startsWith(`${sheetId}:`)) add(Number(key.slice(sheetId.length + 1)), o);
    else if (!key && o.props.fromReading === true) {
      /* a room kept before rooms remembered their key: by name */
      const s = old.find((x) => norm(x.s.name) === norm(String(o.props.name ?? "")));
      if (s) add(s.i, o);
    }
  }
  return out;
}

const kw = (n: number | null) => (n == null ? null : `${n.toFixed(1)} kW`);
const newKey = (n: number, i: number) => `new:${n}:${i}`;
/** the id a room new on the plans takes when it's marked */
const newRoomId = (plan: JobPlan, n: number, i: number) => `obj_${plan.id}_${n}_${i}`;

type Plan = {
  pairs: PagePair[];
  /** by page of the new set: the old room each new one is, and those gone and new */
  matched: Map<number, { pairs: Match[]; gone: Space[]; added: Space[]; k: number }>;
};

function planOf(doc: DesignDocument, up: NewerPlan): Plan {
  const pairs = pagePairs(up.was, up.plan);
  const matched: Plan["matched"] = new Map();
  for (const { old, now } of pairs) {
    const k = old && now.width > 0 ? old.width / now.width : 1;
    matched.set(now.n, { ...matchSpaces(old ? spacesOf(up.was, old.n) : [], spacesOf(up.plan, now.n), k), k });
  }
  return { pairs, matched };
}

/** How many of the new set's floor pages differ from the old set's, off
    her two reads alone: a page new to the design counts. For the row that
    says a newer set is on the job, asked on every change to the design. */
export function sheetsChanged(up: NewerPlan): number {
  let n = 0;
  for (const { old, now } of pagePairs(up.was, up.plan)) {
    if (!old) {
      n += 1;
      continue;
    }
    const k = now.width > 0 ? old.width / now.width : 1;
    const m = matchSpaces(spacesOf(up.was, old.n), spacesOf(up.plan, now.n), k);
    if (m.gone.length || m.added.length || m.pairs.some((p) => roomChange(p, k, null))) n += 1;
  }
  return n;
}

/** What a newer set changed and what taking it does to the design. */
export function planUpdate(doc: DesignDocument, plans: readonly JobPlan[], up: NewerPlan): PlanUpdate {
  const { pairs, matched } = planOf(doc, up);
  const pages: PlanUpdate["pages"] = [];
  const fresh: (RoomOffer & { roomId: string })[] = [];
  const said: PlanUpdate["said"] = [];
  const all = new Set<string>();
  /* `lines`: where a room whose glass alone changed is said, once it's known the change moves its load */
  const changes: { room: DesignObject; title: string; why: string; glass?: { said: string; lines: string[] } }[] = [];

  for (const { old, now } of pairs) {
    const m = matched.get(now.n)!;
    const at = sheetOfRef(doc, old?.ref ?? null);
    const caption = pageCaption(now);
    if (!old || !at) {
      said.push({ title: `${now.name || caption} is new on the plans`, line: "Tiff marks its rooms, as when a design opens" });
      continue;
    }
    const lines: string[] = [];
    const drawn = roomsFrom(doc, at.floorId, at.sheet.id, spacesOf(up.was, old.n));
    for (const p of m.pairs) {
      const c = roomChange(p, m.k, at.mm);
      if (!c) continue;
      const glass = glassOnly(c) ? { said: c.said, lines } : undefined;
      if (!glass) lines.push(c.said);
      for (const room of drawn.get(p.old.i) ?? []) {
        const name = String(room.props.name ?? p.old.s.name);
        const title = c.renamed ? `${name} becomes ${p.now.s.name}` : `${name} takes the new plans`;
        const what = andWords([c.reshaped || c.renamed ? "outline" : null, c.windows || c.glass ? "windows" : null]);
        changes.push({ room, title, why: `Its ${what || "outline"} off ${caption}`, ...(glass ? { glass } : {}) });
        all.add(room.id);
      }
    }
    for (const g of m.gone) {
      lines.push(`${g.s.name} is gone`);
      for (const room of drawn.get(g.i) ?? []) said.push({ title: `${String(room.props.name ?? g.s.name)} isn't on the new plans`, line: "It stays as you drew it" });
    }
    for (const a of m.added) {
      const size = at.mm ? `, ${m2(areaUnitsToM2(polygonArea(a.s.outline) * m.k * m.k, at.mm))}` : "";
      lines.push(`${a.s.name} is new${size}`);
      if (a.s.kind !== "garage" && at.mm) {
        fresh.push({ id: newKey(now.n, a.i), title: `Mark ${a.s.name}`, line: `New on ${caption}`, roomId: newRoomId(up.plan, now.n, a.i) });
        all.add(newKey(now.n, a.i));
      }
    }
    pages.push({ n: now.n, title: caption, lines });
  }

  /* each room's load before and after, off the design as it would be with every change taken */
  const after = updatePlans(doc, plans, up, all);
  const loadOf = (id: string) => {
    const o = after.objects.find((x) => x.id === id);
    return o ? kw(roomLoadKw(after, o as RoomObj)) : null;
  };
  /* glass alone: offered, and said, only where the room's glazing or the way it faces moves with it */
  const moved = (room: DesignObject) => {
    const o = after.objects.find((x) => x.id === room.id);
    return !!o && (o.props.glazing !== room.props.glazing || o.props.orientation !== room.props.orientation);
  };
  const offered = changes.filter((c) => !c.glass || moved(c.room));
  for (const c of offered) if (c.glass && !c.glass.lines.includes(c.glass.said)) c.glass.lines.push(c.glass.said);
  const offers: RoomOffer[] = offered.map((c) => {
    const was = kw(roomLoadKw(doc, c.room as RoomObj));
    const is = loadOf(c.room.id);
    const load = was && is ? (was === is ? `Its load stays ${is}` : `Its load goes from ${was} to ${is}`) : null;
    return { id: c.room.id, title: c.title, line: [c.why, load].filter(Boolean).join(". ") };
  });
  for (const o of fresh) {
    const load = loadOf(o.roomId);
    offers.push({ id: o.id, title: o.title, line: load ? `${o.line}. Its load is ${load}` : o.line });
  }
  /* KEPT AS YOU SET THEM (the building mock, board 6): a value set by hand
     stays when the new plans say otherwise, each with Use the plans' */
  const handRooms = doc.objects.filter((o) => o.type === "room" && handFields(o).length > 0);
  const theirs = handRooms.length ? updatePlans(doc, plans, up, new Set([...all, ...handRooms.map((o) => plansValueId(o.id))])) : after;
  const kept: RoomOffer[] = handRooms.flatMap((room) => {
    const a = after.objects.find((o) => o.id === room.id);
    const t = theirs.objects.find((o) => o.id === room.id);
    if (!a || !t) return [];
    const mine = valuesOf(a);
    const their = valuesOf(t);
    const differ = handFields(room).filter((f) => their[f] !== undefined && mine[f] !== their[f]);
    if (!differ.length) return [];
    return [{ id: plansValueId(room.id), ...keptRow(String(room.props.name ?? "Zone"), mine, their, differ, up.plan.name) }];
  });
  return { ...up, pages: pages.filter((p) => p.lines.length > 0), offers, said, kept };
}

function andWords(words: (string | null)[]): string {
  const w = words.filter((x): x is string => !!x);
  return w.length > 1 ? `${w.slice(0, -1).join(", ")} and ${w.at(-1)}` : (w[0] ?? "");
}

/** The design with the newer set in the old one's place: its sheets where
    the old ones sat, each room drawn from her read pointed at the new read,
    the changes ticked taken (`ticked`: rooms by id, new rooms by their
    offer's id), and a floor the new set adds made as a new design's is. */
export function updatePlans(doc: DesignDocument, plans: readonly JobPlan[], up: NewerPlan, ticked: ReadonlySet<string>): DesignDocument {
  const drawings = drawingsOf(plans);
  const { pairs, matched } = planOf(doc, up);
  const on = [...plansInDesign(doc, drawings).filter((id) => id !== up.was?.id), up.plan.id];
  /* a set read again keeps its sheets, and a page it now finds a floor (a
     garage's, a cabana's: buildings.ts) comes onto the design as a new set's would */
  const swapped = up.again ? withJobPlans(readUnder(doc, up.plan), drawings, drawings, on) : withJobPlans(doc, drawings, drawings, on);
  let d: DesignDocument = { ...swapped.doc, planImport: swapped.doc.planImport ? { ...swapped.doc.planImport, ...(doc.planImport?.passed ? { passed: doc.planImport.passed } : {}) } : swapped.doc.planImport };
  /* the design holds the new set's read now: not offered it again as read again */
  const readAt = up.plan.reading?.at;
  if (d.reading && readAt && time(readAt) > time(d.reading.at)) d = { ...d, reading: { ...d.reading, at: readAt } };

  for (const { old, now } of pairs) {
    const was = sheetOfRef(doc, old?.ref ?? null);
    const is = sheetOfRef(d, now.ref);
    if (!old || !was || !is) continue;
    const m = matched.get(now.n)!;
    /* the new sheet where the old one sat, so what's drawn stays over the house */
    const same = Math.abs(m.k - 1) < 0.01;
    const sheet: PlanSheet = { ...is.sheet, x: was.sheet.x, y: was.sheet.y, ...(same && was.sheet.crop ? { crop: { ...was.sheet.crop } } : {}), ...(same && was.sheet.shape ? { shape: was.sheet.shape } : {}) };
    d = { ...d, floors: d.floors.map((f) => (f.id === is.floorId ? { ...f, plans: f.plans.map((s) => (s.id === sheet.id ? sheet : s)) } : f)) };

    const drawn = roomsFrom(doc, was.floorId, was.sheet.id, spacesOf(up.was, old.n));
    const nowOf = new Map(m.pairs.map((p) => [p.old.i, p]));
    const keyOf = (i: number) => `${sheet.id}:${i}`;
    for (const [i, rooms] of drawn) {
      const p = nowOf.get(i);
      for (const room of rooms) {
        const joined = Array.isArray(room.props.joinedKeys)
          ? (room.props.joinedKeys as unknown[]).flatMap((k) => {
              const j = typeof k === "string" && k.startsWith(`${was.sheet.id}:`) ? nowOf.get(Number(k.slice(was.sheet.id.length + 1))) : null;
              return j ? [keyOf(j.now.i)] : [];
            })
          : null;
        if (!p) continue;
        const key = keyOf(p.now.i);
        const c = roomChange(p, m.k, null);
        const usePlans = ticked.has(plansValueId(room.id));
        if (ticked.has(room.id) && c) {
          const fresh = freshRoom(d, is.floorId, key);
          if (fresh) {
            const renamed = norm(p.old.s.name) !== norm(p.now.s.name);
            const glass = glassOnly(c);
            d = replaceRoom(d, {
              ...room,
              geometry: glass ? room.geometry : fresh.geometry,
              props: handKept(
                {
                  ...room.props,
                  ...pick(fresh.props, glass ? ["glazing", "orientation"] : ["externalWalls", "hasExternalWalls", "glazing", "orientation", "shape", "roomAbove"]),
                  ...(renamed ? { name: p.now.s.name } : {}),
                  readKey: key,
                  ...(joined ? { joinedKeys: joined } : {}),
                },
                room,
                usePlans,
                d,
                is.floorId,
              ),
            });
            continue;
          }
        }
        d = replaceRoom(d, { ...room, props: handKept({ ...room.props, readKey: key, ...(joined ? { joinedKeys: joined } : {}) }, room, usePlans, d, is.floorId) });
      }
    }
    /* rooms new on the plans, ticked: marked as Tiff found them */
    const want = m.added.filter((a) => ticked.has(newKey(now.n, a.i)));
    if (want.length) d = keepFound(d, is.floorId, want.map((a) => keyOf(a.i)), Object.fromEntries(want.map((a) => [keyOf(a.i), newRoomId(up.plan, now.n, a.i)])));
  }
  /* a floor only the new set has opens as a new design's floor does */
  return swapped.made.reduce((x, id) => readyFloor(x, id), d);
}

/** A room as keepFound would make it from her read, without keeping it. A
    set read again keeps its sheets, so the room being given it may hold its key. */
function freshRoom(d: DesignDocument, floorId: string, key: string): DesignObject | null {
  const id = "__update_plans__";
  const made = keepFound({ ...d, objects: d.objects.filter((o) => o.props.readKey !== key) }, floorId, [key], { [key]: id });
  return made.objects.find((o) => o.id === id) ?? null;
}

/** A room's new props with what was set on it by hand kept as it was set,
    or, where the plans' is taken instead, the plans' and no longer marked:
    its height off the new read. */
function handKept(props: DesignObject["props"], room: DesignObject, usePlans: boolean, d: DesignDocument, floorId: string): DesignObject["props"] {
  const hand = handFields(room);
  if (!hand.length) return props;
  if (usePlans) {
    const read = hand.includes("ceilingMm") ? readHeightOf(d, floorId, String(props.name ?? "")) : null;
    return markHand({ ...props, ...(read ? { ceilingHeightM: read.m, heightFrom: read.from } : {}) }, [], hand);
  }
  const own: Record<KeptField, string[]> = { name: ["name"], ceilingMm: ["ceilingHeightM", "heightFrom"], roomAbove: ["roomAbove"], glazing: ["glazing"], condition: ["condition"] };
  const out = { ...props };
  for (const f of hand)
    for (const k of own[f]) {
      if (room.props[k] === undefined) delete out[k];
      else out[k] = room.props[k];
    }
  return out;
}

const replaceRoom = (d: DesignDocument, room: DesignObject): DesignDocument => ({ ...d, objects: d.objects.map((o) => (o.id === room.id ? room : o)) });

function pick(props: DesignObject["props"], keys: string[]): DesignObject["props"] {
  const out: DesignObject["props"] = {};
  for (const k of keys) if (props[k] !== undefined) out[k] = props[k];
  return out;
}
