"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/parts/button";
import { Fade } from "@/components/parts/fade";
import { Loading } from "@/components/parts/states";
import { Tick } from "@/components/parts/tick";
import { Group, Wrong } from "@/components/settings/parts";
import type { DiffKind } from "@/lib/quotes/code-links";
import type { PricedLink, ProposalView } from "@/lib/quotes/links-server";
import type { Offer } from "@/lib/quotes/price-book";
import { withCleanup } from "@/lib/ui/with-cleanup";
import { dollars, Said } from "./pb-bits";

/* THE PACK'S MODELS AND THEIR ORDER CODES, in Price book › Matching.

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

const GROUPS: { kind: DiffKind; heading: string }[] = [
  { kind: "build", heading: "A newer or older build of the same unit" },
  { kind: "wifi", heading: "The order code adds Wi-Fi built in (K)" },
  { kind: "dred", heading: "The order code adds demand response (D)" },
  { kind: "letter", heading: "A letter different" },
];

type Row = { id: string; link: PricedLink; proposal: ProposalView };
type Answer = { ok: boolean; reason?: string };

const refusal = (a: Answer) => a.reason ?? "That couldn't be saved. Try again.";
const units = (n: number) => `${n} unit${n === 1 ? "" : "s"}`;

/** Every supplier's price for a code, the lowest of several in green. */
function Offers({ offers }: { offers: Offer[] }) {
  if (offers.length === 0) return <span className="st2-pb-none">No price</span>;
  const low = Math.min(...offers.map((o) => o.netCents));
  return (
    <span className="st2-pb-offerlist">
      {offers.map((o) => (
        <span key={`${o.supplierKey}:${o.code}`}>
          <span className="st2-pb-line">{`${o.supplierName} `}</span>
          <span className={offers.length > 1 && o.netCents === low ? "st2-pb-low" : undefined}>{dollars(o.netCents)}</span>
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

  if (failed)
    return (
      <Group heading="Equipment pack links">
        <Wrong>The pack&rsquo;s links couldn&rsquo;t be read. Try again.</Wrong>
      </Group>
    );
  if (!links)
    return (
      <Group heading="Equipment pack links">
        <Loading what="Reading the equipment pack" />
      </Group>
    );

  const linked = links.filter((l) => l.codes.length > 0);
  const waiting = links.filter((l) => l.proposals.length > 0);
  const unpriced = links.filter((l) => l.codes.length === 0 && l.proposals.length === 0);
  const rows: Row[] = waiting.flatMap((link) => link.proposals.map((proposal) => ({ id: `${link.model}|${proposal.codes[0]}`, link, proposal })));

  return (
    <Group heading="Equipment pack links">
      <p className="st2-pb-said">
        {`${linked.length} of ${links.length} pack models linked to an order code, ${units(rows.length)} to confirm, ${unpriced.length} with no price in any price list.`}
      </p>
      {note && (note.tone === "ok" ? <Said>{note.text}</Said> : <Wrong>{note.text}</Wrong>)}

      {GROUPS.map((g) => {
        const mine = rows.filter((r) => r.proposal.kind === g.kind);
        if (mine.length === 0) return null;
        const ticked = mine.filter((r) => !left.has(r.id));
        return (
          <section key={g.kind} className="st2-pb-part" aria-label={g.heading}>
            <h3 className="st2-pb-sub">{g.heading}</h3>
            <div className="st2-pb-rows" role="table" aria-label={g.heading}>
              <div className="st2-pb-grid st2-pb-links st2-pb-head" role="row">
                <span role="columnheader">
                  <span className="sr-only">Include</span>
                </span>
                <span role="columnheader">Pack model</span>
                <span role="columnheader">Order code</span>
                <span role="columnheader" className="st2-pb-fig">
                  Prices
                </span>
                <span role="columnheader">
                  <span className="sr-only">Answer</span>
                </span>
              </div>
              {mine.map((r) => (
                <div className="st2-pb-grid st2-pb-links" role="row" key={r.id}>
                  <span role="cell">
                    <Tick label={<span className="sr-only">{`Include ${r.link.model}`}</span>} checked={!left.has(r.id)} disabled={busy !== null} onChange={() => toggle(r.id)} />
                  </span>
                  <span role="cell" className="st2-pb-name">
                    <b>{r.link.model}</b>
                    <span className="st2-pb-line">
                      <Fade>{[r.link.section, r.link.label].filter(Boolean).join(", ")}</Fade>
                    </span>
                  </span>
                  <span role="cell" className="st2-pb-name">
                    <span>{r.proposal.codes.join(", ")}</span>
                    <span className="st2-pb-line">
                      <Fade>{r.proposal.words}</Fade>
                    </span>
                  </span>
                  <span role="cell">
                    <Offers offers={r.proposal.offers} />
                  </span>
                  <span role="cell" className="st2-pb-act">
                    <Button
                      kind="second"
                      size={32}
                      disabled={busy !== null}
                      onClick={() => void answer([r], "rejected", r.id, `${r.link.model}: not the same unit, and won't be offered again.`)}
                    >
                      Not the same
                    </Button>
                  </span>
                </div>
              ))}
            </div>
            <div className="st2-pb-foot">
              <Button
                kind="second"
                size={36}
                disabled={busy !== null || ticked.length === 0}
                aria-label={`Confirm ${units(ticked.length)}: ${g.heading}`}
                onClick={() => void answer(ticked, "confirmed", g.kind, `${units(ticked.length)} linked.`)}
              >
                {busy === g.kind ? "Linking the units" : `Confirm ${units(ticked.length)}`}
              </Button>
            </div>
          </section>
        );
      })}

      {unpriced.length > 0 && (
        <div className="st2-pb-foot">
          <Button kind="quiet" size={32} onClick={() => setShowUnpriced((v) => !v)} aria-expanded={showUnpriced}>
            {showUnpriced ? "Hide models with no price" : `Show the ${unpriced.length} models with no price`}
          </Button>
        </div>
      )}
      {showUnpriced && (
        <ul className="st2-pb-rows" aria-label="Models with no price">
          {unpriced.map((l) => (
            <li key={l.model} className="st2-pb-grid st2-pb-lines">
              <span className="st2-pb-name">
                <span>{l.model}</span>
                <span className="st2-pb-line">
                  <Fade>{[l.section, l.label].filter(Boolean).join(", ")}</Fade>
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Group>
  );
}
