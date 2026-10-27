"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { Button } from "@/components/parts/button";
import { Chooser } from "@/components/parts/chooser";
import { Dialog } from "@/components/parts/dialog";
import { Fade } from "@/components/parts/fade";
import { Field, TextInput } from "@/components/parts/field";
import { Empty } from "@/components/parts/states";
import { Group } from "@/components/settings/parts";
import { BUILT_IN_SUPPLIERS, COLUMN_FIELDS, MAX_DISCOUNT_PCT, pricingWords, type ColumnField, type Columns, type DiscountRule } from "@/lib/quotes/price-book";
import type { SupplierView, ImportSummary } from "@/lib/quotes/price-book-server";
import { MAX_INVOICE_BYTES, otherSupplierNamed, type ReadInvoice } from "@/lib/quotes/invoice-read";
import { uprightFile } from "@/lib/images/upright";
import { withCleanup } from "@/lib/ui/with-cleanup";
import { InvoiceReview } from "./invoice-review";
import { CodeLetters } from "./code-letters";
import { FileButton, Oops, Said } from "./pb-bits";

/* THE PRICE BOOK'S SUPPLIERS (Price book › Suppliers): the suppliers the
   business buys from, each with its price list and its invoices, and how it
   prices. One supplier is one row: its price list and its invoices are two
   ways its prices come in (Isaac, 2026-10-05 — Mitsubishi Electric's VRF
   indoors are only ever quoted, so what was paid on invoices prices them,
   under Mitsubishi Electric). An invoice prices only the codes on it.

   A row opens its supplier (rule 35's record, in a dialog, as a licence
   opens on Business): upload a price list, add invoices, for a list-price
   supplier its discount, and the letters in its codes. A new file is
   uploaded here, not to ServiceM8: AAD's CSV of net prices, Mitsubishi
   Electric's PDF trade book of list prices (the business's own discount
   comes off as it's read). What the file changed is said once it's in.

   Invoices come as a spreadsheet of what was paid, or as the invoice
   itself — a PDF or a photo — which Tiff reads and the person looks over
   before its prices go in (invoice-review.tsx).

   A new business starts with no suppliers: it adds its own. The ones whose
   own files HeyTiff reads (AAD, Reece, the Mitsubishi trade book) are
   offered as the name is typed; any other is added by name, and its price
   list can be any CSV or workbook. When the file's headings aren't ones
   HeyTiff reads, its first rows are shown and a person says which column
   is the code, the description and the price — once: the next file reads
   the same. */

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

/** A price list, which replaces the supplier's last one, or invoices, which
    price only the codes on them: the same supplier either way. */
type Kind = "list" | "invoices";

/** A file waiting for its columns to be matched. */
type Matching = { file: File; kind: Kind; preview: Preview };

/** An invoice Tiff has read, waiting to be looked over. */
type Reading = { fileName: string; read: ReadInvoice };

type ReadAnswer = { ok: true; read: ReadInvoice } | { ok: false; reason: string };
type AddAnswer = { ok: true; summary: ImportSummary } | { ok: false; reason: string };

/** An invoice Tiff reads, rather than a spreadsheet of one: a PDF or a photo. */
const isInvoiceDocument = (f: File) => f.type === "application/pdf" || f.type.startsWith("image/") || /\.(pdf|jpe?g|png|webp)$/i.test(f.name);

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

type Note = { tone: "ok" | "bad"; text: string; detail?: string };

/** What a price list or invoices that went in changed, said once. */
const importedNote = (name: string, kind: Kind, a: Extract<ImportAnswer, { ok: true }>): Note => {
  const twice = a.conflicts.length
    ? `Listed twice at different prices, the first kept: ${[...new Set(a.conflicts.map((c) => c.code))].join(", ")}.`
    : undefined;
  return { tone: "ok", text: `${name} ${kind === "invoices" ? "invoices" : "price list"} in: ${changesOf(a.summary)}.`, detail: twice };
};

