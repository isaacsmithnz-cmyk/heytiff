"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/shell/icon";
import { ScreenBand, ScreenPanel } from "@/components/shell/screen-band";
import { saveQuoteSettings } from "@/app/actions/quote-settings";
import { profitSharePct, sellCents, type ComponentKey } from "@/lib/quotes/components";
import type { ComponentItem, ComponentShortlist } from "@/lib/quotes/settings-query";
import type { SupplierView } from "@/lib/quotes/price-book-server";
import { PriceBook } from "./price-book-panel";
import { LinksPanel } from "./links-panel";
import { MAX_DAY_HOURS, MAX_MARKUP_PCT, type QuoteSettings } from "@/lib/quotes/settings";

/* QUOTING — what a quote is priced by.

   THE MARKUP says its profit share beside it, because 20% markup is 16.7% of
   the sell price and the two get confused on every quote otherwise.

   PREFERRED ITEMS: each common component (pair coil by size, cable, drain
   hose, isolator…) is priced from ONE price-book item. The row shows the
   chosen one with its buy price, what a metre (or one) costs, and what it
   sells at with the materials markup. Change opens the shortlist: the
   price-book items whose names match, most used on the business's jobs
   first, then cheapest per metre. A roll's length is read off the item's
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

  const choose = (key: ComponentKey, item: ComponentItem, rollM: number | null) =>
    save(
      { ...saved, preferred: { ...saved.preferred, [key]: { supplierKey: item.supplierKey, code: item.code, rollM } } },
      "Preferred item saved"
    ).then((ok) => {
      if (ok) setOpen(null);
    });

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
                  <span role="columnheader">Preferred item</span>
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
                    onChoose={(item, rollM) => void choose(c.key, item, rollM)}
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
}: {
  c: ComponentShortlist;
  markupPct: number;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onChoose: (item: ComponentItem, rollM: number | null) => void;
}) {
  const p = c.preferred;
  const [roll, setRoll] = useState(p?.rollM ? String(p.rollM) : "");
  return (
    <>
      <div className={`qs-row${open ? " on" : ""}`} role="row">
        <b role="cell">{c.label}</b>
        <span role="cell" className="qs-item">
          {p ? (
            <>
              {p.name}
              <em>{`${p.code}, ${p.supplierName}`}</em>
            </>
          ) : (
            <em className="qs-none">None chosen</em>
          )}
        </span>
        <span role="cell" className="num">{p ? $(p.buyCents) : ""}</span>
        <span role="cell" className="num">
          {p ? (p.perUnitCents == null ? "Needs roll length" : `${$(p.perUnitCents)} ${perUnitWord(c.unit)}`) : ""}
        </span>
        <span role="cell" className="num">
          {p && p.perUnitCents != null ? `${$(sellCents(p.perUnitCents, markupPct))} ${perUnitWord(c.unit)}` : ""}
        </span>
        <span role="cell" className="qs-act">
          <button type="button" className="pbtn ghost sm" disabled={busy} onClick={onToggle} aria-expanded={open}>
            {open ? "Close" : p ? "Change item" : "Choose item"}
          </button>
        </span>
      </div>
      {open && (
        <div className="qs-pick" role="row">
          <div role="cell">
            {c.unit === "m" && p && (
              <div className="qs-roll">
                <label className="qs-field">
                  <span>{`Roll length of ${p.code}`}</span>
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
                  onClick={() => onChoose(p, Number(roll))}
                >
                  Save length
                </button>
              </div>
            )}
            {c.items.length === 0 ? (
              <p className="qs-sub">No price-book item matches this yet.</p>
            ) : (
              <ul className="qs-list">
                {c.items.map((it) => (
                  <li key={it.id} className={p?.id === it.id ? "on" : undefined}>
                    <span className="qs-item">
                      {it.name}
                      <em>
                        {[it.code, it.supplierName, it.uses ? `On ${it.uses} job line${it.uses === 1 ? "" : "s"}` : null]
                          .filter(Boolean)
                          .join(", ")}
                      </em>
                    </span>
                    <span className="num">{$(it.buyCents)}</span>
                    <span className="num">
                      {it.perUnitCents == null
                        ? c.unit === "m"
                          ? "Length not in the name"
                          : "–"
                        : `${$(it.perUnitCents)} ${perUnitWord(c.unit)}`}
                    </span>
                    <span className="qs-act">
                      {p?.id === it.id ? (
                        <em className="qs-chosen ok">Preferred</em>
                      ) : (
                        <button
                          type="button"
                          className="pbtn ghost sm"
                          disabled={busy}
                          onClick={() => onChoose(it, null)}
                          aria-label={`Use ${it.name}`}
                        >
                          Use this
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
