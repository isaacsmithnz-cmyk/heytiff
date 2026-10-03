"use client";

import { useEffect, useRef, useState } from "react";
import type { CategoryKey } from "@/lib/quotes/categories";
import { COLUMN_FIELDS, MAX_DISCOUNT_PCT, pricingWords, type ColumnField, type Columns, type DiscountRule } from "@/lib/quotes/price-book";
import type { CategoryCount, ModelOffers, SupplierView, ImportSummary } from "@/lib/quotes/price-book-server";
import { withCleanup } from "@/lib/ui/with-cleanup";

/* THE PRICE BOOK in Admin → Quoting: the suppliers the business buys from,
   each with its latest file and how it prices, and one search that finds a
   model at every supplier with the cheaper one marked and the difference.

   A new file is uploaded here, not to ServiceM8: AAD's CSV of net prices,
   Mitsubishi Electric's PDF trade book of list prices (the business's own
   discount comes off as it's read, set here: one for everything and any
   range by its codes). What the file changed is said once it's in.

   And the book can be browsed by shelf — Units, Pipe and coil, Fittings…
   — each product once with every supplier's price, the search narrowing
   the shelf when one is open.

   A supplier HeyTiff doesn't know is added by name; its price list can be
   any CSV or workbook. When the file's headings aren't ones HeyTiff reads,
   its first rows are shown and a person says which column is the code,
   the description and the price — once: the next file reads the same. */

const ROUTE = "/api/quoting/price-book";
const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2 });
const $ = (cents: number) => money.format(cents / 100);
const dateOf = (iso: string) =>
  new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "Australia/Sydney" });

type Preview = { letters: string[]; rows: (string | number | null)[][] };

type ImportAnswer =
  | {
      ok: true;
      summary: ImportSummary;
      conflicts: { code: string; kept: number; also: number }[];
      skipped: number;
    }
  | { ok: false; reason: string; needsColumns?: boolean; preview?: Preview };

/** A file waiting for its columns to be matched. */
type Matching = { supplier: SupplierView; file: File; preview: Preview };

type SearchAnswer = { ok: boolean; models?: ModelOffers[]; total?: number };

/* What each answer says, read OUT HERE rather than in the try/catch that
   asks for it: React Compiler 1.0 cannot lower a value block — a ternary,
   an `&&`, a `??` — inside a try, and gives up on the whole component when
   it meets one. Each is still called from inside the same try, so a
   malformed answer still lands in the same catch. */

/** The file's first rows, when the refusal is that its headings aren't ones HeyTiff reads. */
const columnsToMatch = (a: Extract<ImportAnswer, { ok: false }>) => (a.needsColumns ? a.preview : undefined);

/** What a price list that went in changed, said once. */
const importedNote = (name: string, a: Extract<ImportAnswer, { ok: true }>) => {
  const { read, changed, added, gone } = a.summary;
  const parts = [
    `${read.toLocaleString("en-AU")} items read`,
    changed ? `${changed.toLocaleString("en-AU")} prices changed` : "no price changed",
    added ? `${added.toLocaleString("en-AU")} new` : null,
    gone ? `${gone.toLocaleString("en-AU")} no longer listed` : null,
  ].filter(Boolean);
  const twice = a.conflicts.length
    ? `Listed twice at different prices, the first kept: ${[...new Set(a.conflicts.map((c) => c.code))].join(", ")}.`
    : undefined;
  return { tone: "ok" as const, text: `${name} price list in: ${parts.join(", ")}.`, detail: twice };
};

const addRefusal = (reason: string | undefined) => reason ?? "That supplier couldn't be added.";
const discountRefusal = (reason: string | undefined) => reason ?? "The discount couldn't be saved.";

const foundModels = (a: SearchAnswer) => (a.ok ? (a.models ?? []) : []);
/** A shelf counts what it holds; a search of the whole book doesn't. */
const shelfTotal = (a: SearchAnswer, on: CategoryKey | null) => (a.ok && on ? (a.total ?? null) : null);

