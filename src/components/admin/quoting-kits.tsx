"use client";

import { useEffect, useState } from "react";
import type { KitPreviewItem, KitPreviewPart } from "@/lib/quotes/kits";
import type { RangeKind } from "@/lib/quotes/ranges";

/* KITS IN QUOTING, AS RANGES (Isaac, 2026-10-11, the round-2 mock he said
   yes to: "there should be a selection under each item. So the Y branches
   should be all of the Y branch combinations… supply plenum and return
   plenum… it depends on the unit… Reducer, same thing… Return grille
   again, range of sizes").

   A kit, priced at the business's own example — the unit it names and its
   outlets; nothing until it gives one — part by part: how many, what sizes
   it, what it comes to, and under each sized part every item of its kind
   in the book. Ticked is in the business's range: every size, until it
   narrows it; unticking one keeps the others. The one the example used is
   outlined. */

const ROUTE = "/api/quoting/kit";
const RANGES = "/api/quoting/ranges";
const OUTLET_SIZES = [150, 200, 250, 300, 350, 400];
/* a long range shows its first rows until asked */
const SHOWN = 15;

const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2 });
const $ = (cents: number) => money.format(cents / 100);
const brandWords = (key: string) => key.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

type Example = { kit: "split" | "ducted"; brand: string; model: string; outlets: string; outletMm: string; underfloor: boolean; mount: "ground" | "wall" };
type Answer = {
  ok: boolean;
  reason?: string;
  unit: { model: string; role: "indoor" | "outdoor"; coolKw: number | null } | null;
  brands: string[];
  parts: KitPreviewPart[];
  totalCents: number;
};

const query = (e: Example) =>
  new URLSearchParams({
    kit: e.kit,
    brand: e.brand,
    model: e.model.trim(),
    outlets: e.outlets,
    outletMm: e.outletMm,
    underfloor: e.underfloor ? "1" : "",
    mount: e.mount,
  }).toString();

