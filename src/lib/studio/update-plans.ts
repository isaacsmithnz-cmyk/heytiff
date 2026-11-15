import { floorPagesOf, pageCaption, pageKey, type JobPlan, type JobPlanPage } from "@/lib/jobs/plans";
import type { DesignDocument, DesignObject, PlanSheet } from "./document";
import { areaUnitsToM2, polygonArea } from "./geometry";
import { plansInDesign, withJobPlans } from "./job-plan-floors";
import { roomLoadKw, type RoomObj } from "./loads-room";
import { keepFound, readyFloor } from "./room-edit";
import { glassOf } from "./rooms-from-reading";
import type { ReadOpening, ReadSpace } from "./reading";

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

   Pure. The new set's pages are matched to the old one's by floor, in page
   order; its rooms to the old rooms by where they sit, then by name. */

/** A room she read, with its place in her read and its glass. */
type Space = { i: number; s: ReadSpace; glass: ReadOpening[] };

/** One page of the new set beside the page it takes the place of. */
type PagePair = { old: JobPlanPage | null; now: JobPlanPage };

export type NewerPlan = { plan: JobPlan; was: JobPlan | null };

/** A change offered to the design: a room's, ticked to take it. */
export type RoomOffer = { id: string; title: string; line: string };

export type PlanUpdate = NewerPlan & {
  /** what the plans changed, by page of the new set */
  pages: { n: number; title: string; lines: string[] }[];
  /** what it does to the design, each to be ticked */
  offers: RoomOffer[];
  /** what it does that isn't asked: a room gone from the plans, a floor new on them */
  said: { title: string; line: string }[];
};

const read = (p: JobPlan) => p.state === "read" || p.state === "check";
const drawingsOf = (plans: readonly JobPlan[]) => plans.filter((p) => p.kind !== "spec" && read(p) && floorPagesOf(p).length > 0);
const time = (iso: string) => Date.parse(iso) || 0;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The job's newest set of drawings read since the newest the design holds,
    and the set of the design's it takes the place of: the one sharing the
    most floors with it. Null when the design holds none of the job's plans,
    or nothing newer is on the job. */
export function newerPlan(doc: Pick<DesignDocument, "floors" | "planImport">, plans: readonly JobPlan[]): NewerPlan | null {
  const drawings = drawingsOf(plans);
  const mine = new Set(plansInDesign(doc, drawings));
  const held = drawings.filter((p) => mine.has(p.id));
  if (held.length === 0) return null;
  const passed = new Set(doc.planImport?.passed ?? []);
  const newest = Math.max(...held.map((p) => time(p.addedAt)));
  const plan = drawings
    .filter((p) => !mine.has(p.id) && !passed.has(p.id) && time(p.addedAt) > newest)
    .sort((a, b) => time(b.addedAt) - time(a.addedAt))[0];
  if (!plan) return null;
  const levels = new Set(floorPagesOf(plan).map((p) => p.level ?? 0));
  const was =
    held
      .map((p) => ({ p, shared: floorPagesOf(p).filter((pg) => levels.has(pg.level ?? 0)).length }))
      .filter((x) => x.shared > 0)
      .sort((a, b) => b.shared - a.shared || time(b.p.addedAt) - time(a.p.addedAt))[0]?.p ?? null;
  return { plan, was };
}

