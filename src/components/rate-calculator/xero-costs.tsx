"use client";

import { useState } from "react";
import { money } from "./format";
import { CHARGED_TO } from "./detail";
import type { BusinessCost } from "./engine";
import {
  fleetCosted,
  snapshotAgeMonths,
  snapshotFactor,
  snapshotTotal,
  snapshotVehicleTotal,
  costsToXeroPatch,
  mergeSnapshot,
  periodChoiceOf,
  type RateCalcState,
  type XeroCostSnapshot,
} from "./state";
import type { PeriodChoice } from "@/lib/integrations/xero-pl";
import { useHydrated } from "@/lib/use-hydrated";
import { withCleanup } from "@/lib/ui/with-cleanup";
import { Button } from "@/components/parts/button";
import { Chooser } from "@/components/parts/chooser";
import { StateWord } from "@/components/parts/state";
import { Tray } from "@/components/parts/tabs";

/* Business costs, read from a connected Xero organisation.

   THE SWITCH IS NON-DESTRUCTIVE IN BOTH DIRECTIONS. This panel only ever
   writes `xeroCosts`; the typed-in list under `businessCosts` is never touched,
   so turning Xero off puts the user back exactly where they were — and the
   Detailed editor's one-shot seeding effect has nothing to fight, because it
   only ever looks at the manual list and isn't mounted while this is.

   AMOUNTS ARE XERO'S; THE ALLOCATION IS OURS. A chart of accounts doesn't know
   whether rent loads onto installs or service, so the amounts render read-only
   and what each is charged to stays a choice — the same chooser the manual
   editor uses.

   EXCLUSIONS ARE SHOWN, NOT APPLIED SILENTLY. Wages, super and vehicle lines
   are already in the calculator from the roster and the Vehicles step, so
   importing them would count the same dollar twice. They're pulled out with
   the reason and the amount visible, and every one can be put back — a guess
   the user can't see is a guess they can't correct. */

const REASON_LABEL: Record<string, string> = {
  wages: "Counted in Staff and wages",
  super: "Counted in Staff and wages",
  vehicle: "Counted in Vehicles",
  tax: "A share of profit, not a cost",
  user: "Left out by you",
};

const PERIODS = [
  { value: "last-fy", label: "Last financial year" },
  { value: "trailing-12", label: "Last 12 months" },
] as const;

/* Why a KEPT line is worth a second look. Each one is a judgement only the
   person who set up the chart of accounts can make, so the panel asks rather
   than deciding. */
const NOTE_LABEL: Record<string, string> = {
  depreciation: "May already be in Vehicles, which charges each vehicle's write-down too",
  subcontract: "A job cost rather than an overhead: charge it to a side, or leave it out",
  entertainment: "Check this isn't personal spend",
  "staff-cost": "Paid to staff: check it isn't already in their wage on Team",
  insurance: "If the fleet's cover is in here, Vehicles may be charging it too",
};

/* What a finished pull writes. Out here, not in `pull`'s try/catch, because
   React Compiler 1.0 cannot lower a value block — the conditional spread —
   inside a try and gives up on the whole component when it meets one. */
const pulledPatch = (
  s: RateCalcState,
  snap: XeroCostSnapshot | null | undefined,
  xeroCosts: XeroCostSnapshot
): Partial<RateCalcState> => ({
  xeroCosts,
  ...(snap ? { costsSource: "xero" as const } : costsToXeroPatch({ ...s, xeroCosts })),
});

export type XeroCostsPanelProps = {
  s: RateCalcState;
  patch: (p: Partial<RateCalcState>) => void;
  /** Runs the server action; the panel patches whatever comes back. */
  onFetch: (choice: PeriodChoice) => Promise<{ ok: true; snapshot: XeroCostSnapshot } | { ok: false; error: string }>;
};

