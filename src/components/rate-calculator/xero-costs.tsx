"use client";

import { useState } from "react";
import { RC } from "./theme";
import { money } from "./format";
import { WsEyebrow } from "./ui";
import { chipColor } from "./detail";
import type { BusinessCost } from "./engine";
import { snapshotAgeMonths, snapshotTotal, type RateCalcState, type XeroCostSnapshot } from "./state";
import type { PeriodChoice } from "@/lib/integrations/xero-pl";

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
  user: "you removed it",
};

export type XeroCostsPanelProps = {
  s: RateCalcState;
  patch: (p: Partial<RateCalcState>) => void;
  /** Runs the server action; the panel patches whatever comes back. */
  onFetch: (choice: PeriodChoice) => Promise<{ ok: true; snapshot: XeroCostSnapshot } | { ok: false; error: string }>;
};

export function XeroCostsPanel({ s, patch, onFetch }: XeroCostsPanelProps) {
  const snap = s.xeroCosts;
  const [choice, setChoice] = useState<PeriodChoice>("last-fy");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pull = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await onFetch(choice);
      if (res.ok) {
        /* Re-apply the allocations the user already chose, by line name: a
           refresh is new AMOUNTS, not a reset of their judgement about which
           side of the business each cost belongs to. */
        const previous = new Map((snap?.lines ?? []).map(l => [l.name, l.allocated_to]));
        patch({
          xeroCosts: {
            ...res.snapshot,
            lines: res.snapshot.lines.map(l => ({
              ...l,
              allocated_to: previous.get(l.name) ?? l.allocated_to,
            })),
          },
          costsSource: "xero",
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

  const total = snapshotTotal(snap);
  /* A figure from two financial years ago prices today's rates exactly like
     one pulled this morning — unless somebody says so. Same threshold as the
     calculator's own review reminder, so "old" means one thing here. */
  const ageMonths = snapshotAgeMonths(snap?.fetchedAt, Date.now());
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
          {stale && (
            <p className="rcx-err">
              This snapshot is more than {staleAfter} month{staleAfter === 1 ? "" : "s"} old — the
              P&amp;L has moved since. Refresh it before quoting from these rates.
            </p>
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
        </>
      )}
    </div>
  );
}
