"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/parts/button";
import { Chooser, type ChooserOption } from "@/components/parts/chooser";
import { Fade } from "@/components/parts/fade";
import { SearchField } from "@/components/parts/search-field";
import { StateWord } from "@/components/parts/state";
import { Empty, Loading } from "@/components/parts/states";
import { Wrong } from "@/components/settings/parts";
import { rollMetresOf, sellCents } from "@/lib/quotes/components";
import type { Offer } from "@/lib/quotes/price-book";
import { countsOf, viewOf, type BookView, type BookViewKey, type Family, type Product } from "@/lib/quotes/families";
import { withCleanup } from "@/lib/ui/with-cleanup";

/* THE PRICE BOOK'S ITEMS (v2, 25 October 2026; the mock's Price book
   board): the search, what to show beside it, and the book as a table, a
   part a row, with what it costs and what it sells at (families.ts sorts
   it).

   What to show: the parts on the most quotes, the ones the business has
   put forward, or a shelf. A shelf comes as its families, "Paired coil, 11
   sizes", each opening onto its sizes; units, controls and parts come by
   maker first ("Daikin"). A search from the most used or the preferred
   looks through the whole book; on a shelf, through the shelf.

   The whole book comes once a visit and is sorted here: a shelf, a search,
   Most used answer at once, with nothing asked of the server (Isaac,
   2026-10-05: "the price book is slow to load").

   A part's row shows the item a quote takes, the preferred one or else
   the lowest priced, and what it sells at, at the materials markup, by the
   metre when its name says it's a roll. Opened, it shows every supplier's
   price, the newer of its price list's and what was last paid on its
   invoices, the other under it with its date, the lowest in the state's
   green.

   PREFERRED: Make preferred puts that supplier's item forward. From then on
   a quote takes it over a cheaper one, the job checklist's search lists it
   first, and its family comes to the top of its shelf. Stop preferring
   takes it back; another supplier's Make preferred moves it there. */

const ROUTE = "/api/quoting/price-book";
const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2 });
const $ = (cents: number) => money.format(cents / 100);
const n = (v: number) => v.toLocaleString("en-AU");
const dateOf = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });

/** The supplier's other price for the part, not taken because it's older. */
const otherWords = (o: Offer) =>
  o.other
    ? o.other.from === "invoice"
      ? `paid ${$(o.other.netCents)}${o.other.on ? ` on ${dateOf(o.other.on)}` : ""}`
      : `price list ${$(o.other.netCents)}`
    : null;
const refOf = (o: Offer) => `${o.supplierKey}|${o.code}`;

type Answer = { ok: true; products: Product[] } | { ok: false; reason?: string };

/* read OUT HERE rather than inside the try that asks for it: React Compiler
   gives up on a component with a value block inside a try */
const productsIn = (a: Answer) => (a.ok ? a.products : null);
const refusalOf = (a: { ok: boolean; reason?: string }) => (a.ok ? null : (a.reason ?? "That couldn't be saved. Try again."));

/** How often a part goes on a quote, in words. */
const usedWords = (p: Product) => (p.quotes ? `on ${n(p.quotes)} quote${p.quotes === 1 ? "" : "s"}` : null);

/** A roll's length, in the words its line says it with. */
const rollWords = (m: number | null) => (m == null ? null : m === 1 ? "by the metre" : `${n(m)} m`);

/** What a part sells at: the buy price, by the metre for a roll, plus the materials markup. */
function sellsAt(o: Offer, markupPct: number | null): string {
  if (markupPct == null || o.netCents <= 0) return "";
  const roll = rollMetresOf(o.name);
  return roll ? `${$(sellCents(Math.round(o.netCents / roll), markupPct))} a metre` : `${$(sellCents(o.netCents, markupPct))} each`;
}

/** A family's prices, lowest to highest. */
function rangeOf(f: Family): string {
  const prices = f.products.map((p) => p.cheapest?.netCents ?? 0).filter((c) => c > 0);
  if (prices.length === 0) return "No price";
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  return lo === hi ? $(lo) : `${$(lo)} to ${$(hi)}`;
}

/** The item a quote takes: the preferred, else the lowest priced. */
const taken = (p: Product) => p.preferred ?? p.cheapest ?? p.offers[0] ?? null;

/** One part: its name, the item a quote takes, what it costs and sells at;
    opened, every supplier's price and the choice of which is preferred. */
