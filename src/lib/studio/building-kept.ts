import { pageKey, type JobPlan, type JobPlanPage } from "@/lib/jobs/plans";
import type { DesignDocument, DesignObject } from "./document";
import type { ReadSpace, SpaceSet, SpaceValues } from "./reading";

/* A ZONE'S FIXES ARE THE BUILDING'S (join 2, "the building", second half:
   Isaac, 27 November 2026, "Go head" to https://claude.ai/artifact/6xDKm8xV6f2PGZJKVo6M46,
   boards 5 and 6). A height set in the Studio stayed in that design: the
   job's plans didn't have it, a second design didn't, and the next issue of
   the plans could write over it. Now what somebody sets by hand on a zone
   drawn from Tiff's read goes onto the room it was read off, on the job's
   plan (reading.ts ReadSpace.set): its name, its height, what's above it,
   its glazing and its insulation. Every other design of the job takes it
   as it opens, a design made from the plans starts with it, the quote reads
   it, and new plans never write over it unasked.

   A zone remembers which of its values a person set (`props.handSet`), so
   a value Tiff read is never mistaken for one somebody chose, and a
   person's edit always wins over the building's.

   Pure. The plan is written by plans-server.ts keepSpaceSets. */

export const KEPT_FIELDS = ["name", "ceilingMm", "roomAbove", "glazing", "condition"] as const;
export type KeptField = (typeof KEPT_FIELDS)[number];
const isField = (v: unknown): v is KeptField => typeof v === "string" && (KEPT_FIELDS as readonly string[]).includes(v);

/** The values of a zone a person set by hand. */
export const handFields = (z: Pick<DesignObject, "props">): KeptField[] => (Array.isArray(z.props.handSet) ? z.props.handSet.filter(isField) : []);

/** A zone's props with these fields marked as set by hand, or no longer. */
export function markHand(props: DesignObject["props"], add: readonly KeptField[], drop: readonly KeptField[] = []): DesignObject["props"] {
  const was = Array.isArray(props.handSet) ? props.handSet.filter(isField) : [];
  const next = [...new Set([...was.filter((f) => !drop.includes(f)), ...add])];
  const { handSet: _old, ...rest } = props;
  void _old;
  return next.length ? { ...rest, handSet: next } : rest;
}

/** A zone's own value for each field. */
export function valuesOf(z: Pick<DesignObject, "props">): SpaceValues {
  const p = z.props;
  return {
    ...(typeof p.name === "string" ? { name: p.name } : {}),
    ...(typeof p.ceilingHeightM === "number" ? { ceilingMm: Math.round(p.ceilingHeightM * 1000) } : {}),
    roomAbove: p.roomAbove === true,
    ...(typeof p.glazing === "string" ? { glazing: p.glazing as SpaceValues["glazing"] } : {}),
    ...(typeof p.condition === "string" ? { condition: p.condition as SpaceValues["condition"] } : {}),
  };
}

/** A zone's props given these values. */
export function withValues(props: DesignObject["props"], v: SpaceValues, from: string): DesignObject["props"] {
  return {
    ...props,
    ...(v.name !== undefined ? { name: v.name } : {}),
    ...(v.ceilingMm !== undefined ? { ceilingHeightM: v.ceilingMm / 1000, heightFrom: from } : {}),
    ...(v.roomAbove !== undefined ? { roomAbove: v.roomAbove } : {}),
    ...(v.glazing !== undefined ? { glazing: v.glazing } : {}),
    ...(v.condition !== undefined ? { condition: v.condition } : {}),
  };
}

/** Where on the job's plans a zone was read: its plan, page and room. */
export type Place = { planId: string; n: number; i: number };

/** The page of a plan a design's sheet shows: its picture, else, for the
    plan the design was made from, the page it placed on that sheet. */
function pageOfSheet(doc: Pick<DesignDocument, "planImport">, plan: JobPlan, ref: string): JobPlanPage | null {
  const by = plan.pages.find((p) => p.ref === ref);
  if (by) return by;
  if (doc.planImport?.jobPlanId !== plan.id) return null;
  const at = Object.entries(doc.planImport.placed).find(([, r]) => r === ref);
  return at ? (plan.pages.find((p) => p.n === Number(at[0]) + 1) ?? null) : null;
}

