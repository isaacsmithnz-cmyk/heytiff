import type { ProposalOption, UnitLine } from "@/lib/quotes/proposal";
import { EMPTY_FAN, EMPTY_ROW, EMPTY_TEST, type AcRow, type AcSystem, type FanRow } from "./mechanical";
import { installedFrom, type QuoteReading } from "./quote";

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

/** A unit's serial, read off its rating plate on the job's Installation
    (Isaac, 2026-10-06: "serial numbers etc. can be read from there using
    photos"). */
export type UnitSerial = { room: string; model: string; serial: string };

/** The certificate's rows with the serials read on the job: each row takes
    the serial of the unit in the same place with the same model, once. A
    row with no such unit keeps what it had. */
export function withSerials(reading: QuoteReading, serials: readonly UnitSerial[]): QuoteReading {
  const key = (place: string, model: string) => `${place.trim().toLowerCase()}|${model.toUpperCase().replace(/\s/g, "")}`;
  const left = new Map<string, string[]>();
  for (const s of serials) {
    if (!s.serial.trim()) continue;
    const k = key(s.room, s.model);
    left.set(k, [...(left.get(k) ?? []), s.serial.trim()]);
  }
  const take = <R extends { location: string; model: string; serial: string }>(row: R): R => {
    const queue = left.get(key(row.location, row.model));
    const serial = queue?.shift();
    return serial && !row.serial ? { ...row, serial } : row;
  };
  return {
    ...reading,
    systems: reading.systems.map((s) => ({ ...s, outdoor: take(s.outdoor), indoors: s.indoors.map(take) })),
    fans: reading.fans.map(take),
  };
}

/** Whether any row has a serial to print. */
export const hasSerials = (r: Pick<QuoteReading, "systems" | "fans">): boolean =>
  r.systems.some((s) => !!s.outdoor.serial || s.indoors.some((i) => !!i.serial)) || r.fans.some((f) => !!f.serial);

/** Whether the accepted options hold any equipment rows at all. */
export const quoteHasEquipment = (options: readonly ProposalOption[]): boolean => options.some((o) => o.units.length > 0);
