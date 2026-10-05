"use client";

import { useState } from "react";
import { BUILT_IN_SUPPLIERS, COLUMN_FIELDS, MAX_DISCOUNT_PCT, pricingWords, type ColumnField, type Columns, type DiscountRule } from "@/lib/quotes/price-book";
import type { SupplierView, ImportSummary } from "@/lib/quotes/price-book-server";
import { MAX_INVOICE_BYTES, otherSupplierNamed, type ReadInvoice } from "@/lib/quotes/invoice-read";
import { fileToUprightBase64 } from "@/lib/images/upright";
import { withCleanup } from "@/lib/ui/with-cleanup";
import { InvoiceReview } from "./invoice-review";

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

   Invoices come as a spreadsheet of what was paid, or as the invoice
   itself — a PDF or a photo — which Tiff reads and the person looks over
   before its prices go in (invoice-review.tsx).

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

/** An invoice Tiff has read, waiting to be looked over. */
type Reading = { supplier: SupplierView; fileName: string; read: ReadInvoice };

type ReadAnswer = { ok: true; read: ReadInvoice } | { ok: false; reason: string };
type AddAnswer = { ok: true; summary: ImportSummary } | { ok: false; reason: string };

/** An invoice Tiff reads, rather than a spreadsheet of one: a PDF or a photo. */
const isInvoiceDocument = (f: File) => f.type === "application/pdf" || f.type.startsWith("image/") || /\.(pdf|jpe?g|png|webp)$/i.test(f.name);

/** A photo the way every scan in the app goes to Tiff — upright, and no
    bigger than small print needs (images/upright) — and a PDF as it is. */
async function invoiceFileOf(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  const { data, mediaType } = await fileToUprightBase64(file);
  return new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], file.name, { type: mediaType });
}

/* What each answer says, read OUT HERE rather than in the try/catch that
   asks for it: React Compiler 1.0 cannot lower a value block — a ternary,
   an `&&`, a `??` — inside a try, and gives up on the whole component when
   it meets one. Each is still called from inside the same try, so a
   malformed answer still lands in the same catch. */

/** The file's first rows, when the refusal is that its headings aren't ones HeyTiff reads. */
const columnsToMatch = (a: Extract<ImportAnswer, { ok: false }>) => (a.needsColumns ? a.preview : undefined);

const counted = (v: number, one: string, many: string) => `${v.toLocaleString("en-AU")} ${v === 1 ? one : many}`;

/** What a file that went in changed, in a few words. */
const changesOf = ({ read, changed, added, gone }: ImportSummary) =>
  [
    counted(read, "item read", "items read"),
    changed ? counted(changed, "price changed", "prices changed") : "no price changed",
    added ? `${added.toLocaleString("en-AU")} new` : null,
    gone ? `${gone.toLocaleString("en-AU")} no longer listed` : null,
  ]
    .filter(Boolean)
    .join(", ");

/** What a price list or invoices that went in changed, said once. */
const importedNote = (name: string, kind: Kind, a: Extract<ImportAnswer, { ok: true }>) => {
  const twice = a.conflicts.length
    ? `Listed twice at different prices, the first kept: ${[...new Set(a.conflicts.map((c) => c.code))].join(", ")}.`
    : undefined;
  return { tone: "ok" as const, text: `${name} ${kind === "invoices" ? "invoices" : "price list"} in: ${changesOf(a.summary)}.`, detail: twice };
};

/** What an invoice Tiff read changed once its prices went in. */
const invoiceNote = (r: Reading, summary: ImportSummary) => ({
  tone: "ok" as const,
  text: `${r.supplier.name} ${r.read.invoiceNo ? `invoice ${r.read.invoiceNo}` : r.fileName} in: ${changesOf(summary)}.`,
});

const addRefusal = (reason: string | undefined) => reason ?? "That supplier couldn't be added.";
const discountRefusal = (reason: string | undefined) => reason ?? "The discount couldn't be saved.";

/** A supplier's price list, in a few words. */
const listWords = (s: SupplierView) =>
  s.importedAt ? `${n(s.itemCount ?? 0)} items, prices from ${dateOf(s.listOn ?? s.importedAt)}` : null;
