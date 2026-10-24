"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { Button } from "@/components/parts/button";
import { Menu } from "@/components/parts/menu";
import { Empty } from "@/components/parts/states";
import { ViewTabs } from "@/components/parts/tabs";
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

/* EXPENSE CLAIMS (v2): Your name › Expense claims, a page of its own like
   Timesheet, with no strip of Timesheet · Leave · Expenses tabs over it
   (Isaac, 24 October 2026). Money you spent on the job and want back, and
   the dockets for what the company card paid.

   THE FORM IS CLAIM AN EXPENSE (components/making/expense-form), the v2
   form a job's Add › Cost opens too. It starts on the receipt, read by
   today's reader, and keeps every rule this screen's own form had; this
   page is its door and the lists of what was filed. ONE door: Add, top
   right, says whose money it was (Expense claim, or Company card receipt),
   and the empty views carry no button of their own. */

const money = (n: number) => `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* "What am I owed" · "where's the docket for the thing on the card" · "did my
   claim get paid". Three questions, three faces — see the split below. */
type XcFace = "claims" | "company" | "closed";

export function ExpenseClaims({
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
  /* Claim an expense, open over the screen, on whose money Add chose */
  const [claiming, setClaiming] = useState<PaidWith | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);

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
  const cardReceipts = claims.filter((c) => c.paidWith === "company");
  const ownClaims = claims.filter((c) => c.paidWith === "own");
  const openClaims = ownClaims.filter((c) => isOpen(c.status));
  const closedClaims = ownClaims.filter((c) => !isOpen(c.status));
  const shown =
    face === "company" ? cardReceipts : face === "closed" ? closedClaims : openClaims;

  return (
    <div className="wrap yp">
      <header className="yp-head">
        <h1 className="yp-h1">Expense claims</h1>
        <Button
          ref={addRef}
          kind="main"
          icon="plus"
          aria-haspopup="menu"
          aria-expanded={adding}
          onClick={() => setAdding((a) => !a)}
        >
          Add
          <span className="yp-chev" aria-hidden="true">
            <Icon name="chevD" size={16} />
          </span>
        </Button>
        {/* WHOSE MONEY IT WAS is the first thing Add asks, because getting
            it wrong leaves somebody out of their own money or asks the
            business to pay twice. The form's own tray can still change it. */}
        <Menu
          anchor={addRef}
          open={adding}
          onClose={() => setAdding(false)}
          onSelect={(key) => {
            setAdding(false);
            setClaiming(key as PaidWith);
          }}
          items={[
            { key: "own", label: "Expense claim", hint: "You paid" },
            { key: "company", label: "Company card receipt", hint: "The card paid" },
          ]}
          label="Add"
          align="end"
        />
      </header>

      {error && <div className="xc-err">{error}</div>}

      {/* Claims is the working view: what's still moving. Company card is
          the docket pile for the business's own money, which needs no
          decision from anybody. Closed is the answered pile (reimbursed,
          declined, cancelled), which used to pad out the one list forever.
          Soft tabs (rule 29): three views of one page's list. */}
      <ViewTabs
        ariaLabel="Your expenses"
        idPrefix="xct"
        panelPrefix="xcp"
        current={face}
        onGo={(k) => setFace(k as XcFace)}
        items={[
          { key: "claims", label: "Claims" },
          /* NO COUNT. A number here would be "how many receipts have you filed
             this year", which asks nothing of anybody — unlike the open claims
             beside it, which are people waiting on money. */
          { key: "company", label: "Company card" },
          { key: "closed", label: "Closed" },
        ]}
      />
      {/* No `key`, no `.psec2` — the claim list swaps in place, the way
          Team's directory does. Both together remount the view and fade it
          back in from opacity 0, which on a list reads as a flash. */}
      <section id={`xcp-${face}`} role="tabpanel" aria-labelledby={`xct-${face}`} tabIndex={-1}>
          {/* WHAT YOU ARE OWED, on the screen of the person owed it. The
              approver's queue has carried this figure all along, and so has
              the Time & Pay stat tile; the claimant's own screen listed the
              claims and left them to add up.

              CLAIMS ONLY: over a list of company dockets, "Owed to you
              $184.50" is a number about somewhere else, and the one thing a
              card receipt has to say is that nobody owes anybody anything. */}
          {face === "claims" && owed > 0 && (
            <div className="xc-owed">
              <span className="xc-owedk">Owed to you</span>
              <b>{money(owed)}</b>
              <em>Claims sent or approved but not yet paid.</em>
            </div>
          )}

          <div className="xc-list">
            {/* The page's one door is Add, so an empty view says what goes
                in it and carries no button of its own (Isaac, 24 October
                2026: one button each page). */}
            {shown.length === 0 ? (
              face === "closed" ? (
                <Empty what="Nothing here yet" line="Claims land here once they’re reimbursed, declined or cancelled." action={null} />
              ) : face === "company" ? (
                <Empty
                  what="No card receipts filed"
                  line="Buy something on the company card and its docket goes here, so the bank feed can be matched to it."
                  action={null}
                />
              ) : (
                <Empty what="Nothing claimed yet" line="Anything you buy for a job and pay for yourself goes here." action={null} />
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

      {claiming && (
        <ExpenseForm
          payer={claiming}
          jobs={jobs}
          today={today}
          onClose={() => setClaiming(null)}
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
    </div>
  );
}
