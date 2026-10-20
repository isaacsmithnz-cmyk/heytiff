/* A VEHICLE'S OWN PAGE (v2, "A vehicle's own page", 18 October; the boards
   v2-board-vehicle-*.png): what the page SAYS, worked out without a DOM.

   The page is layout over today's engines (components/fleet). Everything it
   prints that is not a straight field read is decided here, from the same
   rules the card and the register already use (logic.ts, the card's
   derive.ts), so the page can never warn about something the register is
   quiet on, or the other way round. Nothing here invents a figure: a reading
   nobody took is not a point on the line, and a renewal nobody filed is
   "Not set". */

import { fmtDay } from "@/lib/format/day";
import { dateFromDays } from "@/lib/fleet/map";
import {
  FUEL_PAYER_LABEL,
  INSURANCE_COVER_LABEL,
  STATUS_LABEL,
  displayName,
  expiryState,
  fmtCost,
  fmtKm,
  modelLabel,
  serviceDue,
  serviceDueKm,
  vehicleChips,
  type ChipState,
  type RenewalKind,
  type VehicleLog,
  type VehiclePolicy,
  type VehicleStatus,
  type VehicleWithFacts,
} from "@/components/fleet/logic";
import { RENEWAL_ROW, currentPolicy, logIso } from "@/components/fleet/vehicle-modal/derive";

/* ---- the sections and the address ---- */

export const VEHICLE_SECTIONS = ["overview", "service", "issues", "kilometres", "fuel", "documents", "money"] as const;
export type VehicleSection = (typeof VEHICLE_SECTIONS)[number];

export const SECTION_LABEL: Record<VehicleSection, string> = {
  overview: "Overview",
  service: "Service",
  issues: "Issues",
  kilometres: "Kilometres",
  fuel: "Fuel",
  documents: "Documents",
  money: "Money",
};

/** What the viewer is sent decides which sections there are. The register
    lens (`assets_all`) has them all; the driver's own vehicle has what My
    vehicle shows today, so no Documents and no Money; a vehicle with no
    motor has no odometer and no tank, so no Kilometres and no Fuel. */
export function sectionsFor(opts: { register: boolean; motorised: boolean }): VehicleSection[] {
  return VEHICLE_SECTIONS.filter((s) => {
    if ((s === "kilometres" || s === "fuel") && !opts.motorised) return false;
    if ((s === "documents" || s === "money") && !opts.register) return false;
    return true;
  });
}

/** `?tab=`: one of the sections this viewer has, else Overview. A repeated
    one (an array) is no section at all. */
export function parseVehicleSection(raw: unknown, have: readonly VehicleSection[]): VehicleSection {
  if (typeof raw !== "string") return "overview";
  const s = raw.trim().toLowerCase();
  return (have as readonly string[]).includes(s) ? (s as VehicleSection) : "overview";
}

/** The name the open tab wears: "Hilux XQG 41B", or the plate alone when the
    vehicle has no name of its own. */
export function vehicleTabLabel(v: Pick<VehicleWithFacts, "name" | "plate">): string {
  const name = v.name.trim();
  const plate = v.plate.trim();
  if (!name) return plate || "Vehicle";
  return plate && name.toUpperCase() !== plate.toUpperCase() ? `${name} ${plate}` : name;
}

/* ---- the head ---- */

export type Tone = "wrong" | "look" | "good" | "info";
export type Word = { word: string; tone: Tone };

const TONE: Record<ChipState, Tone> = { bad: "wrong", warn: "look", ok: "good" };

const days = (n: number) => (Math.abs(n) === 1 ? "1 day" : `${fmtKm(Math.abs(n))} days`);

/** "Rego due in 25 days" in orange, "Rego 3 days overdue" in red. */
export function dueWord(label: string, d: number): Word {
  if (d < 0) return { word: `${label} ${days(d)} overdue`, tone: "wrong" };
  if (d === 0) return { word: `${label} due today`, tone: "look" };
  if (d === 1) return { word: `${label} due tomorrow`, tone: "look" };
  return { word: `${label} due in ${days(d)}`, tone: "look" };
}

const RENEWAL_DAYS: Record<RenewalKind, (v: VehicleWithFacts) => number | null> = {
  rego: (v) => v.regoDays,
  ctp: (v) => v.ctpDays,
  insurance: (v) => v.insuranceDays,
};

/** Where the vehicle stands, as one word: the worst thing about it, as the
    register's chips rank it (wrong before needs a look), in the page's words;
    and when nothing is, its status. */
