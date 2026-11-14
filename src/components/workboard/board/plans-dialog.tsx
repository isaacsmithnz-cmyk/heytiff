"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/parts/button";
import { Chooser } from "@/components/parts/chooser";
import { Dialog } from "@/components/parts/dialog";
import { StateWord } from "@/components/parts/state";
import { Tick } from "@/components/parts/tick";
import { choosablePages, floorOptions, floorValueOf, planReadLine, planStateWord, type JobPlanRead } from "@/lib/jobs/plans";

/* PLANS (Isaac, 14 November 2026, "Is floor stacker step still needed?" →
   "Yes" to removing it, on https://claude.ai/artifact/61nqwanqUAtQx4iG6AxoYs).
   The job's plans in one dialog, each page with the floor Tiff gave it in a
   menu under it, ending in Not a floor plan, and Add plans, which puts a new
   file on the job only. What's chosen is saved on the job's plan, so every
   design and quote gets the fix.

   Opened two ways: from the job's Plans on a set she isn't sure of (Choose
   floors), on that set alone; and from a design's Edit plans, on all the
   job's drawings, ticked where the design uses them. */

export type ChosenFloors = Record<string, Record<number, string>>;

export function PlansDialog({
  plans,
  jobNumber,
  ticked,
  onAdd,
  onSave,
  onClose,
}: {
  /** the job's sets of drawings, as the job's Plans reads them, kept fresh by the caller while one is read */
  plans: readonly JobPlanRead[];
  /** said in each line, from a design: "In job 3465's Plans" */
  jobNumber?: string | null;
  /** from a design: the plans it uses, which come ticked; absent from the job */
  ticked?: readonly string[];
  /** files onto the job's Plans, each read there: what went wrong, or null */
  onAdd?: (files: File[]) => Promise<string | null>;
  /** the floors changed, by plan and page, and the plans ticked: what went wrong, or null */
  onSave: (chosen: ChosenFloors, ticked: string[]) => Promise<string | null>;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState<ChosenFloors>({});
  /* the design's plans come ticked, and a plan added here once it's read;
     a tick changed by hand stays as it was left */
  const [first] = useState(() => new Set(plans.map((p) => p.id)));
  const [ticks, setTicks] = useState<Readonly<Record<string, boolean>>>({});
  const isOn = (id: string) => ticks[id] ?? (!!ticked?.includes(id) || !first.has(id));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const design = !!ticked;

  const choose = (planId: string, n: number, value: string) => setChosen((c) => ({ ...c, [planId]: { ...c[planId], [n]: value } }));
  const tick = (id: string, on: boolean) => setTicks((cur) => ({ ...cur, [id]: on }));

  const add = async (files: File[]) => {
    if (!onAdd || files.length === 0) return;
    setError(null);
    setBusy(files.length === 1 ? "Adding the plan to the job" : `Adding ${files.length} plans to the job`);
    const wrong = await onAdd(files).catch(() => "The plan couldn't be added. Try again.");
    setBusy(null);
    if (wrong) setError(wrong);
  };

  const save = async () => {
    setError(null);
    setBusy("Saving");
    /* only what changed is saved, by the plans still on the job */
    const changed: ChosenFloors = {};
    for (const p of plans) {
      const mine = chosen[p.id];
      if (!mine) continue;
      const diff = Object.fromEntries(Object.entries(mine).filter(([n, v]) => {
        const page = p.pages.find((pg) => pg.n === Number(n));
        return page && floorValueOf(page) !== v;
      }));
      if (Object.keys(diff).length) changed[p.id] = diff;
    }
    /* a set opened from the job alone was looked at, so it's saved even unchanged */
    if (!design && plans.length === 1 && !changed[plans[0].id]) changed[plans[0].id] = {};
    /* a plan being read again stays in the design as it is */
    const usable = plans.filter((p) => isOn(p.id) && (choosable(p) || !!ticked?.includes(p.id))).map((p) => p.id);
    const wrong = await onSave(changed, usable).catch(() => "The plans couldn't be saved. Try again.");
    setBusy(null);
    if (wrong) setError(wrong);
    else onClose();
  };

  return (
    <Dialog
      heading="Plans"
      width={720}
      onClose={onClose}
      dismissable={!busy}
      foot={
        <>
          <Button onClick={onClose} disabled={busy === "Saving"}>
            Cancel
          </Button>
          <Button kind="main" onClick={() => void save()} disabled={!!busy}>
            {busy === "Saving" ? "Saving" : "Save plans"}
          </Button>
        </>
      }
    >
      <div className="jpl-plans">
        {plans.length > 0 && (
          <ul className="pt-rows" aria-label="The job's plans">
            {plans.map((p) => {
              const state = planStateWord(p);
              const pages = choosable(p) ? choosablePages(p).filter((pg) => p.thumbs[pg.n]) : [];
              const options = floorOptions(p);
              const line = [jobNumber ? `In job ${jobNumber}'s Plans` : null, planReadLine(p)].filter(Boolean).join(". ");
              return (
                <li key={p.id} className="pt-row pt-row--wrap">
                  {design && (
                    <span className="pt-row-lead">
                      <Tick className="jdoc-tick" checked={isOn(p.id) && choosable(p)} disabled={!choosable(p)} onChange={(v) => tick(p.id, v)} label={<span className="sr-only">{`Use ${p.name}`}</span>} />
                    </span>
                  )}
                  <span className="pt-row-text">
                    <span className="pt-row-name">{p.name}</span>
                    <span className="pt-row-line">{line}</span>
                    {pages.length > 0 && (
                      <span className="jpl-pages jpl-pages--floors">
                        {pages.map((pg) => (
                          <span key={pg.n} className="jpl-page">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={p.thumbs[pg.n]} alt={`Page ${pg.n}`} />
                            <span>{`Page ${pg.n}`}</span>
                            <Chooser
                              size={36}
                              aria-label={`Floor of page ${pg.n}`}
                              options={options}
                              value={chosen[p.id]?.[pg.n] ?? floorValueOf(pg)}
                              onChange={(v) => choose(p.id, pg.n, v)}
                              disabled={!!busy}
                            />
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                  <span className="pt-row-end">
                    <StateWord tone={state.tone}>{state.word}</StateWord>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {onAdd && (
          <span className="jpl-plans-add">
            <Button kind="quiet" size={32} disabled={!!busy} onClick={() => picker.current?.click()}>
              {busy && busy !== "Saving" ? busy : "Add plans"}
            </Button>
            <input
              ref={picker}
              type="file"
              hidden
              multiple
              accept="application/pdf,image/png,image/jpeg"
              aria-label="Choose plans to add to the job"
              onChange={(e) => {
                const list = [...(e.target.files ?? [])];
                e.target.value = "";
                void add(list);
              }}
            />
          </span>
        )}
        {error && (
          <p className="ds2-nd-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/** A set whose floors can be chosen: read, with a page she drew. */
const choosable = (p: JobPlanRead) => (p.state === "read" || p.state === "check") && choosablePages(p).length > 0;
