import { OUTLET_KINDS, roundArea, type Ducts, type FlexDuct, type FlexRow, type OutletKind, type OutletRow, type ReturnAir, type RigidRow, type SupplyOutlets, type Zoning } from "./airflow-build";

/* THE DUCTED AIRFLOW GUIDE, CHECKED AGAINST A JOB (data/guides/airflow@<v>/,
   built by airflow-build.ts). Isaac, 2026-10-15: "So she has something to
   compare it with… Anyone using it should get the same recommendations,
   which we can change during the conversation."

   Every check says the guide's figure and why, in words a person reads at a
   glance ("143 L/s through Ø250 flex runs at 2.9 m/s: within the 169 L/s
   the guide recommends"). A check compares; it never decides a size: the
   brief, a plan or the person's word overrides the guide. Pure. */

export { OUTLET_KINDS, type OutletKind };

export type GuideMeta = { name: string; version: string; built: string; scope: string; method: string; recommendation: string };
export type AirflowGuide = { meta: GuideMeta; flex: FlexDuct; outlets: SupplyOutlets; ret: ReturnAir; ducts: Ducts; zoning: Zoning };

/** Within what the guide recommends; over it but within its most; over even that. */
export type Fit = "within" | "over" | "over_most";

/* ── words ── */

const lps = (x: number) => `${Math.round(x)} L/s`;
const ms = (x: number) => `${(Math.round(x * 10) / 10).toFixed(1)} m/s`;
const pa = (x: number) => `${x >= 10 ? Math.round(x) : Math.round(x * 10) / 10} Pa`;
const m2 = (x: number) => `${(Math.round(x * 100) / 100).toFixed(2)} m²`;
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;

export function fitOf(value: number, recommended: number, most: number): Fit {
  if (value <= recommended) return "within";
  return value <= most ? "over" : "over_most";
}

function fitWords(fit: Fit, recommended: string, most: string): string {
  if (fit === "within") return `within the ${recommended} the guide recommends`;
  if (fit === "over") return `over the ${recommended} the guide recommends, within its most of ${most}`;
  return `over the most the guide gives, ${most}`;
}

const KIND_WORDS: Record<OutletKind, string> = {
  round_ceiling_diffuser: "round ceiling diffuser",
  square_ceiling_diffuser: "square ceiling diffuser",
  floor_grille: "floor grille",
  wall_register: "wall register",
  linear_slot: "linear slot",
};
export const outletWords = (kind: OutletKind, size: string) => (kind === "linear_slot" ? `${size} ${KIND_WORDS[kind]}` : `${KIND_WORDS[kind]} ${size}`);

/* ── flexible and rigid duct ── */

/** The smallest flex whose recommendation covers an airflow; null past the biggest. */
export function flexFor(g: AirflowGuide, airflowLs: number): FlexRow | null {
  return g.flex.rows.find((r) => r.recommended_ls >= airflowLs) ?? null;
}

export type DuctCheck = { dia_mm: number; ls: number; velocity_ms: number; fit: Fit; recommended_ls: number; most_ls: number; smallest_mm: number | null; reason: string };

/** An airflow through one flex run of a diameter, against the guide; null
    when the guide has no row for the size. */
export function flexCheck(g: AirflowGuide, diaMm: number, airflowLs: number): DuctCheck | null {
  const row = g.flex.rows.find((r) => r.dia_mm === diaMm);
  if (!row) return null;
  const v = airflowLs / 1000 / roundArea(diaMm);
  const fit = fitOf(airflowLs, row.recommended_ls, row.most_ls);
  const smallest = flexFor(g, airflowLs);
  const then =
    fit === "within"
      ? ""
      : smallest
        ? `; Ø${smallest.dia_mm} carries it at ${ms(airflowLs / 1000 / roundArea(smallest.dia_mm))}`
        : `; it's more than one flex run should carry: split it`;
  return {
    dia_mm: diaMm,
    ls: Math.round(airflowLs),
    velocity_ms: r2(v),
    fit,
    recommended_ls: row.recommended_ls,
    most_ls: row.most_ls,
    smallest_mm: smallest?.dia_mm ?? null,
    reason: `${lps(airflowLs)} through Ø${diaMm} flex runs at ${ms(v)}: ${fitWords(fit, lps(row.recommended_ls), lps(row.most_ls))}${then}.`,
  };
}

