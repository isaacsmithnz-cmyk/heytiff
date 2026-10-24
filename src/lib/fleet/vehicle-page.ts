/* A VEHICLE'S OWN PAGE (v2, "A vehicle's own page", 18 October; simplified
   on Isaac's mock of 24 October 2026, YRqKF87knq2N35tMLa5hkz section 4):
   what the page SAYS, worked out without a DOM.

   EACH FACT ONCE. "The vehicles page is quite messy… Simplify it. Things are
   marked down twice like that. Odometers. The person driving it." (Isaac,
   24 October 2026.) The title is the make and model, with the plate drawn
   beside it; the year, the nickname, who drives it and its status are the
   one grey line under them; Overview holds the renewals, the service (the
   odometer lives there and nowhere else on it) and the last fill. The value
   is Money's alone.

   The page is layout over today's engines (components/fleet). Everything it
   prints that is not a straight field read is decided here, from the same
   rules the card and the register already use (logic.ts, the card's
   derive.ts), so the page can never warn about something the register is
   quiet on, or the other way round. Nothing here invents a figure: a reading
   nobody took is not a point on the line, and a renewal nobody filed is
   "Not on file". */

import { fmtDay } from "@/lib/format/day";
import { dateFromDays } from "@/lib/fleet/map";
import {
  STATUS_LABEL,
  displayName,
  expiryState,
  fmtCost,
  fmtKm,
  serviceDue,
  serviceDueKm,
  type ChipState,
  type RenewalKind,
  type VehicleIdentity,
  type VehicleLog,
  type VehiclePolicy,
  type VehicleStatus,
  type VehicleWithFacts,
} from "@/components/fleet/logic";
import { RENEWAL_ROW, currentPolicy, logIso } from "@/components/fleet/vehicle-modal/derive";

/* ---- the sections and the address ---- */

/* Kilometres was a tab of its own until 24 October 2026; its readings and
   the line are Service's now, under the next service they count towards. */
export const VEHICLE_SECTIONS = ["overview", "service", "fuel", "issues", "documents", "money"] as const;
export type VehicleSection = (typeof VEHICLE_SECTIONS)[number];

export const SECTION_LABEL: Record<VehicleSection, string> = {
  overview: "Overview",
  service: "Service",
  fuel: "Fuel",
  issues: "Issues",
  documents: "Documents",
  money: "Money",
};

/** What the viewer is sent decides which sections there are. The register
    lens (`assets_all`) has them all; the driver's own vehicle has what My
    vehicle shows today, so no Documents and no Money; a vehicle with no
    motor has no tank, so no Fuel. */
export function sectionsFor(opts: { register: boolean; motorised: boolean }): VehicleSection[] {
  return VEHICLE_SECTIONS.filter((s) => {
    if (s === "fuel" && !opts.motorised) return false;
    if ((s === "documents" || s === "money") && !opts.register) return false;
    return true;
  });
}

/** Sections the address once named and the page no longer has, and where
    they went: an old `?tab=kilometres` (a bookmark, a link from before 24
    October 2026) opens Service, where the readings are now. */
const MOVED: ReadonlyMap<string, VehicleSection> = new Map([["kilometres", "service"]]);

/** `?tab=`: one of the sections this viewer has, else Overview. A repeated
    one (an array) is no section at all. */
export function parseVehicleSection(raw: unknown, have: readonly VehicleSection[]): VehicleSection {
  if (typeof raw !== "string") return "overview";
  const s = raw.trim().toLowerCase();
  const to = MOVED.get(s) ?? s;
  return (have as readonly string[]).includes(to) ? (to as VehicleSection) : "overview";
}

/* ---- the head ---- */

type Named = Pick<VehicleIdentity, "make" | "model" | "name" | "plate">;

/** One spelling of a plate or a name, for telling two apart: no spaces, in capitals. */
const squash = (s: string) => s.replace(/\s+/g, "").toUpperCase();

/** The title: the make and model, "Toyota Hiace" (Isaac, 24 October 2026:
    "It should say the brand. At the top, Toyota Hiace"). A model that
    already starts with the make isn't given it twice. With neither, the
    vehicle's own name, else "Vehicle". The plate is drawn beside the title,
    never in it. */
