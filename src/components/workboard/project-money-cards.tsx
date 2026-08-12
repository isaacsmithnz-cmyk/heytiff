"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { WbModal } from "./wb-modal";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { daysBetween } from "@/lib/workboard/board-status";
import {
  claimedLine,
  deriveProjectMoney,
  fmtAud,
  parseAudToCents,
} from "@/lib/workboard/project-money";
import type { ProjectDetail } from "@/lib/workboard/projects-query";
import {
  addClaim,
  addMilestone,
  addScopeItem,
  addVariation,
  decideVariation,
  removeClaim,
  removeMilestone,
  removeScopeItem,
  removeVariation,
  setClaimPaid,
  setProjectBudget,
  setProjectDefectsEnd,
  setProjectHoursBudget,
  setProjectPromise,
  spawnAgreementFromProject,
} from "@/app/actions/workboard-projects";
import { DateField } from "@/components/ui/date-field";

/* The money, scope and dates cards — step 4 of the projects overhaul.

   The law they render is deriveProjectMoney's, never their own: axis 1
   (claimed of the revised total) and axis 2 (collection per claim) share a
   card but never a sentence. Variations move the TARGET and every decision
   records who made the call. Budget prefill sources (studio pricing, SM8
   quote) don't exist as data yet — the field takes the typed number and
   keeps `budget_source` honest for when they do. */

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>) => void;

/* ═════════ money ═════════ */

export function MoneyCard({
  project,
  manage,
  busy,
  run,
}: {
  project: ProjectDetail;
  manage: boolean;
  busy: boolean;
  run: Run;
}) {
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetText, setBudgetText] = useState(
    project.budgetCents !== null ? String(project.budgetCents / 100) : ""
  );
  const [addingClaim, setAddingClaim] = useState(false);

  const money = deriveProjectMoney({
    budgetCents: project.budgetCents,
    variations: project.variations,
    claims: project.claims,
  });
  const line = claimedLine(money);

  const saveBudget = () => {
    setEditingBudget(false);
    const raw = budgetText.trim();
    if (raw === "") {
      run(() => setProjectBudget(project.id, { cents: null }));
      return;
    }
    const cents = parseAudToCents(raw);
    if (cents === null || cents < 0) {
      run(async () => ({ ok: false, error: "The budget needs to be a real dollar amount." }));
      return;
    }
    run(() => setProjectBudget(project.id, { cents, source: "manual" }));
  };

  return (
    <div className="card2">
      <div className="c2h">
        <span className="ci">
          <Icon name="dollar" size={19} />
        </span>
        <div>
          <b>Money</b>
          <em>
            {line ??
              "Set the job total and the claiming story starts — variations move it, claims chip at it."}
          </em>
        </div>
        {money.pendingVariationCents !== 0 && (
          <span className="wb2-chip warn" style={{ marginLeft: "auto" }}>
            {fmtAud(money.pendingVariationCents)} in pending variations
          </span>
        )}
      </div>

      {/* the target line */}
      <div className="wb2-moneyrow head">
        <div className="wb2-trt">
          <b>Job total</b>
          <em>
            {money.baseCents !== null
              ? `${fmtAud(money.baseCents)} base` +
                (money.approvedVariationCents !== 0
                  ? ` ${money.approvedVariationCents > 0 ? "+" : "−"} ${fmtAud(
                      Math.abs(money.approvedVariationCents)
                    )} approved variations`
                  : "")
              : "not set"}
            {project.budgetSource && money.baseCents !== null
              ? ` · ${
                  project.budgetSource === "studio"
                    ? "from the design"
                    : project.budgetSource === "sm8_quote"
                      ? "from the quote"
                      : "typed"
                }`
              : ""}
          </em>
        </div>
        <div className="wb2-plmoney">
          {money.revisedTotalCents !== null && <b>{fmtAud(money.revisedTotalCents)}</b>}
        </div>
        {manage &&
          (editingBudget ? (
            <div className="wb2-dayrow" style={{ margin: 0 }}>
              <input
                className="wb2-fi"
                autoFocus
                inputMode="decimal"
                placeholder="50,000"
                value={budgetText}
                onChange={(e) => setBudgetText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveBudget();
                  if (e.key === "Escape") setEditingBudget(false);
                }}
              />
              <button className="pbtn" disabled={busy} onClick={saveBudget}>
                Save
              </button>
            </div>
          ) : (
            <button
              className="pbtn ghost"
              disabled={busy}
              onClick={() => {
                setBudgetText(project.budgetCents !== null ? String(project.budgetCents / 100) : "");
                setEditingBudget(true);
              }}
            >
              {project.budgetCents !== null ? "Change" : "Set the total"}
            </button>
          ))}
      </div>

      {/* axis 2 rollup — the collection strip, never in the claimed line */}
      {(money.awaitingCents > 0 || money.paidCents > 0) && (
        <p className="wb2-moneystrip">
          <span className="wb2-chip ok">{fmtAud(money.paidCents)} paid</span>
          {money.awaitingCents > 0 && (
            <span className="wb2-chip warn">{fmtAud(money.awaitingCents)} awaiting payment</span>
          )}
        </p>
      )}

      {/* claims */}
      {project.claims.map((c) => (
        <div className="wb2-moneyrow" key={c.id}>
          <div className="wb2-trt">
            <b>{c.label}</b>
            <em>
              claimed {fmtAuWeekdayDayMonth(c.claimedOn)}
              {c.source !== "manual" ? ` · from ${c.source === "servicem8" ? "ServiceM8" : "Xero"}` : ""}
              {c.status === "paid" && c.paidOn ? ` · paid ${fmtAuWeekdayDayMonth(c.paidOn)}` : ""}
            </em>
          </div>
          <div className="wb2-plmoney">
            <b>{fmtAud(c.amountCents)}</b>
          </div>
          {manage ? (
            <button
              className={"wb2-chip" + (c.status === "paid" ? " ok" : " warn")}
              disabled={busy}
              title={c.status === "paid" ? "Mark it back to awaiting" : "Mark it paid"}
              onClick={() => run(() => setClaimPaid(c.id, c.status !== "paid"))}
            >
              {c.status === "paid" ? "Paid" : "Awaiting payment"}
            </button>
          ) : (
            <span className={"wb2-chip" + (c.status === "paid" ? " ok" : " warn")}>
              {c.status === "paid" ? "Paid" : "Awaiting payment"}
            </span>
          )}
          {manage && c.source === "manual" && (
            <button
              className="fl-x"
              aria-label={`Remove ${c.label}`}
              disabled={busy}
              onClick={() => run(() => removeClaim(c.id))}
            >
              <Icon name="x" size={13} />
            </button>
          )}
        </div>
      ))}
      {project.claims.length === 0 && (
        <p className="int-hint">Nothing claimed yet — the deposit is usually the first row.</p>
      )}

      {manage && (
        <button className="pbtn ghost" style={{ marginTop: 8 }} onClick={() => setAddingClaim(true)}>
          <Icon name="plus" size={15} />
          Add a claim
        </button>
      )}

      {addingClaim && (
        <AddClaimModal
          project={project}
          onClose={() => setAddingClaim(false)}
          onAdd={(input) => {
            setAddingClaim(false);
            run(() => addClaim(project.id, input));
          }}
        />
      )}
    </div>
  );
}

