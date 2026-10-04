"use client";

import { useState } from "react";
import { addJobPicklistItem } from "@/app/actions/job-picklist";
import { CLIMATE_ZONES } from "@/lib/studio/loads";
import type { BriefRooms, BriefRoomsResult } from "@/lib/quotes/brief-rooms-server";
import { kitRows, type OutdoorAt, type PairOption, type SizedRoom } from "@/lib/quotes/brief-rooms";

/* ROOMS FROM THE BRIEF, on the job card's Quote section (Isaac, 2026-10-04:
   "What if I said the room is 30m2?"). Pressed, Tiff reads the rooms the
   brief gives a size for; each is sized from the climate zone's watts a
   square metre and offered the data pack's pairs that cover it. What the
   brief didn't say is listed to ask. A pair goes on the job's Materials
   list only when a person adds it — with its kit: pair coil, the outdoor's
   mount and isolator, pipe cover, drain, consumables, and a pump or a new
   circuit when the brief says — and then the Price block prices it. */

const WHERE: { value: OutdoorAt | ""; label: string }[] = [
  { value: "", label: "Not said" },
  { value: "ground", label: "Ground" },
  { value: "wall", label: "Wall" },
  { value: "roof", label: "Roof" },
];

const ROUTE = "/api/workboard/brief-rooms";
const ZONES = Object.keys(CLIMATE_ZONES).map(Number);
const BUILDING_WORDS = { residential: "a home", light_commercial: "an office or shop", commercial: "a commercial building" } as const;

/** The rows on the job's Materials list, one after another, in order. */
async function addRows(job: string, rows: ReturnType<typeof kitRows>) {
  for (const row of rows) await addJobPicklistItem(job, { kind: "material", ...row });
}