/** The smallest duct of a kind for an airflow, and the velocity it runs at. */
export function ductSizeFor(g: AirflowGuide, airflowLs: number, kind: "flex" | "rigid"): { kind: "flex" | "rigid"; dia_mm: number; recommended_ls: number; velocity_ms: number; reason: string } | null {
  const rows: (FlexRow | RigidRow)[] = kind === "flex" ? g.flex.rows : g.ducts.rigid_round_ls.rows;
  const row = rows.find((r) => r.recommended_ls >= airflowLs);
  if (!row) return null;
  const v = airflowLs / 1000 / roundArea(row.dia_mm);
  return {
    kind,
    dia_mm: row.dia_mm,
    recommended_ls: row.recommended_ls,
    velocity_ms: r2(v),
    reason: `${lps(airflowLs)} takes Ø${row.dia_mm} ${kind === "flex" ? "flex" : "rigid duct"} at ${ms(v)}, the smallest the guide recommends for it (${lps(row.recommended_ls)}).`,
  };
}

/** A flex run's loss, Pa/m fully stretched, at its flow: off the guide's
    1 Pa/m line for the size and how loss grows with flow. Null when the
    guide has no line for the size. */
export function flexPaPerM(g: AirflowGuide, diaMm: number, airflowLs: number): number | null {
  const at1 = g.flex.rows.find((r) => r.dia_mm === diaMm)?.ls_at_1pa_m;
  if (!at1) return null;
  return g.flex.friction_pa_m * (airflowLs / at1) ** (1 / g.flex.loss_exponent.value);
}

/* ── supply outlets ── */

/** The size as the guide names it: "250", "300x300", "round neck 250",
    "300x100" (the long side first), "2-slot". Null when it can't tell. */
