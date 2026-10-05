"use client";

import { useEffect, useRef, useState } from "react";
import type { Offer } from "@/lib/quotes/price-book";
import type { BookView, BookViewKey, Family, Product } from "@/lib/quotes/families";
import { withCleanup } from "@/lib/ui/with-cleanup";

/* THE PRICE BOOK'S ITEMS — the book sorted so a person can find a part
   without knowing its code (families.ts sorts it).

   Down the left, what to look at: the parts the business uses most (its
   own job lines and invoices), the ones it has put forward, then every
   shelf. On the right, the shelf's families — "Paired coil, 11 sizes" —
   each opening onto its sizes, and every size with each supplier's price.

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

type Answer = ({ ok: true } & BookView) | { ok: false; reason?: string };

/* read OUT HERE rather than inside the try that asks for it: React Compiler
   gives up on a component with a value block inside a try */
const viewIn = (a: Answer) => (a.ok ? a : null);
const refusalOf = (a: { ok: boolean; reason?: string }) => (a.ok ? null : (a.reason ?? "That couldn't be saved. Try again."));

/** The view asked for. The most used and the preferred are short lists; a
    search from either looks through the whole book. */
function viewUrl(v: BookViewKey, words: string): string {
  const q = words.trim();
  const searching = q.length >= 2;
  const target = searching && (v === "used" || v === "preferred") ? "all" : v;
  return `${ROUTE}?${new URLSearchParams({ view: target, q: searching ? q : "" })}`;
}

/** How often a part is used, in words. */
function usedWords(p: Product): string | null {
  const parts = [
    p.jobLines ? `on ${n(p.jobLines)} job line${p.jobLines === 1 ? "" : "s"}` : null,
    p.bought ? `bought ${n(p.bought)} time${p.bought === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A family's prices, lowest to highest. */
function rangeOf(f: Family): string {
  const prices = f.products.map((p) => p.cheapest?.netCents ?? 0).filter((c) => c > 0);
  if (prices.length === 0) return "No price";
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  return lo === hi ? $(lo) : `${$(lo)} to ${$(hi)}`;
}

/** One part: its name and codes, how often it's used, every supplier's price. */
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
  const [view, setView] = useState<BookViewKey>("used");
  const [q, setQ] = useState("");
  const [book, setBook] = useState<BookView | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const asked = useRef(0);

  const land = (a: Answer) => {
    const got = viewIn(a);
    setBook(got);
    setFailed(got === null);
  };

  const load = async (v: BookViewKey, words: string) => {
    const mine = ++asked.current;
    setLoading(true);
    const url = viewUrl(v, words);
    await withCleanup(async () => {
      try {
        const a = (await (await fetch(url)).json()) as Answer;
        if (mine === asked.current) land(a);
      } catch {
        if (mine === asked.current) setFailed(true);
      }
    }, () => {
      if (mine === asked.current) setLoading(false);
    });
  };

  /* the first view, once */
  useEffect(() => {
    let live = true;
    fetch(viewUrl("used", ""))
      .then((r) => r.json() as Promise<Answer>)
      .then((a) => {
        if (!live) return;
        const got = viewIn(a);
        setBook(got);
        setFailed(got === null);
      })
      .catch(() => live && setFailed(true))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const go = (v: BookViewKey) => {
    setView(v);
    setOpen(new Set());
    if (timer.current) clearTimeout(timer.current);
    void load(v, q);
  };

  const search = (value: string) => {
    setQ(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(view, value), 250);
  };

  /* every copy of the part on screen takes the change: a part can sit in
     the most-used list and on its shelf */
  const mark = (key: string, preferred: Offer | null, delta: number) =>
    setBook((b) =>
      b
        ? {
            ...b,
            counts: { ...b.counts, preferred: b.counts.preferred + delta },
            sections: b.sections.map((s) => ({
              ...s,
              families: s.families.map((f) => ({ ...f, products: f.products.map((p) => (p.key === key ? { ...p, preferred } : p)) })),
            })),
          }
        : b
    );

  const prefer = async (p: Product, o: Offer) => {
    const was = p.preferred;
    const on = was === null || refOf(was) !== refOf(o);
    /* one more preferred part, one fewer, or the same part moved */
    const delta = was === null ? 1 : on ? 0 : -1;
    const body = JSON.stringify({ ref: refOf(o), on, others: p.offers.map(refOf) });
    mark(p.key, on ? o : null, delta);
    const undo = (why: string) => {
      mark(p.key, was, -delta);
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

  const counts = book?.counts;
  const searching = q.trim().length >= 2;
  const onShelf = view !== "used" && view !== "preferred";
  /* a shelf opens on its families; a search, the most used and the
     preferred list their parts */
  const folded = onShelf && !searching;
  const shelfLabel = counts?.shelves.find((s) => s.key === view)?.label;
  const title = view === "used" ? "Most used" : view === "preferred" ? "Preferred" : (shelfLabel ?? "");
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
            <h2 className="pbk-title">{searching && !onShelf ? "The whole price book" : title}</h2>
            {book && !failed && (
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
            onChange={(e) => search(e.target.value)}
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
            {loading
              ? "Looking"
              : searching
                ? "Nothing in the price book matches."
                : view === "preferred"
                  ? "Press a supplier's price on any part to prefer it."
                  : view === "used"
                    ? "Upload your suppliers' invoices, or link ServiceM8, to see what you use most."
                    : "Nothing on this shelf yet."}
          </p>
        ) : (
          book.sections.map((s) => (
            <section key={s.key} className="pbk-sec" aria-label={s.label}>
              {(book.sections.length > 1 || !onShelf) && <h3 className="pbk-sech">{s.label}</h3>}
              <div>
                {s.families.map((f) =>
                  folded && f.products.length > 1 ? (
                    <div key={f.key} className="pbk-fam">
                      <button
                        type="button"
                        className={open.has(f.key) ? "pbk-famrow on" : "pbk-famrow"}
                        aria-expanded={open.has(f.key)}
                        onClick={() => toggle(f.key)}
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
                      {open.has(f.key) && (
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
