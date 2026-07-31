"use client";

import { useState } from "react";
import { RC } from "./theme";
import { money } from "./format";
import { WsEyebrow } from "./ui";
import { snapshotVehicleTotal, type RateCalcState, type XeroCostSnapshot } from "./state";
import type { PeriodChoice } from "@/lib/integrations/xero-pl";

/* The fleet's running cost, read from the same Xero snapshot the Business step
   pulled. No second call and no second period: one P&L answers both steps, and
   two windows that could drift apart would be two answers to one question.

   ONE DOLLAR, ONE PLACE — and it holds by construction, not by arithmetic.
   The mapper puts vehicle-named lines in `excluded`, which is exactly the set
   this sums. Press Include on the Business panel and the line leaves that set:
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
    try {
      const res = await onFetch("last-fy");
      if (res.ok) patch({ xeroCosts: res.snapshot, vehicleSource: "xero" });
      else setError(res.error);
    } catch {
      setError("Couldn't reach Xero. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const lines = (snap?.excluded ?? []).filter(e => e.reason === "vehicle");
  const total = snapshotVehicleTotal(snap);

  if (!snap) {
    return (
      <div className="rcx">
        <p className="rcx-note">
          Reads the vehicle lines off the same profit &amp; loss your business costs come from.
        </p>
        {error && <p className="rcx-err">{error}</p>}
        <button className="rcx-go" onClick={pull} disabled={busy}>
          {busy ? "Reading Xero…" : "Pull from Xero"}
        </button>
      </div>
    );
  }

  return (
    <div className="rcx">
      {error && <p className="rcx-err">{error}</p>}

      <p className="rcx-note">
        {snap.period.label} from <b>{snap.tenantName}</b>
        {snap.monthsCovered !== null && snap.monthsCovered < 12 && snap.annualise && (
          <> · scaled up from {snap.monthsCovered} month{snap.monthsCovered === 1 ? "" : "s"} of books</>
        )}
        .
      </p>

      {lines.length === 0 ? (
        /* Not an error state. Either the books have no vehicle account, or the
           lines were deliberately put back into overheads on the Business step
           — in which case the fleet SHOULD read nil, because the money is
           already priced somewhere else. Saying which is what stops someone
           "fixing" it by typing the cost in a second time. */
        <p className="rcx-err">
          No vehicle lines in this P&amp;L. Either your books have no motor vehicle account, or
          those lines were included in your business costs on step 2 — if so the money is already
          in your rates and must not be entered here as well.
        </p>
      ) : (
        <>
          <div className="rcx-lines">
            {lines.map((l, i) => (
              <div className="rcx-line" key={`${l.name}-${i}`}>
                <span className="rcx-nm">{l.name}</span>
                <span className="rcx-amt">{money(l.amount)}</span>
              </div>
            ))}
          </div>

          <div className="rcx-total">
            <WsEyebrow color={RC.service}>Fleet / yr</WsEyebrow>
            <span style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 24, color: RC.service }}>
              {money(total)}
            </span>
          </div>

          {/* The double-count warning, and it points the way people actually
              get it wrong: topping this up by hand with costs the overhead
              pool is already carrying. */}
          <div className="rcx-part">
            <b>This is fuel and servicing — not the whole cost of a ute</b>
            <em>
              Depreciation, insurance and finance sit in their own accounts on your P&amp;L, so
              they&apos;re already counted in your business costs and already in your rates.
              Don&apos;t add them here as well — that would charge for them twice. Your rates
              recover the same total either way.
            </em>
          </div>
        </>
      )}

      <button className="rcx-go" onClick={pull} disabled={busy} style={{ marginTop: 12 }}>
        {busy ? "Reading Xero…" : "Refresh"}
      </button>
    </div>
  );
}
