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
import { SameItemsPanel } from "./same-items-panel";
import {
  ALLOWANCES,
  ALLOWANCE_KEYS,
  MAX_ALLOWANCE_CENTS,
  MAX_CHARGE_OUT_CENTS,
  MAX_CONTINGENCY_HOURS,
  MAX_CONTINGENCY_PCT,
  MAX_DAY_HOURS,
  MAX_MARKUP_PCT,
  USUAL_LAYOUT_WORDS,
  type AllowanceKey,
  type QuoteSettings,
} from "@/lib/quotes/settings";
import { orgDayOf, rateFromWords, type CalcDay } from "@/lib/quotes/org-day";

/* QUOTING — what a quote is priced by.

   THE RATE AND THE DAY: the charge-out rate and the working day, set here
   so a business can quote before it has finished its Rate Calculator
   (Isaac, 2026-10-04). Left blank, each is the Rate Calculator's, and the
   field says so; a day on site is the one times the other, never a figure
   of ours (org-day.ts).

   THE DUCT CONTINGENCY: a share of a quote's ductwork and grilles, and
   hours on top at the rate — the business's own, and none when blank.

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

/** A setting as its field shows it: blank when the business hasn't set one. */
const field = (n: number | null) => (n == null ? "" : String(n));
const numOrNone = (s: string) => (s.trim() === "" ? null : Number(s));
/** dollars as typed to cents, blank as not set */
const centsOrNone = (s: string) => (s.trim() === "" ? null : Math.round(Number(s.replace(/[$,\s]/g, "")) * 100));
const dollarsField = (cents: number | null) => (cents == null ? "" : String(cents / 100));
/** blank, or a number from lo to hi */
const inRange = (s: string, lo: number, hi: number) => s.trim() === "" || (Number.isFinite(Number(s)) && Number(s) >= lo && Number(s) <= hi);