function AddClaimModal({
  project,
  onClose,
  onAdd,
}: {
  project: ProjectDetail;
  onClose: () => void;
  onAdd: (input: { label: string; amountCents: number; variationId?: string | null }) => void;
}) {
  const [label, setLabel] = useState("");
  const [amountText, setAmountText] = useState("");
  const [variationId, setVariationId] = useState("");
  const cents = parseAudToCents(amountText);
  const approved = project.variations.filter((v) => v.status === "approved");

  return (
    <WbModal
      title="Add a claim"
      sub="Axis one: it counts as claimed the moment it exists. Paid-ness is its own story."
      onClose={onClose}
    >
      <div className="fl-grid">
        <label className="fl-f span">
          <span>
            What&apos;s being claimed<i>*</i>
          </span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Deposit · Rough-in claim · Final"
            autoFocus
          />
        </label>
        <label className="fl-f">
          <span>
            Amount<i>*</i>
          </span>
          <input
            inputMode="decimal"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            placeholder="10,000"
          />
        </label>
        {approved.length > 0 && (
          <label className="fl-f">
            <span>For a variation?</span>
            <select
              className="wb-select"
              value={variationId}
              onChange={(e) => setVariationId(e.target.value)}
            >
              <option value="">No — base work</option>
              {approved.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.title}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="fl-foot">
        <button className="pbtn ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="pbtn primary"
          disabled={!label.trim() || cents === null || cents <= 0}
          onClick={() =>
            onAdd({ label: label.trim(), amountCents: cents!, variationId: variationId || null })
          }
        >
          Add the claim
        </button>
      </div>
    </WbModal>
  );
}

/* ═════════ variations ═════════ */

export function VariationsCard({
  project,
  manage,
  busy,
  run,
}: {
  project: ProjectDetail;
  manage: boolean;
  busy: boolean;
  run: Run;
}) {
  const [adding, setAdding] = useState(false);
  const [deciding, setDeciding] = useState<{ id: string; to: "approved" | "declined" } | null>(null);

  const claimedVariationIds = new Set(
    project.claims.map((c) => c.variationId).filter((v): v is string => v !== null)
  );

  return (
    <div className="card2">
      <div className="c2h">
        <span className="ci">
          <Icon name="layers" size={19} />
        </span>
        <div>
          <b>Variations</b>
          <em>
            Approved ones move the target, never the claimed — and every call records who made it.
          </em>
        </div>
        {manage && (
          <button className="pbtn ghost" style={{ marginLeft: "auto" }} onClick={() => setAdding(true)}>
            <Icon name="plus" size={15} />
            Add
          </button>
        )}
      </div>

      {project.variations.length === 0 ? (
        <p className="int-hint">No variations — the scope below is the whole job.</p>
      ) : (
        project.variations.map((v) => (
          <div className="wb2-moneyrow" key={v.id}>
            <div className="wb2-trt">
              <b>{v.title}</b>
              <em>
                {v.status === "pending"
                  ? "pending a decision"
                  : `${v.status}${v.decidedBy ? ` by ${v.decidedBy}` : ""}${
                      v.decidedAt ? ` · ${fmtAuWeekdayDayMonth(v.decidedAt.slice(0, 10))}` : ""
                    }`}
                {v.detail ? ` · ${v.detail}` : ""}
              </em>
            </div>
            <div className="wb2-plmoney">
              <b>
                {v.amountCents > 0 ? "+" : ""}
                {fmtAud(v.amountCents)}
              </b>
            </div>
            <span
              className={
                "wb2-chip" +
                (v.status === "approved" ? " ok" : v.status === "declined" ? "" : " warn")
              }
            >
              {v.status}
            </span>
            {manage && v.status === "pending" && (
              <>
                <button
                  className="pbtn ghost"
                  disabled={busy}
                  onClick={() => setDeciding({ id: v.id, to: "approved" })}
                >
                  Approve…
                </button>
                <button
                  className="pbtn ghost"
                  disabled={busy}
                  onClick={() => setDeciding({ id: v.id, to: "declined" })}
                >
                  Decline…
                </button>
              </>
            )}
            {manage && v.status === "approved" && !claimedVariationIds.has(v.id) && (
              <button
                className="pbtn ghost"
                disabled={busy}
                title="Raise its claim row — it becomes part of axis one"
                onClick={() =>
                  run(() =>
                    addClaim(project.id, {
                      label: `Variation — ${v.title}`,
                      amountCents: v.amountCents,
                      variationId: v.id,
                    })
                  )
                }
              >
                Claim it
              </button>
            )}
            {manage && v.status !== "pending" && (
              <button
                className="pbtn ghost"
                disabled={busy}
                title="Back to pending — clears the decision"
                onClick={() => run(() => decideVariation(v.id, "pending"))}
              >
                Reopen
              </button>
            )}
            {manage && v.status !== "approved" && (
              <button
                className="fl-x"
                aria-label={`Remove ${v.title}`}
                disabled={busy}
                onClick={() => run(() => removeVariation(v.id))}
              >
                <Icon name="x" size={13} />
              </button>
            )}
          </div>
        ))
      )}

      {adding && (
        <AddVariationModal
          onClose={() => setAdding(false)}
          onAdd={(input) => {
            setAdding(false);
            run(() => addVariation(project.id, input));
          }}
        />
      )}
      {deciding && (
        <DecideModal
          to={deciding.to}
          onClose={() => setDeciding(null)}
          onDecide={(who) => {
            const d = deciding;
            setDeciding(null);
            run(() => decideVariation(d.id, d.to, who));
          }}
        />
      )}
    </div>
  );
}

function AddVariationModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (input: { title: string; detail?: string; amountCents: number }) => void;
}) {
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [amountText, setAmountText] = useState("");
  const cents = parseAudToCents(amountText);

  return (
    <WbModal
      title="Add a variation"
      sub="It changes the TARGET once approved. Credits go negative."
      onClose={onClose}
    >
      <div className="fl-grid">
        <label className="fl-f span">
          <span>
            What changed<i>*</i>
          </span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Extra return-air grille"
            autoFocus
          />
        </label>
        <label className="fl-f">
          <span>
            Amount<i>*</i>
          </span>
          <input
            inputMode="decimal"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            placeholder="4,000 or -1,500"
          />
        </label>
        <label className="fl-f span">
          <span>Detail</span>
          <input
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            placeholder="Why, and what it covers"
          />
        </label>
      </div>
      <div className="fl-foot">
        <button className="pbtn ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="pbtn primary"
          disabled={!title.trim() || cents === null || cents === 0}
          onClick={() => onAdd({ title: title.trim(), detail: detail.trim() || undefined, amountCents: cents! })}
        >
          Add it — pending
        </button>
      </div>
    </WbModal>
  );
}

