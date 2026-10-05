import type { ProposalOption, UnitLine } from "@/lib/quotes/proposal";
import { EMPTY_FAN, EMPTY_ROW, EMPTY_TEST, type AcRow, type AcSystem, type FanRow } from "./mechanical";
import { installedFrom, type QuoteReading } from "./quote";
import { sameModel } from "@/lib/workboard/plate-read";

/* THE EQUIPMENT, FROM THE ACCEPTED QUOTE. A job quoted in HeyTiff holds its
   equipment as rows (lib/quotes/proposal, UnitLine): each outdoor unit, the
   indoor units it runs, each fan, with its model in its own field. This turns
   those rows into the certificate's systems and fans one for one, with
   nothing read out of a sentence. The quote reader (./quote) stays for jobs
   quoted before, whose equipment is only in the job's description.

   What a quote can't know is left for the person: where an outdoor unit
   ended up when the quote didn't say, the kg of refrigerant added. */

const kwOf = (capacity: string): number | null => {
  const m = /(\d+(?:\.\d+)?)/.exec(capacity);
  return m ? Number(m[1]) : null;
};

const acRow = (u: UnitLine): AcRow => ({ ...EMPTY_ROW, location: u.room, model: u.model, qty: u.qty, capacityKw: kwOf(u.capacity) });

function systemsOf(units: readonly UnitLine[], refrigerant: string): AcSystem[] {
  const outdoors = units.filter((u) => u.role === "outdoor");
  const indoors = units.filter((u) => u.role === "indoor");
  const systems: AcSystem[] = outdoors.map((o) => ({
    outdoor: acRow(o),
    indoors: indoors.filter((i) => i.system === o.system).map(acRow),
    test: { ...EMPTY_TEST, refrigerant },
  }));
  /* indoor units with no outdoor listed: one system whose outdoor is still
     to be filled in, rather than units left off */
  const orphans = indoors.filter((i) => !outdoors.some((o) => o.system === i.system));
  if (orphans.length > 0) systems.push({ outdoor: { ...EMPTY_ROW }, indoors: orphans.map(acRow), test: { ...EMPTY_TEST, refrigerant } });
  return systems;
}

const fanOf = (u: UnitLine): FanRow => ({ ...EMPTY_FAN, location: u.room, model: u.model, qty: u.qty, airflowLps: u.lps });

/** The certificate's starting equipment from the options the client
    accepted. What was installed besides the units (ductwork, fire-rated
    penetrations, the refrigerant) is read from the option's own scope lines
    and unit types. */
export function readingFromQuote(options: readonly ProposalOption[]): QuoteReading {
  const words = options.flatMap((o) => [...o.lines, ...o.units.map((u) => `${u.type} ${u.model}`)]).join("\n");
  const said = installedFrom(words);
  const systems = options.flatMap((o) => systemsOf(o.units, said.refrigerant));
  const fans = options.flatMap((o) => o.units.filter((u) => u.role === "fan").map(fanOf));
  return {
    systems,
    fans,
    ductwork: said.ductwork,
    fireRated: said.fireRated,
    ventilation: fans.length > 0,
    refrigerant: said.refrigerant,
    statedConnectedKw: null,
  };
}

/** A unit's serial, read off its rating plate on the job's Installation:
    the quote's unit it's for — its option, role, system, place and model —
    and what the plate said. */
export type UnitSerial = {
  role: "outdoor" | "indoor" | "fan";
  option: number | null;
  system: number | null;
  room: string;
  model: string;
  modelRead: string | null;
  serial: string;
};

/** The certificate's rows with the serials read on the job: each row takes
    the serial of the quote's unit in the same option, system and place with
    the same model, once; where the plate's model isn't the quote's, the row
    takes the plate's — the certificate says what's on the wall. A row with
    no such unit, or nothing to match by, keeps what it had. */
export function withSerials(reading: QuoteReading, serials: readonly UnitSerial[], options: readonly ProposalOption[]): QuoteReading {
  const norm = (place: string, model: string) => `${place.trim().toLowerCase()}|${model.toUpperCase().replace(/\s/g, "")}`;
  const same = (a: number | null, b: number | null) => a == null || b == null || a === b;
  const left = serials.filter((s) => s.serial.trim()).map((s) => ({ ...s, used: false }));
  const take = <R extends { location: string; model: string; serial: string }>(row: R, role: UnitSerial["role"], option: number | null, system: number | null): R => {
    if (row.serial || (!row.location.trim() && !row.model.trim())) return row;
    const hit = left.find((s) => !s.used && s.role === role && same(s.option, option) && same(s.system, system) && norm(s.room, s.model) === norm(row.location, row.model));
    if (!hit) return row;
    hit.used = true;
    const model = hit.modelRead && !sameModel(hit.modelRead, hit.model) ? hit.modelRead : row.model;
    return { ...row, model, serial: hit.serial.trim() };
  };
  /* the reading's systems as readingFromQuote lays them out: each option's
     outdoor units in order, numbered from 1, then a system for its indoor
     units no outdoor ran; its fans after */
  const at = options.flatMap((o, option) => {
    const outdoors = o.units.filter((u) => u.role === "outdoor");
    const orphans = o.units.some((u) => u.role === "indoor" && !outdoors.some((x) => x.system === u.system));
    return [...outdoors.map((x) => ({ option, system: x.system as number | null })), ...(orphans ? [{ option, system: null }] : [])];
  });
  const fanAt = options.flatMap((o, option) => o.units.filter((u) => u.role === "fan").map(() => option));
  return {
    ...reading,
    systems: reading.systems.map((s, i) => {
      const { option = null, system = null } = at[i] ?? {};
      return { ...s, outdoor: take(s.outdoor, "outdoor", option, system), indoors: s.indoors.map((r) => take(r, "indoor", option, system)) };
    }),
    fans: reading.fans.map((f, i) => take(f, "fan", fanAt[i] ?? null, null)),
  };
}

/** Whether any row has a serial to print. */
export const hasSerials = (r: Pick<QuoteReading, "systems" | "fans">): boolean =>
  r.systems.some((s) => !!s.outdoor.serial || s.indoors.some((i) => !!i.serial)) || r.fans.some((f) => !!f.serial);

/** Whether the accepted options hold any equipment rows at all. */
export const quoteHasEquipment = (options: readonly ProposalOption[]): boolean => options.some((o) => o.units.length > 0);