export function headState(v: VehicleWithFacts, openIssues: number, warnDays: number): Word {
  if (v.status === "sold") return { word: "Sold", tone: "info" };
  const found: Word[] = [];
  if (v.status === "offroad") found.push({ word: "Off road", tone: "wrong" });
  for (const kind of ["rego", "ctp", "insurance"] as const) {
    const d = RENEWAL_DAYS[kind](v);
    if (d != null && d <= warnDays) found.push(dueWord(RENEWAL_ROW[kind], d));
  }
  /* the cycle and the issues as the chips say them, one source for both */
  for (const c of vehicleChips(v, openIssues, warnDays)) {
    if (c.label.startsWith("Service") || /issues? open$/.test(c.label)) found.push({ word: c.label, tone: TONE[c.state] });
  }
  const worst = found.find((w) => w.tone === "wrong") ?? found[0];
  if (worst) return worst;
  if (v.status === "for_sale") return { word: STATUS_LABEL.for_sale, tone: "info" };
  return { word: STATUS_LABEL.active, tone: "good" };
}

/** The one grey line under the name: the driver, the kilometres, the model. */
export function headLine(v: VehicleWithFacts, driver: string | null): string {
  return [driver, v.motorised ? `${fmtKm(v.odometer)} km` : null, modelLabel(v) || null].filter(Boolean).join(", ");
}

/** The status, as a word in its state. */
export function statusWord(status: VehicleStatus): Word {
  const tone: Record<VehicleStatus, Tone> = { active: "good", offroad: "wrong", for_sale: "info", sold: "info" };
  return { word: STATUS_LABEL[status], tone: tone[status] };
}

/* ---- where it stands ---- */

export type StandsRow = { key: string; label: string; word: Word; line: string | null };

/** A renewal's word: "Due in 25 days", "3 days overdue", "Current", "Not set". */
export function renewalWord(d: number | null, warnDays: number): Word {
  if (d == null) return { word: "Not set", tone: "info" };
  const state = expiryState(d, warnDays);
  if (state === "ok") return { word: "Current", tone: "good" };
  const w = dueWord("", d).word.trim();
  return { word: w.charAt(0).toUpperCase() + w.slice(1), tone: TONE[state] };
}

function renewalLine(kind: RenewalKind, v: VehicleWithFacts, policies: readonly VehiclePolicy[], today: string): string | null {
  const p = currentPolicy(policies, kind);
  const d = RENEWAL_DAYS[kind](v);
  const until = p?.expiresOn ?? (d != null ? dateFromDays(d, today) : null);
  if (!until) return null;
  const cover = p?.cover ? INSURANCE_COVER_LABEL[p.cover].toLowerCase() : null;
  return [kind === "insurance" ? `To ${fmtDay(until)}` : fmtDay(until), p?.provider ?? null, cover].filter(Boolean).join(", ");
}

/** "In 1,800 km" — the nearer limit, capitalised, or "No cycle set". */
export function serviceWord(v: VehicleWithFacts, warnDays: number): Word {
  const due = serviceDue(v, warnDays);
  if (due.kmLeft == null && due.daysLeft == null) return { word: "No cycle set", tone: "info" };
  const parts: string[] = [];
  if (due.kmLeft != null) parts.push(due.kmLeft < 0 ? `${fmtKm(-due.kmLeft)} km overdue` : `in ${fmtKm(due.kmLeft)} km`);
  if (due.daysLeft != null) parts.push(due.daysLeft < 0 ? `${days(due.daysLeft)} overdue` : `in ${days(due.daysLeft)}`);
  const w = parts.join(" or ");
  /* a cycle that is fine is for your information, grey, as the board draws it */
  const tone: Tone = due.state === "ok" ? "info" : TONE[due.state];
  return { word: w.charAt(0).toUpperCase() + w.slice(1), tone };
}