/** A supplier's invoices, in a few words. */
const invoiceWords = (s: SupplierView) => (s.invoicedAt ? `${n(s.invoiceItems ?? 0)} items, ${dateOf(s.invoicedAt)}` : null);
/** The files behind them, for the open row. */
const filesWords = (s: SupplierView) =>
  [s.fileName ? `Price list from ${s.fileName}` : null, s.invoiceFileName ? `invoices from ${s.invoiceFileName}` : null].filter(Boolean).join(", ");

const n = (v: number) => v.toLocaleString("en-AU");

/* A SUPPLIER IS ONE QUIET ROW (Isaac, 2026-10-05: "that whole page is
   messy. There's so many buttons to press"): its name, how it prices, its
   price list and its invoices. Pressing the row opens what can be done to
   it — upload a price list, add invoices, and for a list-price supplier its
   discount — and only that row's. One "Add a supplier" closes the list. */
export function PriceBook({ suppliers, onImported }: { suppliers: SupplierView[]; onImported: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string; detail?: string } | null>(null);
  const [matching, setMatching] = useState<Matching | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  /* a new business starts with the form open: it has nothing else to do here */
  const [adding, setAdding] = useState(suppliers.length === 0);
  const [newName, setNewName] = useState("");

  /* an invoice itself, a PDF or a photo: Tiff reads its lines for the
     person to look over, and nothing goes in until they add them */
  const readInvoiceFile = async (s: SupplierView, file: File) => {
    setBusy(`${s.key}:invoices`);
    setNote(null);
    setMatching(null);
    setReading(null);
    await withCleanup(async () => {
      try {
        const sending = await invoiceFileOf(file);
        if (sending.size > MAX_INVOICE_BYTES) {
          setNote({ tone: "bad", text: "That file is over 4 MB." });
          return;
        }
        const form = new FormData();
        form.set("supplier", s.key);
        form.set("file", sending);
        const a = (await (await fetch("/api/quoting/invoice-read", { method: "POST", body: form })).json()) as ReadAnswer;
        if (!a.ok) {
          setNote({ tone: "bad", text: a.reason });
          return;
        }
        setReading({ supplier: s, fileName: file.name, read: a.read });
      } catch {
        setNote({ tone: "bad", text: "The invoice couldn't be sent. Try again." });
      }
    }, () => setBusy(null));
  };

  const addInvoice = async (r: Reading) => {
    const body = JSON.stringify({
      supplier: r.supplier.key,
      invoiceNo: r.read.invoiceNo,
      invoiceDate: r.read.invoiceDate,
      fileName: r.fileName,
      lines: r.read.lines.map((l) => ({ code: l.code, name: l.name, cents: l.cents })),
    });
    setBusy(`${r.supplier.key}:add`);
    setNote(null);
    await withCleanup(async () => {
      try {
        const a = (await (await fetch("/api/quoting/invoice-lines", { method: "POST", headers: { "content-type": "application/json" }, body })).json()) as AddAnswer;
        if (!a.ok) {
          setNote({ tone: "bad", text: a.reason });
          return;
        }
        setReading(null);
        setNote(invoiceNote(r, a.summary));
        onImported();
      } catch {
        setNote({ tone: "bad", text: "The prices couldn't be sent. Try again." });
      }
    }, () => setBusy(null));
  };

  const upload = async (s: SupplierView, file: File, kind: Kind, layout?: { columns: Columns; pricing: "net" | "list_less"; discountPct: number }) => {
    if (kind === "invoices" && isInvoiceDocument(file)) return readInvoiceFile(s, file);
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

  /* a supplier whose own files HeyTiff reads (AAD, Reece, the Mitsubishi
     trade book) when the name typed is one of theirs; any other by name */
  const knownToAdd = BUILT_IN_SUPPLIERS.filter((b) => !suppliers.some((s) => s.key === b.key));
  const add = async () => {
    const name = newName.trim();
    if (name.length < 2) return;
    const known = knownToAdd.find((b) => b.name.toLowerCase() === name.toLowerCase());
    const body = JSON.stringify(known ? { builtIn: known.key } : { name });
    /* worked out here, not in the try: the compiler can't lower a value block inside one */
    const added = `${known ? known.name : name} added. Open it to upload its price list.`;
    setBusy("add");
    setNote(null);
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
        setNewName("");
        setAdding(false);
        setNote({ tone: "ok", text: added });
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
        setNote({ tone: "ok", text: `${s.name} discount saved.` });
        onImported();
      } catch {
        setNote({ tone: "bad", text: "The discount couldn't be saved. Try again." });
      }
    }, () => setBusy(null));
  };

  const fileInput = (s: SupplierView, kind: Kind) => (
    <label className="pbtn ghost sm qs-upload" aria-disabled={busy !== null}>
      {busy === `${s.key}:${kind}` ? "Reading the file" : kind === "invoices" ? "Add invoices" : "Upload price list"}
      <input
        type="file"
        className="qs-file"
        aria-label={kind === "invoices" ? `Add ${s.name} invoices` : `Upload ${s.name} price list`}
        accept={
          kind === "invoices"
            ? ".csv,text/csv,.xlsx,.pdf,application/pdf,.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            : s.format === "headed"
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
          if (f) void upload(s, f, kind);
        }}
      />
    </label>
  );

  return (
    <section className="qs-group">
      {note && (
        <div className={`int-note ${note.tone}`}>
          {note.text}
          {note.detail && <span className="qs-notedetail">{note.detail}</span>}
        </div>
      )}
      {suppliers.length > 0 && (
        <div className="pbs" role="list" aria-label="Suppliers">
          <div className="pbs-head" aria-hidden="true">
            <span>Supplier</span>
            <span>Prices</span>
            <span>Price list</span>
            <span>Invoices</span>
          </div>
          {suppliers.map((s) => {
            const isOpen = openKey === s.key;
            const list = listWords(s);
            const invoices = invoiceWords(s);
            const files = filesWords(s);
            return (
              <div key={s.key} role="listitem">
                <button type="button" className={isOpen ? "pbs-row on" : "pbs-row"} aria-expanded={isOpen} onClick={() => setOpenKey(isOpen ? null : s.key)}>
                  <b>{s.name}</b>
                  <span>{pricingWords(s)}</span>
                  <span className={list ? undefined : "pbs-none"}>{list ?? "None yet"}</span>
                  <span className={invoices ? undefined : "pbs-none"}>{invoices ?? "None yet"}</span>
                </button>
                {isOpen && (
                  <div className="pbs-panel">
                    {files && <p className="qs-sub">{`${files}.`}</p>}
                    <div className="pbs-acts">
                      {fileInput(s, "list")}
                      {fileInput(s, "invoices")}
                    </div>
                    {matching?.supplier.key === s.key && (
                      <MatchColumns
                        m={matching}
                        busy={busy !== null}
                        onCancel={() => setMatching(null)}
                        onRead={(layout) => void upload(matching.supplier, matching.file, matching.kind, layout)}
                      />
                    )}
                    {reading?.supplier.key === s.key && (
                      <InvoiceReview
                        read={reading.read}
                        fileName={reading.fileName}
                        supplierName={s.name}
                        otherSupplier={otherSupplierNamed(
                          reading.read.supplier,
                          s.name,
                          suppliers.map((o) => o.name)
                        )}
                        busy={busy !== null}
                        onCancel={() => setReading(null)}
                        onAdd={() => void addInvoice(reading)}
                      />
                    )}
                    {s.pricing === "list_less" && (
                      <SupplierDiscount
                        key={s.key}
                        supplier={s}
                        busy={busy !== null}
                        onSave={(discountPct, rules) => void saveDiscount(s, discountPct, rules)}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {adding ? (
        <div className="pbs-add">
          <input
            className="wb2-fi"
            list="pbs-known"
            value={newName}
            disabled={busy !== null}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void add();
            }}
            placeholder="Supplier's name"
            aria-label="New supplier's name"
          />
          <datalist id="pbs-known">
            {knownToAdd.map((b) => (
              <option key={b.key} value={b.name} />
            ))}
          </datalist>
          {suppliers.length > 0 && (
            <button type="button" className="pbtn ghost" disabled={busy !== null} onClick={() => setAdding(false)}>
              Cancel
            </button>
          )}
          <button type="button" className="pbtn primary" disabled={busy !== null || newName.trim().length < 2} onClick={() => void add()}>
            {busy === "add" ? "Adding" : "Add supplier"}
          </button>
        </div>
      ) : (
        <button type="button" className="pbtn ghost pbs-addbtn" onClick={() => setAdding(true)}>
          Add a supplier
        </button>
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
  onSave,
}: {
  supplier: SupplierView;
  busy: boolean;
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
      <h3 className="qs-h">Discount</h3>
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
