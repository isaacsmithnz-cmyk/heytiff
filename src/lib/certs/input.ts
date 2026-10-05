import {
  BUILDINGS,
  DEFAULT_CERT_ANSWERS,
  EXHAUST_TO,
  MATCHABLE,
  type AcRow,
  type AcSystem,
  type Building,
  type CertAnswers,
  type CircuitTest,
  type ClauseKey,
  type ExhaustTo,
  type FanRow,
  type FireMode,
  type Requirement,
} from "./mechanical";
import { AU_STATES, type AuState } from "@/lib/swms/library";

/* WHAT ARRIVES FROM THE BROWSER IS A CLAIM, NOT AN ANSWER — the SWMS rule
   (lib/swms/input.ts), for the same reason: a version is paperwork frozen
   forever. Unknown keys are dropped, every choice is one of its known values,
   every text is trimmed and capped, every number is finite and in range. */

const text = (v: unknown, max = 200): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const bool = (v: unknown): boolean => v === true;
function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
/** A finite number in range, or null. Strings from inputs are read too. */
function num(v: unknown, max: number): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return Math.round(n * 1000) / 1000;
}
const day = (v: unknown): string => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");

function row(raw: unknown): AcRow {
  const r = obj(raw);
  const qty = num(r.qty, 99);
  return {
    location: text(r.location, 120),
    make: text(r.make, 60),
    model: text(r.model, 80),
    qty: qty && qty >= 1 ? Math.floor(qty) : 1,
    capacityKw: num(r.capacityKw, 2000),
    serial: text(r.serial, 80),
  };
}

function test(raw: unknown): CircuitTest {
  const t = obj(raw);
  return {
    refrigerant: text(t.refrigerant, 20).toUpperCase(),
    addedKg: num(t.addedKg, 500),
  };
}

function system(raw: unknown): AcSystem {
  const s = obj(raw);
  return { outdoor: row(s.outdoor), indoors: list(s.indoors, 60).map(row), test: test(s.test) };
}

function fan(raw: unknown): FanRow {
  const f = obj(raw);
  const r = row(f);
  return {
    location: r.location,
    make: r.make,
    model: r.model,
    qty: r.qty,
    airflowGiven: bool(f.airflowGiven),
    airflowLps: num(f.airflowLps, 100000),
    airflowKind: oneOf(f.airflowKind, ["rated", "measured"] as const) ?? "rated",
    serial: r.serial,
  };
}

/* WHAT A CERTIFICATE HOLDS OF WHAT WAS ASKED. The wizard fills and caps its
   fields to the same numbers, so nothing the person answered is cut here
   without their seeing it. */
export const MAX_REQUIREMENTS = 30;
export const MAX_REQUIREMENT_TEXT = 600;
export const MAX_REASON = 300;

function requirement(raw: unknown): Requirement {
  const r = obj(raw);
  return {
    text: text(r.text, MAX_REQUIREMENT_TEXT),
    answer: oneOf(r.answer, ["clause", "own", "na"] as const) ?? "clause",
    clause: oneOf<ClauseKey>(r.clause, MATCHABLE),
    own: text(r.own, MAX_REQUIREMENT_TEXT),
    reason: text(r.reason, MAX_REASON),
  };
}

/** Whether any row of a saved version carries a serial. */
function hasSerial(r: Record<string, unknown>): boolean {
  const rows = [
    ...list(r.systems, 20).flatMap((s) => [obj(s).outdoor, ...list(obj(s).indoors, 60)]),
    ...list(r.fans, 60),
  ];
  return rows.some((row) => typeof obj(row).serial === "string" && (obj(row).serial as string).trim() !== "");
}

export function normaliseCertAnswers(raw: unknown): CertAnswers {
  const r = obj(raw);
  const covers = obj(r.covers);
  const installed = obj(r.installed);
  return {
    ...DEFAULT_CERT_ANSWERS,
    covers: { ac: bool(covers.ac), vent: bool(covers.vent) },
    /* a version saved before the state was asked is a NSW job: there was no other */
    state: r.state === undefined ? "NSW" : oneOf<AuState>(r.state, AU_STATES),
    building: oneOf<Building>(r.building, BUILDINGS.map((b) => b.key)),
    completedOn: day(r.completedOn),
    systems: list(r.systems, 20).map(system),
    fans: list(r.fans, 60).map(fan),
    installed: {
      ductwork: bool(installed.ductwork),
      fireRated: bool(installed.fireRated),
      fireStopProduct: text(installed.fireStopProduct, 160),
    },
    exhaustTo: oneOf<ExhaustTo>(r.exhaustTo, EXHAUST_TO.map((e) => e.key)),
    requirements: list(r.requirements, MAX_REQUIREMENTS).map(requirement).filter((q) => q.text !== ""),
    fireMode: oneOf<FireMode>(r.fireMode, ["individual", "shutdown", "smoke"]),
    fireModeRatingsChecked: bool(r.fireModeRatingsChecked),
    fireModeInterface: text(r.fireModeInterface, 160),
    fireModeTestedOn: day(r.fireModeTestedOn),
    airBalance: oneOf(r.airBalance, ["attached", "others"] as const),
    notCoveredExtra: text(r.notCoveredExtra, 200),
    equipmentConfirmed: bool(r.equipmentConfirmed),
    /* a version saved before the option printed whatever serial was typed */
    serialsGiven: r.serialsGiven === undefined ? hasSerial(r) : bool(r.serialsGiven),
  };
}
