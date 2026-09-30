"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/shell/icon";
import { ScreenBand, ScreenPanel } from "@/components/shell/screen-band";
import { saveQuoteSettings } from "@/app/actions/quote-settings";
import { profitSharePct, sellCents, type ComponentKey } from "@/lib/quotes/components";
import type { ComponentGroup, ComponentOffer, ComponentShortlist } from "@/lib/quotes/settings-query";
import type { SupplierView } from "@/lib/quotes/price-book-server";
import { PriceBook } from "./price-book-panel";
import { LinksPanel } from "./links-panel";
import { MAX_DAY_HOURS, MAX_MARKUP_PCT, type QuoteSettings } from "@/lib/quotes/settings";

/* QUOTING — what a quote is priced by.

   THE MARKUP says its profit share beside it, because 20% markup is 16.7% of
   the sell price and the two get confused on every quote otherwise.

   PREFERRED ITEMS: each common component (pair coil by size, cable, drain
   hose, isolator…) is priced from ONE price-book item — the LOWEST priced
   per metre or each, by default (Isaac, 2026-09-30). Override opens the
   shortlist and a person picks another; Use lowest goes back. The same item
   at several suppliers is one row with every supplier's price beside it,
   the lowest in the state's green. A roll's length is read off the item's
   name; where it can't be, it can be typed, and a metre can't be priced
   until it is. */

const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2 });
const $ = (cents: number | null) => (cents == null ? "–" : money.format(cents / 100));

