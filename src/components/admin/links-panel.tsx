"use client";

import { useEffect, useState } from "react";
import type { PricedLink } from "@/lib/quotes/links-server";
import type { Offer } from "@/lib/quotes/price-book";

/* THE PACK'S MODELS AND THEIR ORDER CODES, in Admin → Quoting.

   The Studio's equipment pack names a unit as the brochure does; the price
   books sell it by its order code. Exact and tag-only matches are linked
   already. A near match (the pack's MSZ-AP71VGD2 against the order code
   MSZ-AP71VGKD2-A2) waits here with its prices until a person confirms it
   or says it isn't the same unit; either answer is kept. Nothing in the
   pack is renamed. */

const ROUTE = "/api/quoting/links";
const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2 });
const $ = (cents: number) => money.format(cents / 100);

function Offers({ offers }: { offers: Offer[] }) {
  if (offers.length === 0) return <em className="qs-none">No price</em>;
  const low = Math.min(...offers.map((o) => o.netCents));
  return (
    <span className="qs-offers">
      {offers.map((o) => (
        <span key={`${o.supplierKey}:${o.code}`} className={offers.length > 1 && o.netCents === low ? "qs-offer ok" : "qs-offer"}>
          <em>{o.supplierName}</em>
          {$(o.netCents)}
        </span>
      ))}
    </span>
  );
}

export function LinksPanel() {
  const [links, setLinks] = useState<PricedLink[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showUnpriced, setShowUnpriced] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(ROUTE)
      .then((r) => r.json() as Promise<{ ok: boolean; links?: PricedLink[] }>)
      .then((a) => {
        if (!live) return;
        if (a.ok && a.links) setLinks(a.links);
        else setFailed(true);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const decide = async (model: string, code: string, decision: "confirmed" | "rejected") => {
    setBusy(`${model}|${code}`);
    try {
      const a = (await (
        await fetch(ROUTE, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model, code, decision }),
        })
      ).json()) as { ok: boolean };
      if (!a.ok) return;
      setLinks((cur) =>
        (cur ?? []).map((l) => {
          if (l.model !== model) return l;
          if (decision === "rejected") return { ...l, proposed: l.proposed.filter((c) => c !== code) };
          const sorted = [...l.offers, ...(l.proposedOffers[code] ?? [])].sort((a, b) => a.netCents - b.netCents);
          return {
            ...l,
            codes: [...l.codes, code],
            proposed: l.proposed.filter((c) => c !== code),
            offers: sorted,
            cheapest: sorted[0] ?? null,
            savesCents: sorted[1] && sorted[0] ? sorted[1].netCents - sorted[0].netCents : null,
          };
        })
      );
    } finally {
      setBusy(null);
    }
  };

  if (failed) return <p className="qs-sub">The pack&rsquo;s links couldn&rsquo;t be read.</p>;
  if (!links) return <p className="qs-sub">Reading the equipment pack</p>;

  const linked = links.filter((l) => l.codes.length > 0);
  const toConfirm = links.filter((l) => l.proposed.length > 0);
  const unpriced = links.filter((l) => l.codes.length === 0 && l.proposed.length === 0);

  return (
    <section className="qs-group">
      <h2 className="qs-h">Equipment pack links</h2>
      <p className="qs-sub">
        {`${linked.length} of ${links.length} pack models linked to an order code, ${toConfirm.length} to confirm, ${unpriced.length} with no price in any price list.`}
      </p>

      {toConfirm.length > 0 && (
        <div className="qs-table" role="table" aria-label="Links to confirm">
          <div className="qs-row qs-headrow qs-linkrow" role="row">
            <span role="columnheader">Pack model</span>
            <span role="columnheader">Order code</span>
            <span role="columnheader">Prices</span>
            <span role="columnheader" />
          </div>
          {toConfirm.flatMap((l) =>
            l.proposed.slice(0, 2).map((code) => (
              <div className="qs-row qs-linkrow" role="row" key={`${l.model}|${code}`}>
                <span role="cell" className="qs-item">
                  <b>{l.model}</b>
                  <em>{[l.section, l.label].filter(Boolean).join(", ")}</em>
                </span>
                <span role="cell">{code}</span>
                <span role="cell">
                  <Offers offers={l.proposedOffers[code] ?? []} />
                </span>
                <span role="cell" className="qs-act qs-acts2">
                  <button
                    type="button"
                    className="pbtn ghost sm"
                    disabled={busy !== null}
                    onClick={() => void decide(l.model, code, "rejected")}
                  >
                    Not the same
                  </button>
                  <button
                    type="button"
                    className="pbtn primary sm"
                    disabled={busy !== null}
                    onClick={() => void decide(l.model, code, "confirmed")}
                  >
                    Confirm link
                  </button>
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {unpriced.length > 0 && (
        <div className="wb2-jqacts">
          <button type="button" className="pbtn ghost sm" onClick={() => setShowUnpriced((v) => !v)} aria-expanded={showUnpriced}>
            {showUnpriced ? "Hide models with no price" : `Show the ${unpriced.length} models with no price`}
          </button>
        </div>
      )}
      {showUnpriced && (
        <ul className="qs-list qs-unpriced">
          {unpriced.map((l) => (
            <li key={l.model}>
              <span className="qs-item">
                {l.model}
                <em>{[l.section, l.label].filter(Boolean).join(", ")}</em>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