function ProductRow({
  p,
  markupPct,
  open,
  busy,
  onToggle,
  onPrefer,
}: {
  p: Product;
  markupPct: number | null;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onPrefer: (p: Product, o: Offer) => void;
}) {
  const o = taken(p);
  const line = [o?.code, rollWords(o ? rollMetresOf(o.name) : null), usedWords(p)].filter(Boolean).join(", ");
  const others = p.offers.length - 1;
  return (
    <div className={open ? "st2-pb-prod on" : "st2-pb-prod"}>
      <div className="st2-pb-row">
        <span className="st2-pb-name">
          <button type="button" className="st2-pb-open" aria-expanded={open} onClick={onToggle}>
            <Fade>{p.name}</Fade>
          </button>
          {line && (
            <span className="st2-pb-line">
              <Fade>{line}</Fade>
            </span>
          )}
        </span>
        <span className="st2-pb-sup">
          <Fade>{o ? (others > 0 ? `${o.supplierName} and ${others} more` : o.supplierName) : ""}</Fade>
          {p.preferred && <StateWord tone="good">Preferred</StateWord>}
        </span>
        <span className="st2-pb-fig">{o ? (o.netCents > 0 ? $(o.netCents) : "No price") : ""}</span>
        <span className="st2-pb-fig">{o ? sellsAt(o, markupPct) : ""}</span>
      </div>
      {open && (
        <ul className="st2-pb-offers" aria-label={`${p.name} at each supplier`}>
          {p.offers.map((x) => {
            const on = p.preferred ? refOf(p.preferred) === refOf(x) : false;
            const low = p.offers.length > 1 && p.cheapest != null && refOf(p.cheapest) === refOf(x);
            const price = x.netCents > 0 ? $(x.netCents) : "No price";
            const sub = [x.code, x.pricedOn ? `paid ${dateOf(x.pricedOn)}` : null, otherWords(x)].filter(Boolean).join(", ");
            return (
              <li key={refOf(x)} className="st2-pb-row st2-pb-offer">
                <span className="st2-pb-name">
                  <b>{x.supplierName}</b>
                  <span className="st2-pb-line">
                    <Fade>{sub}</Fade>
                  </span>
                </span>
                <span className="st2-pb-sup">{on && <StateWord tone="good">Preferred</StateWord>}</span>
                <span className={low ? "st2-pb-fig st2-pb-low" : "st2-pb-fig"}>
                  {price}
                  {low && <span className="sr-only">, the lowest</span>}
                </span>
                <span className="st2-pb-act">
                  {on ? (
                    <Button kind="quiet" size={32} disabled={busy} aria-label={`Stop preferring ${x.supplierName}'s ${x.code}`} onClick={() => onPrefer(p, x)}>
                      Stop preferring
                    </Button>
                  ) : (
                    <Button kind="second" size={32} disabled={busy} aria-label={`Prefer ${x.supplierName}'s ${x.code} at ${price}`} onClick={() => onPrefer(p, x)}>
                      Make preferred
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** A long list shows its first rows until asked. */
const SHOWN = 200;

type Line = { kind: "family"; family: Family } | { kind: "part"; part: Product };

/** What's drawn of a view: on a shelf, a family of sizes is one row; up to
    `limit` rows, and whether any were left off. */
function linesOf(sections: BookView["sections"], folded: boolean, limit: number) {
  let left = limit;
  const out: { key: string; label: string; lines: Line[] }[] = [];
  for (const s of sections) {
    const lines: Line[] = [];
    for (const f of s.families) {
      if (folded && f.products.length > 1) {
        if (left > 0) lines.push({ kind: "family", family: f });
        left -= 1;
        continue;
      }
      for (const p of f.products) {
        if (left > 0) lines.push({ kind: "part", part: p });
        left -= 1;
      }
    }
    if (lines.length) out.push({ key: s.key, label: s.label, lines });
  }
  return { sections: out, cut: left < 0 };
}

export function BookItems({
  markupPct = null,
  book: started,
}: {
  markupPct?: number | null;
  /** the book, its read started with the page (26 October 2026): asked for
      after the page had drawn, it waited a whole page load behind it */
  book?: Promise<Product[]>;
}) {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<BookViewKey>("used");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState<string | null>(null);

  /* the whole book, once: the page's read when it started one, else asked
     for here */
  useEffect(() => {
    let live = true;
    /* Promise.resolve, not `started` itself: the page's read reaches the
       browser as React's own thenable, whose `then` hands back nothing, so
       a `.catch` chained on it threw and the page fell to its error screen
       (26 October 2026). Wrapped, it is a promise like any other. */
    const read: Promise<Product[] | null> = started
      ? Promise.resolve(started)
      : fetch(ROUTE).then((r) => r.json() as Promise<Answer>).then(productsIn);
    read
      .then((got) => {
        if (!live) return;
        if (got) setProducts(got);
        else setFailed(true);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [started]);

  const go = (v: BookViewKey) => {
    setView(v);
    setOpen(new Set());
    setAll(false);
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
      setWrong(why);
    };
    setBusy(true);
    setWrong(null);
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
  const headed = (book?.sections.length ?? 0) > 1 || !onShelf;

  const options: ChooserOption[] = [
    { value: "used", label: "Most used" },
    { value: "preferred", label: "Preferred" },
    ...(counts?.shelves ?? []).map((s) => ({ value: s.key, label: s.label })),
  ];

  /* a long view draws its first rows, the rest on asking */
  const drawn = book ? linesOf(book.sections, folded, all ? Infinity : SHOWN) : null;

  const row = (p: Product) => (
    <ProductRow key={p.key} p={p} markupPct={markupPct} open={open.has(p.key)} busy={busy} onToggle={() => toggle(p.key)} onPrefer={(x, o) => void prefer(x, o)} />
  );

  return (
    <div className="st2-pb-items">
      <div className="st2-pb-bar">
        <SearchField
          className="st2-pb-find"
          value={q}
          onChange={setQ}
          label="Search the price book"
          placeholder={onShelf && shelfLabel ? `Search ${shelfLabel.toLowerCase()}` : "Search the price book"}
        />
        <Chooser className="st2-pb-show" aria-label="Show" options={options} value={view} onChange={(v) => go(v as BookViewKey)} />
      </div>

      {wrong && <Wrong>{wrong}</Wrong>}

      {failed ? (
        <Wrong>The price book couldn&rsquo;t be read. Try again.</Wrong>
      ) : !book ? (
        <Loading what="Sorting the price book" />
      ) : book.sections.length === 0 ? (
        <Empty
          what={
            searching
              ? "Nothing in the price book matches"
              : view === "preferred"
                ? "Nothing preferred yet"
                : view === "used"
                  ? "Nothing on a quote yet"
                  : "Nothing on this shelf yet"
          }
          action={null}
        />
      ) : (
        <div className="st2-pb-table">
          <div className="st2-pb-row st2-pb-head" aria-hidden="true">
            <span>Item</span>
            <span>Supplier</span>
            <span className="st2-pb-fig">Buy</span>
            <span className="st2-pb-fig">Sells at</span>
          </div>
          {drawn?.sections.map((s) => (
            <section key={s.key} className="st2-pb-sec" aria-label={s.label}>
              {headed && <h3 className="st2-pb-sech">{s.label}</h3>}
              {s.lines.map((l) => {
                if (l.kind === "part") return row(l.part);
                const f = l.family;
                const key = `${s.key}|${f.key}`;
                const isOpen = open.has(key);
                const preferred = f.products.filter((p) => p.preferred).map((p) => p.preferred!.code);
                return (
                  <div key={f.key} className={isOpen ? "st2-pb-fam on" : "st2-pb-fam"}>
                    <div className="st2-pb-row">
                      <span className="st2-pb-name">
                        <button type="button" className="st2-pb-open" aria-expanded={isOpen} onClick={() => toggle(key)}>
                          <Fade>{f.label}</Fade>
                        </button>
                        <span className="st2-pb-line">
                          <Fade>{preferred.length ? `${n(f.products.length)} sizes, ${preferred.join(", ")} preferred` : `${n(f.products.length)} sizes`}</Fade>
                        </span>
                      </span>
                      <span className="st2-pb-sup" />
                      <span className="st2-pb-fig">{rangeOf(f)}</span>
                      <span className="st2-pb-fig" />
                    </div>
                    {isOpen && <div className="st2-pb-sizes">{f.products.map(row)}</div>}
                  </div>
                );
              })}
            </section>
          ))}
          {(drawn?.cut || book.total > book.shown) && (
            <div className="st2-pb-more">
              {book.total > book.shown && <span>{`The first ${n(book.shown)} of ${n(book.total)} parts. Search to find the rest.`}</span>}
              {drawn?.cut && (
                <Button kind="second" size={32} onClick={() => setAll(true)}>
                  Show every part
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