export function outletSizeOf(g: AirflowGuide, kind: OutletKind, raw: string, slots?: number | null): string | null {
  const nums = (raw.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  const has = (size: string) => g.outlets.rows.some((r) => r.kind === kind && r.size === size);
  if (kind === "linear_slot") {
    const n = slots ?? (/slot/i.test(raw) ? nums[0] : null);
    return n ? `${n}-slot` : null;
  }
  if (kind === "round_ceiling_diffuser") return nums[0] != null ? String(nums[0]) : null;
  if (nums.length >= 2) {
    const [a, b] = [Math.max(nums[0]!, nums[1]!), Math.min(nums[0]!, nums[1]!)];
    return `${a}x${b}`;
  }
  if (nums.length === 1 && kind === "square_ceiling_diffuser") {
    const neck = `round neck ${nums[0]}`;
    if (/round|ø|dia|spigot|neck/i.test(raw) || has(neck)) return neck;
    return `${nums[0]}x${nums[0]}`;
  }
  return null;
}

export type OutletCheck = { kind: OutletKind; size: string; ls: number; fit: Fit | null; recommended_ls: number | null; most_ls: number | null; n: number | null; reason: string; fits_it: string | null };

/** One outlet carrying an airflow, against the guide. A linear slot is held
    a metre a slot, so its length and slots are needed. */
export function outletCheck(g: AirflowGuide, o: { kind: OutletKind; size: string; ls: number; length_m?: number | null; slots?: number | null }): OutletCheck {
  const size = outletSizeOf(g, o.kind, o.size, o.slots) ?? o.size;
  const row = g.outlets.rows.find((r) => r.kind === o.kind && r.size === size);
  const name = outletWords(o.kind, size);
  const sizes = g.outlets.rows.filter((r) => r.kind === o.kind);
  if (!row) return { kind: o.kind, size, ls: Math.round(o.ls), fit: null, recommended_ls: null, most_ls: null, n: null, fits_it: null, reason: `The guide has no ${name}: its ${KIND_WORDS[o.kind]}s are ${sizes.map((r) => r.size).join(", ")}.` };
  if (o.kind === "linear_slot") {
    const len = o.length_m ?? null;
    if (!len || len <= 0) return { kind: o.kind, size, ls: Math.round(o.ls), fit: null, recommended_ls: row.recommended_ls, most_ls: row.most_ls, n: row.at_nc25.n, fits_it: null, reason: `A ${name} is held a metre a slot (${lps(row.recommended_ls)}): its length is needed.` };
    const each = o.ls / (len * (row.slots ?? 1));
    const fit = fitOf(each, row.recommended_ls, row.most_ls);
    return {
      kind: o.kind,
      size,
      ls: Math.round(o.ls),
      fit,
      recommended_ls: row.recommended_ls,
      most_ls: row.most_ls,
      n: row.at_nc25.n,
      fits_it: null,
      reason: `${lps(o.ls)} through ${len} m of ${name} is ${lps(each)} a metre a slot: ${fitWords(fit, `${lps(row.recommended_ls)} a metre a slot (about NC/NR 25, ${row.at_nc25.n} makers)`, `${lps(row.most_ls)} (NC/NR 30)`)}.`,
    };
  }
  const fit = fitOf(o.ls, row.recommended_ls, row.most_ls);
  const bigger = fit === "within" ? null : (sizes.find((r) => r.recommended_ls >= o.ls && (o.kind !== "square_ceiling_diffuser" || r.size.startsWith("round neck") === size.startsWith("round neck"))) ?? null);
  const neck = row.neck_velocity_ms != null && row.size_mm?.length === 1 ? `, its neck at ${ms(o.ls / 1000 / roundArea(row.size_mm[0]!))}` : "";
  return {
    kind: o.kind,
    size,
    ls: Math.round(o.ls),
    fit,
    recommended_ls: row.recommended_ls,
    most_ls: row.most_ls,
    n: row.at_nc25.n,
    fits_it: bigger?.size ?? null,
    reason: `${lps(o.ls)} through a ${name}${neck}: ${fitWords(fit, `${lps(row.recommended_ls)} (about NC/NR 25, ${row.at_nc25.n} makers)`, `${lps(row.most_ls)} (NC/NR 30)`)}${bigger ? `; a ${bigger.size} takes it` : fit === "within" ? "" : `; no ${KIND_WORDS[o.kind]} in the guide takes it alone: another outlet`}.`,
  };
}

/* ── the return ── */

export type ReturnCheck = { ls: number; filtered: boolean; velocity_ms: number; face_needed_m2: number; fit: Fit | null; size: string | null; carries_ls: number | null; smallest_size: string | null; reason: string };

/** The return grille for an airflow: the face it needs at the guide's
    velocity, filtered or not, and a size checked against it. */
export function returnCheck(g: AirflowGuide, o: { ls: number; filtered: boolean; pleated?: boolean; w_mm?: number | null; h_mm?: number | null; count?: number | null }): ReturnCheck {
  const v = g.ret.grille_velocity_ms;
  const count = Math.max(1, Math.round(o.count ?? 1));
  const each = o.ls / count;
  const kind = o.pleated ? "a pleated filter grille" : o.filtered ? "a filter grille" : "an open eggcrate";
  const vel = o.pleated ? v.pleated_high_merv_gross.value : o.filtered ? v.filtered_gross.value : v.no_filter_gross_eggcrate.value;
  const most = o.pleated ? v.pleated_high_merv_gross.high : o.filtered ? v.filtered_gross.most : v.no_filter_gross_eggcrate.most;
  const col = o.pleated ? "pleated_ls" : o.filtered ? "filtered_ls" : "no_filter_ls";
  const face = each / 1000 / vel;
  const smallest = g.ret.grille_ls_by_size.rows.find((r) => r[col] >= each) ?? null;
  const per = count > 1 ? ` each of ${count}` : "";
  const needs = `${lps(each)}${per} needs ${m2(face)} of face as ${kind} at ${ms(vel)}`;
  if (!o.w_mm || !o.h_mm) {
    return { ls: Math.round(o.ls), filtered: o.filtered, velocity_ms: vel, face_needed_m2: r2(face), fit: null, size: null, carries_ls: null, smallest_size: smallest?.size ?? null, reason: `${needs}${smallest ? `: a ${smallest.size} or bigger` : ": more than the biggest grille the guide names, so more than one"}.` };
  }
  const area = (o.w_mm / 1000) * (o.h_mm / 1000);
  const carries = area * vel * 1000;
  const fit = fitOf(each, carries, area * most * 1000);
  const size = `${o.w_mm}x${o.h_mm}`;
  return {
    ls: Math.round(o.ls),
    filtered: o.filtered,
    velocity_ms: vel,
    face_needed_m2: r2(face),
    fit,
    size,
    carries_ls: Math.round(carries),
    smallest_size: smallest?.size ?? null,
    reason: `A ${size} ${o.pleated ? "pleated filter grille" : o.filtered ? "filter grille" : "eggcrate"} carries ${lps(carries)} at ${ms(vel)} on its face; ${needs}: ${fit === "within" ? "within it" : fit === "over" ? `over it, within the guide's most (${ms(most)}, ${lps(area * most * 1000)})` : `over even the guide's most (${ms(most)}, ${lps(area * most * 1000)})`}${fit !== "within" && smallest ? `; a ${smallest.size} takes it` : ""}.`,
  };
}

/** The return duct, each of `count`, against the guide's return velocities. */
export function returnDuctCheck(g: AirflowGuide, o: { ls: number; dia_mm: number; count?: number | null }): DuctCheck {
  const count = Math.max(1, Math.round(o.count ?? 1));
  const each = o.ls / count;
  const a = roundArea(o.dia_mm);
  const design = g.ret.return_duct.design_ms.value * a * 1000;
  const most = g.ret.return_duct.most_ms.value * a * 1000;
  const fit = fitOf(each, design, most);
  const v = each / 1000 / a;
  const smallest = g.ret.return_duct.by_dia.rows.find((r) => r.design_ls >= each)?.dia_mm ?? null;
  return {
    dia_mm: o.dia_mm,
    ls: Math.round(each),
    velocity_ms: r2(v),
    fit,
    recommended_ls: Math.round(design),
    most_ls: Math.round(most),
    smallest_mm: smallest,
    reason: `${lps(each)}${count > 1 ? ` in each of ${count}` : ""} Ø${o.dia_mm} return ducts runs at ${ms(v)}: ${fitWords(fit, `${lps(design)} (${ms(g.ret.return_duct.design_ms.value)})`, `${lps(most)} (${ms(g.ret.return_duct.most_ms.value)})`)}.`,
  };
}

/* ── zoning ── */

export type ZoneIn = { name: string; stays_open?: boolean; outlets: { kind: OutletKind; size: string; count: number }[] };
export type ZoningCheck = { least_ls: number; least_from: string; worst: { zones: string[]; outlets: number; carries_ls: number | null; carries_most_ls: number | null }; fit: "enough" | "louder" | "short" | "unknown"; reason: string; notes: string[] };

/** Whether the zones that can be left running carry the unit's least
    airflow: its own low fan if known, else the guide's share of its rated. */
export function zoningCheck(g: AirflowGuide, unit: { airflow_ls: number; low_airflow_ls?: number | null }, zones: ZoneIn[]): ZoningCheck {
  const z = g.zoning;
  const pct = z.min_fan_airflow_pct.value;
  const least = unit.low_airflow_ls ?? (unit.airflow_ls * pct) / 100;
  const leastFrom = unit.low_airflow_ls != null ? `its own low fan, ${lps(least)}` : `${pct}% of its ${lps(unit.airflow_ls)}, the guide's least for an inverter fan (${z.min_fan_airflow_pct.n} makers; its own low fan isn't known)`;
  const carry = (zs: ZoneIn[]) => {
    let rec = 0;
    let most = 0;
    let known = true;
    for (const o of zs.flatMap((x) => x.outlets)) {
      const size = outletSizeOf(g, o.kind, o.size);
      const row: OutletRow | undefined = g.outlets.rows.find((r) => r.kind === o.kind && r.size === size);
      if (!row || o.kind === "linear_slot") known = false;
      else {
        rec += row.recommended_ls * o.count;
        most += row.most_ls * o.count;
      }
    }
    return known ? { rec, most } : null;
  };
  const outletsOf = (zs: ZoneIn[]) => zs.reduce((n, x) => n + x.outlets.reduce((m, o) => m + o.count, 0), 0);
  const open = zones.filter((x) => x.stays_open);
  const others = zones.filter((x) => !x.stays_open);
  const smallest = [...others].sort((a, b) => (carry([a])?.rec ?? outletsOf([a])) - (carry([b])?.rec ?? outletsOf([b])) || outletsOf([a]) - outletsOf([b]))[0];
  const worst = smallest ? [...open, smallest] : open;
  const c = carry(worst);
  const n = outletsOf(worst);
  const names = worst.map((x) => x.name);
  const notes: string[] = [];

  const minOut = z.min_open_outlets.value;
  if (n < minOut) notes.push(`${names.join(" with ")} ${names.length === 1 ? "has" : "have"} ${n} outlet${n === 1 ? "" : "s"} open: the guide's least is ${minOut} at once.`);
  const cz = z.constant_zones;
  if (open.length > cz.most) notes.push(`${open.length} zones stay open: the guide's most is ${cz.most}.`);
  if (open.length > zones.length * cz.most_share_of_zones) notes.push(`${open.length} of ${zones.length} zones stay open: no more than half, the guide says.`);
  const bed = open.filter((x) => /\bbed|master|ensuite/i.test(x.name));
  if (bed.length) notes.push(`${bed.map((x) => x.name).join(" and ")} ${bed.length === 1 ? "stays" : "stay"} open: the guide says a zone left open is never a bedroom.`);
  const total = outletsOf(zones);
  if (smallest && total > 0) {
    const share = (outletsOf([smallest]) / total) * 100;
    if (share < z.smallest_zone_pct.value) notes.push(`${smallest.name} is ${Math.round(share)}% of the outlets: the guide puts no zone under about ${z.smallest_zone_pct.value}% of the airflow.`);
  }

  const which = names.length ? (open.length && smallest ? `${smallest.name} with ${open.map((x) => x.name).join(" and ")} left open` : open.length ? `${names.join(" and ")}, left open` : `${smallest!.name} alone`) : "no zone";
  if (!c) return { least_ls: Math.round(least), least_from: leastFrom, worst: { zones: names, outlets: n, carries_ls: null, carries_most_ls: null }, fit: "unknown", notes, reason: `The unit's least airflow is ${leastFrom}. The guide has no figure for some outlets in ${which}, so what they carry isn't known.` };
  const fit = c.rec >= least ? "enough" : c.most >= least ? "louder" : "short";
  const said =
    fit === "enough"
      ? "enough"
      : fit === "louder"
        ? `enough only louder, at about NC/NR 30 (${lps(c.most)})`
        : `short: it needs a common zone that's always open, or spill zones that open as others close, and a bypass last`;
  return {
    least_ls: Math.round(least),
    least_from: leastFrom,
    worst: { zones: names, outlets: n, carries_ls: Math.round(c.rec), carries_most_ls: Math.round(c.most) },
    fit,
    notes,
    reason: `The unit's least airflow is ${leastFrom}. The least that can run is ${which}: ${n === 1 ? "its 1 outlet carries" : `${n} outlets carry`} ${lps(c.rec)} at the guide's recommendation, ${said}.`,
  };
}

/* ── the static ── */

export type StaticIn = {
  static_pa: number;
  filtered: boolean;
  zoned: boolean;
  balancing?: boolean;
  /** the index run: the longest from the unit to an outlet */
  rigid_m?: number | null;
  flex_m?: number | null;
  flex_mm?: number | null;
  flex_ls?: number | null;
  bends?: number | null;
};
export type StaticCheck = { static_pa: number; parts_pa: { what: string; pa: number }[]; for_duct_pa: number; run_pa: number | null; left_pa: number | null; fit: "fits" | "over" | "unknown"; reason: string };

/** The unit's rated static less what the filter, an outlet, the return
    grille and the dampers take, against the index run's friction; flex
    counted at the guide's length factor. */
export function staticBudget(g: AirflowGuide, s: StaticIn): StaticCheck {
  const d = g.ducts.drops_pa;
  const parts = [
    ...(s.filtered ? [{ what: "a clean filter", pa: d.filter_clean.value }] : []),
    { what: "the return grille", pa: d.eggcrate_return_grille.value },
    { what: "an outlet and its box", pa: d.diffuser_and_boot.value },
    ...(s.zoned ? [{ what: "an open zone damper", pa: d.zone_damper_open.value }] : []),
    ...(s.balancing ? [{ what: "a balancing damper", pa: d.balancing_damper_open.value }] : []),
  ];
  const taken = parts.reduce((n, p) => n + p.pa, 0);
  const forDuct = s.static_pa - taken;
  const partsWords = `${parts.map((p) => `${p.what} ${pa(p.pa)}`).join(", ")}`;
  const head = `Of the unit's ${pa(s.static_pa)}, ${partsWords} take ${pa(taken)}, leaving ${pa(forDuct)} for the duct`;
  const runBits: { words: string; pa: number }[] = [];
  const friction = g.ducts.friction_pa_m.design.value;
  if (s.rigid_m) runBits.push({ words: `${s.rigid_m} m of rigid duct at the design ${friction} Pa/m`, pa: s.rigid_m * friction });
  const factor = g.ducts.flex_rules.find((r) => r.unit === "× its length")?.value ?? 1;
  if (s.flex_m) {
    const perM = s.flex_mm && s.flex_ls ? flexPaPerM(g, s.flex_mm, s.flex_ls) : null;
    const at = perM ?? friction;
    runBits.push({ words: `${s.flex_m} m of ${s.flex_mm ? `Ø${s.flex_mm} ` : ""}flex${perM != null && s.flex_ls ? ` at ${lps(s.flex_ls)} (${r2(perM)} Pa/m)` : ` at the design ${friction} Pa/m`}, counted ${factor} times`, pa: s.flex_m * at * factor });
  }
  if (s.bends && s.flex_mm && s.flex_ls) {
    const v = s.flex_ls / 1000 / roundArea(s.flex_mm);
    const k = g.ducts.flex_bend_90.r_1_5d.value;
    const each = k * 0.6 * v * v;
    runBits.push({ words: `${s.bends} bend${s.bends === 1 ? "" : "s"} at ${pa(each)} each`, pa: s.bends * each });
  }
  if (!runBits.length) return { static_pa: s.static_pa, parts_pa: parts, for_duct_pa: r1(forDuct), run_pa: null, left_pa: null, fit: forDuct > 0 ? "unknown" : "over", reason: `${head}${forDuct > 0 ? ": the index run's lengths are needed to check it" : ": nothing is left for the duct"}.` };
  const run = runBits.reduce((n, b) => n + b.pa, 0);
  const left = forDuct - run;
  return {
    static_pa: s.static_pa,
    parts_pa: parts,
    for_duct_pa: r1(forDuct),
    run_pa: r1(run),
    left_pa: r1(left),
    fit: left >= 0 ? "fits" : "over",
    reason: `${head}; the index run, ${runBits.map((b) => b.words).join(", ")}, takes ${pa(run)}: ${left >= 0 ? `it fits, ${pa(left)} to spare` : `over by ${pa(-left)}`}.`,
  };
}

/* ── the whole check, as Tiff's tool runs it ── */

export type AirflowAsk = {
  unit: { airflow_ls: number; static_pa: number | null; low_airflow_ls: number | null; capacity_kw: number | null };
  outlets: { count: number; kind: OutletKind; size: string; zone: string; room: string; ls_each: number | null; duct_mm: number | null; length_m: number | null; slots: number | null }[];
  takeoffs: { count: number; dia_mm: number; ls_each: number | null; rigid: boolean }[];
  zones: { name: string; stays_open: boolean }[];
  ret: { filtered: boolean; pleated: boolean; w_mm: number | null; h_mm: number | null; count: number | null; duct_mm: number | null; ducts: number | null } | null;
  run: { rigid_m: number | null; flex_m: number | null; flex_mm: number | null; flex_ls: number | null; bends: number | null; balancing: boolean } | null;
};

export type AirflowLine = { check: string; fit: string; reason: string; guide: Record<string, number | string | null> };
export type AirflowResult = { guide: string; air: string; checks: AirflowLine[]; recommendations: string[]; note: string };

/** Every check the job's facts allow, each with the guide's figure and why. */
export function airflowCheck(g: AirflowGuide, a: AirflowAsk): AirflowResult {
  const checks: AirflowLine[] = [];
  const recs: string[] = [];
  const total = a.outlets.reduce((n, o) => n + o.count, 0);
  const given = a.outlets.reduce((n, o) => n + (o.ls_each != null ? o.ls_each * o.count : 0), 0);
  const rest = a.outlets.reduce((n, o) => n + (o.ls_each == null ? o.count : 0), 0);
  const shared = rest > 0 ? Math.max(0, a.unit.airflow_ls - given) / rest : 0;
  const air = total
    ? `${lps(a.unit.airflow_ls)} over ${total} outlet${total === 1 ? "" : "s"}${rest === total ? `: ${lps(shared)} each, shared evenly at full airflow` : rest ? `: ${lps(shared)} each where no airflow was given` : ""}.`
    : `${lps(a.unit.airflow_ls)}.`;

  for (const o of a.outlets) {
    const each = o.ls_each ?? shared;
    const where = o.room || o.zone ? `, ${o.room || o.zone}` : "";
    const oc = outletCheck(g, { kind: o.kind, size: o.size, ls: each, length_m: o.length_m, slots: o.slots });
    checks.push({ check: `${o.count} × ${outletWords(o.kind, oc.size)}${where}`, fit: oc.fit ?? "unknown", reason: oc.reason, guide: { recommended_ls: oc.recommended_ls, most_ls: oc.most_ls, makers: oc.n } });
    if (oc.fits_it) recs.push(`${outletWords(o.kind, oc.fits_it)}${where}, for ${lps(each)} each (the guide's smallest ${KIND_WORDS[o.kind]} that takes it).`);
    /* its flex run: as given, else a round neck's own size */
    const neck = o.duct_mm ?? (o.kind === "round_ceiling_diffuser" || oc.size.startsWith("round neck") ? Number((oc.size.match(/\d+/) ?? [])[0]) || null : null);
    const fc = neck ? flexCheck(g, neck, each) : null;
    if (fc) {
      checks.push({ check: `${o.count} × Ø${neck} flex run${o.count === 1 ? "" : "s"}${where}`, fit: fc.fit, reason: fc.reason, guide: { recommended_ls: fc.recommended_ls, most_ls: fc.most_ls, velocity_ms: fc.velocity_ms } });
      if (fc.fit !== "within" && fc.smallest_mm) recs.push(`Ø${fc.smallest_mm} flex to each ${KIND_WORDS[o.kind]}${where} for ${lps(each)}.`);
    } else if (o.kind !== "linear_slot") {
      const f = flexFor(g, each);
      if (f) recs.push(`The guide's flex for ${lps(each)} is Ø${f.dia_mm}, at ${ms(each / 1000 / roundArea(f.dia_mm))}${neck ? ` (it has no row for Ø${neck})` : ""}.`);
    }
  }

  /* the runs off the supply plenum */
  const takeoffCount = a.takeoffs.reduce((n, t) => n + t.count, 0);
  for (const t of a.takeoffs) {
    const each = t.ls_each ?? a.unit.airflow_ls / Math.max(1, takeoffCount);
    if (t.rigid) {
      const row = g.ducts.rigid_round_ls.rows.find((r) => r.dia_mm === t.dia_mm);
      const fit = row ? fitOf(each, row.recommended_ls, row.most_ls) : null;
      const v = each / 1000 / roundArea(t.dia_mm);
      const size = ductSizeFor(g, each, "rigid");
      checks.push({
        check: `${t.count} × Ø${t.dia_mm} rigid takeoff${t.count === 1 ? "" : "s"}`,
        fit: fit ?? "unknown",
        reason: row ? `${lps(each)} through Ø${t.dia_mm} rigid duct runs at ${ms(v)}: ${fitWords(fit!, lps(row.recommended_ls), lps(row.most_ls))}.` : `The guide has no Ø${t.dia_mm} rigid duct.${size ? ` ${size.reason}` : ""}`,
        guide: { recommended_ls: row?.recommended_ls ?? null, most_ls: row?.most_ls ?? null, velocity_ms: r2(v) },
      });
      if (fit && fit !== "within" && size) recs.push(size.reason);
    } else {
      const fc = flexCheck(g, t.dia_mm, each);
      checks.push({ check: `${t.count} × Ø${t.dia_mm} takeoff${t.count === 1 ? "" : "s"}`, fit: fc?.fit ?? "unknown", reason: fc?.reason ?? `The guide has no Ø${t.dia_mm} flex.`, guide: { recommended_ls: fc?.recommended_ls ?? null, most_ls: fc?.most_ls ?? null, velocity_ms: fc?.velocity_ms ?? null } });
      if (fc && fc.fit !== "within" && fc.smallest_mm) recs.push(`Ø${fc.smallest_mm} takeoffs for ${lps(each)} each.`);
    }
  }

  /* the return */
  if (a.ret) {
    const rc = returnCheck(g, { ls: a.unit.airflow_ls, filtered: a.ret.filtered, pleated: a.ret.pleated, w_mm: a.ret.w_mm, h_mm: a.ret.h_mm, count: a.ret.count });
    checks.push({ check: rc.size ? `Return grille ${rc.size}${(a.ret.count ?? 1) > 1 ? ` × ${a.ret.count}` : ""}` : "Return grille", fit: rc.fit ?? "sized", reason: rc.reason, guide: { velocity_ms: rc.velocity_ms, face_needed_m2: rc.face_needed_m2, carries_ls: rc.carries_ls } });
    if ((rc.fit == null || rc.fit !== "within") && rc.smallest_size) recs.push(`A ${rc.smallest_size} ${a.ret.filtered ? "filter grille" : "return grille"} or bigger${(a.ret.count ?? 1) > 1 ? `, each of ${a.ret.count}` : ""} (${m2(rc.face_needed_m2)} of face at ${ms(rc.velocity_ms)}).`);
    if (a.ret.duct_mm) {
      const dc = returnDuctCheck(g, { ls: a.unit.airflow_ls, dia_mm: a.ret.duct_mm, count: a.ret.ducts });
      checks.push({ check: `Return duct${(a.ret.ducts ?? 1) > 1 ? `s, ${a.ret.ducts}` : ""} × Ø${a.ret.duct_mm}`, fit: dc.fit, reason: dc.reason, guide: { recommended_ls: dc.recommended_ls, most_ls: dc.most_ls, velocity_ms: dc.velocity_ms } });
      if (dc.fit !== "within" && dc.smallest_mm) recs.push(`Ø${dc.smallest_mm} return duct${(a.ret.ducts ?? 1) > 1 ? "s" : ""} for ${lps(dc.ls)} each.`);
    }
  }

  /* zoning: each zone's outlets, from the outlets named for it */
  if (a.zones.length > 1) {
    const zones: ZoneIn[] = a.zones.map((zn) => ({ name: zn.name, stays_open: zn.stays_open, outlets: a.outlets.filter((o) => sameZone(o.zone, zn.name)).map((o) => ({ kind: o.kind, size: o.size, count: o.count })) }));
    const empty = zones.filter((zn) => zn.outlets.length === 0).map((zn) => zn.name);
    if (empty.length) checks.push({ check: "Zoning", fit: "unknown", reason: `No outlets are named for ${empty.join(", ")}: give each outlet its zone to check what can be left running.`, guide: { least_pct: g.zoning.min_fan_airflow_pct.value } });
    else {
      const zc = zoningCheck(g, a.unit, zones);
      checks.push({ check: "Zoning: what can be left running", fit: zc.fit, reason: [zc.reason, ...zc.notes].join(" "), guide: { least_ls: zc.least_ls, carries_ls: zc.worst.carries_ls, carries_most_ls: zc.worst.carries_most_ls, least_open_outlets: g.zoning.min_open_outlets.value } });
      if (zc.fit === "short") recs.push(`Zoning: a zone left open (a common zone, not a bedroom), or spill zones, so at least ${lps(zc.least_ls)} always has somewhere to go; a bypass last.`);
    }
  }

  /* the static */
  if (a.unit.static_pa != null) {
    const sc = staticBudget(g, { static_pa: a.unit.static_pa, filtered: a.ret?.filtered ?? true, zoned: a.zones.length > 1, balancing: a.run?.balancing ?? false, rigid_m: a.run?.rigid_m, flex_m: a.run?.flex_m, flex_mm: a.run?.flex_mm, flex_ls: a.run?.flex_ls, bends: a.run?.bends });
    checks.push({ check: "External static", fit: sc.fit, reason: sc.reason, guide: { for_duct_pa: sc.for_duct_pa, run_pa: sc.run_pa, left_pa: sc.left_pa } });
    if (a.unit.static_pa > g.ducts.external_static_pa.most.value) recs.push(`The unit's rated ${pa(a.unit.static_pa)} is over the ${pa(g.ducts.external_static_pa.most.value)} the guide says the total external static should never pass.`);
  }

  return {
    guide: `${g.meta.name} ${g.meta.version}`,
    air,
    checks,
    recommendations: [...new Set(recs)],
    note: "The guide's figures are recommendations, the median of what its publishers say: say the figure and its reason. The brief, a plan or the person's word overrides it.",
  };
}

const sameZone = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A check that's fine as the guide sees it. */
const FINE = new Set(["within", "enough", "fits", "sized"]);

/** "6 of 7 within the guide, 1 to look at", for the thread. */
export function airflowSaid(r: AirflowResult): string {
  const unknown = r.checks.filter((c) => c.fit === "unknown").length;
  const fine = r.checks.filter((c) => FINE.has(c.fit)).length;
  const look = r.checks.length - fine - unknown;
  return [`${fine} of ${r.checks.length} within the guide`, look ? `${look} to look at` : "", unknown ? `${unknown} not known` : ""].filter(Boolean).join(", ");
}