/** Where a zone drawn from Tiff's read was read, on the job's plans; null for one drawn by hand. */
export function placeOf(doc: Pick<DesignDocument, "floors" | "planImport">, plans: readonly JobPlan[], z: Pick<DesignObject, "props">): Place | null {
  const key = typeof z.props.readKey === "string" ? z.props.readKey : null;
  const cut = key ? key.lastIndexOf(":") : -1;
  if (!key || cut < 0) return null;
  const sheetId = key.slice(0, cut);
  const i = Number(key.slice(cut + 1));
  if (!Number.isInteger(i)) return null;
  const sheet = doc.floors.flatMap((f) => f.plans).find((s) => s.id === sheetId);
  if (!sheet) return null;
  for (const plan of plans) {
    const page = pageOfSheet(doc, plan, sheet.imageRef);
    if (page) return { planId: plan.id, n: page.n, i };
  }
  return null;
}

/** The room a place names, on the job's plans. */
export const spaceAt = (plans: readonly JobPlan[], at: Place): ReadSpace | null =>
  plans.find((p) => p.id === at.planId)?.reading?.floors[pageKey(at.n)]?.[0]?.spaces[at.i] ?? null;

/** One room's change on the job's plan: its values to keep, and the ones to let go. */
export type KeptWrite = Place & { zoneId: string; values: SpaceValues; clear: KeptField[] };

const same = (a: unknown, b: unknown) => a === b;

/** What a design's hand changed since `base` (the design as it opened, or
    as it was last kept) that the job's plans don't have yet: a value set by
    hand that differs from the room's kept one, and a value no longer set by
    hand that the room still keeps from this design. */
export function keptChanges(base: Pick<DesignDocument, "objects">, doc: Pick<DesignDocument, "id" | "floors" | "planImport" | "objects">, plans: readonly JobPlan[]): KeptWrite[] {
  const before = new Map(base.objects.map((o) => [o.id, o]));
  const out: KeptWrite[] = [];
  for (const z of doc.objects) {
    if (z.type !== "room") continue;
    const at = placeOf(doc, plans, z);
    if (!at) continue;
    const was = before.get(z.id);
    const hand = handFields(z);
    const wasHand = was ? handFields(was) : [];
    const now = valuesOf(z);
    const then = was ? valuesOf(was) : {};
    const set = spaceAt(plans, at)?.set;
    const values: SpaceValues = {};
    const clear: KeptField[] = [];
    for (const f of KEPT_FIELDS) {
      const moved = !was || !same(now[f], then[f]) || hand.includes(f) !== wasHand.includes(f) || was.props.readKey !== z.props.readKey;
      if (!moved) continue;
      if (hand.includes(f) && now[f] !== undefined) {
        if (!same(set?.[f], now[f])) (values as Record<string, unknown>)[f] = now[f];
      } else if (set && set[f] !== undefined && set.design === doc.id) clear.push(f);
    }
    if (Object.keys(values).length || clear.length) out.push({ ...at, zoneId: z.id, values, clear });
  }
  return out;
}

/** A room's kept set with a write onto it; null when nothing is kept any more. */
export function setWith(was: SpaceSet | undefined, w: Pick<KeptWrite, "values" | "clear">, meta: { by: string | null; design: string; at: string }): SpaceSet | null {
  const kept: Record<string, unknown> = {};
  for (const f of KEPT_FIELDS) if (was?.[f] !== undefined && !w.clear.includes(f)) kept[f] = was[f];
  Object.assign(kept, w.values);
  if (Object.keys(kept).length === 0) return null;
  return { ...(kept as SpaceValues), ...meta };
}

/** The job's plans with writes made, as the server makes them: for the
    Studio's own copy, so what it compares against is what's kept. */
export function plansWith<P extends JobPlan>(plans: readonly P[], writes: readonly KeptWrite[], meta: { by: string | null; design: string; at: string }): P[] {
  return plans.map((plan) => {
    const mine = writes.filter((w) => w.planId === plan.id);
    if (!mine.length || !plan.reading) return plan;
    const floors = { ...plan.reading.floors };
    for (const w of mine) {
      const key = pageKey(w.n);
      const sheets = floors[key];
      const space = sheets?.[0]?.spaces[w.i];
      if (!space) continue;
      const set = setWith(space.set, w, meta);
      const { set: _old, ...rest } = space;
      void _old;
      const spaces = sheets[0].spaces.map((s, i) => (i === w.i ? (set ? { ...rest, set } : rest) : s));
      floors[key] = [{ ...sheets[0], spaces }, ...sheets.slice(1)];
    }
    return { ...plan, reading: { ...plan.reading, floors } };
  });
}

