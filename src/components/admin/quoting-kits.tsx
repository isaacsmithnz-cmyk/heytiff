"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/parts/button";
import { Chooser } from "@/components/parts/chooser";
import { Dialog } from "@/components/parts/dialog";
import { Fade } from "@/components/parts/fade";
import { Field, TextInput } from "@/components/parts/field";
import { Tray } from "@/components/parts/tabs";
import { Tick } from "@/components/parts/tick";
import { Group, Wrong } from "@/components/settings/parts";
import type { KitPreviewItem, KitPreviewPart } from "@/lib/quotes/kits";
import type { RangeKind } from "@/lib/quotes/ranges";
import { dollars } from "./pb-bits";

/* KITS, AS RANGES, on Price book › What prices each part (Isaac,
   2026-10-11, the round-2 mock he said yes to: "there should be a selection
   under each item. So the Y branches should be all of the Y branch
   combinations… supply plenum and return plenum… it depends on the unit…
   Reducer, same thing… Return grille again, range of sizes").

   A kit, priced at the business's own example — the unit it names and its
   outlets; nothing until it gives one — part by part: how many, what sizes
   it, what it comes to, and under each sized part every item of its kind
   in the book. Ticked is in the business's range: every size, until it
   narrows it; unticking one keeps the others. The one the example used
   says so. */

const ROUTE = "/api/quoting/kit";
const RANGES = "/api/quoting/ranges";
const OUTLET_SIZES = [150, 200, 250, 300, 350, 400];
/* a long range shows its first rows until asked */
const SHOWN = 15;

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

const KITS = [
  { value: "split" as const, label: "Split" },
  { value: "ducted" as const, label: "Ducted" },
];