export function JobQuoteRooms({ job, onAdded }: { job: string; onAdded: () => void }) {
  const [rooms, setRooms] = useState<BriefRooms | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  /* the pipe run a person typed for a room, over the brief's */
  const [runs, setRuns] = useState<Record<string, string>>({});
  const runOf = (r: SizedRoom): number | null => {
    const typed = runs[r.name];
    if (typed === undefined) return r.runM;
    const n = Number(typed);
    return typed.trim() !== "" && Number.isFinite(n) && n > 0 && n <= 100 ? Math.round(n * 10) / 10 : null;
  };

  /* where the outdoor sits, as a person set it over the brief's */
  const [wheres, setWheres] = useState<Record<string, OutdoorAt | "">>({});
  const whereOf = (r: SizedRoom): OutdoorAt | null => {
    const set = wheres[r.name];
    return set === undefined ? r.outdoorAt : set || null;
  };
  const kitOf = (r: SizedRoom, o: PairOption) => kitRows(r, o, { runM: runOf(r), outdoorAt: whereOf(r) });

  const post = async (body: object, word: string) => {
    setBusy(word);
    setNote(null);
    try {
      const a = (await (await fetch(ROUTE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ job, ...body }) })).json()) as BriefRoomsResult;
      if (a.ok) setRooms(a.rooms);
      else setNote(a.reason);
    } catch {
      setNote("The rooms couldn't be sized. Try again.");
    }
    setBusy(null);
  };

  const rezone = (zone: number) =>
    rooms && void post({ read: rooms.read, zone, buildingType: rooms.buildingType, buildingSaid: rooms.buildingSaid, dropped: rooms.dropped }, "zone");

  const add = async (room: SizedRoom, o: PairOption) => {
    const key = `${room.name}|${o.indoor}`;
    /* read OUT HERE: React Compiler can't lower a loop or a conditional
       inside a try, and gives up on the whole component */
    const rows = kitOf(room, o);
    setBusy(key);
    setNote(null);
    try {
      await addRows(job, rows);
      setAdded((s) => new Set(s).add(key));
      onAdded();
    } catch {
      setNote("That pair couldn't be added. Try again.");
    }
    setBusy(null);
  };

  return (
    <section className="wb2-jcsec" aria-label="Rooms">
      <div className="wb2-jcdhead">
        <b>Rooms</b>
        <em>{rooms ? `Sized from the brief, as ${BUILDING_WORDS[rooms.buildingType]}${rooms.buildingSaid ? "" : " (assumed)"}` : "Sized from the brief"}</em>
      </div>
      {!rooms && (
        <div className="wb2-jqacts">
          <button type="button" className="pbtn ghost sm" disabled={busy !== null} onClick={() => void post({}, "read")}>
            {busy === "read" ? "Reading the brief" : "Size the rooms from the brief"}
          </button>
        </div>
      )}
      {note && <p className="wb2-sherr">{note}</p>}
      {rooms && (
        <>
          <div className="wb2-mline">
            <b>Climate zone</b>
            <em>
              {rooms.zone
                ? rooms.zone.from === "address"
                  ? `From the address${rooms.zone.town ? `, ${rooms.zone.town}` : ""}`
                  : "Chosen here"
                : "Not placed from the address: choose it"}
            </em>
            <span>
              <select
                className="wb2-sel"
                aria-label="Climate zone"
                value={rooms.zone?.zone ?? ""}
                disabled={busy !== null}
                onChange={(e) => rezone(Number(e.target.value))}
              >
                {!rooms.zone && <option value="">Choose</option>}
                {ZONES.map((z) => (
                  <option key={z} value={z}>
                    {CLIMATE_ZONES[z]!.label}
                  </option>
                ))}
              </select>
            </span>
          </div>
          {rooms.read.length === 0 && <p className="wb2-shtext">The brief gives no room sizes.</p>}
          {rooms.rooms.map((r) => (
            <div key={r.name + r.said}>
              <div className="wb2-mline">
                <b>{`${r.name}, ${r.areaM2} m²`}</b>
                <em>{`“${r.said}”`}</em>
                <span>{`${r.loadKw} kW`}</span>
              </div>
              <div className="wb2-mline">
                <b>Pipe run</b>
                <em>{runs[r.name] === undefined && r.runM != null ? "From the brief" : runOf(r) == null ? "To ask: goes on as Run to ask" : "Typed here"}</em>
                <span className="qs-in">
                  <input
                    className="wb2-fi wb2-jqpct"
                    inputMode="decimal"
                    aria-label={`Pipe run for ${r.name}, metres`}
                    value={runs[r.name] ?? (r.runM != null ? String(r.runM) : "")}
                    disabled={busy !== null}
                    onChange={(e) => setRuns((cur) => ({ ...cur, [r.name]: e.target.value }))}
                  />
                  <em>m</em>
                </span>
              </div>
              <div className="wb2-mline">
                <b>Outdoor</b>
                <em>{wheres[r.name] === undefined && r.outdoorAt != null ? "From the brief" : whereOf(r) == null ? "To ask: goes on as an outdoor mount to ask" : "Set here"}</em>
                <span>
                  <select
                    className="wb2-sel"
                    aria-label={`Where ${r.name}'s outdoor sits`}
                    value={whereOf(r) ?? ""}
                    disabled={busy !== null}
                    onChange={(e) => setWheres((cur) => ({ ...cur, [r.name]: e.target.value as OutdoorAt | "" }))}
                  >
                    {WHERE.map((w) => (
                      <option key={w.value} value={w.value}>
                        {w.label}
                      </option>
                    ))}
                  </select>
                </span>
              </div>
              {r.options[0] && (
                <p className="wb2-shtext">
                  {`With the pair: ${kitOf(r, r.options[0])
                    .slice(2)
                    .map((k) => `${k.name.toLowerCase()} (${k.qty})`)
                    .join(", ")}.`}
                </p>
              )}
              {r.assumed.length > 0 && <p className="wb2-shtext">{`Counted as standard, to ask: ${r.assumed.join(", ")}.`}</p>}
              {r.options.length === 0 && <p className="wb2-shtext">No single split in the data pack covers it: a multi or ducted system, in Studio.</p>}
              {r.options.map((o) => {
                const key = `${r.name}|${o.indoor}`;
                return (
                  <div className="wb2-mline" key={key}>
                    <b>{`${o.indoor} + ${o.outdoor}`}</b>
                    <em>{`${o.style}, ${o.coolKw} kW cooling, ${o.heatKw} kW heating`}</em>
                    <span>
                      <button type="button" className="pbtn ghost sm" disabled={busy !== null || added.has(key)} onClick={() => void add(r, o)}>
                        {added.has(key) ? "Added" : busy === key ? "Adding" : "Add to materials"}
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
          {rooms.dropped.length > 0 && (
            <p className="wb2-shtext">{`Not used, their size isn't in the brief's words: ${rooms.dropped.join(", ")}.`}</p>
          )}
        </>
      )}
    </section>
  );
}
