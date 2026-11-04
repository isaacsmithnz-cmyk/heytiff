"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/parts/button";
import { StateWord } from "@/components/parts/state";
import { trackerLabour, trackerMaterials, fmtHours, type TrackerItem, type TrackerRead } from "@/lib/jobs/job-tracker";
import { fmtAud } from "@/lib/workboard/project-money";
import { JobSection } from "./job-section";

/* THE JOB TRACKER (Isaac, 3 and 4 November 2026: "a bar line per section";
   "show the simple lines first and then you can drop them down"; rows A on
   https://claude.ai/artifact/YGZXZsQMdaJTQEckLEJ5to, checked against the
   laws on https://claude.ai/artifact/8L3hw5D8QxHZidsAAQNcX6, "build it").
   Three lines against the quote, each two lines and a bar:

     Labour     hours worked of the quote's hours; overtime's extra paid
                hours follow on the bar in orange, and only what passes
                the quote is red (design.md, "On a job's page")
     Materials  what was used, priced from the price book, of the quote's
                materials
     Equipment  the quote's units, as quoted

   Each line's Show opens its rows: the days, the things used, the units. */

function Meter({ parts, label }: { parts: { kind: "used" | "ot" | "over"; share: number }[]; label: string }) {
  const shown = parts.filter((p) => p.share > 0);
  return (
    <span className="jtr-meter" role="img" aria-label={label}>
      {shown.map((p) => (
        <i key={p.kind} className={`jtr-${p.kind}`} style={{ width: `${Math.min(100, p.share * 100)}%` }} />
      ))}
    </span>
  );
}

function Rows({ items }: { items: TrackerItem[] }) {
  return (
    <ul className="jov-rows jtr-rows">
      {items.map((it, i) => (
        <li className="jov-row" key={`${it.name}-${i}`}>
          <span className="jtr-thing">
            <b>{it.name}</b>
            {it.detail && <span className="jov-cap">{it.detail}</span>}
          </span>
          <span className="jtr-amt">
            {it.noPrice ? <StateWord tone="look">No price</StateWord> : it.amount}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Line({
  name,
  noun,
  figure,
  word,
  meter,
  under,
  items,
}: {
  name: string;
  /** What Show opens: days, materials, equipment (rule 49). */
  noun: string;
  figure: ReactNode;
  word: ReactNode;
  meter?: ReactNode;
  under?: string | null;
  items: TrackerItem[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="jtr-line">
      <div className="jtr-top">
        <b className="jtr-name">{name}</b>
        {word}
      </div>
      <div className="jtr-fig">
        <span>{figure}</span>
        {items.length > 0 && (
          <Button kind="quiet" size={32} className="jtr-show" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? `Hide ${noun}` : `Show ${noun}`}
          </Button>
        )}
      </div>
      {(meter || under) && (
        <div className="jtr-bar">
          {meter}
          {under && <span className="jtr-under">{under}</span>}
        </div>
      )}
      {open && <Rows items={items} />}
    </li>
  );
}

export function JobTracker({ read }: { read: TrackerRead | null }) {
  if (!read) {
    return (
      <JobSection name="Job tracker" icon="gauge" hue="purple">
        <p className="jov-none">Reading the job</p>
      </JobSection>
    );
  }
  const lab = trackerLabour(read.labour);
  const mat = trackerMaterials(read.materials);
  return (
    <JobSection name="Job tracker" icon="gauge" hue="purple">
      <ul className="jtr">
        <Line
          name="Labour"
          noun="days"
          figure={
            read.labour.quotedHours !== null ? (
              <>
                <b>{fmtHours(read.labour.workedHours)}</b> of {fmtHours(read.labour.quotedHours)}
              </>
            ) : (
              <>
                <b>{fmtHours(read.labour.workedHours)}</b> worked
              </>
            )
          }
          word={<StateWord tone={lab.tone}>{lab.word}</StateWord>}
          meter={lab.parts.length ? <Meter parts={lab.parts} label={lab.label} /> : null}
          under={lab.under}
          items={read.labour.days.map((d) => ({
            name: d.day,
            detail: [d.who, d.paidAs !== null ? `Paid as ${fmtHours(d.paidAs)}` : null].filter(Boolean).join(". ") || null,
            amount: fmtHours(d.hours),
          }))}
        />
        <Line
          name="Materials"
          noun="materials"
          figure={
            read.materials.spent === null ? (
              <>
                <b>{read.materials.count}</b> {read.materials.count === 1 ? "thing" : "things"} used
              </>
            ) : read.materials.allowance !== null ? (
              <>
                <b>{fmtAud(read.materials.spent)}</b> of {fmtAud(read.materials.allowance)}
              </>
            ) : (
              <>
                <b>{fmtAud(read.materials.spent)}</b> used
              </>
            )
          }
          word={<StateWord tone={mat.tone}>{mat.word}</StateWord>}
          meter={mat.parts.length ? <Meter parts={mat.parts} label={mat.label} /> : null}
          under={mat.under}
          items={read.materials.items}
        />
        <Line
          name="Equipment"
          noun="equipment"
          figure={
            read.equipment.items.length === 0 ? (
              "No units on the quote"
            ) : read.equipment.total !== null ? (
              <b>{fmtAud(read.equipment.total)}</b>
            ) : (
              <>
                <b>{read.equipment.items.length}</b> on the quote
              </>
            )
          }
          word={read.equipment.items.length ? <StateWord tone="info">As quoted</StateWord> : null}
          items={read.equipment.items}
        />
      </ul>
    </JobSection>
  );
}
