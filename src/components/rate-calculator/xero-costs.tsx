"use client";

import { useState } from "react";
import { RC } from "./theme";
import { money } from "./format";
import { WsEyebrow } from "./ui";
import { chipColor } from "./detail";
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

/* Business costs, read from a connected Xero organisation.

   THE SWITCH IS NON-DESTRUCTIVE IN BOTH DIRECTIONS. This panel only ever
   writes `xeroCosts`; the typed-in list under `businessCosts` is never touched,
   so turning Xero off puts the user back exactly where they were — and the
   Detailed editor's one-shot seeding effect has nothing to fight, because it
   only ever looks at the manual list and isn't mounted while this is.

   AMOUNTS ARE XERO'S; THE ALLOCATION IS OURS. A chart of accounts doesn't know
   whether rent loads onto installs or service, so the amounts render read-only
   and the allocation chips stay live — the same chips the manual editor uses.

   EXCLUSIONS ARE SHOWN, NOT APPLIED SILENTLY. Wages, super and vehicle lines
   are already in the calculator from the roster and the Vehicles step, so
   importing them would count the same dollar twice. They're pulled out with
   the reason and the amount visible, and every one can be put back — a guess
   the user can't see is a guess they can't correct. */

const ALLOC: BusinessCost["allocated_to"][] = ["shared", "install", "service"];

const ALLOC_LABEL: Record<string, string> = {
  shared: "Shared",
  install: "Install",
  service: "Service",
};

const REASON_LABEL: Record<string, string> = {
  wages: "already counted from your staff",
  super: "already derived from wages",
  vehicle: "already counted in Vehicles",
  tax: "a share of profit, not a cost to recover",
  user: "you removed it",
};

/* Why a KEPT line is worth a second look. Each one is a judgement only the
   person who set up the chart of accounts can make, so the panel asks rather
   than deciding. */
