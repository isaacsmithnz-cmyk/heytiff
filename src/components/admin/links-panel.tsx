"use client";

import { useEffect, useState } from "react";
import type { DiffKind } from "@/lib/quotes/code-links";
import type { PricedLink, ProposalView } from "@/lib/quotes/links-server";
import type { Offer } from "@/lib/quotes/price-book";
import { withCleanup } from "@/lib/ui/with-cleanup";

/* THE PACK'S MODELS AND THEIR ORDER CODES, in Admin → Price book → Matching.

   The Studio's equipment pack names a unit as the brochure does; the price
   books sell it by its order code. Exact and tag-only matches are linked
   already, and so is a pack name in the brochure's shorthand ("PEAD-M50JAA(D)"
   is the JAAD in the book).

   A near match waits for a person (Isaac, 2026-10-05: "most matches are a
   slight variant in model code… should it just group similar units?"). A
   near unit is one decision, whatever its revisions and suppliers, and near
   units wait in groups by what differs — a newer build, Wi-Fi built in (K),
   demand response (D), a letter — each group confirmed in one press. A unit
   is left out of its group's press by unticking it, or said not to be the
   same; either answer is kept. Nothing in the pack is renamed. */

const ROUTE = "/api/quoting/links";
const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2 });
const dollars = (cents: number) => money.format(cents / 100);

const GROUPS: { kind: DiffKind; title: string }[] = [
  { kind: "build", title: "A newer or older build of the same unit" },
  { kind: "wifi", title: "The order code adds Wi-Fi built in (K)" },
  { kind: "dred", title: "The order code adds demand response (D)" },
  { kind: "letter", title: "A letter different" },
];

type Row = { id: string; link: PricedLink; proposal: ProposalView };
type Answer = { ok: boolean; reason?: string };

const refusal = (a: Answer) => a.reason ?? "That couldn't be saved. Try again.";
const units = (n: number) => `${n} unit${n === 1 ? "" : "s"}`;

function Offers({ offers }: { offers: Offer[] }) {
  if (offers.length === 0) return <em className="qs-none">No price</em>;
  const low = Math.min(...offers.map((o) => o.netCents));
  return (
    <span className="qs-offers">
      {offers.map((o) => (
        <span key={`${o.supplierKey}:${o.code}`} className={offers.length > 1 && o.netCents === low ? "qs-offer ok" : "qs-offer"}>
          <em>{o.supplierName}</em>
          {dollars(o.netCents)}
        </span>
      ))}
    </span>
  );
}

export function LinksPanel() {
  const [links, setLinks] = useState<PricedLink[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reads, setReads] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  /* units a person unticked: left out of their group's press */
  const [left, setLeft] = useState<Set<string>>(() => new Set());
  const [showUnpriced, setShowUnpriced] = useState(false);

  /* read again after every answer: what's linked now prices, and what's
     left waits where it was */
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
  }, [reads]);

  const answer = async (rows: Row[], decision: "confirmed" | "rejected", key: string, done: string) => {
    const body = JSON.stringify({ decisions: rows.flatMap((r) => r.proposal.codes.map((code) => ({ model: r.link.model, code, decision }))) });
    setBusy(key);
    setNote(null);
    await withCleanup(async () => {
      try {
        const a = (await (await fetch(ROUTE, { method: "POST", headers: { "content-type": "application/json" }, body })).json()) as Answer;
        if (!a.ok) {
          setNote({ tone: "bad", text: refusal(a) });
          return;
        }
        setNote({ tone: "ok", text: done });
        setReads((n) => n + 1);
      } catch {
        setNote({ tone: "bad", text: "That couldn't be saved. Try again." });
      }
    }, () => setBusy(null));
  };

  const toggle = (id: string) =>
    setLeft((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (failed) return <p className="qs-sub">The pack&rsquo;s links couldn&rsquo;t be read.</p>;
  if (!links) return <p className="qs-sub">Reading the equipment pack</p>;

  const linked = links.filter((l) => l.codes.length > 0);
  const waiting = links.filter((l) => l.proposals.length > 0);
  const unpriced = links.filter((l) => l.codes.length === 0 && l.proposals.length === 0);
  const rows: Row[] = waiting.flatMap((link) => link.proposals.map((proposal) => ({ id: `${link.model}|${proposal.codes[0]}`, link, proposal })));

  return (
    <section className="qs-group">
      <h2 className="qs-h">Equipment pack links</h2>
      <p className="qs-sub">
        {`${linked.length} of ${links.length} pack models linked to an order code, ${units(rows.length)} to confirm, ${unpriced.length} with no price in any price list.`}
      </p>
      {note && <div className={`int-note ${note.tone}`}>{note.text}</div>}

      {GROUPS.map((g) => {
        const mine = rows.filter((r) => r.proposal.kind === g.kind);
        if (mine.length === 0) return null;
        const ticked = mine.filter((r) => !left.has(r.id));
        return (
          <div key={g.kind} className="lk-group">
            <h3 className="qs-h">{`${g.title}, ${units(mine.length)}`}</h3>
            <div className="qs-table" role="table" aria-label={g.title}>
              <div className="qs-row qs-headrow lk-row" role="row">
                <span role="columnheader">
                  <span className="sr-only">Include</span>
                </span>
                <span role="columnheader">Pack model</span>
                <span role="columnheader">Order code</span>
                <span role="columnheader">Prices</span>
                <span role="columnheader" />
              </div>
              {mine.map((r) => (
                <div className="qs-row lk-row" role="row" key={r.id}>
                  <span role="cell">
                    <input type="checkbox" checked={!left.has(r.id)} disabled={busy !== null} onChange={() => toggle(r.id)} aria-label={`Include ${r.link.model}`} />
                  </span>
                  <span role="cell" className="qs-item">
                    <b>{r.link.model}</b>
                    <em>{[r.link.section, r.link.label].filter(Boolean).join(", ")}</em>
                  </span>
                  <span role="cell" className="qs-item">
                    {r.proposal.codes.join(", ")}
                    <em>{r.proposal.words}</em>
                  </span>
                  <span role="cell">
                    <Offers offers={r.proposal.offers} />
                  </span>
                  <span role="cell" className="qs-act">
                    <button
                      type="button"
                      className="pbtn ghost sm"
                      disabled={busy !== null}
                      onClick={() => void answer([r], "rejected", r.id, `${r.link.model}: not the same unit, and won't be offered again.`)}
                    >
                      Not the same
                    </button>
                  </span>
                </div>
              ))}
            </div>
            <div className="wb2-jqacts">
              <button
                type="button"
                className="pbtn primary"
                disabled={busy !== null || ticked.length === 0}
                aria-label={`Confirm ${units(ticked.length)}: ${g.title}`}
                onClick={() => void answer(ticked, "confirmed", g.kind, `${units(ticked.length)} linked.`)}
              >
                {busy === g.kind ? "Linking" : `Confirm ${units(ticked.length)}`}
              </button>
            </div>
          </div>
        );
      })}

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