export function vehicleTitle(v: Named): string {
  const make = v.make.trim();
  const model = v.model.trim();
  const both = make && model && !model.toUpperCase().startsWith(make.toUpperCase()) ? `${make} ${model}` : model || make;
  return both || v.name.trim() || "Vehicle";
}

/** The vehicle's own name, "Zucky", when it has one that is more than its
    plate or its title again. */
export function nickname(v: Named): string | null {
  const name = v.name.trim();
  if (!name || squash(name) === squash(v.plate) || squash(name) === squash(vehicleTitle(v))) return null;
  return name;
}

/** The name the open tab wears: the title and the plate, "Toyota Hiace
    EVD72G", as the head reads; the plate alone when there is no title. */
export function vehicleTabLabel(v: Named): string {
  const title = vehicleTitle(v);
  const plate = v.plate.trim();
  if (!plate) return title;
  return title === "Vehicle" || squash(title) === squash(plate) ? plate : `${title} ${plate}`;
}

/** Who drives it, as the grey line says it: the driver's name, "you" on the
    driver's own vehicle, or nobody. */
export type Driver = string | "you" | null;

/** The one grey line under the title: the year, the nickname when it has
    one, and who drives it ("Isaac Smith drives it", "No driver"); something
    towed is towed. Its status follows the line as a dot and a word. */
export function headFacts(v: VehicleWithFacts, driver: Driver): string {
  const who =
    driver === "you"
      ? `You ${v.motorised ? "drive" : "tow"} it`
      : driver
        ? `${driver} ${v.motorised ? "drives" : "tows"} it`
        : "No driver";
  return [v.year ? String(v.year) : null, nickname(v), who].filter(Boolean).join(", ");
}

export type Tone = "wrong" | "look" | "good" | "info";
export type Word = { word: string; tone: Tone };

const TONE: Record<ChipState, Tone> = { bad: "wrong", warn: "look", ok: "good" };

/** The status, as a word in its state: the head's, and the only place it shows. */
export function statusWord(status: VehicleStatus): Word {
  const tone: Record<VehicleStatus, Tone> = { active: "good", offroad: "wrong", for_sale: "info", sold: "info" };
  return { word: STATUS_LABEL[status], tone: tone[status] };
}

/* ---- Overview: the renewals ---- */

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

/** A renewal's word: "Due in 25 days", "3 days overdue", "Current", "Not on file". */
export function renewalWord(d: number | null, warnDays: number): Word {
  if (d == null) return { word: "Not on file", tone: "info" };
  const state = expiryState(d, warnDays);
  if (state === "ok") return { word: "Current", tone: "good" };
  const w = dueWord("", d).word.trim();
  return { word: w.charAt(0).toUpperCase() + w.slice(1), tone: TONE[state] };
}

export type RenewalRow = {
  kind: RenewalKind;
  label: string;
  word: Word;
  /** "to 12 Nov 2026", or "ended 15 Oct 2026" once it has; null with nothing on file */
  date: string | null;
  /** a date is on file, so its door says Renew; without one it says Add */
  onFile: boolean;
};

/** Rego, green slip and insurance, each with its state and the day it runs to. */
export function renewalRows(v: VehicleWithFacts, policies: readonly VehiclePolicy[], today: string, warnDays: number): RenewalRow[] {
  return (["rego", "ctp", "insurance"] as const).map((kind) => {
    const d = RENEWAL_DAYS[kind](v);
    const until = d == null ? null : (currentPolicy(policies, kind)?.expiresOn ?? dateFromDays(d, today));
    return {
      kind,
      label: RENEWAL_ROW[kind],
      word: renewalWord(d, warnDays),
      date: until ? `${d != null && d < 0 ? "ended" : "to"} ${fmtDay(until)}` : null,
      onFile: d != null,
    };
  });
}

/* ---- Overview: the service, and the last fill ---- */

