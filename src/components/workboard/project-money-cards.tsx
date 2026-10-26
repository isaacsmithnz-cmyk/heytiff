"use client";

import { useState, type ReactNode } from "react";
import { Button, LinkButton } from "@/components/parts/button";
import { StateWord } from "@/components/parts/state";
import { TextInput } from "@/components/parts/field";
import { JobSection } from "@/components/jobs/job-section";
import { auDayOf, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { daysBetween } from "@/lib/workboard/board-status";
import { claimedLine, deriveProjectMoney, fmtAud } from "@/lib/workboard/project-money";
import { MONEY_BASIS } from "@/lib/workboard/job-money";
import type { ProjectDetail } from "@/lib/workboard/projects-query";
import {
  addClaim,
  addScopeItem,
  decideVariation,
  removeClaim,
  removeMilestone,
  removeScopeItem,
  removeVariation,
  setClaimPaid,
} from "@/app/actions/workboard-projects";
import type { OpenForm } from "./project-forms";

/* A PROJECT'S MONEY, SCOPE, DATES AND AGREEMENT (the old screens' mock,
   27 October 2026): each a section in the one recipe (job-section.tsx),
   a coloured block, its title and at most one button, then its rows under
   hairlines. They were five cards with a caption under each title, and the
   captions went: they explained the cards.

   The law they render is deriveProjectMoney's, never their own: axis 1
   (claimed of the revised total) and axis 2 (collection per claim) share a
   section but never a sentence. Variations move the TARGET, and every
   decision records who made the call. A claim mirrored from ServiceM8 is
   read-only here, even for a manager: its paid-ness is ServiceM8's answer
   and the next sync would overwrite a press (the server refuses it too).

   The forms these open are the page's (project-forms.tsx); a press here
   says which, and the page holds it. */

export type Run = (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
type Open = (form: OpenForm) => void;

const sourceWord = (source: string | null) =>
  source === "studio" ? "from the design" : source === "sm8_quote" ? "from the quote" : source ? "typed" : null;

/** "inc GST, from the quote": the basis always, where the total came from when known. */
export const totalBasis = (project: ProjectDetail) => [MONEY_BASIS, sourceWord(project.budgetSource)].filter(Boolean).join(", ");

/* ═════════ the job total and its claims ═════════ */

export function MoneySection({
  project,
  manage,
  busy,
  run,
  onOpen,
}: {
  project: ProjectDetail;
  manage: boolean;
  busy: boolean;
  run: Run;
  onOpen: Open;
}) {
  const money = deriveProjectMoney({ budgetCents: project.budgetCents, variations: project.variations, claims: project.claims });
  const line = claimedLine(money);
  const approved = money.approvedVariationCents;

  return (
    <div className="pj-col">
      <div className="pj-total">
        <div className="pj-total-k">
          <span className="pj-total-lab">Job total</span>
          {money.revisedTotalCents !== null ? (
            <>
              <b className="pj-big">{fmtAud(money.revisedTotalCents)}</b>
              <span className="pj-cap">{totalBasis(project)}</span>
              {approved !== 0 && money.baseCents !== null && (
                <span className="pj-cap">
                  {fmtAud(money.baseCents)} base {approved > 0 ? "+" : "−"} {fmtAud(Math.abs(approved))} approved variations
                </span>
              )}
            </>
          ) : (
            <span className="pj-cap">Not set</span>
          )}
          {money.pendingVariationCents !== 0 && (
            <StateWord tone="look">{fmtAud(money.pendingVariationCents)} in pending variations</StateWord>
          )}
        </div>
        {manage && (
          <Button size={32} disabled={busy} onClick={() => onOpen({ kind: "total" })}>
            {project.budgetCents !== null ? "Change total" : "Set total"}
          </Button>
        )}
      </div>

      <JobSection
        name="Claims"
        icon="card"
        hue="green"
        action={
          manage ? (
            <Button size={32} onClick={() => onOpen({ kind: "claim" })}>
              Add claim
            </Button>
          ) : null
        }
      >
        {(line || money.paidCents > 0 || money.awaitingCents > 0) && (
          <div className="pj-sums">
            {line && <p className="pj-sum">{line}</p>}
            {(money.paidCents > 0 || money.awaitingCents > 0) && (
              <p className="pj-words">
                {money.paidCents > 0 && <StateWord tone="good">{fmtAud(money.paidCents)} paid</StateWord>}
                {money.awaitingCents > 0 && <StateWord tone="look">{fmtAud(money.awaitingCents)} awaiting payment</StateWord>}
              </p>
            )}
          </div>
        )}
        {project.claims.length === 0 ? (
          <p className="pj-none">Nothing claimed yet.</p>
        ) : (
          <ul className="jov-rows" aria-label="Claims">
            {project.claims.map((c) => {
              const own = manage && c.source === "manual";
              return (
                <li className="jov-row pj-row" key={c.id}>
                  <span className="pj-text">
                    <b className="pj-name">{c.label}</b>
                    <span className="pj-line">
                      {[
                        `Claimed ${fmtAuWeekdayDayMonth(c.claimedOn)}`,
                        c.source !== "manual" ? `from ${c.source === "servicem8" ? "ServiceM8" : "Xero"}` : null,
                        c.status === "paid" && c.paidOn ? `paid ${fmtAuWeekdayDayMonth(c.paidOn)}` : null,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </span>
                  </span>
                  <span className="pj-end">
                    <b className="pj-amt">{fmtAud(c.amountCents)}</b>
                    <StateWord tone={c.status === "paid" ? "good" : "look"}>{c.status === "paid" ? "Paid" : "Awaiting payment"}</StateWord>
                    {own && (
                      <Button kind="quiet" size={32} disabled={busy} onClick={() => run(() => setClaimPaid(c.id, c.status !== "paid"))}>
                        {c.status === "paid" ? "Mark unpaid" : "Mark paid"}
                      </Button>
                    )}
                    {own && (
                      <Button kind="quiet" size={32} className="pj-rm" aria-label={`Remove ${c.label}`} disabled={busy} onClick={() => run(() => removeClaim(c.id))}>
                        Remove
                      </Button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </JobSection>
    </div>
  );
}

/* ═════════ variations ═════════ */

const VARIATION_WORD = { pending: "Pending", approved: "Approved", declined: "Declined" } as const;
const VARIATION_TONE = { pending: "look", approved: "good", declined: "info" } as const;

export function VariationsSection({
  project,
  manage,
  busy,
  run,
  onOpen,
}: {
  project: ProjectDetail;
  manage: boolean;
  busy: boolean;
  run: Run;
  onOpen: Open;
}) {
  const claimed = new Set(project.claims.map((c) => c.variationId).filter((v): v is string => v !== null));

  return (
    <JobSection
      name="Variations"
      icon="plus"
      hue="pink"
      action={
        manage ? (
          <Button size={32} onClick={() => onOpen({ kind: "variation" })}>
            Add variation
          </Button>
        ) : null
      }
    >
      {project.variations.length === 0 ? (
        <p className="pj-none">No variations.</p>
      ) : (
        <ul className="jov-rows" aria-label="Variations">
          {project.variations.map((v) => (
            <li className="jov-row pj-row" key={v.id}>
              <span className="pj-text">
                <b className="pj-name">{v.title}</b>
                <span className="pj-line">
                  {/* decided_at is a timestamp: its first ten characters are the
                      UTC day, yesterday for a call made on an AU morning */}
                  {[
                    v.status === "pending"
                      ? "Waiting on a decision"
                      : `${VARIATION_WORD[v.status]}${v.decidedBy ? ` by ${v.decidedBy}` : ""}${v.decidedAt ? `, ${fmtAuWeekdayDayMonth(auDayOf(v.decidedAt))}` : ""}`,
                    v.detail,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </span>
              </span>
              <span className="pj-end">
                <b className="pj-amt">
                  {v.amountCents > 0 ? "+" : "−"}
                  {fmtAud(Math.abs(v.amountCents))}
                </b>
                <StateWord tone={VARIATION_TONE[v.status]}>{VARIATION_WORD[v.status]}</StateWord>
                {manage && v.status === "pending" && (
                  <>
                    <Button kind="quiet" size={32} disabled={busy} onClick={() => onOpen({ kind: "decide", id: v.id, to: "approved" })}>
                      Approve
                    </Button>
                    <Button kind="quiet" size={32} disabled={busy} onClick={() => onOpen({ kind: "decide", id: v.id, to: "declined" })}>
                      Decline
                    </Button>
                  </>
                )}
                {manage && v.status === "approved" && !claimed.has(v.id) && (
                  <Button
                    kind="quiet"
                    size={32}
                    disabled={busy}
                    onClick={() => run(() => addClaim(project.id, { label: `Variation — ${v.title}`, amountCents: v.amountCents, variationId: v.id }))}
                  >
                    Claim variation
                  </Button>
                )}
                {manage && v.status !== "pending" && (
                  <Button kind="quiet" size={32} disabled={busy} onClick={() => run(() => decideVariation(v.id, "pending"))}>
                    Reopen
                  </Button>
                )}
                {manage && v.status !== "approved" && (
                  <Button kind="quiet" size={32} className="pj-rm" aria-label={`Remove ${v.title}`} disabled={busy} onClick={() => run(() => removeVariation(v.id))}>
                    Remove
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </JobSection>
  );
}

/* ═════════ scope of work ═════════ */

export function ScopeSections({ project, manage, busy, run }: { project: ProjectDetail; manage: boolean; busy: boolean; run: Run }) {
  return (
    <div className="pj-two">
      <ScopeList project={project} kind="inclusion" manage={manage} busy={busy} run={run} />
      <ScopeList project={project} kind="exclusion" manage={manage} busy={busy} run={run} />
    </div>
  );
}

function ScopeList({
  project,
  kind,
  manage,
  busy,
  run,
}: {
  project: ProjectDetail;
  kind: "inclusion" | "exclusion";
  manage: boolean;
  busy: boolean;
  run: Run;
}) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("")
  const rows = project.scope.filter((s) => s.kind === kind);
  const inPrice = kind === "inclusion";
  const name = inPrice ? "In the price" : "Not in the price";

  const commit = () => {
    const label = text.trim();
    setAdding(false);
    setText("");
    if (label) run(() => addScopeItem(project.id, kind, label));
  };

  return (
    <JobSection
      name={name}
      icon={inPrice ? "check" : "x"}
      hue={inPrice ? "green" : "grey"}
      action={
        manage ? (
          <Button size={32} disabled={busy} aria-label={`Add a line ${inPrice ? "in" : "not in"} the price`} onClick={() => setAdding(true)}>
            Add line
          </Button>
        ) : null
      }
    >
      {rows.length === 0 && !adding ? (
        <p className="pj-none">{inPrice ? "Nothing listed yet." : "No exclusions listed."}</p>
      ) : (
        <ul className="jov-rows" aria-label={name}>
          {rows.map((s) => (
            <li className="jov-row pj-row" key={s.id}>
              <span className="pj-name pj-plain">{s.label}</span>
              {manage && (
                <Button kind="quiet" size={32} className="pj-rm" aria-label={`Remove ${s.label}`} disabled={busy} onClick={() => run(() => removeScopeItem(s.id))}>
                  Remove
                </Button>
              )}
            </li>
          ))}
          {adding && (
            <li className="jov-row pj-row">
              <TextInput
                size={32}
                autoFocus
                aria-label={inPrice ? "A line in the price" : "A line not in the price"}
                placeholder={inPrice ? "Supply and install" : "Electrical mains upgrade"}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commit();
                  }
                  if (e.key === "Escape") {
                    setAdding(false);
                    setText("");
                  }
                }}
                onBlur={commit}
              />
            </li>
          )}
        </ul>
      )}
    </JobSection>
  );
}

/* ═════════ committed dates ═════════ */

export function DatesSection({
  project,
  today,
  manage,
  busy,
  run,
  onOpen,
}: {
  project: ProjectDetail;
  today: string;
  manage: boolean;
  busy: boolean;
  run: Run;
  onOpen: Open;
}) {
  const promise = () => {
    if (!project.promisedFinish) return null;
    const n = daysBetween(today, project.promisedFinish);
    if (n < 0) return <StateWord tone="wrong">{-n} {n === -1 ? "day" : "days"} past the promise</StateWord>;
    if (n <= 7) return <StateWord tone="look">{n === 0 ? "Today" : `In ${n} ${n === 1 ? "day" : "days"}`}</StateWord>;
    return <StateWord tone="info">In {n} days</StateWord>;
  };
  const over = project.hoursBudget !== null && project.hoursLogged > project.hoursBudget;

  const row = (label: string, value: ReactNode, word: ReactNode, press: string | null, form: OpenForm) => (
    <li className="jov-row pj-row">
      <span className="pj-text">
        <b className="pj-name">{label}</b>
        <span className="pj-line">{value ?? "Not set"}</span>
      </span>
      <span className="pj-end">
        {word}
        {manage && press && (
          <Button size={32} disabled={busy} onClick={() => onOpen(form)}>
            {press}
          </Button>
        )}
      </span>
    </li>
  );

  return (
    <JobSection name="Dates" icon="calendar" hue="yellow">
      <ul className="jov-rows" aria-label="Dates">
        {row(
          "Promised finish",
          project.promisedFinish ? fmtAuWeekdayDayMonth(project.promisedFinish) : null,
          promise(),
          project.promisedFinish ? "Move date" : "Set date",
          { kind: "promise" },
        )}
        {row(
          "Defects period ends",
          project.defectsEnd ? fmtAuWeekdayDayMonth(project.defectsEnd) : null,
          project.defectsEnd ? <StateWord tone="info">Task on the board</StateWord> : null,
          project.defectsEnd ? "Move date" : "Set date",
          { kind: "defects" },
        )}
        {row(
          "Hours allowed",
          project.hoursBudget !== null ? `${project.hoursLogged} of ${project.hoursBudget} h` : null,
          project.hoursBudget !== null ? (
            <StateWord tone={over ? "wrong" : "info"}>{over ? "Over the budget" : "Used so far"}</StateWord>
          ) : null,
          project.hoursBudget !== null ? "Change hours" : "Set hours",
          { kind: "hours" },
        )}
      </ul>

      <div className="pj-sub">
        <span>Windows and milestones</span>
        {manage && (
          <Button kind="quiet" size={32} onClick={() => onOpen({ kind: "milestone" })}>
            Add milestone
          </Button>
        )}
      </div>
      {project.milestones.length === 0 ? (
        <p className="pj-none">No milestones yet.</p>
      ) : (
        <ul className="jov-rows" aria-label="Windows and milestones">
          {project.milestones.map((m) => {
            const n = daysBetween(today, m.onDate);
            return (
              <li className="jov-row pj-row" key={m.id}>
                <span className="pj-lead">{fmtAuWeekdayDayMonth(m.onDate)}</span>
                <span className="pj-name pj-plain">{m.label}</span>
                <span className="pj-end">
                  {n >= 0 && n <= 7 && <StateWord tone="look">This week</StateWord>}
                  {manage && (
                    <Button kind="quiet" size={32} className="pj-rm" aria-label={`Remove ${m.label}`} disabled={busy} onClick={() => run(() => removeMilestone(m.id))}>
                      Remove
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </JobSection>
  );
}


/* ═════════ the maintenance agreement ═════════ */

/** At Handover a manager turns the install into its maintenance agreement in
    one press: client, site and every serial carry over. Once it has one, it
    links there. Mid-build, and for anyone else, it isn't shown. */
export function AgreementSection({ project, manage, onOpen }: { project: ProjectDetail; manage: boolean; onOpen: Open }) {
  const atHandover = project.stage === "Handover" || project.stage === "Complete";
  if (!project.agreementId && (!manage || !atHandover)) return null;
  return (
    <JobSection
      name="Maintenance agreement"
      icon="wrench"
      hue="green"
      action={
        !project.agreementId ? (
          <Button size={32} onClick={() => onOpen({ kind: "agreement" })}>
            Set up agreement
          </Button>
        ) : null
      }
    >
      {project.agreementId ? (
        <ul className="jov-rows">
          <li className="jov-row pj-row">
            <span className="pj-text">
              <LinkButton href="/dashboard/workboard" className="pj-name">
                {project.agreementLabel ?? "Its agreement"}
              </LinkButton>
              <span className="pj-line">On the maintenance board, its equipment and serials carried over</span>
            </span>
          </li>
        </ul>
      ) : (
        <p className="pj-none">No agreement yet.</p>
      )}
    </JobSection>
  );
}
