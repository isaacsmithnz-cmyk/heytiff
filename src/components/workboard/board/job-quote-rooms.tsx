"use client";

import { useState } from "react";
import { addJobPicklistItem } from "@/app/actions/job-picklist";
import { CLIMATE_ZONES } from "@/lib/studio/loads";
import type { BriefRooms, BriefRoomsResult } from "@/lib/quotes/brief-rooms-server";
import type { PairOption } from "@/lib/quotes/brief-rooms";

/* ROOMS FROM THE BRIEF, on the job card's Quote section (Isaac, 2026-10-04:
   "What if I said the room is 30m2?"). Pressed, Tiff reads the rooms the
   brief gives a size for; each is sized from the climate zone's watts a
   square metre and offered the data pack's pairs that cover it. What the
   brief didn't say is listed to ask. A pair goes on the job's Materials
   list only when a person adds it, and then the Price block prices it. */

const ROUTE = "/api/workboard/brief-rooms";
const ZONES = Object.keys(CLIMATE_ZONES).map(Number);
const BUILDING_WORDS = { residential: "a home", light_commercial: "an office or shop", commercial: "a commercial building" } as const;

export function JobQuoteRooms({ job, onAdded }: { job: string; onAdded: () => void }) {
  const [rooms, setRooms] = useState<BriefRooms | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());

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

  const add = async (room: string, o: PairOption) => {
    const key = `${room}|${o.indoor}`;
    setBusy(key);
    setNote(null);
    try {
      await addJobPicklistItem(job, { kind: "material", name: o.indoor, qty: "1", sub: `${o.style} indoor unit, ${room}` });
      await addJobPicklistItem(job, { kind: "material", name: o.outdoor, qty: "1", sub: `Outdoor unit, ${room}` });
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
              {r.assumed.length > 0 && <p className="wb2-shtext">{`Counted as standard, to ask: ${r.assumed.join(", ")}.`}</p>}
              {r.options.length === 0 && <p className="wb2-shtext">No single split in the data pack covers it: a multi or ducted system, in Studio.</p>}
              {r.options.map((o) => {
                const key = `${r.name}|${o.indoor}`;
                return (
                  <div className="wb2-mline" key={key}>
                    <b>{`${o.indoor} + ${o.outdoor}`}</b>
                    <em>{`${o.style}, ${o.coolKw} kW cooling, ${o.heatKw} kW heating`}</em>
                    <span>
                      <button type="button" className="pbtn ghost sm" disabled={busy !== null || added.has(key)} onClick={() => void add(r.name, o)}>
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