/** What the building has that a design's zones don't: a room's value kept
    from another design, where this design's zone wasn't set by hand. */
export type KeptTake = { zoneId: string; values: SpaceValues };
export function buildingTakes(doc: Pick<DesignDocument, "id" | "floors" | "planImport" | "objects">, plans: readonly JobPlan[]): KeptTake[] {
  const out: KeptTake[] = [];
  for (const z of doc.objects) {
    if (z.type !== "room") continue;
    const at = placeOf(doc, plans, z);
    const set = at ? spaceAt(plans, at)?.set : null;
    if (!set || set.design === doc.id) continue;
    const hand = handFields(z);
    const now = valuesOf(z);
    const values: SpaceValues = {};
    for (const f of KEPT_FIELDS) if (set[f] !== undefined && !hand.includes(f) && !same(set[f], now[f])) (values as Record<string, unknown>)[f] = set[f];
    if (Object.keys(values).length) out.push({ zoneId: z.id, values });
  }
  return out;
}

/** The design with the building's values on its zones, each marked as set,
    so new plans keep it as the building has it. */
export function takeOnto(doc: DesignDocument, takes: readonly KeptTake[]): DesignDocument {
  if (!takes.length) return doc;
  const by = new Map(takes.map((t) => [t.zoneId, t.values]));
  return {
    ...doc,
    objects: doc.objects.map((o) => {
      const v = by.get(o.id);
      if (!v) return o;
      const fields = KEPT_FIELDS.filter((f) => v[f] !== undefined);
      return { ...o, props: markHand(withValues(o.props, v, "the building"), fields) };
    }),
  };
}

const GLAZING_WORD: Record<string, string> = { low: "low", moderate: "moderate", high: "high" };
const CONDITION_WORD: Record<string, string> = { well_insulated: "good", standard: "standard", poor: "poor" };

/** A change in a few words: "Grand Hall height 6.4 m". `name` is the zone's
    name as it was, so a rename reads "Lounge renamed Family". */
export function keptWords(name: string, v: SpaceValues): string[] {
  const out: string[] = [];
  if (v.name !== undefined && v.name !== name) out.push(`${name} renamed ${v.name}`);
  const who = v.name ?? name;
  if (v.ceilingMm !== undefined) out.push(`${who} height ${(v.ceilingMm / 1000).toFixed(1)} m`);
  if (v.roomAbove !== undefined) out.push(`${who} ${v.roomAbove ? "a floor above" : "the roof above"}`);
  if (v.glazing !== undefined) out.push(`${who} glazing ${GLAZING_WORD[v.glazing] ?? v.glazing}`);
  if (v.condition !== undefined) out.push(`${who} insulation ${CONDITION_WORD[v.condition] ?? v.condition}`);
  return out;
}

/** A row of Kept as you set them: what was set, and what the new plans
    say instead. "Grand Hall, height 6.4 m" / "Rev C says 3.2 m". */
export function keptRow(name: string, mine: SpaceValues, theirs: SpaceValues, fields: readonly KeptField[], plan: string): { title: string; line: string } {
  const m = (mm: number) => `${(mm / 1000).toFixed(1)} m`;
  const above = (v: boolean | undefined) => (v ? "a floor above" : "the roof above");
  const set: string[] = [];
  const say: string[] = [];
  for (const f of fields) {
    if (f === "name") {
      set.push("the name you gave it");
      say.push(`calls it ${theirs.name}`);
    } else if (f === "ceilingMm" && mine.ceilingMm !== undefined && theirs.ceilingMm !== undefined) {
      set.push(`height ${m(mine.ceilingMm)}`);
      say.push(`says ${m(theirs.ceilingMm)}`);
    } else if (f === "roomAbove") {
      set.push(above(mine.roomAbove));
      say.push(`has ${above(theirs.roomAbove)}`);
    } else if (f === "glazing") {
      set.push(`glazing ${GLAZING_WORD[mine.glazing ?? ""] ?? mine.glazing}`);
      say.push(`says glazing ${GLAZING_WORD[theirs.glazing ?? ""] ?? theirs.glazing}`);
    } else if (f === "condition") {
      set.push(`insulation ${CONDITION_WORD[mine.condition ?? ""] ?? mine.condition}`);
      say.push(`says insulation ${CONDITION_WORD[theirs.condition ?? ""] ?? theirs.condition}`);
    }
  }
  return { title: `${name}, ${set.join(", ")}`, line: `You set it in the design. ${plan} ${say.join(", ")}` };
}
