"use client";

import { useEffect, useState } from "react";
import type { PricedProposal, PricedSide, SameItemsView } from "@/lib/quotes/same-items-server";

/* ONE PART AT TWO SUPPLIERS, in Admin → Quoting.

   The same part under each supplier's own code — AAD's PC1412 pair coil is
   Reece's 9800006-1 — found by Tiff: a code written in the other's name,
   or the same kind of part with the same sizes. A person says "Same item"
   and from then on it's one item priced at both, in the search and the
   preferred items; or "Not the same", and it isn't proposed again. */

const ROUTE = "/api/quoting/same-items";
const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2 });
const $ = (cents: number) => money.format(cents / 100);
const refOf = (s: PricedSide) => `${s.supplierKey}|${s.code}`;

function Side({ s, cheaper }: { s: PricedSide; cheaper: boolean }) {
  return (
    <span role="cell" className="qs-item">
      <b>{s.name}</b>
      <em>
        {`${s.supplierName}, ${s.code}, `}
        <span className={cheaper ? "qs-state ok" : "qs-state"}>{s.netCents > 0 ? $(s.netCents) : "no price"}</span>
      </em>
    </span>
  );
}

export function SameItemsPanel() {
  const [view, setView] = useState<SameItemsView | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(ROUTE)
      .then((r) => r.json() as Promise<{ ok: boolean } & Partial<SameItemsView>>)
      .then((a) => {
        if (!live) return;
        if (a.ok && a.proposals) setView({ proposals: a.proposals, confirmed: a.confirmed ?? 0 });
        else setFailed(true);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const decide = async (p: PricedProposal, decision: "confirmed" | "rejected") => {
    const key = `${refOf(p.a)}#${refOf(p.b)}`;
    setBusy(key);
    try {
      const a = (await (
        await fetch(ROUTE, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ a: refOf(p.a), b: refOf(p.b), decision }),
        })
      ).json()) as { ok: boolean };
      if (!a.ok) return;
      setView((cur) =>
        cur
          ? {
              proposals: cur.proposals.filter((x) => `${refOf(x.a)}#${refOf(x.b)}` !== key),
              confirmed: cur.confirmed + (decision === "confirmed" ? 1 : 0),
            }
          : cur
      );
    } finally {
      setBusy(null);
    }
  };

  if (failed) return <p className="qs-sub">The price lists couldn&rsquo;t be compared.</p>;
  if (!view) return <p className="qs-sub">Comparing the price lists</p>;

  return (
    <section className="qs-group">
      <h2 className="qs-h">Same item, two suppliers</h2>
      <p className="qs-sub">
        {`${view.confirmed} confirmed, ${view.proposals.length} to check. A confirmed pair is one item priced at both suppliers.`}
      </p>
      {view.proposals.length > 0 && (
        <div className="qs-table" role="table" aria-label="Items to check">
          <div className="qs-row qs-headrow qs-samerow" role="row">
            <span role="columnheader">Item</span>
            <span role="columnheader">Looks the same as</span>
            <span role="columnheader">Why</span>
            <span role="columnheader" />
          </div>
          {view.proposals.map((p) => {
            const key = `${refOf(p.a)}#${refOf(p.b)}`;
            const both = p.a.netCents > 0 && p.b.netCents > 0 && p.a.netCents !== p.b.netCents;
            return (
              <div className="qs-row qs-samerow" role="row" key={key}>
                <Side s={p.a} cheaper={both && p.a.netCents < p.b.netCents} />
                <Side s={p.b} cheaper={both && p.b.netCents < p.a.netCents} />
                <span role="cell" className="qs-saves">
                  {p.why === "mentioned" ? `${p.shared[0]} is in the name` : p.shared.join(", ")}
                </span>
                <span role="cell" className="qs-act qs-acts2">
                  <button type="button" className="pbtn ghost sm" disabled={busy !== null} onClick={() => void decide(p, "rejected")}>
                    Not the same
                  </button>
                  <button type="button" className="pbtn primary sm" disabled={busy !== null} onClick={() => void decide(p, "confirmed")}>
                    Same item
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
