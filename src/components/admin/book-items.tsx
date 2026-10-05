"use client";

import { useEffect, useState } from "react";
import type { Offer } from "@/lib/quotes/price-book";
import { countsOf, viewOf, type BookViewKey, type Family, type Product } from "@/lib/quotes/families";
import { withCleanup } from "@/lib/ui/with-cleanup";

/* THE PRICE BOOK'S ITEMS — the book sorted so a person can find a part
   without knowing its code (families.ts sorts it).

   Down the left, what to look at: the parts on the most quotes, the ones
   the business has put forward, then every shelf. On the right, the shelf's
   families — "Paired coil, 11 sizes" — each opening onto its sizes, and
   every size with each supplier's price. Units, controls and parts come by
   maker first ("Daikin"), a unit's families by type ("Wall split indoor").

   The whole book comes once a visit and is sorted here: a shelf, a search,
   Most used answer at once, with nothing asked of the server (Isaac,
   2026-10-05: "the price book is slow to load").

   A supplier's price is the newer of its price list's and what was last
   paid on its invoices; the one not taken is under it, with its date.

   PREFERRED: pressing a supplier's price puts that item forward. From then
   on a quote takes it over a cheaper one, the job checklist's search lists
   it first, and its family comes to the top of its shelf. Pressing it again
   takes it back; pressing another supplier's price for the same part moves
   it there. The lowest price is in the state's green, as everywhere in
   Quoting. */

const ROUTE = "/api/quoting/price-book";
const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2 });
const $ = (cents: number) => money.format(cents / 100);
const n = (v: number) => v.toLocaleString("en-AU");
const dateOf = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });

/** Whose price, and when it was paid if it was: "Mitsubishi Electric, paid 21 Sep 2026". */
const sourceWords = (o: Offer, preferred: boolean) =>
  [o.supplierName, o.pricedOn ? `paid ${dateOf(o.pricedOn)}` : null, preferred ? "preferred" : null].filter(Boolean).join(", ");

/** The supplier's other price for the part, not taken because it's older. */
const otherWords = (o: Offer) =>
  o.other
    ? o.other.from === "invoice"
      ? `Paid ${$(o.other.netCents)}${o.other.on ? ` on ${dateOf(o.other.on)}` : ""}`
      : `Price list ${$(o.other.netCents)}`
    : null;
const refOf = (o: Offer) => `${o.supplierKey}|${o.code}`;

type Answer = { ok: true; products: Product[] } | { ok: false; reason?: string };

/* read OUT HERE rather than inside the try that asks for it: React Compiler
   gives up on a component with a value block inside a try */
const productsIn = (a: Answer) => (a.ok ? a.products : null);
const refusalOf = (a: { ok: boolean; reason?: string }) => (a.ok ? null : (a.reason ?? "That couldn't be saved. Try again."));

/** How often a part goes on a quote, in words. */
const usedWords = (p: Product) => (p.quotes ? `On ${n(p.quotes)} quote${p.quotes === 1 ? "" : "s"}` : null);

/** A family's prices, lowest to highest. */
function rangeOf(f: Family): string {
  const prices = f.products.map((p) => p.cheapest?.netCents ?? 0).filter((c) => c > 0);
  if (prices.length === 0) return "No price";
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  return lo === hi ? $(lo) : `${$(lo)} to ${$(hi)}`;
}

const partsIn = (fs: Family[]) => fs.reduce((m, f) => m + f.products.length, 0);

/** One part: its name and codes, how often it's quoted, every supplier's price. */
function ProductRow({ p, busy, onPrefer }: { p: Product; busy: boolean; onPrefer: (p: Product, o: Offer) => void }) {
  const codes = [...new Set(p.offers.map((o) => o.code))].join(", ");
  const used = usedWords(p);
  return (
    <div className={p.preferred ? "pbk-prod on" : "pbk-prod"}>
      <span className="qs-item">
        <b>{p.name}</b>
        <em>{used ? `${codes}. ${used}` : codes}</em>
      </span>
      <span className="qs-groupoffers">
        {p.offers.map((o) => {
          const on = p.preferred ? refOf(p.preferred) === refOf(o) : false;
          const low = p.offers.length > 1 && p.cheapest != null && refOf(p.cheapest) === refOf(o);
          return (
            <button
              key={refOf(o)}
              type="button"
              className={["qs-offerbtn", low ? "ok" : "", on ? "on" : ""].filter(Boolean).join(" ")}
              aria-pressed={on}
              aria-label={`${on ? "Preferred" : "Prefer"} ${o.supplierName}'s ${o.code} at ${o.netCents > 0 ? $(o.netCents) : "no price"}`}
              disabled={busy}
              onClick={() => onPrefer(p, o)}
            >
              <em>{sourceWords(o, on)}</em>
              {o.netCents > 0 ? $(o.netCents) : "No price"}
              {o.other && <em>{otherWords(o)}</em>}
            </button>
          );
        })}
      </span>
    </div>
  );
}