export function KitsSection() {
  const [example, setExample] = useState<Example>({ kit: "ducted", brand: "", model: "", outlets: "", outletMm: "", underfloor: false, mount: "ground" });
  /* the example as it's being typed; priced on Price the kit */
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

  const summary = [
    example.kit === "ducted" && example.underfloor ? "Under the floor" : null,
    answer?.unit ? answer.unit.model : example.model ? `${example.model} (not in its data pack)` : null,
    answer?.unit?.coolKw ? `${answer.unit.coolKw} kW` : null,
    example.kit === "ducted" && example.outlets ? `${example.outlets} outlets${example.outletMm ? ` of Ø${example.outletMm}` : ""}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Group
      heading="Kits"
      tools={
        <Button kind="second" size={32} onClick={() => setDraft({ ...example })}>
          Change the example
        </Button>
      }
    >
      <div className="st2-pb-kitbar">
        <Tray ariaLabel="Kit" options={KITS} value={example.kit} onChange={(k) => setExample({ ...example, kit: k })} />
        <p className="st2-pb-said">
          {summary ? `Priced at ${summary}` : "Priced at your example, once you name a unit"}
        </p>
        <p className="st2-pb-said st2-pb-kittotal">
          <b>{answer ? dollars(answer.totalCents) : "Pricing the kit"}</b>
          <span>The kit at this size, ex GST, at cost</span>
        </p>
      </div>
      {note && <Wrong>{note}</Wrong>}
      {(answer?.parts ?? []).map((part) => {
        const total = part.lines.filter((l) => l.known).reduce((n, l) => n + l.totalCents, 0);
        const range = part.range;
        const open = all.has(part.key);
        const items = range ? (open ? range.items : range.items.slice(0, SHOWN)) : [];
        return (
          <section key={part.key} aria-label={part.name}>
            <div className="st2-pb-kitpart">
              <span className="st2-pb-name">
                <b>{part.name}</b>
                <span className="st2-pb-line">{part.rule}</span>
                <span className="st2-pb-line">{part.sizedBy}</span>
              </span>
              <div className="st2-pb-kituses">
                {part.lines.map((l, i) =>
                  l.known ? (
                    <div key={i} className="st2-pb-kituse">
                      <span className="st2-pb-name">
                        <Fade>{l.name}</Fade>
                        <span className="st2-pb-line">{l.code}</span>
                      </span>
                      <span className="st2-pb-fig st2-pb-line">{`${l.qty}${l.unit ? ` ${l.unit}` : ""} × ${dollars(l.eachCents)}`}</span>
                    </div>
                  ) : (
                    <span key={i} className="st2-pb-line">
                      {l.why}
                    </span>
                  )
                )}
              </div>
              <span className="st2-pb-fig">
                <b>{total > 0 ? dollars(total) : ""}</b>
              </span>
            </div>
            {range && (
              <>
                <p className="st2-pb-said">
                  {range.items.length === 0
                    ? "Your range: none in your book"
                    : `Your range: ${range.items.filter((i) => i.ticked).length} of ${range.items.length} in your book${range.held ? "" : ", every size until you narrow it"}`}
                </p>
                {items.length > 0 && (
                  <ul className="st2-pb-kitrange">
                    {items.map((i) => (
                      <li key={`${i.supplierKey}|${i.code}`}>
                        <Tick
                          checked={i.ticked}
                          disabled={busy}
                          onChange={() => void tick(range.kind, range.held, range.items, i)}
                          label={
                            <>
                              <b>{i.words}</b>
                              <span className="st2-pb-line">{`${i.code}, ${i.supplierName}, ${dollars(i.cents)}`}</span>
                              {i.used && <span className="st2-pb-line">At this size</span>}
                            </>
                          }
                        />
                      </li>
                    ))}
                  </ul>
                )}
                {!open && range.items.length > SHOWN && (
                  <div className="st2-pb-foot">
                    <Button kind="quiet" size={32} onClick={() => setAll(new Set(all).add(part.key))}>
                      {`Show all ${range.items.length} sizes`}
                    </Button>
                  </div>
                )}
              </>
            )}
          </section>
        );
      })}

      {draft && (
        <ExampleDialog
          draft={draft}
          brands={answer?.brands ?? []}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onPrice={() => {
            setExample(draft);
            setDraft(null);
          }}
        />
      )}
    </Group>
  );
}

/** The example a kit is priced at: the unit it names and, ducted, its outlets. */
function ExampleDialog({
  draft: e,
  brands,
  onChange,
  onClose,
  onPrice,
}: {
  draft: Example;
  brands: string[];
  onChange: (e: Example) => void;
  onClose: () => void;
  onPrice: () => void;
}) {
  return (
    <Dialog
      heading="Your example"
      width={560}
      onClose={onClose}
      foot={
        <>
          <Button kind="second" size={36} onClick={onClose}>
            Cancel
          </Button>
          <Button kind="main" size={36} onClick={onPrice}>
            Price the kit
          </Button>
        </>
      }
    >
      <div className="st2-pb-dlg">
        <Tray ariaLabel="Kit" options={KITS} value={e.kit} onChange={(k) => onChange({ ...e, kit: k })} />
        <div className="st2-pb-fields">
          <Field label="Its maker">
            <Chooser placeholder="Choose a maker" options={brands.map((b) => ({ value: b, label: brandWords(b) }))} value={e.brand || null} onChange={(v) => onChange({ ...e, brand: v })} />
          </Field>
          <Field label={e.kit === "ducted" ? "The indoor's model" : "The outdoor's model"}>
            <TextInput value={e.model} onChange={(ev) => onChange({ ...e, model: ev.target.value })} />
          </Field>
          {e.kit === "ducted" && (
            <>
              <Field label="Outlets">
                <TextInput inputMode="numeric" value={e.outlets} onChange={(ev) => onChange({ ...e, outlets: ev.target.value.replace(/\D/g, "").slice(0, 2) })} />
              </Field>
              <Field label="Their size">
                <Chooser placeholder="Choose a size" options={OUTLET_SIZES.map((mm) => ({ value: String(mm), label: `Ø${mm}` }))} value={e.outletMm || null} onChange={(v) => onChange({ ...e, outletMm: v })} />
              </Field>
            </>
          )}
        </div>
        {e.kit === "ducted" ? (
          <Tick label="Under the floor" checked={e.underfloor} onChange={(on) => onChange({ ...e, underfloor: on })} />
        ) : (
          <Tick label="On a wall bracket" checked={e.mount === "wall"} onChange={(on) => onChange({ ...e, mount: on ? "wall" : "ground" })} />
        )}
      </div>
    </Dialog>
  );
}