const NOTE_LABEL: Record<string, string> = {
  depreciation:
    "may already be in Vehicles — that step charges the write-down on each vehicle too",
  subcontract: "job cost rather than overhead — allocate it, or take it out",
  entertainment: "check this isn't personal spend",
  "staff-cost": "paid to staff — check it isn't already in their wage on the roster",
  insurance: "if the fleet's cover is in here, Vehicles may be charging it too",
};

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
        patch({
          xeroCosts,
          ...(snap ? { costsSource: "xero" as const } : costsToXeroPatch({ ...s, xeroCosts })),
        });
      } else setError(res.error);
    } catch {
      setError("Couldn't reach Xero. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const cycleAlloc = (i: number) => {
    if (!snap) return;
    const lines = snap.lines.map((l, n) =>
      n === i ? { ...l, allocated_to: ALLOC[(ALLOC.indexOf(l.allocated_to) + 1) % ALLOC.length] } : l
    );
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
    <div className="rcx">
      <div className="rcx-head">
        <div className="rcx-per">
          {(
            [
              ["last-fy", "Last financial year"],
              ["trailing-12", "Last 12 months"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              className={`rcx-pbtn${choice === v ? " on" : ""}`}
              onClick={() => setChoice(v)}
              disabled={busy}
            >
              {label}
            </button>
          ))}
        </div>
        <button className="rcx-go" onClick={pull} disabled={busy}>
          {busy ? "Reading Xero…" : snap ? "Refresh" : "Pull from Xero"}
        </button>
      </div>

      {error && <p className="rcx-err">{error}</p>}

      {!snap && !error && (
        <p className="rcx-note">
          Reads the operating expenses off your profit &amp; loss. Wages, super and vehicle costs
          are left out — this calculator already has those from your staff and Vehicles steps.
        </p>
      )}

      {snap && (
        <>
          <p className="rcx-note">
            {snap.period.label} from <b>{snap.tenantName}</b>, read{" "}
            {snap.fetchedAt ? new Date(snap.fetchedAt).toLocaleDateString("en-AU") : "recently"}.
            {snap.sections.length > 0 && <> Source: {snap.sections.join(", ")}.</>}
          </p>
          {/* The explicit space before "old" is load-bearing: JSX drops the
              leading space of a text chunk that wraps to a new line, and this
              banner shipped reading "more than 6 monthsold". */}
          {stale && (
            <p className="rcx-err">
              This snapshot is more than {staleAfter} month{staleAfter === 1 ? "" : "s"}{" "}
              old — the P&amp;L has moved since. Refresh it before quoting from these rates.
            </p>
          )}

          {partial && (
            <div className="rcx-part">
              <b>
                Your books cover {months} of these 12 months
              </b>
              {/* One string rather than interleaved JSX: these sentences carry
                  the two figures side by side, and a space lost to JSX
                  whitespace collapsing would run them together. */}
              <em>
                {snap.annualise
                  ? `${money(raw)} over ${months} month${months === 1 ? "" : "s"}, scaled to ${money(total)} for a year. ` +
                    "That assumes the months you have are typical — if they aren't, or if you're " +
                    "still ramping up, take the scaling off and the rate will price on what actually happened."
                  : `Pricing on ${money(raw)} as though it were a full year of overheads. It isn't — ` +
                    `it's ${months} month${months === 1 ? "" : "s"} — so your rate is carrying less ` +
                    "overhead than the business really has."}
              </em>
              <button className="rcx-add" onClick={() => patch({ xeroCosts: { ...snap, annualise: !snap.annualise } })}>
                {snap.annualise ? "Use the unscaled figures" : `Scale up to a year (× ${factor.toFixed(1)})`}
              </button>
            </div>
          )}

          {vehicleLost && (
            <div className="rcx-part">
              <b>{money(vehicleHeld)} of vehicle cost isn&apos;t being counted anywhere</b>
              <em>
                It was held back because the Vehicles step is meant to have it, but that step has
                no running costs in it. Either put those figures into Vehicles, or bring these
                lines into your overheads here — right now they&apos;re in neither.
              </em>
              <button className="rcx-add" onClick={includeVehicles}>
                Add {money(vehicleHeld)} to overheads
              </button>
            </div>
          )}

          <div className="rcx-lines">
            {snap.lines.map((l, i) => (
              <div className="rcx-line" key={`${l.name}-${i}`}>
                <span className="rcx-nm">{l.name}</span>
                {/* the same chip the manual editor uses — one visual language
                    for "which side of the business does this load onto" */}
                <button
                  className="rca-chipbtn rcx-alloc"
                  onClick={() => cycleAlloc(i)}
                  aria-label={`Allocation for ${l.name}: ${ALLOC_LABEL[l.allocated_to] ?? l.allocated_to}`}
                  style={{ color: chipColor(l.allocated_to).c, background: chipColor(l.allocated_to).bg }}
                >
                  {ALLOC_LABEL[l.allocated_to] ?? l.allocated_to}
                </button>
                <span className="rcx-amt">{money(l.amount)}</span>
                <button className="rcx-x" onClick={() => exclude(i)} aria-label={`Remove ${l.name}`}>
                  ×
                </button>
              </div>
            ))}
          </div>

          <div className="rcx-total">
            <WsEyebrow color={RC.install}>Overheads / yr</WsEyebrow>
            <span style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 24, color: RC.install }}>
              {money(total)}
            </span>
          </div>

          {/* Kept, but worth a look. Separate from "Left out" on purpose: these
              lines ARE in the pool and priced, and the flag is a question about
              where they belong, not a claim that they don't count. */}
          {snap.notes.length > 0 && (
            <div className="rcx-ex">
              <b>Worth checking</b>
              <em>These are in your overheads. Have a look at whether they should be.</em>
              {snap.notes.map((n, i) => (
                <div className="rcx-exrow" key={`${n.name}-${i}`}>
                  <span className="rcx-nm">{n.name}</span>
                  <span className="rcx-why">{NOTE_LABEL[n.note] ?? n.note}</span>
                  <span className="rcx-amt muted">{money(n.amount)}</span>
                </div>
              ))}
            </div>
          )}

          {snap.excluded.length > 0 && (
            <div className="rcx-ex">
              <b>Left out</b>
              <em>So nothing is counted twice. Put any of them back if that&apos;s wrong.</em>
              {snap.excluded.map((e, i) => (
                <div className="rcx-exrow" key={`${e.name}-${i}`}>
                  <span className="rcx-nm">{e.name}</span>
                  <span className="rcx-why">{REASON_LABEL[e.reason] ?? e.reason}</span>
                  <span className="rcx-amt muted">{money(e.amount)}</span>
                  <button className="rcx-add" onClick={() => include(i)}>
                    Include
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Accounts that exist in Xero and had nothing in this window.

              A P&L only reports accounts with transactions, so an account the
              import would handle WRONGLY is invisible until the period it
              finally has a balance — `Income Tax Expense` sat nil through an
              entire audit that way. Collapsed, because on a normal chart this
              is a dozen quiet rows and nobody needs it open. */}
          {snap.dormant.length > 0 && (
            <details className="rcx-ex rcx-dorm">
              <summary>
                <b>{snap.dormant.length} account{snap.dormant.length === 1 ? "" : "s"} with nothing in this period</b>
              </summary>
              <em>
                They&apos;re in your chart of accounts but had no transactions, so they aren&apos;t
                priced. Here&apos;s what would happen to each if it did.
              </em>
              {snap.dormant.map((d, i) => (
                <div className="rcx-exrow" key={`${d.name}-${i}`}>
                  <span className="rcx-nm">{d.name}</span>
                  <span className="rcx-why">
                    {d.verdict === "overhead"
                      ? "would be added to overheads"
                      : REASON_LABEL[d.verdict] ?? NOTE_LABEL[d.verdict] ?? d.verdict}
                  </span>
                </div>
              ))}
            </details>
          )}
        </>
      )}
    </div>
  );
}