function DecideModal({
  to,
  onClose,
  onDecide,
}: {
  to: "approved" | "declined";
  onClose: () => void;
  onDecide: (who: string) => void;
}) {
  const [who, setWho] = useState("");
  return (
    <WbModal
      title={to === "approved" ? "Approve the variation" : "Decline the variation"}
      sub="Who made the call — the client's name, usually. This is the ledger's whole point."
      onClose={onClose}
    >
      <label className="fl-f span">
        <span>
          Decided by<i>*</i>
        </span>
        <input
          value={who}
          onChange={(e) => setWho(e.target.value)}
          placeholder="Sarah Bowden (client)"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && who.trim()) onDecide(who.trim());
          }}
        />
      </label>
      <div className="fl-foot">
        <button className="pbtn ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="pbtn primary" disabled={!who.trim()} onClick={() => onDecide(who.trim())}>
          {to === "approved" ? "Approve it" : "Decline it"}
        </button>
      </div>
    </WbModal>
  );
}

/* ═════════ scope of work ═════════ */

export function ScopeCard({
  project,
  manage,
  busy,
  run,
}: {
  project: ProjectDetail;
  manage: boolean;
  busy: boolean;
  run: Run;
}) {
  const inclusions = project.scope.filter((s) => s.kind === "inclusion");
  const exclusions = project.scope.filter((s) => s.kind === "exclusion");

  const column = (kind: "inclusion" | "exclusion", rows: typeof inclusions) => (
    <div className="wb2-scopecol">
      <div className="wb-dayhead">{kind === "inclusion" ? "In the price" : "Not in the price"}</div>
      {rows.map((s) => (
        <div className="wb-row" key={s.id}>
          <span className={"wb2-scopemark" + (kind === "exclusion" ? " out" : "")} aria-hidden="true">
            <Icon name={kind === "inclusion" ? "check" : "x"} size={12} />
          </span>
          <span className="wb-who">{s.label}</span>
          {manage && (
            <button
              className="fl-x"
              aria-label={`Remove ${s.label}`}
              disabled={busy}
              onClick={() => run(() => removeScopeItem(s.id))}
            >
              <Icon name="x" size={13} />
            </button>
          )}
        </div>
      ))}
      {rows.length === 0 && (
        <p className="int-hint">{kind === "inclusion" ? "Nothing listed yet." : "No exclusions listed."}</p>
      )}
      {manage && (
        <AddScopeRow
          busy={busy}
          placeholder={kind === "inclusion" ? "Supply & install…" : "Electrical mains upgrade…"}
          onAdd={(label) => run(() => addScopeItem(project.id, kind, label))}
        />
      )}
    </div>
  );

  return (
    <div className="card2">
      <div className="c2h">
        <span className="ci">
          <Icon name="file" size={19} />
        </span>
        <div>
          <b>Scope of work</b>
          <em>The baseline variations depart from — exclusions settle arguments before they start.</em>
        </div>
      </div>
      <div className="wb2-scope">
        {column("inclusion", inclusions)}
        {column("exclusion", exclusions)}
      </div>
    </div>
  );
}