export function QuotingScreen({
  initial,
  components,
  suppliers,
}: {
  initial: QuoteSettings;
  components: ComponentShortlist[];
  suppliers: SupplierView[];
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [unit, setUnit] = useState(String(initial.unitMarkupPct));
  const [material, setMaterial] = useState(String(initial.materialMarkupPct));
  const [hours, setHours] = useState(String(initial.dayHours));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [open, setOpen] = useState<ComponentKey | null>(null);

  const save = async (next: QuoteSettings, done: string) => {
    setBusy(true);
    setNote(null);
    const res = await saveQuoteSettings(next);
    setBusy(false);
    if (!res.ok) {
      setNote({ tone: "bad", text: res.reason });
      return false;
    }
    setSaved(res.settings);
    setUnit(String(res.settings.unitMarkupPct));
    setMaterial(String(res.settings.materialMarkupPct));
    setHours(String(res.settings.dayHours));
    setNote({ tone: "ok", text: done });
    router.refresh();
    return true;
  };

  const pct = (s: string) => Number(s);
  const changed =
    pct(unit) !== saved.unitMarkupPct || pct(material) !== saved.materialMarkupPct || pct(hours) !== saved.dayHours;
  const valid =
    [unit, material].every((s) => s.trim() !== "" && pct(s) >= 0 && pct(s) <= MAX_MARKUP_PCT) &&
    hours.trim() !== "" &&
    pct(hours) >= 1 &&
    pct(hours) <= MAX_DAY_HOURS;

  const choose = (key: ComponentKey, group: ComponentGroup, offer: ComponentOffer, rollM: number | null) =>
    save(
      { ...saved, preferred: { ...saved.preferred, [key]: { supplierKey: offer.supplierKey, code: offer.code, rollM } } },
      "Item chosen"
    ).then((ok) => {
      if (ok) setOpen(null);
    });

  const backToLowest = (key: ComponentKey) => {
    const preferred = { ...saved.preferred };
    delete preferred[key];
    return save({ ...saved, preferred }, "Back to the lowest price").then((ok) => {
      if (ok) setOpen(null);
    });
  };

  return (
    <div className="page in full">
      <div className="wrap">
        <div className="stg">
          <ScreenBand
            crumb={
              <Link href="/dashboard/admin" className="int-back">
                <Icon name="chevL" size={15} />
                Admin
              </Link>
            }
            title="Quoting"
          />
          <ScreenPanel>
            {note && <div className={`int-note ${note.tone}`}>{note.text}</div>}

            <section className="qs-group">
              <h2 className="qs-h">Markup and the install day</h2>
              <div className="qs-fields">
                <MarkupField label="Units" value={unit} onChange={setUnit} disabled={busy} />
                <MarkupField label="Materials" value={material} onChange={setMaterial} disabled={busy} />
                <label className="qs-field">
                  <span>Install day</span>
                  <span className="qs-in">
                    <input
                      className="wb2-fi"
                      inputMode="decimal"
                      value={hours}
                      disabled={busy}
                      onChange={(e) => setHours(e.target.value)}
                      aria-label="Hours in an install day"
                    />
                    <em>hours</em>
                  </span>
                </label>
              </div>
              <div className="wb2-jqacts">
                <button
                  type="button"
                  className="pbtn primary"
                  disabled={busy || !changed || !valid}
                  onClick={() =>
                    void save(
                      { ...saved, unitMarkupPct: pct(unit), materialMarkupPct: pct(material), dayHours: pct(hours) },
                      "Markup saved"
                    )
                  }
                >
                  Save markup
                </button>
              </div>
            </section>

            <PriceBook suppliers={suppliers} onImported={() => router.refresh()} />

            <LinksPanel />

            <section className="qs-group">
              <h2 className="qs-h">Preferred items</h2>
              <p className="qs-sub">{`Materials sell at buy price plus ${saved.materialMarkupPct}%.`}</p>
              <div className="qs-table" role="table" aria-label="Preferred items">
                <div className="qs-row qs-headrow" role="row">
                  <span role="columnheader">Component</span>
                  <span role="columnheader">Priced from</span>
                  <span role="columnheader" className="num">Buy</span>
                  <span role="columnheader" className="num">Per metre or each</span>
                  <span role="columnheader" className="num">Sells at</span>
                  <span role="columnheader" />
                </div>
                {components.map((c) => (
                  <ComponentRow
                    key={c.key}
                    c={c}
                    markupPct={saved.materialMarkupPct}
                    open={open === c.key}
                    busy={busy}
                    onToggle={() => setOpen((o) => (o === c.key ? null : c.key))}
                    onChoose={(group, offer, rollM) => void choose(c.key, group, offer, rollM)}
                    onLowest={() => void backToLowest(c.key)}
                  />
                ))}
              </div>
            </section>
          </ScreenPanel>
        </div>
      </div>
    </div>
  );
}

function MarkupField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const n = Number(value);
  return (
    <label className="qs-field">
      <span>{label}</span>
      <span className="qs-in">
        <input
          className="wb2-fi"
          inputMode="decimal"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} markup percent`}
        />
        <em>%</em>
      </span>
      <em className="qs-share">
        {value.trim() !== "" && Number.isFinite(n) ? `${profitSharePct(n)}% of the sell price is profit` : "–"}
      </em>
    </label>
  );
}

const perUnitWord = (unit: "m" | "each") => (unit === "m" ? "a metre" : "each");

function ComponentRow({
  c,
  markupPct,
  open,
  busy,
  onToggle,
  onChoose,
  onLowest,
}: {
  c: ComponentShortlist;
  markupPct: number;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onChoose: (group: ComponentGroup, offer: ComponentOffer, rollM: number | null) => void;
  onLowest: () => void;
}) {
  const pick = c.chosen;
  const [roll, setRoll] = useState(pick?.group.rollM ? String(pick.group.rollM) : "");
  return (
    <>
      <div className={`qs-row${open ? " on" : ""}`} role="row">
        <b role="cell">{c.label}</b>
        <span role="cell" className="qs-item">
          {pick ? (
            <>
              {pick.group.name}
              <em>
                {`${pick.offer.code}, ${pick.offer.supplierName}${pick.offer.pack ? `, ${pick.offer.pack}` : ""}, `}
                <span className={pick.overridden ? "qs-state warn" : "qs-state"}>{pick.overridden ? "Override" : "Lowest price"}</span>
              </em>
            </>
          ) : (
            <em className="qs-none">Nothing in the price book prices this yet</em>
          )}
        </span>
        <span role="cell" className="num">{pick ? $(pick.offer.buyCents) : ""}</span>
        <span role="cell" className="num">
          {pick ? (pick.offer.perUnitCents == null ? "Needs roll length" : `${$(pick.offer.perUnitCents)} ${perUnitWord(c.unit)}`) : ""}
        </span>
        <span role="cell" className="num">
          {pick && pick.offer.perUnitCents != null ? `${$(sellCents(pick.offer.perUnitCents, markupPct))} ${perUnitWord(c.unit)}` : ""}
        </span>
        <span role="cell" className="qs-act qs-acts2">
          {pick?.overridden && (
            <button type="button" className="pbtn ghost sm" disabled={busy} onClick={onLowest}>
              Use lowest
            </button>
          )}
          {c.groups.length > 0 && (
            <button type="button" className="pbtn ghost sm" disabled={busy} onClick={onToggle} aria-expanded={open}>
              {open ? "Close" : "Override"}
            </button>
          )}
        </span>
      </div>
      {open && (
        <div className="qs-pick" role="row">
          <div role="cell">
            {c.unit === "m" && pick && (
              <div className="qs-roll">
                <label className="qs-field">
                  <span>{`Roll length of ${pick.offer.code}`}</span>
                  <span className="qs-in">
                    <input
                      className="wb2-fi"
                      inputMode="decimal"
                      value={roll}
                      disabled={busy}
                      onChange={(e) => setRoll(e.target.value)}
                      aria-label="Roll length in metres"
                    />
                    <em>m</em>
                  </span>
                </label>
                <button
                  type="button"
                  className="pbtn ghost"
                  disabled={busy || !(Number(roll) > 0)}
                  onClick={() => onChoose(pick.group, pick.offer, Number(roll))}
                >
                  Save length
                </button>
              </div>
            )}
            <ul className="qs-list">
              {c.groups.map((g) => (
                <li key={g.code} className={pick?.group.code === g.code ? "on" : undefined}>
                  <span className="qs-item">
                    {g.name}
                    <em>
                      {[g.code, g.uses ? `On ${g.uses} job line${g.uses === 1 ? "" : "s"}` : null]
                        .filter(Boolean)
                        .join(", ")}
                    </em>
                  </span>
                  <span className="qs-groupoffers">
                    {g.offers.map((o, i) => {
                      const on = pick?.offer.code === o.code && pick.offer.supplierKey === o.supplierKey;
                      return (
                        <button
                          key={`${o.supplierKey}:${o.code}`}
                          type="button"
                          className={`qs-offerbtn${i === 0 && g.offers.length > 1 ? " ok" : ""}${on ? " on" : ""}`}
                          disabled={busy || on}
                          aria-pressed={on}
                          aria-label={`Use ${o.code} from ${o.supplierName}`}
                          onClick={() => onChoose(g, o, null)}
                        >
                          <em>{o.pack ? `${o.supplierName}, ${o.pack}` : o.supplierName}</em>
                          {o.perUnitCents == null
                            ? c.unit === "m"
                              ? `${$(o.buyCents)}, length not in the name`
                              : $(o.buyCents)
                            : `${$(o.perUnitCents)} ${perUnitWord(c.unit)}`}
                        </button>
                      );
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