export function KitsSection() {
  const [example, setExample] = useState<Example>({ kit: "ducted", brand: "", model: "", outlets: "", outletMm: "", underfloor: false, mount: "ground" });
  /* the example as it's being typed; priced on Price it */
  const [draft, setDraft] = useState<Example | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [reads, setReads] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [all, setAll] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => fetch(`${ROUTE}?${query(example)}`))
      .then((r) => r.json() as Promise<Answer>)
      .then((a) => live && setAnswer(a.ok && Array.isArray(a.parts) ? a : null))
      .catch(() => live && setAnswer(null));
    return () => {
      live = false;
    };
  }, [example, reads]);

  /* a tick in or out of the range; the range a business hasn't narrowed is
     every size, so the first untick keeps all the others */
  const tick = async (kind: RangeKind, held: boolean, items: KitPreviewItem[], item: KitPreviewItem) => {
    setBusy(true);
    setNote(null);
    const ref = (i: KitPreviewItem) => ({ supplierKey: i.supplierKey, code: i.code, size: i.size });
    const body = !held
      ? { kind, add: items.filter((i) => i !== item).map(ref), remove: [] }
      : item.ticked
        ? { kind, add: [], remove: [{ supplierKey: item.supplierKey, code: item.code }] }
        : { kind, add: [ref(item)], remove: [] };
    const r = await fetch(RANGES, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const a = r ? ((await r.json().catch(() => null)) as { ok: boolean; reason?: string } | null) : null;
    setBusy(false);
    if (!a?.ok) setNote(a?.reason ?? "The range couldn't be saved. Try again.");
    setReads((n) => n + 1);
  };

  const e = draft ?? example;
  const summary = [
    example.kit === "ducted" && example.underfloor ? "Under the floor" : null,
    answer?.unit ? answer.unit.model : example.model ? `${example.model} (not in its data pack)` : null,
    answer?.unit?.coolKw ? `${answer.unit.coolKw} kW` : null,
    example.kit === "ducted" && example.outlets ? `${example.outlets} outlets${example.outletMm ? ` of ${example.outletMm}` : ""}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <section className="qs-group qs-kits" aria-labelledby="qs-kits">
      <h2 className="qs-h" id="qs-kits">
        Kits
      </h2>
      <div className="qs-kitbar">
        <div className="wb2-ckseg" role="radiogroup" aria-label="Kit">
          {(["split", "ducted"] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={example.kit === k} className={example.kit === k ? "on" : undefined} onClick={() => setExample({ ...example, kit: k })}>
              {k === "split" ? "Split" : "Ducted"}
            </button>
          ))}
        </div>
        <div className="qs-kat">
          <span>Priced at</span>
          <b>{summary || "Your example: name a unit"}</b>
          <button type="button" className="qs-klink" onClick={() => setDraft(draft ? null : { ...example })}>
            {draft ? "Close" : "Change"}
          </button>
        </div>
        <div className="qs-ktot">
          <span>The kit at this size</span>
          <b>{answer ? $(answer.totalCents) : "Pricing"}</b>
          <span>ex GST, at cost</span>
        </div>
      </div>
      {draft && (
        <div className="qs-kform" aria-label="Your example">
          <label className="qs-field">
            <span>Its maker</span>
            <select className="wb2-fi" value={e.brand} onChange={(ev) => setDraft({ ...e, brand: ev.target.value })}>
              <option value="">Choose</option>
              {(answer?.brands ?? []).map((b) => (
                <option key={b} value={b}>
                  {brandWords(b)}
                </option>
              ))}
            </select>
          </label>
          <label className="qs-field">
            <span>{e.kit === "ducted" ? "The indoor's model" : "The outdoor's model"}</span>
            <input className="wb2-fi" value={e.model} onChange={(ev) => setDraft({ ...e, model: ev.target.value })} />
          </label>
          {e.kit === "ducted" ? (
            <>
              <label className="qs-field">
                <span>Outlets</span>
                <input className="wb2-fi" inputMode="numeric" value={e.outlets} onChange={(ev) => setDraft({ ...e, outlets: ev.target.value.replace(/\D/g, "").slice(0, 2) })} />
              </label>
              <label className="qs-field">
                <span>Their size</span>
                <select className="wb2-fi" value={e.outletMm} onChange={(ev) => setDraft({ ...e, outletMm: ev.target.value })}>
                  <option value="">Choose</option>
                  {OUTLET_SIZES.map((mm) => (
                    <option key={mm} value={mm}>{`Ø${mm}`}</option>
                  ))}
                </select>
              </label>
              <label className="qs-check">
                <input type="checkbox" checked={e.underfloor} onChange={(ev) => setDraft({ ...e, underfloor: ev.target.checked })} />
                Under the floor
              </label>
            </>
          ) : (
            <label className="qs-check">
              <input type="checkbox" checked={e.mount === "wall"} onChange={(ev) => setDraft({ ...e, mount: ev.target.checked ? "wall" : "ground" })} />
              On a wall bracket
            </label>
          )}
          <button
            type="button"
            className="pbtn primary sm"
            onClick={() => {
              setExample(e);
              setDraft(null);
            }}
          >
            Price it
          </button>
        </div>
      )}
      {note && <p className="wb2-sherr">{note}</p>}
      <div className="qs-kcols" aria-hidden="true">
        <span>Part</span>
        <span>How many</span>
        <span>Which size</span>
        <span>At this size</span>
        <span className="r">Total</span>
      </div>
      {(answer?.parts ?? []).map((part) => {
        const total = part.lines.filter((l) => l.known).reduce((n, l) => n + l.totalCents, 0);
        const range = part.range;
        const open = all.has(part.key);
        const items = range ? (open ? range.items : range.items.slice(0, SHOWN)) : [];
        return (
          <section key={part.key} className="qs-kpart" aria-label={part.name}>
            <div className="qs-kph">
              <b>{part.name}</b>
              <span>{part.rule}</span>
              <span>{part.sizedBy}</span>
              <div className="qs-kuses">
                {part.lines.map((l, i) =>
                  l.known ? (
                    <div key={i} className="qs-kuse">
                      <span>
                        {l.name}
                        <small>{l.code}</small>
                      </span>
                      <span className="n">{`${l.qty}${l.unit ? ` ${l.unit}` : ""} × ${$(l.eachCents)}`}</span>
                    </div>
                  ) : (
                    <div key={i} className="qs-kuse none">
                      <span>{l.why}</span>
                    </div>
                  )
                )}
              </div>
              <span className="qs-kamt">{total > 0 ? $(total) : ""}</span>
            </div>
            {range && (
              <>
                <div className="qs-krh">
                  <b>Your range</b>
                  <span>
                    {range.items.length === 0
                      ? "None in your book"
                      : `${range.items.filter((i) => i.ticked).length} of ${range.items.length} in your book${range.held ? "" : ", every size until you narrow it"}`}
                  </span>
                </div>
                {items.length > 0 && (
                  <ul className="qs-krange">
                    {items.map((i) => (
                      <li key={`${i.supplierKey}|${i.code}`} className={i.used ? "now" : undefined}>
                        <label>
                          <input type="checkbox" checked={i.ticked} disabled={busy} onChange={() => void tick(range.kind, range.held, range.items, i)} />
                          <span>
                            <b>{i.words}</b>
                            <small>
                              <span>{`${i.code}, ${i.supplierName}`}</span>
                              <span className="n">{$(i.cents)}</span>
                            </small>
                            {i.used && <em>At this size</em>}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
                {!open && range.items.length > SHOWN && (
                  <button type="button" className="qs-klink" onClick={() => setAll(new Set(all).add(part.key))}>
                    {`All ${range.items.length} sizes`}
                  </button>
                )}
              </>
            )}
          </section>
        );
      })}
    </section>
  );
}
