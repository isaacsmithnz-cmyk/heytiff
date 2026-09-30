"use client";

import { useRef, useState } from "react";
import { pricingWords } from "@/lib/quotes/price-book";
import type { ModelOffers, SupplierView, ImportSummary } from "@/lib/quotes/price-book-server";

/* THE PRICE BOOK in Admin → Quoting: the suppliers the business buys from,
   each with its latest file and how it prices, and one search that finds a
   model at every supplier with the cheaper one marked and the difference.

   A new file is uploaded here, not to ServiceM8: AAD's CSV of net prices,
   Mitsubishi Electric's PDF trade book of list prices (the discount comes
   off as it's read). What the file changed is said once it's in. */

const ROUTE = "/api/quoting/price-book";
const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2 });
const $ = (cents: number) => money.format(cents / 100);
const dateOf = (iso: string) =>
  new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "Australia/Sydney" });

type ImportAnswer =
  | {
      ok: true;
      summary: ImportSummary;
      conflicts: { code: string; kept: number; also: number }[];
      skipped: number;
    }
  | { ok: false; reason: string };

export function PriceBook({ suppliers, onImported }: { suppliers: SupplierView[]; onImported: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string; detail?: string } | null>(null);
  const [q, setQ] = useState("");
  const [models, setModels] = useState<ModelOffers[] | null>(null);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const upload = async (s: SupplierView, file: File) => {
    setBusy(s.key);
    setNote(null);
    try {
      const form = new FormData();
      form.set("supplier", s.key);
      form.set("file", file);
      const a = (await (await fetch(ROUTE, { method: "POST", body: form })).json()) as ImportAnswer;
      if (!a.ok) {
        setNote({ tone: "bad", text: a.reason });
        return;
      }
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
      setNote({ tone: "ok", text: `${s.name} price list in: ${parts.join(", ")}.`, detail: twice });
      onImported();
    } catch {
      setNote({ tone: "bad", text: "The file couldn't be sent. Try again." });
    } finally {
      setBusy(null);
    }
  };

  const search = (value: string) => {
    setQ(value);
    if (timer.current) clearTimeout(timer.current);
    if (value.trim().length < 2) {
      setModels(null);
      return;
    }
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const a = (await (await fetch(`${ROUTE}?q=${encodeURIComponent(value.trim())}`)).json()) as {
          ok: boolean;
          models?: ModelOffers[];
        };
        setModels(a.ok ? (a.models ?? []) : []);
      } catch {
        setModels([]);
      } finally {
        setSearching(false);
      }
    }, 250);
  };

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
            <span role="cell" className="qs-act">
              <label className="pbtn ghost sm qs-upload" aria-disabled={busy !== null}>
                {busy === s.key ? "Reading the file" : "Upload price list"}
                <input
                  type="file"
                  className="qs-file"
                  accept={s.file === "csv" ? ".csv,text/csv" : s.file === "xlsx" ? ".xlsx" : ".pdf,application/pdf"}
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
      </div>

      <label className="qs-field qs-find">
        <span>Compare suppliers</span>
        <input
          className="wb2-fi"
          value={q}
          onChange={(e) => search(e.target.value)}
          placeholder="Model or name, e.g. MSZ-AP71"
          aria-label="Find a model"
        />
      </label>
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
