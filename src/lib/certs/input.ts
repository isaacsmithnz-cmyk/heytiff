import {
  BUILDINGS,
  DEFAULT_CERT_ANSWERS,
  MATCHABLE,
  type AcRow,
  type AcSystem,
  type Building,
  type CertAnswers,
  type CircuitTest,
  type ClauseKey,
  type FanRow,
  type FireMode,
  type Requirement,
} from "./mechanical";

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
    model: text(r.model, 80),
    qty: qty && qty >= 1 ? Math.floor(qty) : 1,
    capacityKw: num(r.capacityKw, 2000),
    serial: text(r.serial, 80),
  };
}

function test(raw: unknown): CircuitTest {
  const t = obj(raw);
  return {
    pressureKpa: num(t.pressureKpa, 20000),
    holdMinutes: num(t.holdMinutes, 100000),
    vacuumMicrons: num(t.vacuumMicrons, 100000),
    manufacturerMicrons: num(t.manufacturerMicrons, 100000),
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
    model: r.model,
    qty: r.qty,
    airflowLps: num(f.airflowLps, 100000),
    airflowKind: oneOf(f.airflowKind, ["rated", "measured"] as const) ?? "rated",
    serial: r.serial,
  };
}

function requirement(raw: unknown): Requirement {
  const r = obj(raw);
  return {
    text: text(r.text, 600),
    answer: oneOf(r.answer, ["clause", "own", "na"] as const) ?? "clause",
    clause: oneOf<ClauseKey>(r.clause, MATCHABLE),
    own: text(r.own, 600),
    reason: text(r.reason, 300),
  };
}

export function normaliseCertAnswers(raw: unknown): CertAnswers {
  const r = obj(raw);
  const covers = obj(r.covers);
  const installed = obj(r.installed);
  const certifier = r.certifier && typeof r.certifier === "object" ? obj(r.certifier) : null;
  return {
    ...DEFAULT_CERT_ANSWERS,
    covers: { ac: bool(covers.ac), vent: bool(covers.vent) },
    building: oneOf<Building>(r.building, BUILDINGS.map((b) => b.key)),
    completedOn: day(r.completedOn),
    systems: list(r.systems, 20).map(system),
    fans: list(r.fans, 60).map(fan),
    installed: {
      ductwork: bool(installed.ductwork),
      fireRated: bool(installed.fireRated),
      fireStopProduct: text(installed.fireStopProduct, 160),
      condensatePump: bool(installed.condensatePump),
    },
    ventAs16682: bool(r.ventAs16682),
    certifier: certifier
      ? {
          name: text(certifier.name, 120),
          projectNumber: text(certifier.projectNumber, 60),
          consentAuthority: text(certifier.consentAuthority, 120),
        }
      : null,
    requirements: list(r.requirements, 30).map(requirement).filter((q) => q.text !== ""),
    fireMode: oneOf<FireMode>(r.fireMode, ["individual", "shutdown", "smoke"]),
    fireModeRatingsChecked: bool(r.fireModeRatingsChecked),
    fireModeInterface: text(r.fireModeInterface, 160),
    fireModeTestedOn: day(r.fireModeTestedOn),
    airBalance: oneOf(r.airBalance, ["attached", "others"] as const),
    notCoveredExtra: text(r.notCoveredExtra, 200),
  };
}
