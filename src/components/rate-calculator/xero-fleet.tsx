"use client";

import { useState } from "react";
import { money } from "./format";
import { mergeSnapshot, periodChoiceOf, snapshotVehicleTotal, type RateCalcState, type XeroCostSnapshot } from "./state";
import type { PeriodChoice } from "@/lib/integrations/xero-pl";
import { withCleanup } from "@/lib/ui/with-cleanup";
import { Button } from "@/components/parts/button";
import { StateWord } from "@/components/parts/state";

/* The fleet's running cost, read from the same Xero snapshot the Business step
   pulled. No second call and no second period: one P&L answers both steps, and
   two windows that could drift apart would be two answers to one question.

   ONE DOLLAR, ONE PLACE — and it holds by construction, not by arithmetic.
   The mapper puts vehicle-named lines in `excluded`, which is exactly the set
   this sums. Press Put back on the Business panel and the line leaves that set:
   overheads gain it and the fleet total drops by the same amount, in the same
   render, with nothing here to keep in step. The bug this shape rules out is
   the one that actually happened — money held out of overheads for a step that
   never claimed it, landing in no pool at all.

   WHAT IT CANNOT SEE, SAID OUT LOUD. A P&L has one Motor Vehicle Expenses
   account: fuel and servicing. The utes' depreciation is in Depreciation, their
   cover is inside Insurance, their finance is in Interest Expense — and those
   are ALREADY being recovered as overheads. That makes the honest warning the
   opposite of the obvious one: the danger isn't that this number is low, it's
   that someone tops it up by hand and pays for the same insurance twice. */

export type XeroFleetPanelProps = {
  s: RateCalcState;
  patch: (p: Partial<RateCalcState>) => void;
  /** Same action the Business step uses — this panel can pull for itself so the
      source switch isn't dead until someone visits step 2. */
  onFetch: (choice: PeriodChoice) => Promise<{ ok: true; snapshot: XeroCostSnapshot } | { ok: false; error: string }>;
};

export function XeroFleetPanel({ s, patch, onFetch }: XeroFleetPanelProps) {
  const snap = s.xeroCosts;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pull = async () => {
    setBusy(true);
    setError(null);
    await withCleanup(async () => {
      try {
        /* Same window the snapshot already covers, and the shared merge — this
           panel writes the SAME snapshot the Business step reads, so a refresh
           here must neither swap the period under that step nor reset the
           judgements (allocations, exclusions, annualise) made on it. */
        const res = await onFetch(periodChoiceOf(snap));
        if (res.ok) patch({ xeroCosts: mergeSnapshot(snap, res.snapshot), vehicleSource: "xero" });
        else setError(res.error);
      } catch {
        setError("Couldn't reach Xero. Try again.");
      }
    }, () => setBusy(false));
  };

  const lines = (snap?.excluded ?? []).filter(e => e.reason === "vehicle");
  const total = snapshotVehicleTotal(snap);

  const failed = error && (
    <div className="rc-say">
      <StateWord tone="wrong">Xero didn&apos;t answer</StateWord>
      <p>{error}</p>
    </div>
  );

  if (!snap) {
    return (
      <div className="rc-q">
        <div className="rc-qhead">
          <p className="rc-note rc-grow">Reads the vehicle lines off the profit and loss your business costs come from.</p>
          <Button kind="xero" size={32} onClick={pull} disabled={busy}>
            {busy ? "Reading Xero" : "Pull from Xero"}
          </Button>
        </div>
        {failed}
      </div>
    );
  }

  return (
    <div className="rc-q">
      <div className="rc-qhead">
        <p className="rc-note rc-grow">
          {snap.period.label} from {snap.tenantName}
          {snap.monthsCovered !== null && snap.monthsCovered < 12 && snap.annualise
            ? `, scaled up from ${snap.monthsCovered} month${snap.monthsCovered === 1 ? "" : "s"} of books`
            : ""}
          .
        </p>
        <Button kind="xero" size={32} onClick={pull} disabled={busy}>
          {busy ? "Reading Xero" : "Refresh"}
        </Button>
      </div>
      {failed}

      {lines.length === 0 ? (
        /* Not an error. Either the books have no vehicle account, or the
           lines were deliberately put back into overheads on the Business
           step — in which case the fleet SHOULD read nil, because the money is
           already priced somewhere else. Saying which is what stops someone
           "fixing" it by typing the cost in a second time. */
        <div className="rc-say">
          <StateWord tone="info">No vehicle lines in this profit and loss</StateWord>
          <p>Either your books have no motor vehicle account, or those lines are in your business costs, and so already in your rates. Don&apos;t enter them here as well.</p>
        </div>
      ) : (
        <>
          <div>
            {lines.map((l, i) => (
              <div className="rc-cost" key={`${l.name}-${i}`}>
                <span className="rc-nm">{l.name}</span>
                <span />
                <span className="rc-r">{money(l.amount)}</span>
                <span />
              </div>
            ))}
          </div>
          <div className="rc-total"><span>Fleet a year</span><span>{money(total)}</span></div>

          {/* The double-count warning, pointing the way people actually get
              it wrong: topping this up by hand with costs the overhead pool is
              already carrying. */}
          <div className="rc-say">
            <StateWord tone="info">This is fuel and servicing, not the whole cost of a ute</StateWord>
            <p>Depreciation, insurance and finance are in their own accounts, so they&apos;re already in your business costs. Don&apos;t add them here as well.</p>
          </div>
        </>
      )}
    </div>
  );
}