/** "at 130,200 km or by 30 Dec 2026": both limits, each only if it applies. */
function serviceLimits(v: VehicleWithFacts, today: string): string | null {
  const km = serviceDueKm(v);
  const parts = [
    km != null ? `at ${fmtKm(km)} km` : null,
    v.serviceDays != null ? `by ${fmtDay(dateFromDays(v.serviceDays, today))}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" or ") : null;
}

/** "Due at 130,200 km or by 30 Dec 2026". */
export function serviceDueLine(v: VehicleWithFacts, today: string): string | null {
  const s = serviceLimits(v, today);
  return s ? `Due ${s}` : null;
}

const READ_FROM: Record<VehicleLog["kind"], string> = {
  fuel: "from a fuel docket",
  odo: "off the dash",
  issue: "with an issue",
  service: "at a service",
};

/** The newest log that carried a reading. */
export function latestReading(logs: readonly VehicleLog[]): VehicleLog | null {
  return [...logs].filter((l) => typeof l.odo === "number").sort((a, b) => a.ago - b.ago)[0] ?? null;
}

export function standsRows(
  v: VehicleWithFacts,
  policies: readonly VehiclePolicy[],
  logs: readonly VehicleLog[],
  today: string,
  warnDays: number,
): StandsRow[] {
  const rows: StandsRow[] = (["rego", "ctp", "insurance"] as const).map((kind) => ({
    key: kind,
    label: RENEWAL_ROW[kind],
    word: renewalWord(RENEWAL_DAYS[kind](v), warnDays),
    line: renewalLine(kind, v, policies, today),
  }));
  rows.push({ key: "service", label: "Service", word: serviceWord(v, warnDays), line: serviceDueLine(v, today) });
  if (v.motorised) {
    const read = latestReading(logs);
    rows.push({
      key: "odo",
      label: "Odometer",
      word: { word: `${fmtKm(v.odometer)} km`, tone: "info" },
      line: read ? `Read ${read.when}, ${READ_FROM[read.kind]}` : null,
    });
  }
  return rows;
}

/* ---- Latest: one row of each kind ---- */

export type LatestKind = "issue" | "fuel" | "odo" | "service" | "renewal";
export type LatestRow = {
  kind: LatestKind;
  label: string;
  name: string;
  line: string;
  /** a log's id, or a renewal's kind */
  opens: { log: string } | { renewal: RenewalKind };
};

const newest = (logs: readonly VehicleLog[], kind: VehicleLog["kind"]) =>
  [...logs].filter((l) => l.kind === kind).sort((a, b) => a.ago - b.ago)[0] ?? null;

const join = (xs: (string | null | undefined | false)[]) => xs.filter(Boolean).join(", ");

export function issueName(l: VehicleLog): string {
  return l.note?.trim() || "Issue reported";
}
export function issueLine(l: VehicleLog): string {
  return join([l.staffName, l.when, typeof l.odo === "number" ? `at ${fmtKm(l.odo)} km` : null]);
}
export function fuelName(l: VehicleLog): string {
  return join([typeof l.litres === "number" ? `${l.litres} litres` : "Fuel", typeof l.cost === "number" ? fmtCost(l.cost) : null]);
}
export function fuelLine(l: VehicleLog, eco?: number): string {
  return join([
    l.station,
    l.when,
    typeof eco === "number" ? `${eco} L/100 km` : null,
    l.paidWith ? FUEL_PAYER_LABEL[l.paidWith].toLowerCase() : null,
  ]);
}
export function serviceName(l: VehicleLog): string {
  return l.note?.trim() || "Service";
}

/** The policy filed last: by when it was filed, else when it starts, else when it runs to. */
export function latestPolicy(policies: readonly VehiclePolicy[]): VehiclePolicy | null {
  const at = (p: VehiclePolicy) => p.createdAt ?? p.startsOn ?? p.expiresOn;
  return [...policies].sort((a, b) => at(b).localeCompare(at(a)))[0] ?? null;
}

const RENEWED: Record<RenewalKind, string> = { rego: "Rego", ctp: "Green slip", insurance: "Insurance" };

export function latestRows(
  logs: readonly VehicleLog[],
  policies: readonly VehiclePolicy[],
  eco: Record<string, number>,
): LatestRow[] {
  const rows: LatestRow[] = [];
  const issue = newest(logs, "issue");
  if (issue) rows.push({ kind: "issue", label: "Issue", name: issueName(issue), line: issueLine(issue), opens: { log: issue.id } });
  const fuel = newest(logs, "fuel");
  if (fuel) rows.push({ kind: "fuel", label: "Fuel", name: fuelName(fuel), line: fuelLine(fuel, eco[fuel.id]), opens: { log: fuel.id } });
  const odo = newest(logs, "odo");
  if (odo && typeof odo.odo === "number")
    rows.push({
      kind: "odo",
      label: "Kilometres",
      name: `${fmtKm(odo.odo)} km`,
      line: join([odo.staffName ? `Read off the dash by ${odo.staffName}` : "Read off the dash", odo.when]),
      opens: { log: odo.id },
    });
  const service = newest(logs, "service");
  if (service)
    rows.push({
      kind: "service",
      label: "Service",
      name: serviceName(service),
      line: join([service.station, service.when, typeof service.cost === "number" ? fmtCost(service.cost) : null]),
      opens: { log: service.id },
    });
  const p = latestPolicy(policies);
  if (p)
    rows.push({
      kind: "renewal",
      label: "Renewal",
      name: `${RENEWED[p.kind]} renewed to ${fmtDay(p.expiresOn)}`,
      line: join([
        p.provider,
        p.cover ? INSURANCE_COVER_LABEL[p.cover].toLowerCase() : null,
        p.premium != null ? fmtCost(p.premium) : null,
        p.excess != null ? `excess ${fmtCost(p.excess)}` : null,
      ]),
      opens: { renewal: p.kind },
    });
  return rows;
}

/* ---- Service ---- */

/** The services, newest first, each with its date as the paper gives it. */
export function serviceHistory(logs: readonly VehicleLog[], today: string): (VehicleLog & { on: string })[] {
  return [...logs]
    .filter((l) => l.kind === "service")
    .sort((a, b) => a.ago - b.ago)
    .map((l) => ({ ...l, on: fmtDay(logIso(l, today)) }));
}

/** What servicing cost over the last twelve months, or null when nothing logged carried a cost. */
export function serviceSpend(logs: readonly VehicleLog[]): number | null {
  const xs = logs.filter((l) => l.kind === "service" && l.ago >= 0 && l.ago <= 365 && typeof l.cost === "number");
  return xs.length ? xs.reduce((a, l) => a + (l.cost ?? 0), 0) : null;
}

/** "Every 10,000 km or 6 months, whichever comes first. 1,800 km to go." */
export function serviceEvery(v: VehicleWithFacts, warnDays: number): string | null {
  const every = [
    v.serviceIntervalKm != null && v.motorised ? `${fmtKm(v.serviceIntervalKm)} km` : null,
    v.serviceIntervalMonths != null ? `${v.serviceIntervalMonths} month${v.serviceIntervalMonths === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  if (every.length === 0) return null;
  const { kmLeft } = serviceDue(v, warnDays);
  const first = every.length === 2 ? `Every ${every.join(" or ")}, whichever comes first.` : `Every ${every[0]}.`;
  const left = kmLeft == null ? "" : kmLeft < 0 ? ` ${fmtKm(-kmLeft)} km past it.` : ` ${fmtKm(kmLeft)} km to go.`;
  return first + left;
}

/** "At 130,200 km or by 30 Dec 2026" — the next service as a heading. */
export function nextServiceHeading(v: VehicleWithFacts, today: string): string | null {
  const s = serviceLimits(v, today);
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : null;
}

/* ---- Issues ---- */

/** Open first, newest first within each. */
export function issueGroups(logs: readonly VehicleLog[]): { open: VehicleLog[]; fixed: VehicleLog[] } {
  const issues = [...logs].filter((l) => l.kind === "issue").sort((a, b) => a.ago - b.ago);
  return { open: issues.filter((l) => l.status !== "resolved"), fixed: issues.filter((l) => l.status === "resolved") };
}

/* ---- Kilometres ---- */

export type Reading = {
  log: VehicleLog;
  odo: number;
  /** ISO day */
  on: string;
  /** kilometres since the reading before it, or null for the first */
  since: number | null;
  from: string;
  by: string;
};

const FROM: Record<VehicleLog["kind"], (l: VehicleLog) => string> = {
  fuel: (l) => (l.station ? `Fuel docket, ${l.station}` : "Fuel docket"),
  odo: () => "Read off the dash",
  issue: () => "Issue reported",
  service: (l) => (l.station ? `Service, ${l.station}` : "Service"),
};

/** Every log that carried a reading, newest first, each with how far it was from the one before. */
export function readings(logs: readonly VehicleLog[], today: string): Reading[] {
  const xs = [...logs].filter((l) => typeof l.odo === "number").sort((a, b) => a.ago - b.ago);
  return xs.map((l, i) => {
    const before = xs[i + 1];
    return {
      log: l,
      odo: l.odo as number,
      on: logIso(l, today),
      since: before ? (l.odo as number) - (before.odo as number) : null,
      from: FROM[l.kind](l),
      by: l.staffName ?? (l.staffId ? "Not recorded" : "Imported"),
    };
  });
}

const MONTH_DAYS = 365.25 / 12;

/** Kilometres a month over the last twelve months, from the readings in
    them: null with fewer than two, or less than four weeks between them. */
export function kmPerMonth(rs: readonly Reading[]): { perMonth: number; sinceIso: string; spanDays: number } | null {
  const inYear = rs.filter((r) => r.log.ago >= 0 && r.log.ago <= 365);
  if (inYear.length < 2) return null;
  const newestR = inYear[0];
  const oldestR = inYear[inYear.length - 1];
  const spanDays = oldestR.log.ago - newestR.log.ago;
  if (spanDays < 28) return null;
  return { perMonth: Math.round((newestR.odo - oldestR.odo) / (spanDays / MONTH_DAYS)), sinceIso: oldestR.on, spanDays };
}

export type KmChart = {
  width: number;
  height: number;
  /** the line, as an SVG path */
  path: string;
  points: { x: number; y: number; odo: number; id: string }[];
  yTicks: { y: number; label: string }[];
  xTicks: { x: number; label: string }[];
  /** the service-due line, when the next service has a distance */
  due: { y: number; label: string } | null;
  last: { x: number; y: number; label: string } | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The line over the last twelve months. Pure geometry: the component draws it. */
export function kmChart(
  rs: readonly Reading[],
  today: string,
  dueKm: number | null,
  size: { width: number; height: number } = { width: 880, height: 240 },
): KmChart | null {
  const inYear = rs.filter((r) => r.log.ago >= 0 && r.log.ago <= 365).slice().reverse(); // oldest first
  if (inYear.length < 2) return null;
  const pad = { l: 48, r: 16, t: 16, b: 24 };
  const w = size.width - pad.l - pad.r;
  const h = size.height - pad.t - pad.b;
  const odos = inYear.map((r) => r.odo);
  let lo = Math.min(...odos);
  let hi = Math.max(...odos);
  if (dueKm != null && dueKm >= hi && dueKm <= hi + (hi - lo + 1) * 0.5 + 5000) hi = dueKm;
  /* round the scale to a step that gives four or five lines */
  const raw = Math.max(1, (hi - lo) / 4);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  if (hi === lo) hi = lo + step;
  const x = (ago: number) => pad.l + ((365 - ago) / 365) * w;
  const y = (odo: number) => pad.t + (1 - (odo - lo) / (hi - lo)) * h;
  const points = inYear.map((r) => ({ x: Math.round(x(r.log.ago) * 10) / 10, y: Math.round(y(r.odo) * 10) / 10, odo: r.odo, id: r.log.id }));
  const path = points.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
  const yTicks: KmChart["yTicks"] = [];
  for (let v = lo; v <= hi + 1e-6; v += step)
    yTicks.push({ y: Math.round(y(v) * 10) / 10, label: v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v) });
  const xTicks: KmChart["xTicks"] = [];
  const [ty, tm] = today.split("-").map(Number);
  for (let i = 11; i >= 0; i--) {
    const first = new Date(Date.UTC(ty, tm - 1 - i, 1));
    const ago = Math.round((Date.parse(`${today}T00:00:00Z`) - first.getTime()) / 86_400_000);
    if (ago > 365) continue;
    xTicks.push({ x: Math.round(x(ago) * 10) / 10, label: MONTHS[first.getUTCMonth()] });
  }
  const tail = points[points.length - 1];
  return {
    width: size.width,
    height: size.height,
    path,
    points,
    yTicks,
    xTicks,
    due: dueKm != null && dueKm <= hi && dueKm >= lo ? { y: Math.round(y(dueKm) * 10) / 10, label: `Service due, ${fmtKm(dueKm)} km` } : null,
    last: tail ? { x: tail.x, y: tail.y, label: `${fmtKm(tail.odo)} km` } : null,
  };
}

/* ---- Fuel ---- */

export function fuelHistory(logs: readonly VehicleLog[], today: string): (VehicleLog & { on: string })[] {
  return [...logs]
    .filter((l) => l.kind === "fuel")
    .sort((a, b) => a.ago - b.ago)
    .map((l) => ({ ...l, on: fmtDay(logIso(l, today)) }));
}

/* ---- Documents ---- */

export type RenewalEntry = { policy: VehiclePolicy; name: string; line: string; current: boolean };

/** Every renewal on file, rego then green slip then insurance, the one in
    force first in each. */
export function renewalHistory(policies: readonly VehiclePolicy[]): RenewalEntry[] {
  const out: RenewalEntry[] = [];
  for (const kind of ["rego", "ctp", "insurance"] as const) {
    const now = currentPolicy(policies, kind);
    const mine = policies.filter((p) => p.kind === kind).sort((a, b) => b.expiresOn.localeCompare(a.expiresOn));
    for (const p of mine)
      out.push({
        policy: p,
        name: `${RENEWAL_ROW[kind]} to ${fmtDay(p.expiresOn)}`,
        line: join([p.provider, p.premium != null ? fmtCost(p.premium) : null, p.createdAt ? `filed ${fmtDay(p.createdAt)}` : null]),
        current: p.id === now?.id,
      });
  }
  return out;
}

/** The vehicle's display name, re-exported so the page asks one module. */
export { displayName };