/** What an invoice Tiff read changed once its prices went in. */
const invoiceNote = (name: string, r: Reading, summary: ImportSummary): Note => ({
  tone: "ok",
  text: `${name} ${r.read.invoiceNo ? `invoice ${r.read.invoiceNo}` : r.fileName} in: ${changesOf(summary)}.`,
});

const addRefusal = (reason: string | undefined) => reason ?? "That supplier couldn't be added.";
const discountRefusal = (reason: string | undefined) => reason ?? "The discount couldn't be saved.";

const n = (v: number) => v.toLocaleString("en-AU");
/** A supplier's price list, in a few words. */
const listWords = (s: SupplierView) =>
  s.importedAt ? `${n(s.itemCount ?? 0)} items, prices from ${dateOf(s.listOn ?? s.importedAt)}` : null;
/** A supplier's invoices, in a few words. */
const invoiceWords = (s: SupplierView) => (s.invoicedAt ? `${n(s.invoiceItems ?? 0)} items, ${dateOf(s.invoicedAt)}` : null);

/* A SUPPLIER IS ONE QUIET ROW (Isaac, 2026-10-05: "that whole page is
   messy. There's so many buttons to press"): its name, how it prices, its
   price list and its invoices. Pressing the row opens what can be done to
   it, and only that supplier's. Add a supplier is on the group's head. */
