"use client";

import { useState } from "react";
import { BUILT_IN_SUPPLIERS, COLUMN_FIELDS, MAX_DISCOUNT_PCT, pricingWords, type ColumnField, type Columns, type DiscountRule } from "@/lib/quotes/price-book";
import type { SupplierView, ImportSummary } from "@/lib/quotes/price-book-server";
import { withCleanup } from "@/lib/ui/with-cleanup";

/* THE PRICE BOOK'S SUPPLIERS: the suppliers the business buys from, each
   with its price list and its invoices, and how it prices. One supplier is
   one row: its price list and its invoices are two ways its prices come in
   (Isaac, 2026-10-05 — Mitsubishi Electric's VRF indoors are only ever
   quoted, so what was paid on invoices prices them, under Mitsubishi
   Electric). An invoice prices only the codes on it.

   A new file is uploaded here, not to ServiceM8: AAD's CSV of net prices,
   Mitsubishi Electric's PDF trade book of list prices (the business's own
   discount comes off as it's read, set here: one for everything and any
   range by its codes). What the file changed is said once it's in.

   A new business starts with no suppliers: it adds its own. The ones whose
   own files HeyTiff reads (AAD, Reece, the Mitsubishi trade book) are a press
   each; any other is added by name, and its price list can be
   any CSV or workbook. When the file's headings aren't ones HeyTiff reads,
   its first rows are shown and a person says which column is the code,
   the description and the price — once: the next file reads the same. */

const ROUTE = "/api/quoting/price-book";
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
/** A price list, which replaces the supplier's last one, or invoices, which
    price only the codes on them: the same supplier either way. */
type Kind = "list" | "invoices";

type Matching = { supplier: SupplierView; file: File; kind: Kind; preview: Preview };

/* What each answer says, read OUT HERE rather than in the try/catch that
   asks for it: React Compiler 1.0 cannot lower a value block — a ternary,
   an `&&`, a `??` — inside a try, and gives up on the whole component when
   it meets one. Each is still called from inside the same try, so a
   malformed answer still lands in the same catch. */

/** The file's first rows, when the refusal is that its headings aren't ones HeyTiff reads. */
const columnsToMatch = (a: Extract<ImportAnswer, { ok: false }>) => (a.needsColumns ? a.preview : undefined);

/** What a price list or invoices that went in changed, said once. */
const importedNote = (name: string, kind: Kind, a: Extract<ImportAnswer, { ok: true }>) => {
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
  return { tone: "ok" as const, text: `${name} ${kind === "invoices" ? "invoices" : "price list"} in: ${parts.join(", ")}.`, detail: twice };
};

const addRefusal = (reason: string | undefined) => reason ?? "That supplier couldn't be added.";
const discountRefusal = (reason: string | undefined) => reason ?? "The discount couldn't be saved.";

export function PriceBook({ suppliers, onImported }: { suppliers: SupplierView[]; onImported: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string; detail?: string } | null>(null);
  const [matching, setMatching] = useState<Matching | null>(null);
  const [discounting, setDiscounting] = useState<SupplierView | null>(null);
  const [newName, setNewName] = useState("");

  const upload = async (s: SupplierView, file: File, kind: Kind, layout?: { columns: Columns; pricing: "net" | "list_less"; discountPct: number }) => {
    setBusy(`${s.key}:${kind}`);
    setNote(null);
    await withCleanup(async () => {
      try {
        const form = new FormData();
        form.set("supplier", s.key);
        form.set("file", file);
        form.set("kind", kind);
        if (layout) {
          form.set("columns", JSON.stringify(layout.columns));
          form.set("pricing", layout.pricing);
          form.set("discountPct", String(layout.discountPct));
        }
        const a = (await (await fetch(ROUTE, { method: "POST", body: form })).json()) as ImportAnswer;
        if (!a.ok) {
          const preview = columnsToMatch(a);
          if (preview) setMatching({ supplier: s, file, kind, preview });
          else setNote({ tone: "bad", text: a.reason });
          return;
        }
        setMatching(null);
        setNote(importedNote(s.name, kind, a));
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

  /* a supplier whose own file HeyTiff reads, added by the business */
  const addKnown = async (key: string, name: string) => {
    setBusy("add");
    setNote(null);
    const body = JSON.stringify({ builtIn: key });
    await withCleanup(async () => {
      try {
        const a = (await (await fetch("/api/quoting/suppliers", { method: "POST", headers: { "content-type": "application/json" }, body })).json()) as {
          ok: boolean;
          reason?: string;
        };
        if (!a.ok) {
          setNote({ tone: "bad", text: addRefusal(a.reason) });
          return;
        }
        setNote({ tone: "ok", text: `${name} added. Upload its price list.` });
        onImported();
      } catch {
        setNote({ tone: "bad", text: "That supplier couldn't be added. Try again." });
      }
    }, () => setBusy(null));
  };
  const knownToAdd = BUILT_IN_SUPPLIERS.filter((b) => !suppliers.some((s) => s.key === b.key));

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

  return (
    <section className="qs-group">
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
                  ? `Price list: ${(s.itemCount ?? 0).toLocaleString("en-AU")} items from ${s.fileName ?? "a file"}, prices from ${dateOf(s.listOn ?? s.importedAt)}`
                  : "No price list yet"}
              </em>
              {s.invoicedAt && (
                <em>{`Invoices: ${(s.invoiceItems ?? 0).toLocaleString("en-AU")} items from ${s.invoiceFileName ?? "a file"} on ${dateOf(s.invoicedAt)}`}</em>
              )}
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
                {busy === `${s.key}:invoices` ? "Reading the file" : "Add invoices"}
                <input
                  type="file"
                  className="qs-file"
                  accept=".csv,text/csv,.xlsx"
                  aria-label={`Add ${s.name} invoices`}
                  disabled={busy !== null}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void upload(s, f, "invoices");
                  }}
                />
              </label>
              <label className="pbtn ghost sm qs-upload" aria-disabled={busy !== null}>
                {busy === `${s.key}:list` ? "Reading the file" : "Upload price list"}
                <input
                  type="file"
                  className="qs-file"
                  aria-label={`Upload ${s.name} price list`}
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
                    if (f) void upload(s, f, "list");
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
          <span role="cell" className="qs-act qs-acts2" aria-label="Suppliers whose own files HeyTiff reads">
            {knownToAdd.map((b) => (
              <button key={b.key} type="button" className="pbtn ghost sm" disabled={busy !== null} onClick={() => void addKnown(b.key, b.name)}>
                {`Add ${b.name}`}
              </button>
            ))}
          </span>
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
          onRead={(layout) => void upload(matching.supplier, matching.file, matching.kind, layout)}
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
  /* invoices say what was paid: no discount comes off them */
  const invoices = m.kind === "invoices";
  const ready = !!cols.code && !!cols.price && (invoices || pricing === "net" || Number(pct) > 0);
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
        {!invoices && (
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
        )}
        {!invoices && pricing === "list_less" && (
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