/** The new set's floor pages, each beside the old set's page on its floor, in page order. */
function pagePairs(was: JobPlan | null, plan: JobPlan): PagePair[] {
  const byLevel = (p: JobPlan | null) => {
    const out = new Map<number, JobPlanPage[]>();
    for (const pg of p ? floorPagesOf(p) : []) out.set(pg.level ?? 0, [...(out.get(pg.level ?? 0) ?? []), pg]);
    return out;
  };
  const olds = byLevel(was);
  return floorPagesOf(plan).map((now) => {
    const level = now.level ?? 0;
    const at = floorPagesOf(plan).filter((p) => (p.level ?? 0) === level).indexOf(now);
    return { old: olds.get(level)?.[at] ?? null, now };
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

/** What changed about one room, or null when it's as it was. `mm`: the old page's millimetres per pixel. */
function roomChange(m: Match, k: number, mm: number | null): { renamed: boolean; reshaped: boolean; windows: boolean; said: string } | null {
  const renamed = norm(m.old.s.name) !== norm(m.now.s.name);
  const a0 = polygonArea(m.old.s.outline);
  const a1 = polygonArea(m.now.s.outline) * k * k;
  const reshaped = m.fit < SAME_SHAPE || Math.abs(a1 - a0) > a0 * SAME_AREA;
  const before = facingsOf(m.old);
  const after = facingsOf(m.now);
  const gained = [...after].filter((f) => !before.has(f));
  const lost = [...before].filter((f) => !after.has(f));
  const windows = gained.length > 0 || lost.length > 0 || m.old.glass.length !== m.now.glass.length;
  if (!renamed && !reshaped && !windows) return null;
  const size = mm ? m2(areaUnitsToM2(a1, mm)) : null;
  const glass = [gained.length ? `with a window to the ${gained.join(" and ")}` : null, lost.length ? `no window to the ${lost.join(" and ")}` : null]
    .filter(Boolean)
    .join(" and ");
  const said = renamed
    ? `${m.old.s.name} is ${m.now.s.name} now${size ? `, ${size}` : ""}${glass ? ` ${glass}` : ""}`
    : reshaped
      ? `${m.now.s.name} is ${size ? `${size} now, was ${m2(areaUnitsToM2(a0, mm!))}` : "a new shape"}${glass ? `, ${glass}` : ""}`
      : `${m.now.s.name} has ${gained.length ? `a window to the ${gained.join(" and ")}` : lost.length ? `no window to the ${lost.join(" and ")}` : "different windows"} now`;
  return { renamed, reshaped, windows, said };
}

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
  const changes: { room: DesignObject; title: string; why: string }[] = [];

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
      lines.push(c.said);
      for (const room of drawn.get(p.old.i) ?? []) {
        const name = String(room.props.name ?? p.old.s.name);
        const title = c.renamed ? `${name} becomes ${p.now.s.name}` : `${name} takes the new plans`;
        const what = andWords([c.reshaped || c.renamed ? "outline" : null, c.windows ? "windows" : null]);
        changes.push({ room, title, why: `Its ${what || "outline"} off ${caption}` });
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
    if (lines.length) pages.push({ n: now.n, title: caption, lines });
  }

  /* each room's load before and after, off the design as it would be with every change taken */
  const after = updatePlans(doc, plans, up, all);
  const loadOf = (id: string) => {
    const o = after.objects.find((x) => x.id === id);
    return o ? kw(roomLoadKw(after, o as RoomObj)) : null;
  };
  const offers: RoomOffer[] = changes.map((c) => {
    const was = kw(roomLoadKw(doc, c.room as RoomObj));
    const is = loadOf(c.room.id);
    const load = was && is ? (was === is ? `Its load stays ${is}` : `Its load goes from ${was} to ${is}`) : null;
    return { id: c.room.id, title: c.title, line: [c.why, load].filter(Boolean).join(". ") };
  });
  for (const o of fresh) {
    const load = loadOf(o.roomId);
    offers.push({ id: o.id, title: o.title, line: load ? `${o.line}. Its load is ${load}` : o.line });
  }
  return { ...up, pages, offers, said };
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
  const swapped = withJobPlans(doc, drawings, drawings, on);
  let d: DesignDocument = { ...swapped.doc, planImport: swapped.doc.planImport ? { ...swapped.doc.planImport, ...(doc.planImport?.passed ? { passed: doc.planImport.passed } : {}) } : swapped.doc.planImport };

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
        const changed = !!roomChange(p, m.k, null);
        if (ticked.has(room.id) && changed) {
          const fresh = freshRoom(d, is.floorId, key);
          if (fresh) {
            const renamed = norm(p.old.s.name) !== norm(p.now.s.name);
            d = replaceRoom(d, {
              ...room,
              geometry: fresh.geometry,
              props: {
                ...room.props,
                ...pick(fresh.props, ["externalWalls", "hasExternalWalls", "glazing", "orientation", "shape", "roomAbove"]),
                ...(renamed ? { name: p.now.s.name } : {}),
                readKey: key,
                ...(joined ? { joinedKeys: joined } : {}),
              },
            });
            continue;
          }
        }
        d = replaceRoom(d, { ...room, props: { ...room.props, readKey: key, ...(joined ? { joinedKeys: joined } : {}) } });
      }
    }
    /* rooms new on the plans, ticked: marked as Tiff found them */
    const want = m.added.filter((a) => ticked.has(newKey(now.n, a.i)));
    if (want.length) d = keepFound(d, is.floorId, want.map((a) => keyOf(a.i)), Object.fromEntries(want.map((a) => [keyOf(a.i), newRoomId(up.plan, now.n, a.i)])));
  }
  /* a floor only the new set has opens as a new design's floor does */
  return swapped.made.reduce((x, id) => readyFloor(x, id), d);
}

/** A room as keepFound would make it from her read, without keeping it. */
function freshRoom(d: DesignDocument, floorId: string, key: string): DesignObject | null {
  const id = "__update_plans__";
  const made = keepFound(d, floorId, [key], { [key]: id });
  return made.objects.find((o) => o.id === id) ?? null;
}

const replaceRoom = (d: DesignDocument, room: DesignObject): DesignDocument => ({ ...d, objects: d.objects.map((o) => (o.id === room.id ? room : o)) });

function pick(props: DesignObject["props"], keys: string[]): DesignObject["props"] {
  const out: DesignObject["props"] = {};
  for (const k of keys) if (props[k] !== undefined) out[k] = props[k];
  return out;
}