export function XeroCostsPanel({ s, patch, onFetch }: XeroCostsPanelProps) {
  const snap = s.xeroCosts;
  // Starts on the window the snapshot was pulled for, so Refresh means
  // "same question again" rather than silently reverting to last-FY.
  const [choice, setChoice] = useState<PeriodChoice>(periodChoiceOf(snap));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // false on the server and through hydration — see the staleness note below
  const hydrated = useHydrated();

  const pull = async () => {
    setBusy(true);
    setError(null);
    await withCleanup(async () => {
      try {
        const res = await onFetch(choice);
        if (res.ok) {
          /* A refresh is new AMOUNTS; every judgement made about the old ones —
             allocations, re-exclusions, inclusions, the annualise answer —
             survives via the shared merge. */
          const xeroCosts = mergeSnapshot(snap, res.snapshot);
          /* The fleet comes along on the FIRST pull only — that is the moment
             vehicle lines first leave the overhead pool and the mixed state
             would otherwise be born. On a refresh the fleet source is wherever
             the user last put it; re-running the convenience default here would
             override "Enter them myself" every time this button was pressed. */
          patch(pulledPatch(s, snap, xeroCosts));
        } else setError(res.error);
      } catch {
        setError("Couldn't reach Xero. Try again.");
      }
    }, () => setBusy(false));
  };

  const setAlloc = (i: number, to: BusinessCost["allocated_to"]) => {
    if (!snap) return;
    const lines = snap.lines.map((l, n) => (n === i ? { ...l, allocated_to: to } : l));
    patch({ xeroCosts: { ...snap, lines } });
  };

  /** Put an excluded line back into the pool. */
  const include = (i: number) => {
    if (!snap) return;
    const line = snap.excluded[i];
    patch({
      xeroCosts: {
        ...snap,
        lines: [...snap.lines, { name: line.name, amount: line.amount, allocated_to: "shared" }],
        excluded: snap.excluded.filter((_, n) => n !== i),
      },
    });
  };

  /** Take a line back out — recorded as the user's own decision, so a refresh
      keeps it out for their reason rather than ours. */
  const exclude = (i: number) => {
    if (!snap) return;
    const line = snap.lines[i];
    patch({
      xeroCosts: {
        ...snap,
        lines: snap.lines.filter((_, n) => n !== i),
        excluded: [...snap.excluded, { name: line.name, amount: line.amount, reason: "user" }],
      },
    });
  };

  /** Put every vehicle line back in the pool at once — the escape hatch for
      the case where the exclusion was right in principle and wrong in fact. */
  const includeVehicles = () => {
    if (!snap) return;
    const back = snap.excluded.filter(e => e.reason === "vehicle");
    patch({
      xeroCosts: {
        ...snap,
        lines: [...snap.lines, ...back.map(e => ({ name: e.name, amount: e.amount, allocated_to: "shared" as const }))],
        excluded: snap.excluded.filter(e => e.reason !== "vehicle"),
      },
    });
  };

  const total = snapshotTotal(snap);
  const factor = snapshotFactor(snap);
  const raw = (snap?.lines ?? []).reduce((a, l) => a + l.amount, 0);
  /* A window the books only partly cover. Reported in months rather than as a
     yes/no because "5 of 12" is the number that makes someone check. */
  const months = snap?.monthsCovered ?? null;
  const partial = months !== null && months > 0 && months < 12;

  /* THE MONEY THAT FALLS BETWEEN TWO STEPS. Vehicle lines are held out because
     the Vehicles step is meant to have them — but nothing was checking whether
     it does. With an empty fleet, or "no vehicles" ticked against a P&L that
     plainly shows fuel, this is spend that ends up in no pool at all and
     quietly under-prices the rate. */
  const vehicleHeld = snapshotVehicleTotal(snap);
  const vehicleLost = vehicleHeld > 0 && !fleetCosted(s);
  /* A figure from two financial years ago prices today's rates exactly like
     one pulled this morning — unless somebody says so. Same threshold as the
     calculator's own review reminder, so "old" means one thing here.

     THE CLOCK IS READ ONCE, AND ONLY IN THE BROWSER. `Date.now()` sat in this
     render body, which is two problems wearing one line. It makes the render
     impure — the same props could produce a different banner on a re-render
     nobody caused — and this page is SERVER-rendered with `initialState`, so
     the snapshot and its age both exist during SSR: a month boundary crossed
     between the server's clock and the browser's would put different markup
     in the same node. That is a hydration failure for the whole tree, which
     this codebase has paid for before (see sm8-chip, which reads its clock
     the same way and for the same reason).

     Mount-time is precise enough by a wide margin: the unit here is MONTHS,
     so a clock that stops when the panel opens would have to be left open for
     one to drift. */
  const now = useState(() => Date.now())[0];
  const ageMonths = hydrated ? snapshotAgeMonths(snap?.fetchedAt, now) : null;
  const staleAfter = s.settings.review_reminder_months ?? 6;
  const stale = ageMonths !== null && ageMonths >= staleAfter;

  return (
    <>
      <div className="rc-q">
        <div className="rc-qhead">
          <Tray options={PERIODS} value={choice} onChange={setChoice} ariaLabel="Which year" disabled={busy} />
          <span className="rc-grow" />
          <Button kind="xero" size={32} onClick={pull} disabled={busy}>
            {busy ? "Reading Xero" : snap ? "Refresh" : "Pull from Xero"}
          </Button>
        </div>

        {error && (
          <div className="rc-say">
            <StateWord tone="wrong">Xero didn&apos;t answer</StateWord>
            <p>{error}</p>
          </div>
        )}

        {!snap && !error && (
          <p className="rc-note">Reads the operating expenses off your profit and loss. Wages, super and vehicles stay out: the other steps have them.</p>
        )}

        {snap && (
          <p className="rc-note">
            {snap.period.label} from {snap.tenantName}, read{" "}
            {snap.fetchedAt ? new Date(snap.fetchedAt).toLocaleDateString("en-AU") : "recently"}.
            {snap.sections.length > 0 && <> {snap.sections.join(", ")} only.</>}
          </p>
        )}

        {/* The explicit space before "old" is load-bearing: JSX drops the
            leading space of a text chunk that wraps to a new line, and this
            line shipped reading "more than 6 monthsold". */}
        {snap && stale && (
          <div className="rc-say">
            <StateWord tone="look">
              This snapshot is more than {staleAfter} month{staleAfter === 1 ? "" : "s"}{" "}
              old
            </StateWord>
            <p>The profit and loss has moved since. Refresh it before quoting from these rates.</p>
          </div>
        )}

        {snap && partial && (
          <div className="rc-say">
            <StateWord tone="look">{`Your books cover ${months} of these 12 months`}</StateWord>
            {/* One string rather than interleaved JSX: these sentences carry
                the two figures side by side, and a space lost to JSX
                whitespace collapsing would run them together. */}
            <p>
              {snap.annualise
                ? `${money(raw)} over ${months} month${months === 1 ? "" : "s"}, scaled to ${money(total)} for a year. ` +
                  "That takes the months you have as typical; if they aren't, take the scaling off."
                : `Pricing on ${money(raw)} as a full year, when it's ${months} month${months === 1 ? "" : "s"}, ` +
                  "so your rate is carrying less overhead than the business really has."}
            </p>
            <Button size={32} onClick={() => patch({ xeroCosts: { ...snap, annualise: !snap.annualise } })}>
              {snap.annualise ? "Use the unscaled figures" : `Scale up to a year (× ${factor.toFixed(1)})`}
            </Button>
          </div>
        )}

        {snap && vehicleLost && (
          <div className="rc-say">
            <StateWord tone="look">{`${money(vehicleHeld)} of vehicle cost isn't being counted anywhere`}</StateWord>
            <p>It was held back for the Vehicles step, which has no running costs in it. Put them into Vehicles, or bring these lines into your overheads.</p>
            <Button size={32} onClick={includeVehicles}>{`Add ${money(vehicleHeld)} to overheads`}</Button>
          </div>
        )}

        {snap && (
          <>
            <div className="rc-cost-head"><span>Account</span><span>Charged to</span><span className="rc-r">A year</span><span /></div>
            <div>
              {snap.lines.map((l, i) => (
                <div className="rc-cost" key={`${l.name}-${i}`}>
                  <span className="rc-nm">{l.name}</span>
                  <Chooser size={32} aria-label={`${l.name}, charged to`} options={CHARGED_TO} value={l.allocated_to}
                    onChange={v => setAlloc(i, v as BusinessCost["allocated_to"])} />
                  <span className="rc-r">{money(l.amount)}</span>
                  <Button kind="quiet" size={32} onClick={() => exclude(i)} aria-label={`Leave out ${l.name}`}>Leave out</Button>
                </div>
              ))}
            </div>
            <div className="rc-total"><span>Overheads a year</span><span>{money(total)}</span></div>
          </>
        )}
      </div>

      {/* Kept, but worth a look. Apart from "Left out" on purpose: these lines
          ARE in the pool and priced, and the flag is a question about where
          they belong, not a claim that they don't count. */}
      {snap && snap.notes.length > 0 && (
        <div className="rc-q">
          <h3>Worth checking</h3>
          <ul className="rc-list">
            {snap.notes.map((n, i) => (
              <li key={`${n.name}-${i}`}>
                <span className="rc-list-w"><b>{n.name}</b><span>{NOTE_LABEL[n.note] ?? n.note}</span></span>
                <span className="rc-r">{money(n.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {snap && snap.excluded.length > 0 && (
        <div className="rc-q">
          <h3>Left out</h3>
          <div>
            {snap.excluded.map((e, i) => (
              <div className="rc-cost" key={`${e.name}-${i}`}>
                <span className="rc-nm">{e.name}<span>{REASON_LABEL[e.reason] ?? e.reason}</span></span>
                <span />
                <span className="rc-r">{money(e.amount)}</span>
                <Button kind="quiet" size={32} onClick={() => include(i)} aria-label={`Put back ${e.name}`}>Put back</Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Accounts that exist in Xero and had nothing in this window.

          A P&L only reports accounts with transactions, so an account the
          import would handle WRONGLY is invisible until the period it finally
          has a balance — `Income Tax Expense` sat nil through an entire audit
          that way. Closed, because on a normal chart this is a dozen quiet
          rows and nobody needs it open. */}
      {snap && snap.dormant.length > 0 && (
        <details className="rc-q rc-dorm">
          <summary>{snap.dormant.length} account{snap.dormant.length === 1 ? "" : "s"} had nothing this year</summary>
          <ul className="rc-list">
            {snap.dormant.map((d, i) => (
              <li key={`${d.name}-${i}`}>
                <span className="rc-list-w">
                  <b>{d.name}</b>
                  <span>
                    {d.verdict === "overhead"
                      ? "Would be added to overheads"
                      : REASON_LABEL[d.verdict] ?? NOTE_LABEL[d.verdict] ?? d.verdict}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
