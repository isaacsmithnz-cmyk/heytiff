"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { FaceSwitch } from "@/components/me/face-switch";
import { Button } from "@/components/parts/button";
import { ExpenseForm } from "@/components/making/expense-form";
import { fmtAuWeekdayDate } from "@/lib/au-dates";
import type { JobCandidate } from "@/lib/workboard/note-match";
import {
  CATEGORY_LABEL,
  type PaidWith,
  isCancellable,
  isOpen,
  owedTotal,
  STATUS_LABEL,
  type Claim,
} from "@/lib/expenses/claim";
import { cancelClaim, type ExpenseResult } from "@/app/actions/expenses";

/* My expenses — money you spent on the job, and want back.

   THE FORM IS CLAIM AN EXPENSE (components/making/expense-form), the v2
   form a job's Add › Cost opens too. It starts on the receipt, read by
   today's reader, and keeps every rule this screen's own form had; this
   screen is its door and the lists of what was filed. */

const money = (n: number) => `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* "What am I owed" · "where's the docket for the thing on the card" · "did my
   claim get paid". Three questions, three faces — see the split below. */
type XcFace = "claims" | "company" | "closed";

export function MyExpensesFace({
  claims,
  today,
  jobs = [],
}: {
  claims: Claim[];
  today: string;
  /* The open work this receipt could belong to — the SAME list the Tiff
     modal's "Which job is this for?" reads (`jobCandidates`), so "which job"
     is answered the same way wherever this app asks it. An empty
     list hides the control rather than offering an empty picker: a workspace
     with no open work has nothing to attach to, and a dead row saying so is
     the hint text this app doesn't write. */
  jobs?: JobCandidate[];
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /* One claim armed for cancellation at a time — same shape My leave and the
     team directory use. Arming a second forgets the first. */
  const [armed, setArmed] = useState<string | null>(null);
  const [face, setFace] = useState<XcFace>("claims");
  /* Claim an expense, open over the screen */
  const [claiming, setClaiming] = useState(false);

  const run = (action: () => Promise<ExpenseResult>, onOk?: () => void) => {
    setError(null);
    start(async () => {
      const res = await action();
      if (res.ok) {
        onOk?.();
        router.refresh();
      } else setError(res.error);
    });
  };

  /* WHAT YOU ARE OWED. The same `owedTotal` the approver's queue and the
     Time & Pay stat tile have always used — it counts pending plus
     approved-but-unpaid, and it was on every screen except the one belonging
     to the person who is actually out of pocket. */
  const owed = owedTotal(claims);

  /* THREE FACES, THREE QUESTIONS. "What am I owed?" · "Where's the receipt for
     the thing I bought on the card?", "Did my claim get paid?"

     Company rows are split off FIRST and never appear anywhere else. They are
     not open — nobody is waiting on them — so without this they would have
     landed in Closed beside declined and cancelled claims, which is the pile
     you look at when something went wrong. Nothing went wrong with a filed
     docket.

     Open rides `isOpen`, the same test `owedTotal` uses, so the Claims face
     and the owed figure can never disagree about which rows count. */
  /* Which payer a NEW row starts as, read off the face you started from. */
  const payer: PaidWith = face === "company" ? "company" : "own";

  const cardReceipts = claims.filter((c) => c.paidWith === "company");
  const ownClaims = claims.filter((c) => c.paidWith === "own");
  const openClaims = ownClaims.filter((c) => isOpen(c.status));
  const closedClaims = ownClaims.filter((c) => !isOpen(c.status));
  const shown =
    face === "company" ? cardReceipts : face === "closed" ? closedClaims : openClaims;

  return (
    <>
      <div className="wb2-card">
        <div className="ppanel2">
      {error && <div className="xc-err">{error}</div>}

      {/* Claims is the working face — capture first, then what's still
          moving. Company card is the docket pile for the business's own
          money, which needs no decision from anybody. Closed is the answered
          pile (reimbursed, declined, cancelled), which used to pad out the one
          list forever.

          The pair was this card's tab strip until expenses became a face of
          the Me card, and a card-edge strip does not nest — see
          me/face-switch.tsx. Same two faces, one level down. */}
      <FaceSwitch
        ariaLabel="Your expenses"
        idPrefix="xct"
        panelPrefix="xcp"
        active={face}
        onGo={(k) => setFace(k as XcFace)}
        items={[
          {
            key: "claims",
            label: "Claims",
            count: openClaims.length,
            countLabel: (n) => `${n} open`,
          },
          /* NO COUNT. A number here would be "how many receipts have you filed
             this year", which asks nothing of anybody — unlike the open claims
             beside it, which are people waiting on money. */
          { key: "company", label: "Company card" },
          { key: "closed", label: "Closed" },
        ]}
      />
      {/* No `key`, no `.psec2` — the claim list swaps in place, the way
          Team's directory does. Both together remount the face and fade it
          back in from opacity 0, which on a list reads as a flash rather than
          polish (see me-screen.tsx). */}
      <section id={`xcp-${face}`} role="tabpanel" aria-labelledby={`xct-${face}`} tabIndex={-1}>
          {(face === "claims" || face === "company") && (
            <>
          {/* THE DOOR (rule 52): Claim an expense, over this screen.
              THE FACE YOU ARE ON DECIDES WHOSE MONEY IT WAS: from Company
              card it opens on the card, and the form's own tray is there to
              change it. Get it wrong and either somebody is out of their own
              money or the business is asked to pay twice. */}
          <div className="mk-money-door">
            <Button kind="main" icon={face === "company" ? "card" : "receipt"} onClick={() => setClaiming(true)}>
              {face === "company" ? "File a card receipt" : "Claim an expense"}
            </Button>
          </div>

          {/* WHAT YOU ARE OWED, on the screen of the person owed it. The
              approver's queue has carried this figure all along, and so has
              the Time & Pay stat tile; the claimant's own screen listed the
              claims and left them to add up.

              CLAIMS ONLY. The capture row above is on both faces because both
              file a receipt, but this figure is not: over a list of company
              dockets, "Owed to you $184.50" is a number about somewhere else,
              and the one thing a card receipt has to say is that nobody owes
              anybody anything. */}
          {face === "claims" && owed > 0 && (
            <div className="xc-owed">
              <span className="xc-owedk">Owed to you</span>
              <b>{money(owed)}</b>
              <em>Claims sent or approved but not yet paid.</em>
            </div>
          )}
            </>
          )}

          <div className="xc-list">
            {shown.length === 0 ? (
              face === "closed" ? (
                <div className="adm-empty">
                  <b>Nothing here yet</b>
                  <em>Claims land here once they&apos;re reimbursed, declined or cancelled.</em>
                </div>
              ) : face === "company" ? (
                <div className="adm-empty">
                  <b>No card receipts filed</b>
                  <em>
                    Buy something on the company card and the docket goes here — the bank feed
                    knows the amount, not what was bought. Fuel is the exception: it goes on the
                    vehicle, with the litres and the odometer.
                  </em>
                </div>
              ) : (
                <div className="adm-empty">
                  <b>Nothing claimed yet</b>
                  <em>Anything you buy for a job and pay for yourself goes here.</em>
                </div>
              )
            ) : (
              shown.map((c) => (
                <div className={`xc-row ${c.status}`} key={c.id}>
                  <div className="xc-main">
                    <b>{c.description}</b>
                    <em>
                      {fmtAuWeekdayDate(c.expenseDate)}
                      {c.supplier ? `, ${c.supplier}` : ""}, {CATEGORY_LABEL[c.category]}
                    </em>
                    {/* WHERE THIS CAME FROM. A claim raised by "Log fuel · my
                        own money" is one the person never filled in, so the
                        row has to say so or it reads as a mystery. */}
                    {c.fuelLog && (
                      <p className="xc-from">
                        <Icon name="fuel" size={13} />
                        Raised from your fuel log
                        {c.fuelLog.vehicle ? `, ${c.fuelLog.vehicle}` : ""}
                      </p>
                    )}
                    {/* WHICH JOB IT WENT ON — in the MAIN column, with the
                        supplier and the date, because it is a fact about the
                        purchase and not a status. `job.label` is the snapshot
                        filed with the receipt, so a job renamed since still
                        reads as the one the money was actually spent on (see
                        the migration). */}
                    {c.job && (
                      <p className="xc-onjob">
                        <Icon name="activity" size={13} />
                        {c.job.label}
                      </p>
                    )}
                    {c.reviewNote && <p className="xc-note">{c.reviewNote}</p>}
                  </div>
                  <div className="xc-amt">
                    {money(c.amount)}
                    {c.gstAmount ? <span>incl. {money(c.gstAmount)} GST</span> : null}
                  </div>
                  <div className="xc-side">
                    <span className={`xc-pill ${c.status}`}>{STATUS_LABEL[c.status]}</span>
                    {/* THE APPROVER'S ROW HAS ALWAYS SAID THIS and the
                        claimant's never did — so the person was told a docket
                        is "what gets approved without a conversation" while
                        filling the form, and then never told again whether
                        theirs had one. Same words the review screen uses. */}
                    {(c.receipts ?? []).length > 0 ? (
                      (c.receipts ?? []).map((r, i) =>
                        r.url ? (
                          <a key={i} className="xc-rec" href={r.url} target="_blank" rel="noopener noreferrer">
                            {i === 0 ? "Receipt" : `Receipt ${i + 1}`}
                          </a>
                        ) : null,
                      )
                    ) : (
                      /* Only while the claim is still live. A reimbursed or
                         declined one is history, and chasing its docket in
                         amber is drawing the eye to a decision already made. */
                      isOpen(c.status) && <span className="xr-noreceipt">No receipt</span>
                    )}
                    {/* ARMS BEFORE IT FIRES, the same protocol My leave uses on
                        its own Cancel and for the same reason: this discards a
                        claim for money you are owed — an APPROVED one, at that
                        — and strands the receipt with it. One press asked, and
                        it was gone. */}
                    {isCancellable(c.status) && (
                      <button
                        className={`xc-cancel${armed === c.id ? " arm" : ""}`}
                        disabled={busy}
                        aria-label={
                          armed === c.id
                            ? `Confirm cancelling ${c.description}`
                            : `Cancel ${c.description}`
                        }
                        onClick={() => {
                          if (armed !== c.id) return setArmed(c.id);
                          run(() => cancelClaim(c.id), () => setArmed(null));
                        }}
                      >
                        {armed === c.id ? "Confirm" : "Cancel"}
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
      </section>
        </div>
      </div>

      {claiming && (
        <ExpenseForm
          payer={payer}
          jobs={jobs}
          today={today}
          onClose={() => setClaiming(false)}
          /* Land on the face the thing you just filed lives on. Saving a card
             receipt and being left staring at Claims, where it will never
             appear, reads as the save having failed. */
          onSaved={(paid) => {
            setFace(paid === "company" ? "company" : "claims");
            router.refresh();
          }}
          onUndone={() => router.refresh()}
        />
      )}
    </>
  );
}
