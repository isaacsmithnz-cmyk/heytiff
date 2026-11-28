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
   takes it. Cancel leaves the design as it is, still told. A set Tiff read
   again says Plans updated and Use on this design (Isaac, 23 November 2026). */

const dayOf = (iso: string | null | undefined) => (iso ? fmtAuWeekdayDayMonth(iso.slice(0, 10)) : null);

export function UpdatePlansDialog({ update, onUpdate, onClose }: { update: PlanUpdate; onUpdate: (ticked: Set<string>) => void; onClose: () => void }) {
  const [off, setOff] = useState<ReadonlySet<string>>(() => new Set());
  /* what was set by hand, the plans' taken instead (the building mock, board 6) */
  const [theirs, setTheirs] = useState<ReadonlySet<string>>(() => new Set());
  const { plan, was, pages, offers, said, again } = update;
  const kept = update.kept ?? [];
  const day = dayOf(again ? plan.reading?.at : plan.addedAt);
  const lede = again
    ? `${plan.name}${day ? `, read again ${day}` : ""}, against her read${dayOf(was?.reading?.at) ? ` of ${dayOf(was?.reading?.at)}` : ""}, which this design was drawn from.`
    : `${plan.name}${day ? `, added ${day}` : ""}${was ? `, against ${was.name}, which this design was drawn from` : ""}.`;
  const go = again ? "Use on this design" : "Update plans";
  const tick = (id: string, on: boolean) =>
    setOff((cur) => {
      const next = new Set(cur);
      if (on) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog
      heading={again ? "Plans updated" : "Update plans"}
      width={720}
      onClose={onClose}
      foot={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="main" onClick={() => onUpdate(new Set([...offers.map((o) => o.id).filter((id) => !off.has(id)), ...kept.map((k) => k.id).filter((id) => theirs.has(id))]))}>
            {go}
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
                  <span className="pt-row-name">{again ? "The walls, roof and site take her new read" : `The supplied scope takes ${plan.name}`}</span>
                  <span className="pt-row-line">Your Scope, units and ducts stay as you made them</span>
                </span>
              </li>
            </ul>
          </div>
        </Field>
        {kept.length > 0 && (
          <Field label="Kept as you set them">
            <div className="ds2-nd-plans">
              <ul className="pt-rows" aria-label="Kept as you set them">
                {kept.map((k) => {
                  const on = theirs.has(k.id);
                  const flip = () =>
                    setTheirs((cur) => {
                      const next = new Set(cur);
                      if (on) next.delete(k.id);
                      else next.add(k.id);
                      return next;
                    });
                  return (
                    <li key={k.id} className="pt-row pt-row--wrap">
                      <span className="pt-row-text">
                        <span className="pt-row-name">{k.title}</span>
                        <span className="pt-row-line">{k.line}</span>
                      </span>
                      <Button size={32} aria-pressed={on} onClick={flip}>
                        {on ? "Keep mine" : "Use the plans'"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </Field>
        )}
      </div>
    </Dialog>
  );
}

/** The row that says a newer set is on the job, with its Update plans. */
export function NewerPlansRow({ plan, was, again, changed, onOpen }: { plan: JobPlan; was: JobPlan | null; again?: boolean; changed: number; onOpen: () => void }) {
  const day = dayOf(plan.reading?.at);
  const line = again
    ? `Tiff read ${plan.name} again${day ? ` ${day}` : ""}, ${changed === 0 ? "no rooms changed" : `${changed} ${changed === 1 ? "sheet" : "sheets"} changed`}`
    : was
    ? changed === 0
      ? `No rooms changed from ${was.name}`
      : `${changed} ${changed === 1 ? "sheet" : "sheets"} changed from ${was.name}`
    : "New floors for this design";
  return (
    <div className="upl-row">
      <span className="upl-row-text">
        <span className="upl-row-name">{again ? "Plans updated" : `${plan.name} is in the job's Plans`}</span>
        <span className="upl-row-line">{line}</span>
      </span>
      <Button size={32} onClick={onOpen}>
        {again ? "Use on this design" : "Update plans"}
      </Button>
    </div>
  );
}