export function PriceBook({
  suppliers,
  onImported,
  initialOpen = null,
  initialAdding = false,
}: {
  suppliers: SupplierView[];
  onImported: () => void;
  /** a supplier to open on arrival (Add items, on the title, asked which) */
  initialOpen?: string | null;
  /** arrive with Add a supplier open */
  initialAdding?: boolean;
}) {
  const [openKey, setOpenKey] = useState<string | null>(initialOpen);
  const [adding, setAdding] = useState(initialAdding);
  const [said, setSaid] = useState<string | null>(null);
  const open = suppliers.find((s) => s.key === openKey) ?? null;

  const add = (
    <Button kind="second" size={32} onClick={() => setAdding(true)}>
      Add a supplier
    </Button>
  );

  return (
    <Group heading="Suppliers" tools={suppliers.length > 0 ? add : undefined}>
      {said && <Said>{said}</Said>}
      {suppliers.length === 0 ? (
        <Empty what="No suppliers yet" action={add} />
      ) : (
        <div className="st2-pb-rows" role="table" aria-label="Suppliers">
          <div className="st2-pb-grid st2-pb-sups st2-pb-head" role="row">
            <span role="columnheader">Supplier</span>
            <span role="columnheader">Prices</span>
            <span role="columnheader">Price list</span>
            <span role="columnheader">Invoices</span>
          </div>
          {suppliers.map((s) => {
            const list = listWords(s);
            const invoices = invoiceWords(s);
            return (
              <div key={s.key} className="st2-pb-grid st2-pb-sups st2-pb-click" role="row">
                <span role="cell" className="st2-pb-name">
                  <button type="button" className="st2-pb-open" onClick={() => setOpenKey(s.key)}>
                    <Fade>{s.name}</Fade>
                  </button>
                </span>
                <span role="cell">
                  <Fade>{pricingWords(s)}</Fade>
                </span>
                <span role="cell" className={list ? undefined : "st2-pb-none"}>
                  <Fade>{list ?? "None yet"}</Fade>
                </span>
                <span role="cell" className={invoices ? undefined : "st2-pb-none"}>
                  <Fade>{invoices ?? "None yet"}</Fade>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {open && <SupplierDialog key={open.key} supplier={open} suppliers={suppliers} onImported={onImported} onClose={() => setOpenKey(null)} />}
      {adding && (
        <AddSupplier
          suppliers={suppliers}
          onAdded={(words) => {
            setAdding(false);
            setSaid(words);
            onImported();
          }}
          onClose={() => setAdding(false)}
        />
      )}
    </Group>
  );
}

/* ADD A SUPPLIER: its name. One whose own files HeyTiff reads (AAD, Reece,
   the Mitsubishi trade book) is added as that when its name is typed; any
   other by its name. */
function AddSupplier({ suppliers, onAdded, onClose }: { suppliers: SupplierView[]; onAdded: (said: string) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState<string | null>(null);
  const knownToAdd = BUILT_IN_SUPPLIERS.filter((b) => !suppliers.some((s) => s.key === b.key));
  const ready = name.trim().length >= 2;

  const add = async () => {
    const typed = name.trim();
    if (typed.length < 2) return;
    const known = knownToAdd.find((b) => b.name.toLowerCase() === typed.toLowerCase());
    const body = JSON.stringify(known ? { builtIn: known.key } : { name: typed });
    /* worked out here, not in the try: the compiler can't lower a value block inside one */
    const added = `${known ? known.name : typed} added. Open it to upload its price list.`;
    setBusy(true);
    setWrong(null);
    await withCleanup(async () => {
      try {
        const a = (await (await fetch("/api/quoting/suppliers", { method: "POST", headers: { "content-type": "application/json" }, body })).json()) as {
          ok: boolean;
          reason?: string;
        };
        if (!a.ok) {
          setWrong(addRefusal(a.reason));
          return;
        }
        onAdded(added);
      } catch {
        setWrong("That supplier couldn't be added. Try again.");
      }
    }, () => setBusy(false));
  };

  return (
    <Dialog
      heading="Add a supplier"
      onClose={onClose}
      foot={
        <>
          <Button kind="second" size={36} disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button kind="main" size={36} disabled={busy || !ready} onClick={() => void add()}>
            {busy ? "Adding the supplier" : "Add supplier"}
          </Button>
        </>
      }
    >
      <div className="st2-pb-dlg">
        <Field label="New supplier's name">
          <TextInput
            list="st2-pb-known"
            value={name}
            disabled={busy}
            data-autofocus
            placeholder="e.g. Reece"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void add();
            }}
          />
        </Field>
        <datalist id="st2-pb-known">
          {knownToAdd.map((b) => (
            <option key={b.key} value={b.name} />
          ))}
        </datalist>
        {wrong && <Oops>{wrong}</Oops>}
      </div>
    </Dialog>
  );
}

/* A SUPPLIER, OPENED: what it is, its two ways in for prices, what came of
   the last one, and, for a list-price supplier, its discount; then the
   letters in its codes. */
function SupplierDialog({
  supplier: s,
  suppliers,
  onImported,
  onClose,
}: {
  supplier: SupplierView;
  suppliers: SupplierView[];
  onImported: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [matching, setMatching] = useState<Matching | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  /* the discount as typed, and as last saved: the supplier's own until this
     dialog saves another */
  const [draft, setDraft] = useState(() => draftOf(s));
  const [kept, setKept] = useState(() => draftOf(s));
  const unsaved = s.pricing === "list_less" && !sameDiscount(draft, kept);

  /* an invoice itself, a PDF or a photo: Tiff reads its lines for the
     person to look over, and nothing goes in until they add them */
  const readInvoiceFile = async (file: File) => {
    setBusy("invoices");
    setNote(null);
    setMatching(null);
    setReading(null);
    await withCleanup(async () => {
      try {
        const sending = await uprightFile(file);
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
        setReading({ fileName: file.name, read: a.read });
      } catch {
        setNote({ tone: "bad", text: "The invoice couldn't be sent. Try again." });
      }
    }, () => setBusy(null));
  };

  const addInvoice = async (r: Reading) => {
    const body = JSON.stringify({
      supplier: s.key,
      invoiceNo: r.read.invoiceNo,
      invoiceDate: r.read.invoiceDate,
      fileName: r.fileName,
      lines: r.read.lines.map((l) => ({ code: l.code, name: l.name, cents: l.cents })),
    });
    setBusy("add");
    setNote(null);
    await withCleanup(async () => {
      try {
        const a = (await (await fetch("/api/quoting/invoice-lines", { method: "POST", headers: { "content-type": "application/json" }, body })).json()) as AddAnswer;
        if (!a.ok) {
          setNote({ tone: "bad", text: a.reason });
          return;
        }
        setReading(null);
        setNote(invoiceNote(s.name, r, a.summary));
        onImported();
      } catch {
        setNote({ tone: "bad", text: "The prices couldn't be sent. Try again." });
      }
    }, () => setBusy(null));
  };

  const upload = async (file: File, kind: Kind, layout?: { columns: Columns; pricing: "net" | "list_less"; discountPct: number }) => {
    if (kind === "invoices" && isInvoiceDocument(file)) return readInvoiceFile(file);
    setBusy(kind);
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
          if (preview) setMatching({ file, kind, preview });
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

  /** Saves the discount as typed; true once it's in. */
  const saveDiscount = async (d: DiscountDraft): Promise<boolean> => {
    setBusy("discount");
    setNote(null);
    let saved = false;
    await withCleanup(async () => {
      try {
        const a = (await (
          await fetch("/api/quoting/suppliers", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ key: s.key, ...asSaved(d) }),
          })
        ).json()) as { ok: boolean; reason?: string };
        if (!a.ok) {
          setNote({ tone: "bad", text: discountRefusal(a.reason) });
          return;
        }
        saved = true;
        setKept(d);
        setNote({ tone: "ok", text: `${s.name} discount saved.` });
        onImported();
      } catch {
        setNote({ tone: "bad", text: "The discount couldn't be saved. Try again." });
      }
    }, () => setBusy(null));
    return saved;
  };

  /* Done keeps a discount typed and not saved, as Escape and the scrim do
     (Isaac's walk, 27 October 2026: 31% typed, then Done, and the supplier
     opened again at 30%). One that can't be saved holds the dialog open,
     saying why. */
  const close = async () => {
    if (busy === "discount") return;
    if (!unsaved) return onClose();
    if (!discountReady(draft)) {
      const why = okPct(draft.pct) ? "Give each range its codes and its discount, or remove it." : `A discount is 0 to ${MAX_DISCOUNT_PCT}%.`;
      setNote({ tone: "bad", text: `The discount isn't saved. ${why}` });
      return;
    }
    if (await saveDiscount(draft)) onClose();
  };

  const accept = (kind: Kind) =>
    kind === "invoices"
      ? ".csv,text/csv,.xlsx,.pdf,application/pdf,.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
      : s.format === "headed"
        ? ".csv,text/csv,.xlsx"
        : s.file === "csv"
          ? ".csv,text/csv"
          : s.file === "xlsx"
            ? ".xlsx"
            : ".pdf,application/pdf";

  const list = listWords(s);
  const invoices = invoiceWords(s);
  return (
    <Dialog
      heading={s.name}
      width={720}
      onClose={() => void close()}
      foot={
        <Button kind="second" size={36} disabled={busy === "discount"} onClick={() => void close()}>
          Done
        </Button>
      }
    >
      <div className="st2-pb-dlg">
        <dl className="st2-pb-kv">
          <div>
            <dt>Prices</dt>
            <dd>{pricingWords(s)}</dd>
          </div>
          <div>
            <dt>Price list</dt>
            <dd className={list ? undefined : "st2-pb-none"}>{list ? `${list}${s.fileName ? `, from ${s.fileName}` : ""}` : "None yet"}</dd>
          </div>
          <div>
            <dt>Invoices</dt>
            <dd className={invoices ? undefined : "st2-pb-none"}>{invoices ? `${invoices}${s.invoiceFileName ? `, from ${s.invoiceFileName}` : ""}` : "None yet"}</dd>
          </div>
        </dl>
        <div className="st2-pb-acts">
          <FileButton
            words={busy === "list" ? "Reading the file" : "Upload price list"}
            label={`Upload ${s.name} price list`}
            accept={accept("list")}
            disabled={busy !== null}
            onFile={(f) => void upload(f, "list")}
          />
          <FileButton
            words={busy === "invoices" ? "Reading the file" : "Add invoices"}
            label={`Add ${s.name} invoices`}
            accept={accept("invoices")}
            disabled={busy !== null}
            onFile={(f) => void upload(f, "invoices")}
          />
        </div>
        {note && (note.tone === "ok" ? <Said more={note.detail}>{note.text}</Said> : <Oops>{note.text}</Oops>)}
        {matching && (
          <MatchColumns
            m={matching}
            supplier={s}
            busy={busy !== null}
            onCancel={() => setMatching(null)}
            onRead={(layout) => void upload(matching.file, matching.kind, layout)}
          />
        )}
        {reading && (
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
            adding={busy === "add"}
            onCancel={() => setReading(null)}
            onAdd={() => void addInvoice(reading)}
          />
        )}
        {s.pricing === "list_less" && <SupplierDiscount draft={draft} onDraft={setDraft} busy={busy !== null} onSave={() => void saveDiscount(draft)} />}
        <CodeLetters supplierKey={s.key} supplierName={s.name} />
      </div>
    </Dialog>
  );
}

/* The first rows of a file HeyTiff couldn't read by its headings, and a
   choice of column for each field. What's chosen is kept for the supplier,
   so the next file reads without asking. */
const NOT_IN_FILE = "none";
function MatchColumns({
  m,
  supplier,
  busy,
  onCancel,
  onRead,
}: {
  m: Matching;
  supplier: SupplierView;
  busy: boolean;
  onCancel: () => void;
  onRead: (layout: { columns: Columns; pricing: "net" | "list_less"; discountPct: number }) => void;
}) {
  const [cols, setCols] = useState<Columns>({});
  const [pricing, setPricing] = useState<"net" | "list_less">(supplier.pricing);
  const [pct, setPct] = useState(supplier.discountPct ? String(supplier.discountPct) : "");
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
    <section aria-label={`Which column is which in ${m.file.name}?`}>
      <h3 className="st2-pb-sub">{`Which column is which in ${m.file.name}?`}</h3>
      <div className="st2-pb-ledgerwrap">
        <table className="st2-pb-ledger">
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
                  <td key={j}>
                    <Fade>{v == null ? "" : String(v)}</Fade>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="st2-pb-fields">
        {COLUMN_FIELDS.map((f) => (
          <Field key={f.field} label={f.label}>
            <Chooser
              placeholder={f.required ? "Choose a column" : "Not in this file"}
              options={[...(f.required ? [] : [{ value: NOT_IN_FILE, label: "Not in this file" }]), ...m.preview.letters.map((l) => ({ value: l, label: sample(l) }))]}
              value={cols[f.field] ?? (f.required ? null : NOT_IN_FILE)}
              disabled={busy}
              onChange={(v) => set(f.field, v === NOT_IN_FILE ? "" : v)}
            />
          </Field>
        ))}
        {!invoices && (
          <Field label="The prices are">
            <Chooser
              options={[
                { value: "net", label: "What we pay" },
                { value: "list_less", label: "List prices, less our discount" },
              ]}
              value={pricing}
              disabled={busy}
              onChange={(v) => setPricing(v === "list_less" ? "list_less" : "net")}
            />
          </Field>
        )}
        {!invoices && pricing === "list_less" && (
          <Field label="Our discount, %">
            <TextInput inputMode="decimal" value={pct} disabled={busy} onChange={(e) => setPct(e.target.value)} />
          </Field>
        )}
      </div>
      <div className="st2-pb-foot">
        <Button kind="second" size={36} disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button kind="main" size={36} disabled={busy || !ready} onClick={() => onRead({ columns: cols, pricing, discountPct: pricing === "list_less" ? Number(pct) : 0 })}>
          Read the file
        </Button>
      </div>
    </section>
  );
}

/* A list-price supplier's discount: what the business takes off every list
   price, and any range by the start of its codes that gets a different one
   (a business's PUMY range, say). The business's own; HeyTiff has none. */
type DiscountDraft = { pct: string; rules: { prefix: string; pct: string }[] };

const draftOf = (s: SupplierView): DiscountDraft => ({
  pct: s.discountPct ? String(s.discountPct) : "",
  rules: s.rules.map((r) => ({ prefix: r.prefix, pct: String(r.discountPct) })),
});
const okPct = (v: string) => v.trim() === "" || (Number(v) >= 0 && Number(v) <= MAX_DISCOUNT_PCT);
/* a range added and left blank is no range */
const filledRules = (d: DiscountDraft) => d.rules.filter((r) => r.prefix.trim() !== "" || r.pct.trim() !== "");
const discountReady = (d: DiscountDraft) => okPct(d.pct) && filledRules(d).every((r) => r.prefix.trim() !== "" && r.pct.trim() !== "" && okPct(r.pct));
/** The discount as it's sent and kept. */
const asSaved = (d: DiscountDraft): { discountPct: number; rules: DiscountRule[] } => ({
  discountPct: Number(d.pct) || 0,
  rules: filledRules(d).map((r) => ({ prefix: r.prefix.trim(), discountPct: Number(r.pct) })),
});
const sameDiscount = (a: DiscountDraft, b: DiscountDraft) => JSON.stringify(asSaved(a)) === JSON.stringify(asSaved(b));

function SupplierDiscount({
  draft,
  onDraft,
  busy,
  onSave,
}: {
  draft: DiscountDraft;
  onDraft: Dispatch<SetStateAction<DiscountDraft>>;
  busy: boolean;
  onSave: () => void;
}) {
  const { pct, rules } = draft;
  const ready = discountReady(draft);
  const setPct = (v: string) => onDraft((d) => ({ ...d, pct: v }));
  const setRules = (f: (rs: DiscountDraft["rules"]) => DiscountDraft["rules"]) => onDraft((d) => ({ ...d, rules: f(d.rules) }));
  const setRule = (i: number, part: Partial<{ prefix: string; pct: string }>) =>
    setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...part } : r)));
  return (
    <section aria-label="Discount">
      <h3 className="st2-pb-sub">Discount</h3>
      <div className="st2-pb-fields">
        <Field label="Off every list price, %" error={okPct(pct) ? null : `A discount is 0 to ${MAX_DISCOUNT_PCT}%`}>
          <TextInput inputMode="decimal" value={pct} disabled={busy} onChange={(e) => setPct(e.target.value)} />
        </Field>
      </div>
      {rules.map((r, i) => (
        <div className="st2-pb-rule" key={i}>
          <Field label="Codes starting">
            <TextInput value={r.prefix} disabled={busy} onChange={(e) => setRule(i, { prefix: e.target.value })} />
          </Field>
          <Field label="Their discount, %">
            <TextInput inputMode="decimal" value={r.pct} disabled={busy} onChange={(e) => setRule(i, { pct: e.target.value })} />
          </Field>
          <Button kind="quiet" size={36} disabled={busy} aria-label={`Remove the range ${r.prefix || i + 1}`} onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}>
            Remove
          </Button>
        </div>
      ))}
      <div className="st2-pb-foot">
        <Button kind="second" size={36} disabled={busy} onClick={() => setRules((rs) => [...rs, { prefix: "", pct: "" }])}>
          Add a range
        </Button>
        <Button kind="second" size={36} disabled={busy || !ready} onClick={onSave}>
          Save discount
        </Button>
      </div>
    </section>
  );
}