/** "at 130,200 km or by 30 Dec 2026": both limits, each only if it applies. */
function serviceLimits(v: VehicleWithFacts, today: string): string | null {
  const km = serviceDueKm(v);
  const parts = [
    km != null ? `at ${fmtKm(km)} km` : null,
    v.serviceDays != null ? `by ${fmtDay(dateFromDays(v.serviceDays, today))}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" or ") : null;
}

/** The newest log that carried a reading. */
export function latestReading(logs: readonly VehicleLog[]): VehicleLog | null {
  return [...logs].filter((l) => typeof l.odo === "number").sort((a, b) => a.ago - b.ago)[0] ?? null;
}

const newest = (logs: readonly VehicleLog[], kind: VehicleLog["kind"]) =>
  [...logs].filter((l) => l.kind === kind).sort((a, b) => a.ago - b.ago)[0] ?? null;

const join = (xs: (string | null | undefined | false)[]) => xs.filter(Boolean).join(", ");

export type FactRow = {
  key: string;
  label: string;
  value: string;
  /** nothing recorded, said in grey */
  quiet?: boolean;
  /** a cycle that needs a look or is past, as a word on the right */
  word?: Word;
};

/** "At 130,200 km or by 30 Dec 2026, 1,800 km to go", with a word when it
    is close or past; "No cycle set" for a vehicle with neither limit. */
function nextServiceRow(v: VehicleWithFacts, today: string, warnDays: number): FactRow {
  const limits = serviceLimits(v, today);
  if (!limits) return { key: "next", label: "Next service", value: "No cycle set", quiet: true };
  const due = serviceDue(v, warnDays);
  const left =
    due.kmLeft != null
      ? due.kmLeft < 0
        ? `${fmtKm(-due.kmLeft)} km past it`
        : `${fmtKm(due.kmLeft)} km to go`
      : due.daysLeft != null
        ? due.daysLeft < 0
          ? `${days(due.daysLeft)} past it`
          : `${days(due.daysLeft)} to go`
        : null;
  const value = `${limits.charAt(0).toUpperCase()}${limits.slice(1)}${left ? `, ${left}` : ""}`;
  const word: Word | undefined =
    due.state === "bad" ? { word: "Overdue", tone: "wrong" } : due.state === "warn" ? { word: "Due soon", tone: "look" } : undefined;
  return { key: "next", label: "Next service", value, word };
}

/** Overview's Service: the odometer and when it was read (the one place
    Overview says it), the next service, and the last one. `lastServiceDays`
    is the register's own anchor, for a service that came in without a log. */
export function serviceRows(
  v: VehicleWithFacts,
  logs: readonly VehicleLog[],
  today: string,
  warnDays: number,
  lastServiceDays: number | null = null,
): FactRow[] {
  const rows: FactRow[] = [];
  if (v.motorised) {
    const read = latestReading(logs);
    rows.push({ key: "odo", label: "Odometer", value: `${fmtKm(v.odometer)} km${read ? `, read ${read.when}` : ""}` });
  }
  rows.push(nextServiceRow(v, today, warnDays));
  const last = newest(logs, "service");
  rows.push(
    last
      ? { key: "last", label: "Last service", value: last.when }
      : lastServiceDays != null
        ? { key: "last", label: "Last service", value: fmtDay(dateFromDays(-lastServiceDays, today)) }
        : { key: "last", label: "Last service", value: "None logged", quiet: true },
  );
  return rows;
}

/** The newest fill: its day, then "90.05 litres, $106.17, Coles Express Park Holme". */
export function lastFuel(logs: readonly VehicleLog[]): { log: VehicleLog; when: string; line: string } | null {
  const f = newest(logs, "fuel");
  if (!f) return null;
  const line = join([typeof f.litres === "number" ? `${f.litres} litres` : null, typeof f.cost === "number" ? fmtCost(f.cost) : null, f.station]);
  return { log: f, when: f.when, line: line || "Fuel logged" };
}

/* ---- Issues and Service: names and lines ---- */

export function issueName(l: VehicleLog): string {
  return l.note?.trim() || "Issue reported";
}
export function issueLine(l: VehicleLog): string {
  return join([l.staffName, l.when, typeof l.odo === "number" ? `at ${fmtKm(l.odo)} km` : null]);
}
export function serviceName(l: VehicleLog): string {
  return l.note?.trim() || "Service";
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

/* ---- Kilometres, on Service ---- */

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