export function QuotingScreen({
  initial,
  components,
  suppliers,
  calc,
}: {
  initial: QuoteSettings;
  components: ComponentShortlist[];
  suppliers: SupplierView[];
  /** what the business's Rate Calculator says, when it has one */
  calc: CalcDay | null;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [unit, setUnit] = useState(field(initial.unitMarkupPct));
  const [material, setMaterial] = useState(field(initial.materialMarkupPct));
  const [rate, setRate] = useState(dollarsField(initial.chargeOutCents));
  const [hours, setHours] = useState(field(initial.dayHours));
  const [contPct, setContPct] = useState(field(initial.contingencyPct));
  const [contHours, setContHours] = useState(field(initial.contingencyHours));
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
    setUnit(field(res.settings.unitMarkupPct));
    setMaterial(field(res.settings.materialMarkupPct));
    setRate(dollarsField(res.settings.chargeOutCents));
    setHours(field(res.settings.dayHours));
    setContPct(field(res.settings.contingencyPct));
    setContHours(field(res.settings.contingencyHours));
    setNote({ tone: "ok", text: done });
    router.refresh();
    return true;
  };

  const typed = {
    unitMarkupPct: numOrNone(unit),
    materialMarkupPct: numOrNone(material),
    chargeOutCents: centsOrNone(rate),
    dayHours: numOrNone(hours),
    contingencyPct: numOrNone(contPct),
    contingencyHours: numOrNone(contHours),
  };
  const changed =
    typed.unitMarkupPct !== saved.unitMarkupPct ||
    typed.materialMarkupPct !== saved.materialMarkupPct ||
    typed.chargeOutCents !== saved.chargeOutCents ||
    typed.dayHours !== saved.dayHours ||
    typed.contingencyPct !== saved.contingencyPct ||
    typed.contingencyHours !== saved.contingencyHours;
  const valid =
    [unit, material].every((s) => inRange(s, 0, MAX_MARKUP_PCT)) &&
    inRange(rate.replace(/[$,\s]/g, ""), 0.01, MAX_CHARGE_OUT_CENTS / 100) &&
    inRange(hours, 1, MAX_DAY_HOURS) &&
    inRange(contPct, 0, MAX_CONTINGENCY_PCT) &&
    inRange(contHours, 0, MAX_CONTINGENCY_HOURS);
  /* what a quote will use, as typed: this page's figure, else the Rate Calculator's */
  const day = orgDayOf(valid ? typed : saved, calc);

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
              <h2 className="qs-h">Rate and markup</h2>
              <div className="qs-fields">
                <label className="qs-field">
                  <span>Charge-out rate</span>
                  <span className="qs-in">
                    <em>$</em>
                    <input
                      className="wb2-fi"
                      inputMode="decimal"
                      value={rate}
                      disabled={busy}
                      onChange={(e) => setRate(e.target.value)}
                      aria-label="Charge-out rate, dollars an hour"
                    />
                    <em>an hour</em>
                  </span>
                  <em className="qs-share">{day.rate ? fromWords(rate, rateFromWords(day.rate.from), $(day.rate.perHourCents)) : "Not set"}</em>
                </label>
                <label className="qs-field">
                  <span>Working day</span>
                  <span className="qs-in">
                    <input
                      className="wb2-fi"
                      inputMode="decimal"
                      value={hours}
                      disabled={busy}
                      onChange={(e) => setHours(e.target.value)}
                      aria-label="Hours in a working day"
                    />
                    <em>hours</em>
                  </span>
                  <em className="qs-share">
                    {day.hours ? fromWords(hours, "your Rate Calculator's working hours", `${day.hours.hours} hours`) : "Not set"}
                  </em>
                </label>
                <MarkupField label="Units" value={unit} onChange={setUnit} disabled={busy} />
                <MarkupField label="Materials" value={material} onChange={setMaterial} disabled={busy} />
                <label className="qs-field">
                  <span>Duct contingency</span>
                  <span className="qs-in">
                    <input
                      className="wb2-fi"
                      inputMode="decimal"
                      value={contPct}
                      disabled={busy}
                      onChange={(e) => setContPct(e.target.value)}
                      aria-label="Duct contingency, percent of ductwork and grilles"
                    />
                    <em>% of ductwork</em>
                  </span>
                  <span className="qs-in">
                    <input
                      className="wb2-fi"
                      inputMode="decimal"
                      value={contHours}
                      disabled={busy}
                      onChange={(e) => setContHours(e.target.value)}
                      aria-label="Duct contingency, hours"
                    />
                    <em>hours</em>
                  </span>
                  <em className="qs-share">{contPct.trim() === "" && contHours.trim() === "" ? "None" : "On a quote with ductwork"}</em>
                </label>
              </div>
              <p className="qs-sub">
                {day.dayCents != null && day.rate && day.hours
                  ? `A day on site is ${$(day.dayCents)} a person: ${day.hours.hours} hours at ${$(day.rate.perHourCents)}.`
                  : "A day on site needs a charge-out rate and a working day."}
              </p>
              <div className="wb2-jqacts">
                <button
                  type="button"
                  className="pbtn primary"
                  disabled={busy || !changed || !valid}
                  onClick={() => void save({ ...saved, ...typed }, "Rate and markup saved")}
                >
                  Save
                </button>
              </div>
            </section>

            <AllowancesGroup
              key={JSON.stringify(saved.allowances)}
              saved={saved.allowances}
              busy={busy}
              onSave={(allowances) => void save({ ...saved, allowances }, "Allowances saved")}
            />

            <section className="qs-group">
              <h2 className="qs-h">Ductwork, when the brief doesn&apos;t say</h2>
              <div className="qs-fields">
                <label className="qs-field">
                  <span>Your usual layout</span>
                  <select
                    className="wb2-sel"
                    value={saved.usualLayout ?? ""}
                    disabled={busy}
                    onChange={(e) =>
                      void save({ ...saved, usualLayout: e.target.value === "trunks" || e.target.value === "plenum" ? e.target.value : null }, "Usual layout saved")
                    }
                  >
                    <option value="">Ask on each job</option>
                    {(["trunks", "plenum"] as const).map((k) => (
                      <option key={k} value={k}>
                        {USUAL_LAYOUT_WORDS[k]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            <PriceBook suppliers={suppliers} onImported={() => router.refresh()} />

            <LinksPanel />

            <SameItemsPanel />

            <section className="qs-group">
              <h2 className="qs-h">Preferred items</h2>
              <p className="qs-sub">
                {saved.materialMarkupPct == null
                  ? "No materials markup set."
                  : `Materials sell at buy price plus ${saved.materialMarkupPct}%.`}
              </p>
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

/* WHAT A KIT CARRIES THAT ISN'T ONE ITEM — the business's own figure for
   each, at cost: its materials markup goes on top. Blank, a quote's kit
   lists the line and asks for it here (Isaac, 2026-10-04). */
function AllowancesGroup({
  saved,
  busy,
  onSave,
}: {
  saved: QuoteSettings["allowances"];
  busy: boolean;
  onSave: (a: QuoteSettings["allowances"]) => void;
}) {
  const [typed, setTyped] = useState<Record<AllowanceKey, string>>(
    () => Object.fromEntries(ALLOWANCE_KEYS.map((k) => [k, dollarsField(saved[k])])) as Record<AllowanceKey, string>
  );
  const next = Object.fromEntries(ALLOWANCE_KEYS.map((k) => [k, centsOrNone(typed[k])])) as QuoteSettings["allowances"];
  const changed = ALLOWANCE_KEYS.some((k) => next[k] !== saved[k]);
  const valid = ALLOWANCE_KEYS.every((k) => inRange(typed[k].replace(/[$,\s]/g, ""), 0, MAX_ALLOWANCE_CENTS / 100));
  return (
    <section className="qs-group">
      <h2 className="qs-h">Allowances, at cost</h2>
      <div className="qs-fields">
        {ALLOWANCE_KEYS.map((k) => (
          <label className="qs-field" key={k}>
            <span>{ALLOWANCES[k].label}</span>
            <span className="qs-in">
              <em>$</em>
              <input
                className="wb2-fi"
                inputMode="decimal"
                value={typed[k]}
                disabled={busy}
                onChange={(e) => setTyped((cur) => ({ ...cur, [k]: e.target.value }))}
                aria-label={`${ALLOWANCES[k].label} allowance, dollars ${ALLOWANCES[k].per}`}
              />
              <em>{ALLOWANCES[k].per}</em>
            </span>
            <em className="qs-share">{saved[k] == null ? "Not set" : "Set"}</em>
          </label>
        ))}
      </div>
      <div className="wb2-jqacts">
        <button type="button" className="pbtn primary" disabled={busy || !changed || !valid} onClick={() => onSave(next)}>
          Save allowances
        </button>
      </div>
    </section>
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

/** Under a blank field, where the figure a quote uses comes from; under a
    filled one, nothing more to say. */
const fromWords = (typedValue: string, source: string, value: string) =>
  typedValue.trim() === "" ? `${value}, ${source}` : "Set here";

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
  markupPct: number | null;
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
          {pick && pick.offer.perUnitCents != null && markupPct != null ? `${$(sellCents(pick.offer.perUnitCents, markupPct))} ${perUnitWord(c.unit)}` : ""}
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
