"use client";

import { useState } from "react";
import { addJobPicklistItem } from "@/app/actions/job-picklist";
import { CLIMATE_ZONES } from "@/lib/studio/loads";
import type { BriefRooms, BriefRoomsResult } from "@/lib/quotes/brief-rooms-server";
import { VRF_METHOD_WORDS, vrfKitRows, type VrfMethod, type VrfOption } from "@/lib/quotes/brief-vrf";
import { ductedAsks, ductedKitRows, makerZoningWords, outletName, type DuctedPair } from "@/lib/quotes/brief-ducted";
import { kitRows, multiKitRows, withSwap, type Swap, multiPipeWords, type MultiOption, type OutdoorAt, type PairOption, type SizedRoom } from "@/lib/quotes/brief-rooms";

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
  /* a swap, as the brief says it or as a person ticks it */
  const [swapSet, setSwapSet] = useState<Swap | null>(null);
  const swapOf = (): Swap => swapSet ?? rooms?.swap ?? { replacing: false, keepPipe: false };
  const kitOf = (r: SizedRoom, o: PairOption) => withSwap(kitRows(r, o, { runM: runOf(r), outdoorAt: whereOf(r) }), swapOf(), r.name);

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
    rooms &&
    void post(
      {
        read: rooms.read,
        zone,
        buildingType: rooms.buildingType,
        buildingSaid: rooms.buildingSaid,
        dropped: rooms.dropped,
        ducted: rooms.ducted,
        swap: swapOf(),
        vrfSaid: rooms.vrfSaid,
        vrfHeads: rooms.vrfHeads,
      },
      "zone"
    );

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

  /* the same rooms on one multi: where its outdoor sits, set here over the
     first the brief said */
  const [multiWhere, setMultiWhere] = useState<OutdoorAt | "" | undefined>(undefined);
  const multiWhereOf = (): OutdoorAt | null =>
    multiWhere === undefined ? (rooms?.rooms.find((r) => r.outdoorAt != null)?.outdoorAt ?? null) : multiWhere || null;
  const multiRows = (m: MultiOption) =>
    withSwap(
      multiKitRows(m, rooms?.rooms ?? [], {
        runs: Object.fromEntries((rooms?.rooms ?? []).map((r) => [r.name, runOf(r)])),
        outdoorAt: multiWhereOf(),
      }),
      swapOf(),
      "the multi"
    );

  /* how the VRF's heads connect: the brief's way, else branch boxes when
     they serve every room, else City Multi — or as a person switches it */
  const [vrfWay, setVrfWay] = useState<VrfMethod | null>(null);
  const vrfWayOf = (): VrfMethod => vrfWay ?? rooms?.vrfHeads ?? (rooms?.vrf?.box?.ok ? "box" : "joint");
  const vrfP = rooms?.vrf ? rooms.vrf[vrfWayOf()] : null;
  const vrfRows = (v: VrfOption) =>
    withSwap(
      vrfKitRows(v, rooms?.rooms ?? [], {
        runs: Object.fromEntries((rooms?.rooms ?? []).map((r) => [r.name, runOf(r)])),
        outdoorAt: multiWhereOf(),
      }),
      swapOf(),
      "the VRF"
    );

  /* a whole system's rows, as the ducted block built them */
  const addSystem = async (key: string, rows: ReturnType<typeof kitRows>) => {
    setBusy(key);
    setNote(null);
    try {
      await addRows(job, rows);
      setAdded((s) => new Set(s).add(key));
      onAdded();
    } catch {
      setNote("The system couldn't be added. Try again.");
    }
    setBusy(null);
  };

  const addMulti = async (m: MultiOption) => {
    const key = `multi|${m.outdoor}`;
    const rows = multiRows(m);
    setBusy(key);
    setNote(null);
    try {
      await addRows(job, rows);
      setAdded((s) => new Set(s).add(key));
      onAdded();
    } catch {
      setNote("The multi couldn't be added. Try again.");
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
            <b>A swap</b>
            <em>{swapSet === null && (rooms.swap.replacing || rooms.swap.keepPipe) ? "From the brief" : "Ticked here, or a new install"}</em>
            <span className="qs-acts2 qs-act">
              <label>
                <input
                  type="checkbox"
                  checked={swapOf().replacing}
                  disabled={busy !== null}
                  onChange={(e) => setSwapSet({ ...swapOf(), replacing: e.target.checked })}
                />{" "}
                Old system out
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={swapOf().keepPipe}
                  disabled={busy !== null}
                  onChange={(e) => setSwapSet({ ...swapOf(), keepPipe: e.target.checked })}
                />{" "}
                Keeping the pipe
              </label>
            </span>
          </div>
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
              {!rooms.ducted && (
              <>
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
              </>
              )}
            </div>
          ))}
          {rooms.ducted && (
            <Ducted
              system={rooms.ducted}
              swap={swapOf()}
              roomNames={rooms.rooms.map((r) => r.name)}
              busy={busy}
              added={added}
              onAdd={(key, rows) => void addSystem(key, rows)}
            />
          )}
          {rooms.multi && !rooms.multi.ok && <p className="wb2-shtext">{`One multi for these rooms: ${rooms.multi.why}.`}</p>}
          {rooms.multi?.ok && (
            <div>
              <div className="wb2-mline">
                <b>{`Or one multi for the ${rooms.multi.multi.heads.length} rooms`}</b>
                <em>{`${rooms.multi.multi.outdoor}, ${rooms.multi.multi.coolKw} kW cooling, ${rooms.multi.multi.heatKw} kW heating`}</em>
                <span>
                  <button
                    type="button"
                    className="pbtn ghost sm"
                    disabled={busy !== null || added.has(`multi|${rooms.multi.multi.outdoor}`)}
                    onClick={() => rooms.multi?.ok && void addMulti(rooms.multi.multi)}
                  >
                    {added.has(`multi|${rooms.multi.multi.outdoor}`) ? "Added" : busy === `multi|${rooms.multi.multi.outdoor}` ? "Adding" : "Add to materials"}
                  </button>
                </span>
              </div>
              {rooms.multi.multi.heads.map((h) => (
                <div className="wb2-mline" key={`head-${h.room}`}>
                  <b>{h.indoor}</b>
                  <em>{`${h.style} for ${h.room}, ${h.coolKw} kW cooling, ${h.heatKw} kW heating`}</em>
                  <span />
                </div>
              ))}
              <div className="wb2-mline">
                <b>Outdoor</b>
                <em>{multiWhere === undefined && multiWhereOf() != null ? "From the brief" : multiWhereOf() == null ? "To ask: goes on as an outdoor mount to ask" : "Set here"}</em>
                <span>
                  <select
                    className="wb2-sel"
                    aria-label="Where the multi's outdoor sits"
                    value={multiWhereOf() ?? ""}
                    disabled={busy !== null}
                    onChange={(e) => setMultiWhere(e.target.value as OutdoorAt | "")}
                  >
                    {WHERE.map((w) => (
                      <option key={w.value} value={w.value}>
                        {w.label}
                      </option>
                    ))}
                  </select>
                </span>
              </div>
              {multiPipeWords(
                rooms.multi.multi,
                rooms.rooms.map((r) => ({ room: r.name, runM: runOf(r) }))
              ).map((w) => (
                <p className="wb2-shtext" key={w}>{`${w}.`}</p>
              ))}
              <p className="wb2-shtext">
                {`With it: ${multiRows(rooms.multi.multi)
                  .filter((k) => !/indoor unit|outdoor unit/i.test(k.sub))
                  .map((k) => `${k.name.toLowerCase()} (${k.qty})`)
                  .join(", ")}.`}
              </p>
            </div>
          )}
          {vrfP && !vrfP.ok && <p className="wb2-shtext">{`A VRF for these rooms: ${vrfP.why}.`}</p>}
          {vrfP?.ok && (
            <div>
              <div className="wb2-mline">
                <b>{`${rooms.vrfSaid ? "A" : "Or a"} VRF for the ${vrfP.vrf.heads.length} rooms`}</b>
                <em>{`${vrfP.vrf.outdoor}, ${vrfP.vrf.coolKw} kW cooling, ${vrfP.vrf.heatKw} kW heating`}</em>
                <span>
                  <button
                    type="button"
                    className="pbtn ghost sm"
                    disabled={busy !== null || added.has(`vrf|${vrfP.vrf.outdoor}`)}
                    onClick={() => vrfP?.ok && void addSystem(`vrf|${vrfP.vrf.outdoor}`, vrfRows(vrfP.vrf))}
                  >
                    {added.has(`vrf|${vrfP.vrf.outdoor}`) ? "Added" : busy === `vrf|${vrfP.vrf.outdoor}` ? "Adding" : "Add to materials"}
                  </button>
                </span>
              </div>
              <div className="wb2-mline">
                <b>Heads</b>
                <em>{vrfWay === null && rooms.vrfHeads ? "From the brief" : "Every head the same way, never a mix"}</em>
                <span>
                  <select
                    className="wb2-sel"
                    aria-label="How the VRF's heads connect"
                    value={vrfWayOf()}
                    disabled={busy !== null}
                    onChange={(e) => setVrfWay(e.target.value as VrfMethod)}
                  >
                    {(["box", "joint"] as const).map((m) => (
                      <option key={m} value={m}>
                        {VRF_METHOD_WORDS[m]}
                      </option>
                    ))}
                  </select>
                </span>
              </div>
              {vrfP.vrf.heads.map((h) => (
                <div className="wb2-mline" key={`vrf-${h.room}`}>
                  <b>{h.indoor}</b>
                  <em>{`${h.style} for ${h.room}, ${h.coolKw} kW cooling, ${h.heatKw} kW heating`}</em>
                  <span />
                </div>
              ))}
              <div className="wb2-mline">
                <b>Outdoor</b>
                <em>{multiWhere === undefined && multiWhereOf() != null ? "From the brief" : multiWhereOf() == null ? "To ask: goes on as an outdoor mount to ask" : "Set here"}</em>
                <span>
                  <select
                    className="wb2-sel"
                    aria-label="Where the VRF's outdoor sits"
                    value={multiWhereOf() ?? ""}
                    disabled={busy !== null}
                    onChange={(e) => setMultiWhere(e.target.value as OutdoorAt | "")}
                  >
                    {WHERE.map((w) => (
                      <option key={w.value} value={w.value}>
                        {w.label}
                      </option>
                    ))}
                  </select>
                </span>
              </div>
              <p className="wb2-shtext">
                {`From the data pack: ${vrfP.vrf.fittings.map((f) => (f.part ? `${f.part} (${f.kind === "box" ? "branch box" : f.kind})` : `a ${f.kind} to size`)).join(", ") || "no fittings"}.`}
              </p>
              <p className="wb2-shtext">
                {`With it: ${vrfRows(vrfP.vrf)
                  .filter((k) => !/indoor unit|outdoor unit/i.test(k.sub))
                  .map((k) => `${k.name.toLowerCase()} (${k.qty})`)
                  .join(", ")}.`}
              </p>
            </div>
          )}
          {rooms.dropped.length > 0 && (
            <p className="wb2-shtext">{`Not used, their size isn't in the brief's words: ${rooms.dropped.join(", ")}.`}</p>
          )}
        </>
      )}
    </section>
  );
}