export function PriceBook({ suppliers, onImported }: { suppliers: SupplierView[]; onImported: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string; detail?: string } | null>(null);
  const [q, setQ] = useState("");
  const [models, setModels] = useState<ModelOffers[] | null>(null);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [shelves, setShelves] = useState<CategoryCount[] | null>(null);
  const [shelf, setShelf] = useState<CategoryKey | null>(null);
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`${ROUTE}?counts=1`)
      .then((r) => r.json() as Promise<{ ok: boolean; categories?: CategoryCount[] }>)
      .then((a) => live && a.ok && setShelves(a.categories ?? []))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const [matching, setMatching] = useState<Matching | null>(null);
  const [discounting, setDiscounting] = useState<SupplierView | null>(null);
  const [newName, setNewName] = useState("");

  const upload = async (s: SupplierView, file: File, layout?: { columns: Columns; pricing: "net" | "list_less"; discountPct: number }) => {
    setBusy(s.key);
    setNote(null);
    await withCleanup(async () => {
      try {
        const form = new FormData();
        form.set("supplier", s.key);
        form.set("file", file);
        if (layout) {
          form.set("columns", JSON.stringify(layout.columns));
          form.set("pricing", layout.pricing);
          form.set("discountPct", String(layout.discountPct));
        }
        const a = (await (await fetch(ROUTE, { method: "POST", body: form })).json()) as ImportAnswer;
        if (!a.ok) {
          const preview = columnsToMatch(a);
          if (preview) setMatching({ supplier: s, file, preview });
          else setNote({ tone: "bad", text: a.reason });
          return;
        }
        setMatching(null);
        setNote(importedNote(s.name, a));
        onImported();
      } catch {
        setNote({ tone: "bad", text: "The file couldn't be sent. Try again." });
      }
    }, () => setBusy(null));
  };

  const add = async () => {
    const name = newName.trim();
    if (name.length < 2) return;
    setBusy("add");
    setNote(null);
    await withCleanup(async () => {
      try {
        const a = (await (
          await fetch("/api/quoting/suppliers", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name }),
          })
        ).json()) as { ok: boolean; reason?: string };
        if (!a.ok) {
          setNote({ tone: "bad", text: addRefusal(a.reason) });
          return;
        }
        setNewName("");
        setNote({ tone: "ok", text: `${name} added. Upload its price list.` });
        onImported();
      } catch {
        setNote({ tone: "bad", text: "That supplier couldn't be added. Try again." });
      }
    }, () => setBusy(null));
  };

  const saveDiscount = async (s: SupplierView, discountPct: number, rules: DiscountRule[]) => {
    setBusy(s.key);
    setNote(null);
    await withCleanup(async () => {
      try {
        const a = (await (
          await fetch("/api/quoting/suppliers", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ key: s.key, discountPct, rules }),
          })
        ).json()) as { ok: boolean; reason?: string };
        if (!a.ok) {
          setNote({ tone: "bad", text: discountRefusal(a.reason) });
          return;
        }
        setDiscounting(null);
        setNote({ tone: "ok", text: `${s.name} discount saved.` });
        onImported();
      } catch {
        setNote({ tone: "bad", text: "The discount couldn't be saved. Try again." });
      }
    }, () => setBusy(null));
  };

  const look = async (value: string, on: CategoryKey | null) => {
    setSearching(true);
    await withCleanup(async () => {
      try {
        const params = new URLSearchParams({ q: value.trim() });
        if (on) params.set("category", on);
        const a = (await (await fetch(`${ROUTE}?${params}`)).json()) as SearchAnswer;
        setModels(foundModels(a));
        setTotal(shelfTotal(a, on));
      } catch {
        setModels([]);
        setTotal(null);
      }
    }, () => setSearching(false));
  };

  const search = (value: string) => {
    setQ(value);
    if (timer.current) clearTimeout(timer.current);
    /* a shelf lists itself; the whole book needs a couple of letters */
    if (!shelf && value.trim().length < 2) {
      setModels(null);
      return;
    }
    timer.current = setTimeout(() => void look(value, shelf), 250);
  };

  const openShelf = (key: CategoryKey) => {
    const on = shelf === key ? null : key;
    setShelf(on);
    if (timer.current) clearTimeout(timer.current);
    if (!on && q.trim().length < 2) {
      setModels(null);
      setTotal(null);
      return;
    }
    void look(q, on);
  };
  const shelfLabel = shelves?.find((c) => c.key === shelf)?.label ?? null;

  return (
    <section className="qs-group">
      <h2 className="qs-h">Price book</h2>
      {note && (
        <div className={`int-note ${note.tone}`}>
          {note.text}
          {note.detail && <span className="qs-notedetail">{note.detail}</span>}
        </div>
      )}
      <div className="qs-table" role="table" aria-label="Suppliers">
        {suppliers.map((s) => (
          <div className="qs-row qs-suprow" role="row" key={s.key}>
            <b role="cell">{s.name}</b>
            <span role="cell" className="qs-item">
              {pricingWords(s)}
              <em>
                {s.importedAt
                  ? `${(s.itemCount ?? 0).toLocaleString("en-AU")} items, from ${s.fileName ?? "a file"} on ${dateOf(s.importedAt)}`
                  : "No price list yet"}
              </em>
            </span>
            <span role="cell" className="qs-act qs-acts2">
              {s.pricing === "list_less" && (
                <button
                  type="button"
                  className="pbtn ghost sm"
                  disabled={busy !== null}
                  aria-expanded={discounting?.key === s.key}
                  onClick={() => setDiscounting((d) => (d?.key === s.key ? null : s))}
                >
                  Discount
                </button>
              )}
              <label className="pbtn ghost sm qs-upload" aria-disabled={busy !== null}>
                {busy === s.key ? "Reading the file" : "Upload price list"}
                <input
                  type="file"
                  className="qs-file"
                  accept={
                    s.format === "headed"
                      ? ".csv,text/csv,.xlsx"
                      : s.file === "csv"
                        ? ".csv,text/csv"
                        : s.file === "xlsx"
                          ? ".xlsx"
                          : ".pdf,application/pdf"
                  }
                  disabled={busy !== null}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void upload(s, f);
                  }}
                />
              </label>
            </span>
          </div>
        ))}
        <div className="qs-row qs-suprow" role="row">
          <span role="cell" className="qs-addsup">
            <input
              className="wb2-fi"
              value={newName}
              disabled={busy !== null}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void add();
              }}
              placeholder="Another supplier"
              aria-label="New supplier's name"
            />
          </span>
          <span role="cell" />
          <span role="cell" className="qs-act">
            <button type="button" className="pbtn ghost sm" disabled={busy !== null || newName.trim().length < 2} onClick={() => void add()}>
              {busy === "add" ? "Adding" : "Add supplier"}
            </button>
          </span>
        </div>
      </div>

      {matching && (
        <MatchColumns
          m={matching}
          busy={busy !== null}
          onCancel={() => setMatching(null)}
          onRead={(layout) => void upload(matching.supplier, matching.file, layout)}
        />
      )}

      {discounting && (
        <SupplierDiscount
          key={discounting.key}
          supplier={discounting}
          busy={busy !== null}
          onCancel={() => setDiscounting(null)}
          onSave={(discountPct, rules) => void saveDiscount(discounting, discountPct, rules)}
        />
      )}

      {shelves && shelves.length > 0 && (
        <div className="qs-shelves" role="group" aria-label="Browse by category">
          {shelves.map((c) => (
            <button
              key={c.key}
              type="button"
              className={`pbtn sm ${shelf === c.key ? "primary" : "ghost"}`}
              aria-pressed={shelf === c.key}
              onClick={() => openShelf(c.key)}
            >
              {`${c.label} ${c.count.toLocaleString("en-AU")}`}
            </button>
          ))}
        </div>
      )}

      <label className="qs-field qs-find">
        <span>{shelfLabel ? `Search ${shelfLabel.toLowerCase()}` : "Compare suppliers"}</span>
        <input
          className="wb2-fi"
          value={q}
          onChange={(e) => search(e.target.value)}
          placeholder="Model or name, e.g. MSZ-AP71"
          aria-label="Find a model"
        />
      </label>
      {models && total != null && (
        <p className="qs-sub">
          {total > models.length
            ? `${total.toLocaleString("en-AU")} items, the first ${models.length} by name`
            : `${total.toLocaleString("en-AU")} item${total === 1 ? "" : "s"}`}
        </p>
      )}
      {models && (
        <div className="qs-table" role="table" aria-label="Prices by supplier">
          {models.length === 0 ? (
            <p className="qs-sub">{searching ? "Looking" : "Nothing in the price book matches."}</p>
          ) : (
            models.map((m) => (
              <div className="qs-row qs-cmprow" role="row" key={m.code}>
                <span role="cell" className="qs-item">
                  <b>{m.code}</b>
                  <em>{m.name}</em>
                </span>
                <span role="cell" className="qs-offers">
                  {m.offers.map((o, i) => (
                    /* offers come cheapest first */
                    <span key={`${o.supplierKey}:${o.code}`} className={m.offers.length > 1 && i === 0 ? "qs-offer ok" : "qs-offer"}>
                      {/* a part confirmed under two codes names each */}
                      <em>{`${o.supplierName}${o.code !== m.code ? `, ${o.code}` : ""}${o.pricedOn ? ` on ${dateOf(o.pricedOn)}` : ""}`}</em>
                      {$(o.netCents)}
                    </span>
                  ))}
                </span>
                <span role="cell" className="qs-saves">
                  {m.cheapest && m.savesCents != null && m.savesCents > 0
                    ? `${m.cheapest.supplierName} is ${$(m.savesCents)} cheaper`
                    : m.offers.length > 1
                      ? "Same price"
                      : `Only at ${m.offers[0]?.supplierName ?? ""}`}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}

/* The first rows of a file HeyTiff couldn't read by its headings, and a
   choice of column for each field. What's chosen is kept for the supplier,
   so the next file reads without asking. */
function MatchColumns({
  m,
  busy,
  onCancel,
  onRead,
}: {
  m: Matching;
  busy: boolean;
  onCancel: () => void;
  onRead: (layout: { columns: Columns; pricing: "net" | "list_less"; discountPct: number }) => void;
}) {
  const [cols, setCols] = useState<Columns>({});
  const [pricing, setPricing] = useState<"net" | "list_less">(m.supplier.pricing);
  const [pct, setPct] = useState(m.supplier.discountPct ? String(m.supplier.discountPct) : "");
  const sample = (letter: string) => {
    const v = m.preview.rows.map((r) => r[m.preview.letters.indexOf(letter)]).find((x) => x != null && String(x).trim());
    return v == null ? letter : `${letter}: ${String(v).slice(0, 24)}`;
  };
  const set = (field: ColumnField, letter: string) =>
    setCols((c) => {
      const next = { ...c };
      if (letter) next[field] = letter;
      else delete next[field];
      return next;
    });
  const ready = !!cols.code && !!cols.price && (pricing === "net" || Number(pct) > 0);
  return (
    <div className="qs-match">
      <h3 className="qs-h">{`Which column is which in ${m.file.name}?`}</h3>
      <div className="qs-preview">
        <table>
          <thead>
            <tr>
              {m.preview.letters.map((l) => (
                <th key={l} scope="col">
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {m.preview.rows.map((r, i) => (
              <tr key={i}>
                {r.map((v, j) => (
                  <td key={j}>{v == null ? "" : String(v)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="qs-fields">
        {COLUMN_FIELDS.map((f) => (
          <label className="qs-field" key={f.field}>
            <span>{f.label}</span>
            <select className="wb2-sel" value={cols[f.field] ?? ""} disabled={busy} onChange={(e) => set(f.field, e.target.value)}>
              <option value="">{f.required ? "Choose a column" : "Not in this file"}</option>
              {m.preview.letters.map((l) => (
                <option key={l} value={l}>
                  {sample(l)}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label className="qs-field">
          <span>The prices are</span>
          <select
            className="wb2-sel"
            value={pricing}
            disabled={busy}
            onChange={(e) => setPricing(e.target.value === "list_less" ? "list_less" : "net")}
          >
            <option value="net">What we pay</option>
            <option value="list_less">List prices, less our discount</option>
          </select>
        </label>
        {pricing === "list_less" && (
          <label className="qs-field">
            <span>Our discount</span>
            <span className="qs-in">
              <input className="wb2-fi" inputMode="decimal" value={pct} disabled={busy} onChange={(e) => setPct(e.target.value)} aria-label="Discount percent" />
              <em>%</em>
            </span>
          </label>
        )}
      </div>
      <div className="wb2-jqacts">
        <button type="button" className="pbtn ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="pbtn primary"
          disabled={busy || !ready}
          onClick={() => onRead({ columns: cols, pricing, discountPct: pricing === "list_less" ? Number(pct) : 0 })}
        >
          Read the file
        </button>
      </div>
    </div>
  );
}

/* A list-price supplier's discount: what the business takes off every list
   price, and any range by the start of its codes that gets a different one
   (a business's PUMY range, say). The business's own; HeyTiff has none. */
function SupplierDiscount({
  supplier,
  busy,
  onCancel,
  onSave,
}: {
  supplier: SupplierView;
  busy: boolean;
  onCancel: () => void;
  onSave: (discountPct: number, rules: DiscountRule[]) => void;
}) {
  const [pct, setPct] = useState(supplier.discountPct ? String(supplier.discountPct) : "");
  const [rules, setRules] = useState(supplier.rules.map((r) => ({ prefix: r.prefix, pct: String(r.discountPct) })));
  const okPct = (v: string) => v.trim() === "" || (Number(v) >= 0 && Number(v) <= MAX_DISCOUNT_PCT);
  const ready = okPct(pct) && rules.every((r) => r.prefix.trim() !== "" && r.pct.trim() !== "" && okPct(r.pct));
  const setRule = (i: number, part: Partial<{ prefix: string; pct: string }>) =>
    setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...part } : r)));
  return (
    <div className="qs-match">
      <h3 className="qs-h">{`${supplier.name} discount`}</h3>
      <div className="qs-fields">
        <label className="qs-field">
          <span>Off every list price</span>
          <span className="qs-in">
            <input className="wb2-fi" inputMode="decimal" value={pct} disabled={busy} onChange={(e) => setPct(e.target.value)} aria-label="Discount percent" />
            <em>%</em>
          </span>
        </label>
      </div>
      {rules.map((r, i) => (
        <div className="qs-fields qs-rule" key={i}>
          <label className="qs-field">
            <span>Codes starting</span>
            <span className="qs-in">
              <input
                className="wb2-fi"
                value={r.prefix}
                disabled={busy}
                onChange={(e) => setRule(i, { prefix: e.target.value })}
                aria-label="Codes starting with"
              />
            </span>
          </label>
          <label className="qs-field">
            <span>Their discount</span>
            <span className="qs-in">
              <input
                className="wb2-fi"
                inputMode="decimal"
                value={r.pct}
                disabled={busy}
                onChange={(e) => setRule(i, { pct: e.target.value })}
                aria-label="Their discount percent"
              />
              <em>%</em>
            </span>
          </label>
          <button type="button" className="pbtn ghost sm" disabled={busy} onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <div className="wb2-jqacts">
        <button type="button" className="pbtn ghost" disabled={busy} onClick={() => setRules((rs) => [...rs, { prefix: "", pct: "" }])}>
          Add a range
        </button>
        <button type="button" className="pbtn ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="pbtn primary"
          disabled={busy || !ready}
          onClick={() => onSave(Number(pct) || 0, rules.map((r) => ({ prefix: r.prefix.trim(), discountPct: Number(r.pct) })))}
        >
          Save discount
        </button>
      </div>
    </div>
  );
}