export function BookItems() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<BookViewKey>("used");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  /* the whole book, once */
  useEffect(() => {
    let live = true;
    fetch(ROUTE)
      .then((r) => r.json() as Promise<Answer>)
      .then((a) => {
        if (!live) return;
        const got = productsIn(a);
        if (got) setProducts(got);
        else setFailed(true);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const go = (v: BookViewKey) => {
    setView(v);
    setOpen(new Set());
  };

  /** A part's preferred item, everywhere it's shown. */
  const mark = (key: string, preferred: Offer | null) =>
    setProducts((ps) => (ps ? ps.map((p) => (p.key === key ? { ...p, preferred } : p)) : ps));

  const prefer = async (p: Product, o: Offer) => {
    const was = p.preferred;
    const on = was === null || refOf(was) !== refOf(o);
    const body = JSON.stringify({ ref: refOf(o), on });
    mark(p.key, on ? o : null);
    const undo = (why: string) => {
      mark(p.key, was);
      setNote(why);
    };
    setBusy(true);
    setNote(null);
    await withCleanup(async () => {
      try {
        const a = (await (
          await fetch("/api/quoting/preferred", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
          })
        ).json()) as { ok: boolean; reason?: string };
        const refused = refusalOf(a);
        if (refused) undo(refused);
      } catch {
        undo("That couldn't be saved. Try again.");
      }
    }, () => setBusy(false));
  };

  const toggle = (key: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const searching = q.trim().length >= 2;
  const onShelf = view !== "used" && view !== "preferred";
  /* the most used and the preferred are short lists; a search from either
     looks through the whole book */
  const looking: BookViewKey = searching && !onShelf ? "all" : view;
  const counts = products ? countsOf(products) : null;
  const book = products ? viewOf(products, looking, searching ? q : "") : null;
  /* a shelf opens on its families; a search, the most used and the
     preferred list their parts */
  const folded = onShelf && !searching;
  const shelfLabel = counts?.shelves.find((s) => s.key === view)?.label;
  const title = searching && !onShelf ? "The whole price book" : view === "used" ? "Most used" : view === "preferred" ? "Preferred" : (shelfLabel ?? "");
  const families = book?.sections.reduce((m, s) => m + s.families.length, 0) ?? 0;

  return (
    <div className="pbk">
      <nav className="pbk-rail" aria-label="Price book views">
        {(
          [
            ["used", "Most used", counts?.used],
            ["preferred", "Preferred", counts?.preferred],
          ] as const
        ).map(([key, label, count]) => (
          <button key={key} type="button" className={view === key ? "pbk-view on" : "pbk-view"} aria-pressed={view === key} onClick={() => go(key)}>
            <span>{label}</span>
            {count ? <em>{n(count)}</em> : null}
          </button>
        ))}
        <div className="pbk-railsep" />
        {counts?.shelves.map((s) => (
          <button key={s.key} type="button" className={view === s.key ? "pbk-view on" : "pbk-view"} aria-pressed={view === s.key} onClick={() => go(s.key)}>
            <span>{s.label}</span>
            <em>{n(s.count)}</em>
          </button>
        ))}
      </nav>

      <div className="pbk-main">
        <div className="pbk-head">
          <div>
            <h2 className="pbk-title">{title}</h2>
            {book && (
              <p className="qs-sub">
                {book.total > book.shown
                  ? `${n(book.total)} parts, the first ${n(book.shown)}`
                  : folded
                    ? `${n(book.total)} parts in ${n(families)} ${families === 1 ? "family" : "families"}`
                    : `${n(book.total)} part${book.total === 1 ? "" : "s"}`}
              </p>
            )}
          </div>
          <input
            className="wb2-fi pbk-find"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={onShelf && shelfLabel ? `Search ${shelfLabel.toLowerCase()}` : "Search the price book"}
            aria-label="Search the price book"
          />
        </div>

        {note && <div className="int-note bad">{note}</div>}

        {failed ? (
          <p className="qs-sub">The price book couldn&rsquo;t be read. Try again.</p>
        ) : !book ? (
          <p className="qs-sub">Sorting the price book</p>
        ) : book.sections.length === 0 ? (
          <p className="qs-sub">
            {searching
              ? "Nothing in the price book matches."
              : view === "preferred"
                ? "Press a supplier's price on any part to prefer it."
                : view === "used"
                  ? "Parts land here as they go on quotes."
                  : "Nothing on this shelf yet."}
          </p>
        ) : (
          book.sections.map((s) => (
            <section key={s.key} className="pbk-sec" aria-label={s.label}>
              {(book.sections.length > 1 || !onShelf) && (
                <h3 className="pbk-sech">
                  {s.label}
                  <em>{n(partsIn(s.families))}</em>
                </h3>
              )}
              <div>
                {s.families.map((f) =>
                  folded && f.products.length > 1 ? (
                    <div key={f.key} className="pbk-fam">
                      <button
                        type="button"
                        className={open.has(`${s.key}|${f.key}`) ? "pbk-famrow on" : "pbk-famrow"}
                        aria-expanded={open.has(`${s.key}|${f.key}`)}
                        onClick={() => toggle(`${s.key}|${f.key}`)}
                      >
                        <span className="qs-item">
                          <b>{f.label}</b>
                          <em>
                            {f.products.some((p) => p.preferred)
                              ? `${n(f.products.length)} sizes, ${f.products.filter((p) => p.preferred).map((p) => p.preferred!.code).join(", ")} preferred`
                              : `${n(f.products.length)} sizes`}
                          </em>
                        </span>
                        <span className="pbk-range">{rangeOf(f)}</span>
                      </button>
                      {open.has(`${s.key}|${f.key}`) && (
                        <div className="pbk-sizes">
                          {f.products.map((p) => (
                            <ProductRow key={p.key} p={p} busy={busy} onPrefer={(x, o) => void prefer(x, o)} />
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    f.products.map((p) => <ProductRow key={p.key} p={p} busy={busy} onPrefer={(x, o) => void prefer(x, o)} />)
                  )
                )}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