/* ONE DUCTED SYSTEM FOR THE ROOMS — the pair that covers them together, and
   the air side as the brief gives it: its outlets, returns, ductwork piece
   by piece, and zoning; what the brief left out is asked. */
function Ducted({
  system,
  swap,
  roomNames,
  busy,
  added,
  onAdd,
}: {
  system: NonNullable<BriefRooms["ducted"]>;
  swap: Swap;
  /** the rooms the brief sized: the system's zones' rooms */
  roomNames: string[];
  busy: string | null;
  added: Set<string>;
  onAdd: (key: string, rows: ReturnType<typeof ductedKitRows>) => void;
}) {
  const { read } = system;
  const [run, setRun] = useState<string | undefined>(undefined);
  const [where, setWhere] = useState<OutdoorAt | "" | undefined>(undefined);
  const runM = (() => {
    if (run === undefined) return read.run.m;
    const n = Number(run);
    return run.trim() !== "" && Number.isFinite(n) && n > 0 && n <= 100 ? Math.round(n * 10) / 10 : null;
  })();
  const outdoorAt = where === undefined ? read.outdoor.at : where || null;
  const choices = { runM, outdoorAt, newCircuit: read.circuit.needed, drainPump: read.drain.how === "pump" };
  const rowsOf = (o: DuctedPair) => withSwap(ductedKitRows(o, read, choices, system.controller, system.usual), swap, "the ducted system");
  const first = system.options[0];
  return (
    <div>
      <div className="wb2-mline">
        <b>{`One ducted system for the ${roomNames.length} rooms`}</b>
        <em>{`${system.loadKw} kW together`}</em>
        <span />
      </div>
      {system.options.length === 0 && <p className="wb2-shtext">No ducted pair in the data pack covers that load: Studio, or two systems.</p>}
      {system.options.map((o) => {
        const key = `ducted|${o.indoor}|${o.outdoor}`;
        return (
          <div className="wb2-mline" key={key}>
            <b>{`${o.indoor} + ${o.outdoor}`}</b>
            <em>{`${o.coolKw} kW cooling, ${o.heatKw} kW heating${o.airflowLs ? `, ${o.airflowLs} L/s` : ""}`}</em>
            <span>
              <button type="button" className="pbtn ghost sm" disabled={busy !== null || added.has(key)} onClick={() => onAdd(key, rowsOf(o))}>
                {added.has(key) ? "Added" : busy === key ? "Adding" : "Add to materials"}
              </button>
            </span>
          </div>
        );
      })}
      <div className="wb2-mline">
        <b>Pipe run</b>
        <em>{run === undefined && read.run.m != null ? "From the brief" : runM == null ? "To ask: goes on as Run to ask" : "Typed here"}</em>
        <span className="qs-in">
          <input
            className="wb2-fi wb2-jqpct"
            inputMode="decimal"
            aria-label="Pipe run for the ducted system, metres"
            value={run ?? (read.run.m != null ? String(read.run.m) : "")}
            disabled={busy !== null}
            onChange={(e) => setRun(e.target.value)}
          />
          <em>m</em>
        </span>
      </div>
      <div className="wb2-mline">
        <b>Outdoor</b>
        <em>{where === undefined && read.outdoor.at != null ? "From the brief" : outdoorAt == null ? "To ask: goes on as an outdoor mount to ask" : "Set here"}</em>
        <span>
          <select
            className="wb2-sel"
            aria-label="Where the ducted system's outdoor sits"
            value={outdoorAt ?? ""}
            disabled={busy !== null}
            onChange={(e) => setWhere(e.target.value as OutdoorAt | "")}
          >
            {WHERE.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </select>
        </span>
      </div>
      {read.outlets.length > 0 && (
        <p className="wb2-shtext">{`Outlets: ${read.outlets.map((o) => `${o.count || "?"} × ${outletName(o).toLowerCase()}${o.room ? ` (${o.room})` : ""}`).join(", ")}.`}</p>
      )}
      {read.returns.length > 0 && <p className="wb2-shtext">{`Returns: ${read.returns.map((r) => (r.common ? "a common return" : r.room)).join(", ")}.`}</p>}
      {read.layout.length > 0 && <p className="wb2-shtext">{`Ductwork, as the brief has it: ${read.layout.map((p) => `“${p.said}”`).join(" ")}`}</p>}
      {read.layout.length === 0 && system.usual && <p className="wb2-shtext">Ductwork: your usual layout from Quoting, as the brief doesn&apos;t describe one.</p>}
      {read.zoning && <p className="wb2-shtext">{`Zoning: “${read.zoning.said}”${system.controller ? `, by ${system.controller.vendor}'s book in the data pack` : ""}`}</p>}
      {makerZoningWords(system.controller, read.zoning).map((w) => (
        <p className="wb2-shtext" key={w}>{`${w}.`}</p>
      ))}
      {system.air.map((w) => (
        <p className="wb2-shtext" key={w}>{`${w}.`}</p>
      ))}
      {first && (
        <p className="wb2-shtext">
          {`With it: ${rowsOf(first)
            .slice(2)
            .map((k) => `${k.name.toLowerCase()} (${k.qty})`)
            .join(", ")}.`}
        </p>
      )}
      <p className="wb2-shtext">{`To ask: ${ductedAsks(read, choices, roomNames, system.usual).join("; ")}.`}</p>
      {system.dropped.length > 0 && <p className="wb2-shtext">{`Not used, their words aren't the brief's: ${system.dropped.join(", ")}.`}</p>}
    </div>
  );
}