function AddScopeRow({
  busy,
  placeholder,
  onAdd,
}: {
  busy: boolean;
  placeholder: string;
  onAdd: (label: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  if (!editing) {
    return (
      <button className="wb2-pk add" disabled={busy} onClick={() => setEditing(true)}>
        <Icon name="plus" size={12} />
        Add a line
      </button>
    );
  }
  const commit = () => {
    const label = text.trim();
    setEditing(false);
    setText("");
    if (label) onAdd(label);
  };
  return (
    <input
      className="wb2-fi"
      autoFocus
      placeholder={placeholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") {
          setEditing(false);
          setText("");
        }
      }}
      onBlur={commit}
    />
  );
}

/* ═════════ committed dates ═════════ */

export function DatesCard({
  project,
  today,
  manage,
  busy,
  run,
}: {
  project: ProjectDetail;
  today: string;
  manage: boolean;
  busy: boolean;
  run: Run;
}) {
  const [promiseDay, setPromiseDay] = useState("");
  const [defectsDay, setDefectsDay] = useState("");
  const [msLabel, setMsLabel] = useState("");
  const [msDay, setMsDay] = useState("");

  const promiseChip = () => {
    if (!project.promisedFinish) return null;
    const n = daysBetween(today, project.promisedFinish);
    if (n < 0)
      return <span className="wb2-chip dan">{-n} {n === -1 ? "day" : "days"} past the promise</span>;
    if (n <= 7) return <span className="wb2-chip warn">{n === 0 ? "today" : `in ${n} ${n === 1 ? "day" : "days"}`}</span>;
    return <span className="wb2-chip">in {n} days</span>;
  };

  const dateRow = (
    label: string,
    sub: string,
    value: string | null,
    chip: React.ReactNode,
    draft: string,
    setDraft: (v: string) => void,
    save: (day: string | null) => Promise<{ ok: boolean; error?: string }>
  ) => (
    <div className="wb2-moneyrow">
      <div className="wb2-trt">
        <b>{label}</b>
        <em>{sub}</em>
      </div>
      <div className="wb2-trd">
        {value ? (
          <>
            <b>{fmtAuWeekdayDayMonth(value)}</b>
            <em>{chip}</em>
          </>
        ) : (
          <em>not set</em>
        )}
      </div>
      {manage && (
        <div className="wb2-dayrow" style={{ margin: 0 }}>
          <DateField
            className="wb2-fi"
            aria-label={label}
            value={draft || null}
            onChange={(iso) => setDraft(iso ?? "")}
          />
          <button
            className="pbtn ghost"
            disabled={busy || !draft}
            onClick={() => {
              const d = draft;
              setDraft("");
              run(() => save(d));
            }}
          >
            {value ? "Move it" : "Set it"}
          </button>
          {value && (
            <button className="pbtn ghost" disabled={busy} onClick={() => run(() => save(null))}>
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="card2">
      <div className="c2h">
        <span className="ci">
          <Icon name="clock" size={19} />
        </span>
        <div>
          <b>Committed dates</b>
          <em>The promises with consequences — the board counts them down out loud.</em>
        </div>
      </div>

      {dateRow(
        "Promised finish",
        "urgent when it's a week out and the stage is behind",
        project.promisedFinish,
        promiseChip(),
        promiseDay,
        setPromiseDay,
        (d) => setProjectPromise(project.id, d)
      )}
      {dateRow(
        "Defects period ends",
        "setting it keeps one open task pointed at the walk",
        project.defectsEnd,
        project.defectsEnd ? <span className="wb2-chip">task on the board</span> : null,
        defectsDay,
        setDefectsDay,
        (d) => setProjectDefectsEnd(project.id, d)
      )}

      <div className="wb-dayhead" style={{ marginTop: 10 }}>
        Windows &amp; milestones
      </div>
      {project.milestones.map((m) => (
        <div className="wb-row" key={m.id}>
          <span className="wb-time">{fmtAuWeekdayDayMonth(m.onDate)}</span>
          <span className="wb-who">{m.label}</span>
          {daysBetween(today, m.onDate) >= 0 && daysBetween(today, m.onDate) <= 7 && (
            <span className="wb2-chip warn">this week</span>
          )}
          {manage && (
            <button
              className="fl-x"
              aria-label={`Remove ${m.label}`}
              disabled={busy}
              onClick={() => run(() => removeMilestone(m.id))}
            >
              <Icon name="x" size={13} />
            </button>
          )}
        </div>
      ))}
      {project.milestones.length === 0 && (
        <p className="int-hint">Crane day, shutdown window, inspection — the dates that don&apos;t move.</p>
      )}
      {manage && (
        <div className="wb2-dayrow">
          <input
            className="wb2-fi"
            placeholder="Crane booked"
            value={msLabel}
            onChange={(e) => setMsLabel(e.target.value)}
          />
          <DateField
            className="wb2-fi"
            aria-label="Milestone day"
            value={msDay || null}
            onChange={(iso) => setMsDay(iso ?? "")}
          />
          <button
            className="pbtn ghost"
            disabled={busy || !msLabel.trim() || !msDay}
            onClick={() => {
              const input = { label: msLabel.trim(), onDate: msDay };
              setMsLabel("");
              setMsDay("");
              run(() => addMilestone(project.id, input));
            }}
          >
            Add
          </button>
        </div>
      )}

      {manage && (
        <HoursBudgetRow project={project} busy={busy} run={run} />
      )}
    </div>
  );
}

function HoursBudgetRow({
  project,
  busy,
  run,
}: {
  project: ProjectDetail;
  busy: boolean;
  run: Run;
}) {
  const [text, setText] = useState(project.hoursBudget !== null ? String(project.hoursBudget) : "");
  const [editing, setEditing] = useState(false);

  return (
    <div className="wb2-moneyrow">
      <div className="wb2-trt">
        <b>Hours allowed</b>
        <em>the labour the price assumed — burn reads against it, hours versus hours</em>
      </div>
      <div className="wb2-trd">
        {project.hoursBudget !== null ? (
          <>
            <b>{project.hoursLogged} of {project.hoursBudget} h</b>
            <em>{project.hoursLogged > project.hoursBudget ? "over the budget" : "used so far"}</em>
          </>
        ) : (
          <em>not set</em>
        )}
      </div>
      {editing ? (
        <div className="wb2-dayrow" style={{ margin: 0 }}>
          <input
            className="wb2-fi"
            autoFocus
            inputMode="decimal"
            placeholder="60"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(false);
            }}
          />
          <button
            className="pbtn ghost"
            disabled={busy}
            onClick={() => {
              setEditing(false);
              const raw = text.trim();
              run(() => setProjectHoursBudget(project.id, raw === "" ? null : Number(raw)));
            }}
          >
            Save
          </button>
        </div>
      ) : (
        <button className="pbtn ghost" disabled={busy} onClick={() => setEditing(true)}>
          {project.hoursBudget !== null ? "Change" : "Set the hours"}
        </button>
      )}
    </div>
  );
}

/* ═════════ the flywheel ═════════ */

export function FlywheelCard({
  project,
  manage,
  busy,
  run,
}: {
  project: ProjectDetail;
  manage: boolean;
  busy: boolean;
  run: Run;
}) {
  const [open, setOpen] = useState(false);
  const [interval, setInterval] = useState("6");
  const [firstDue, setFirstDue] = useState("");

  const atHandover = project.stage === "Handover" || project.stage === "Complete";

  if (project.agreementId) {
    return (
      <div className="card2">
        <div className="c2h">
          <span className="ci">
            <Icon name="rotate" size={19} />
          </span>
          <div>
            <b>Maintenance agreement</b>
            <em>
              This install feeds{" "}
              <Link href="/dashboard/workboard" className="ro-link">
                {project.agreementLabel ?? "its agreement"}
              </Link>{" "}
              on the maintenance board — equipment and serials carried over.
            </em>
          </div>
        </div>
      </div>
    );
  }

  if (!manage || !atHandover) return null;

  return (
    <div className="card2">
      <div className="c2h">
        <span className="ci">
          <Icon name="rotate" size={19} />
        </span>
        <div>
          <b>The install&apos;s done — keep it</b>
          <em>
            One press turns this project into its maintenance agreement: client, site and every
            serial carry over.
          </em>
        </div>
        {!open && (
          <button className="pbtn" style={{ marginLeft: "auto" }} disabled={busy} onClick={() => setOpen(true)}>
            Set up the agreement
          </button>
        )}
      </div>
      {open && (
        <div className="wb2-dayrow">
          <label className="wb2-fl">
            Every
            <select className="wb-select" value={interval} onChange={(e) => setInterval(e.target.value)}>
              <option value="3">3 months</option>
              <option value="6">6 months</option>
              <option value="12">12 months</option>
            </select>
          </label>
          <label className="wb2-fl">
            First service
            <DateField
              className="wb2-fi"
              aria-label="First service due"
              value={firstDue || null}
              onChange={(iso) => setFirstDue(iso ?? "")}
            />
          </label>
          <button
            className="pbtn"
            disabled={busy || !firstDue}
            onClick={() => {
              setOpen(false);
              run(() =>
                spawnAgreementFromProject(project.id, {
                  intervalMonths: parseInt(interval, 10),
                  anchorDate: firstDue,
                })
              );
            }}
          >
            Create the agreement
          </button>
          <button className="pbtn ghost" disabled={busy} onClick={() => setOpen(false)}>
            Not now
          </button>
        </div>
      )}
    </div>
  );
}
