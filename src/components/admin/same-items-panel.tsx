"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/parts/button";
import { Fade } from "@/components/parts/fade";
import { Loading } from "@/components/parts/states";
import { Group, Wrong } from "@/components/settings/parts";
import type { PricedProposal, PricedSide, SameItemsView } from "@/lib/quotes/same-items-server";
import { withCleanup } from "@/lib/ui/with-cleanup";
import { dollars } from "./pb-bits";

/* ONE PART AT TWO SUPPLIERS, in Price book › Matching.

   The same part under each supplier's own code — AAD's PC1412 pair coil is
   Reece's 9800006-1 — found by Tiff: a code written in the other's name,
   or the same kind of part with the same sizes. A person says "Same item"
   and from then on it's one item priced at both, in the search and the
   preferred items; or "Not the same", and it isn't proposed again. */

const ROUTE = "/api/quoting/same-items";
const refOf = (s: PricedSide) => `${s.supplierKey}|${s.code}`;

function Side({ s, cheaper }: { s: PricedSide; cheaper: boolean }) {
  return (
    <span role="cell" className="st2-pb-name">
      <b>
        <Fade>{s.name}</Fade>
      </b>
      <span className="st2-pb-line">
        {`${s.supplierName}, ${s.code}, `}
        <span className={cheaper ? "st2-pb-low" : undefined}>{s.netCents > 0 ? dollars(s.netCents) : "no price"}</span>
      </span>
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
    await withCleanup(async () => {
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
    }, () => setBusy(null));
  };

  return (
    <Group heading="Same item, two suppliers">
      {failed ? (
        <Wrong>The price lists couldn&rsquo;t be compared. Try again.</Wrong>
      ) : !view ? (
        <Loading what="Comparing the price lists" />
      ) : (
        <>
          <p className="st2-pb-said">{`${view.confirmed} confirmed, ${view.proposals.length} to check.`}</p>
          {view.proposals.length > 0 && (
            <div className="st2-pb-rows" role="table" aria-label="Items to check">
              <div className="st2-pb-grid st2-pb-same st2-pb-head" role="row">
                <span role="columnheader">Item</span>
                <span role="columnheader">Looks the same as</span>
                <span role="columnheader">Why</span>
                <span role="columnheader">
                  <span className="sr-only">Answer</span>
                </span>
              </div>
              {view.proposals.map((p) => {
                const key = `${refOf(p.a)}#${refOf(p.b)}`;
                const both = p.a.netCents > 0 && p.b.netCents > 0 && p.a.netCents !== p.b.netCents;
                return (
                  <div className="st2-pb-grid st2-pb-same" role="row" key={key}>
                    <Side s={p.a} cheaper={both && p.a.netCents < p.b.netCents} />
                    <Side s={p.b} cheaper={both && p.b.netCents < p.a.netCents} />
                    <span role="cell" className="st2-pb-line">
                      {p.why === "mentioned" ? `${p.shared[0]} is in the name` : p.shared.join(", ")}
                    </span>
                    <span role="cell" className="st2-pb-act">
                      <Button kind="second" size={32} disabled={busy !== null} onClick={() => void decide(p, "rejected")}>
                        Not the same
                      </Button>
                      <Button kind="second" size={32} disabled={busy !== null} onClick={() => void decide(p, "confirmed")}>
                        Same item
                      </Button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </Group>
  );
}
