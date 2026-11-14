import { designFromPlan, floorPagesOf, pageKey, type JobPlan, type JobPlanPage } from "@/lib/jobs/plans";
import { newId, type DesignDocument, type Floor, type PlanSheet } from "./document";
import { defaultFloorName, placeSheets, SHEET_GAP } from "./plans";
import type { PlanReading, SheetReading } from "./reading";

/* A DESIGN'S PLANS ARE THE JOB'S (Isaac, 14 November 2026: "you won't have
   two sets of plans by accident"). Edit plans on a design made from a job's
   plans opens the Plans dialog over the job's own plans: the ones ticked are
   the design's, each page on the floor it's given there. Saving brings the
   design into line with them, here: a page now on another floor moves there
   with what she read off it, a page taken out or a plan unticked leaves its
   floor, a page or plan newly in gets its floor, and a floor left with no
   plan and nothing drawn on it goes. Nothing drawn is ever moved or lost.

   `before` is the job's plans as the dialog opened on them, `after` as
   they were saved, so a page's move is how far its level changed: a design
   that put a second plan's ground floor one up keeps it one up. */

type At = { plan: JobPlan; page: JobPlanPage };

export function withJobPlans(
  doc: DesignDocument,
  before: readonly JobPlan[],
  after: readonly JobPlan[],
  ticked: readonly string[]
): { doc: DesignDocument; made: string[] } {
  /* a plan being read again has no floors to go by just now: the design
     keeps what it shows of it */
  const read = (p: JobPlan) => p.state === "read" || p.state === "check";
  const on = new Set(ticked.filter((id) => after.some((p) => p.id === id && read(p))));
  const pageOf = new Map<string, At>();
  for (const plan of after) if (read(plan)) for (const page of plan.pages) if (page.ref) pageOf.set(page.ref, { plan, page });
  const levelWas = new Map<string, number | null>();
  for (const plan of before) for (const p of plan.pages) levelWas.set(`${plan.id}:${p.n}`, p.kind === "floor" ? (p.level ?? 0) : null);
  const wanted = (ref: string): At | null => {
    const at = pageOf.get(ref);
    return at && on.has(at.plan.id) && at.page.kind === "floor" ? at : null;
  };

  const floors: Floor[] = doc.floors.map((f) => ({ ...f, plans: [...f.plans] }));
  const hadJobSheet = new Set<string>();
  const present = new Set<string>();
  const moves: { sheet: PlanSheet; level: number; from: string; at: At }[] = [];
  const gone = new Set<string>();
  for (const f of floors) {
    const keep: PlanSheet[] = [];
    for (const sheet of f.plans) {
      if (!pageOf.has(sheet.imageRef)) {
        keep.push(sheet);
        continue;
      }
      hadJobSheet.add(f.id);
      const w = wanted(sheet.imageRef);
      if (!w) {
        gone.add(sheet.id);
        continue;
      }
      present.add(sheet.imageRef);
      const was = levelWas.get(`${w.plan.id}:${w.page.n}`);
      const now = w.page.level ?? 0;
      const level = was == null ? now : f.level + (now - was);
      if (level === f.level) keep.push(sheet);
      else moves.push({ sheet, level, from: f.id, at: w });
    }
    f.plans = keep;
  }

  const made: string[] = [];
  const floorAt = (level: number, at: At): Floor => {
    const there = floors.find((f) => f.level === level);
    if (there) return there;
    const { page } = at;
    const scale = page.set && page.set.mmPerPx > 0 ? page.set.mmPerPx : page.mmPerPx;
    const floor: Floor = { id: newId("flr"), name: page.name || defaultFloorName(level), level, scaleMmPerUnit: scale ?? null, northDeg: null, northPos: null, plans: [] };
    floors.push(floor);
    made.push(floor.id);
    return floor;
  };

  /* what she read, by floor: a moved sheet takes its own with it */
  const readOf: Record<string, SheetReading[]> = {};
  for (const [id, sheets] of Object.entries(doc.reading?.floors ?? {})) readOf[id] = sheets.filter((s) => !gone.has(s.sheetId));
  let failed = (doc.reading?.failed ?? []).filter((f) => !gone.has(f.sheetId));
  const rightOf = (f: Floor) => f.plans.reduce((m, s) => Math.max(m, s.x + s.width), 0);

  for (const m of moves) {
    const to = floorAt(m.level, m.at);
    const sheet = to.plans.length ? { ...m.sheet, x: rightOf(to) + SHEET_GAP } : m.sheet;
    to.plans.push(sheet);
    const mine = (readOf[m.from] ?? []).filter((s) => s.sheetId === sheet.id);
    readOf[m.from] = (readOf[m.from] ?? []).filter((s) => s.sheetId !== sheet.id);
    if (mine.length) readOf[to.id] = [...(readOf[to.id] ?? []), ...mine];
    failed = failed.map((f) => (f.sheetId === sheet.id ? { ...f, floorId: to.id } : f));
  }

  /* a page or plan newly in: its sheet on its floor, her read of it with it */
  let gotReading = false;
  for (const plan of after) {
    if (!on.has(plan.id)) continue;
    for (const page of floorPagesOf(plan)) {
      if (present.has(page.ref!)) continue;
      const to = floorAt(page.level ?? 0, { plan, page });
      const [sheet] = placeSheets(to.plans, [
        {
          label: page.name || defaultFloorName(page.level ?? 0),
          ref: page.ref!,
          pageNumber: plan.sourceKind === "pdf" ? page.n : null,
          width: page.width,
          height: page.height,
          ...(page.trim ? { crop: { ...page.trim } } : {}),
        },
      ]);
      to.plans.push(sheet);
      present.add(page.ref!);
      const key = pageKey(page.n);
      const sheets = plan.reading?.floors[key] ?? [];
      if (sheets.length) {
        readOf[to.id] = [...(readOf[to.id] ?? []), ...sheets.map((s) => ({ ...s, sheetId: sheet.id }))];
        gotReading = true;
      }
      for (const f of plan.reading?.failed ?? []) if (f.floorId === key) failed.push({ ...f, floorId: to.id, sheetId: sheet.id });
    }
  }

  /* a floor the plans left, with nothing drawn on it, goes; one floor stays */
  const drawnOn = new Set(doc.objects.map((o) => o.floorId));
  let kept = floors.filter((f) => !(hadJobSheet.has(f.id) && f.plans.length === 0 && !drawnOn.has(f.id)));
  if (kept.length === 0 && floors.length) kept = [{ ...floors.sort((a, b) => a.level - b.level)[0], plans: [] }];
  kept.sort((a, b) => a.level - b.level);
  const ids = new Set(kept.map((f) => f.id));

  let reading: PlanReading | null | undefined = doc.reading;
  if (doc.reading || gotReading) {
    const first = after.find((p) => on.has(p.id) && p.reading)?.reading;
    const base = doc.reading ?? (first ? { at: first.at, model: first.model, floors: {}, failed: [] } : null);
    if (base) {
      const roof = base.roof
        ? {
            ...base.roof,
            levels: base.roof.levels.filter((l) => ids.has(l.floorId)),
            parts: base.roof.parts.filter((p) => ids.has(p.floorId)),
            raked: base.roof.raked.filter((r) => ids.has(r.floorId)),
          }
        : base.roof;
      reading = {
        ...base,
        floors: Object.fromEntries(Object.entries(readOf).filter(([id, s]) => ids.has(id) && s.length > 0)),
        failed: failed.filter((f) => ids.has(f.floorId)),
        ...(roof !== undefined ? { roof } : {}),
        ...(base.site !== undefined ? { site: base.site && ids.has(base.site.floorId) ? base.site : null } : {}),
      };
    }
  }

  /* the import record follows the plan the design keeps first */
  const lead = after.find((p) => p.id === doc.planImport?.jobPlanId && on.has(p.id)) ?? after.find((p) => on.has(p.id));
  const planImport = lead ? designFromPlan(lead).planImport : doc.planImport?.jobPlanId ? null : doc.planImport;

  return {
    doc: { ...doc, floors: kept, planImport, ...(reading !== undefined ? { reading } : {}) },
    made: made.filter((id) => ids.has(id)),
  };
}

/** The job's plans a design has on its floors, by the pictures it shows. */
export function plansInDesign(doc: Pick<DesignDocument, "floors" | "planImport">, plans: readonly JobPlan[]): string[] {
  const refs = new Set(doc.floors.flatMap((f) => f.plans.map((s) => s.imageRef)));
  return plans.filter((p) => p.id === doc.planImport?.jobPlanId || p.pages.some((pg) => pg.ref && refs.has(pg.ref))).map((p) => p.id);
}
