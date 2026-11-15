"use client";

import { useState } from "react";
import { Button } from "@/components/parts/button";
import { Dialog } from "@/components/parts/dialog";
import { Field } from "@/components/parts/field";
import { Tick } from "@/components/parts/tick";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import type { JobPlan } from "@/lib/jobs/plans";
import type { PlanUpdate } from "@/lib/studio/update-plans";

/* UPDATE PLANS (update-plans.ts; the board "Update plans" of 11 November
   2026): what the newer set changed, page by page; what it does to the
   design, each room's change ticked to take it; and the main button that
   takes it. Cancel leaves the design as it is, still told. */

export function UpdatePlansDialog({ update, onUpdate, onClose }: { update: PlanUpdate; onUpdate: (ticked: Set<string>) => void; onClose: () => void }) {
  const [off, setOff] = useState<ReadonlySet<string>>(() => new Set());
  const { plan, was, pages, offers, said } = update;
  const day = plan.addedAt ? fmtAuWeekdayDayMonth(plan.addedAt.slice(0, 10)) : null;
  const lede = `${plan.name}${day ? `, added ${day}` : ""}${was ? `, against ${was.name}, which this design was drawn from` : ""}.`;
  const tick = (id: string, on: boolean) =>
    setOff((cur) => {
      const next = new Set(cur);
      if (on) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog
      heading="Update plans"
      width={720}
      onClose={onClose}
      foot={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="main" onClick={() => onUpdate(new Set(offers.map((o) => o.id).filter((id) => !off.has(id))))}>
            Update plans
          </Button>
        </>
      }
    >
      <div className="ds2-nd-form">
        <p className="upl-lede">{lede}</p>
        <Field label="What the plans changed">
          <div className="ds2-nd-plans">
            <ul className="pt-rows" aria-label="What the plans changed">
              {pages.length > 0 ? (
                pages.map((p) => (
                  <li key={p.n} className="pt-row pt-row--wrap">
                    <span className="pt-row-text">
                      <span className="pt-row-name">{p.title}</span>
                      <span className="pt-row-line">{p.lines.join(". ")}</span>
                    </span>
                  </li>
                ))
              ) : (
                <li className="pt-row pt-row--wrap">
                  <span className="pt-row-text">
                    <span className="pt-row-name">The rooms are as they were</span>
                    <span className="pt-row-line">Only the drawings change</span>
                  </span>
                </li>
              )}
            </ul>
          </div>
        </Field>
        <Field label="What it does to the design">
          <div className="ds2-nd-plans">
            <ul className="pt-rows" aria-label="What it does to the design">
              {offers.map((o) => (
                <li key={o.id} className="pt-row pt-row--wrap">
                  <span className="pt-row-lead">
                    <Tick className="jdoc-tick" checked={!off.has(o.id)} onChange={(v) => tick(o.id, v)} label={<span className="sr-only">{o.title}</span>} />
                  </span>
                  <span className="pt-row-text">
                    <span className="pt-row-name">{o.title}</span>
                    <span className="pt-row-line">{o.line}</span>
                  </span>
                </li>
              ))}
              {said.map((s) => (
                <li key={s.title} className="pt-row pt-row--wrap">
                  <span className="pt-row-text">
                    <span className="pt-row-name">{s.title}</span>
                    <span className="pt-row-line">{s.line}</span>
                  </span>
                </li>
              ))}
              <li className="pt-row pt-row--wrap">
                <span className="pt-row-text">
                  <span className="pt-row-name">{`The supplied scope takes ${plan.name}`}</span>
                  <span className="pt-row-line">Your Scope, units and ducts stay as you made them</span>
                </span>
              </li>
            </ul>
          </div>
        </Field>
      </div>
    </Dialog>
  );
}

/** The row that says a newer set is on the job, with its Update plans. */
export function NewerPlansRow({ plan, was, changed, onOpen }: { plan: JobPlan; was: JobPlan | null; changed: number; onOpen: () => void }) {
  const line = was
    ? changed === 0
      ? `No rooms changed from ${was.name}`
      : `${changed} ${changed === 1 ? "sheet" : "sheets"} changed from ${was.name}`
    : "New floors for this design";
  return (
    <div className="upl-row">
      <span className="upl-row-text">
        <span className="upl-row-name">{`${plan.name} is in the job's Plans`}</span>
        <span className="upl-row-line">{line}</span>
      </span>
      <Button size={32} onClick={onOpen}>
        Update plans
      </Button>
    </div>
  );
}
