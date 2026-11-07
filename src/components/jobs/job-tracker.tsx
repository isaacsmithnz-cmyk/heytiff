"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/parts/button";
import { TextInput } from "@/components/parts/field";
import { StateWord } from "@/components/parts/state";
import {
  cleanVisits,
  fmtHours,
  planHours,
  planWords,
  PLAN_MAX_VISITS,
  trackerLabour,
  trackerMaterials,
  type TrackerItem,
  type TrackerRead,
} from "@/lib/jobs/job-tracker";
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

   Each line's Show opens its rows: the days, the things used, the units.

   WHERE THE QUOTE DOESN'T SAY (Isaac, 5 November 2026, on the mock
   https://claude.ai/artifact/Gbw8CZCxNYBJSDEHTaAyv9, "Yes, build it"):
   Labour says "Hours not quoted" and offers Add hours, which opens in the
   line: visit by visit, people and days, at the working day. Saved, it is
   judged like a quoted job and says who planned it, with Change. Materials
   says "Not quoted" and offers Add amount, the same way, for whoever sees
   costs. A quote's own hours or materials always stand, with no Add. */

type Save = (change: Record<string, unknown>) => Promise<string | null>;

const SAVE_FAILED = "That didn't save. Try again.";

/** The plan to the route; null when it couldn't be reached. */
function postPlan(jobId: string, change: Record<string, unknown>): Promise<{ ok?: boolean; reason?: string; tracker?: TrackerRead } | null> {
  return fetch("/api/workboard/job-tracker", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ job: jobId, ...change }),
  })
    .then((r) => r.json())
    .catch(() => null);
}

/** The line's own "who added it", with Change. */
function PlannedBy({ words, onChange }: { words: string; onChange: () => void }) {
  return (
    <span className="jtr-by">
      {words}
      <Button kind="quiet" size={32} className="jtr-change" onClick={onChange}>
        Change
      </Button>
    </span>
  );
}

type Row = { people: string; days: string };

/** Add hours: visit by visit, people and days, at the working day. */
function HoursForm({ read, save, onDone }: { read: TrackerRead["labour"]; save: Save; onDone: () => void }) {
  const [rows, setRows] = useState<Row[]>(() =>
    read.plan?.visits.length ? read.plan.visits.map((v) => ({ people: String(v.people), days: String(v.days) })) : [{ people: "", days: "" }],
  );
  const known = read.plan?.dayHours ?? read.dayHours ?? null;
  const [dayTyped, setDayTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState<string | null>(null);
  const day = known ?? (Number(dayTyped) > 0 ? Number(dayTyped) : null);
  /* a row with nothing in it is dropped; one half filled is wrong */
  const filled = rows.filter((r) => r.people.trim() || r.days.trim());
  const visits = cleanVisits(filled.map((r) => ({ people: Number(r.people), days: Number(r.days) })));
  const total = visits && day ? planHours(visits, day) : null;
  const set = (i: number, k: keyof Row, v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!visits) return setWrong("Each visit needs its people and its days.");
    if (visits.length && !day) return setWrong("Say how many hours are in a working day.");
    setBusy(true);
    const why = await save({ visits, ...(known ? {} : { dayHours: day }) });
    setBusy(false);
    if (why) setWrong(why);
    else onDone();
  };

  return (
    <form className="jtr-plan" onSubmit={submit} aria-label="How it was priced">
      <span className="jov-cap">How it was priced</span>
      {rows.map((r, i) => {
        const v = cleanVisits([{ people: Number(r.people), days: Number(r.days) }]);
        return (
          <div className="jtr-visit" key={i}>
            <b>Visit {i + 1}</b>
            <TextInput size={32} className="jtr-num" inputMode="numeric" aria-label={`Visit ${i + 1}, people`} value={r.people} onChange={(e) => set(i, "people", e.target.value)} />
            <span>people</span>
            <TextInput size={32} className="jtr-num" inputMode="decimal" aria-label={`Visit ${i + 1}, days`} value={r.days} onChange={(e) => set(i, "days", e.target.value)} />
            <span>days</span>
            <span className="jtr-vh">{v && day ? fmtHours(planHours(v, day)) : ""}</span>
          </div>
        );
      })}
      {rows.length < PLAN_MAX_VISITS && (
        <Button kind="quiet" size={32} className="jtr-addvisit" onClick={() => setRows((rs) => [...rs, { people: "", days: "" }])}>
          Add visit
        </Button>
      )}
      {known === null && (
        <div className="jtr-visit">
          <b>Day</b>
          <TextInput size={32} className="jtr-num" inputMode="decimal" aria-label="Hours in a working day" value={dayTyped} onChange={(e) => setDayTyped(e.target.value)} />
          <span>hours</span>
        </div>
      )}
      {wrong && <p className="jtr-wrong" role="alert">{wrong}</p>}
      <div className="jtr-tot">
        <span>{total !== null && day ? <><b>{fmtHours(total)}</b> at a {fmtHours(day)} day</> : null}</span>
        <span className="jtr-acts">
          <Button kind="quiet" size={32} onClick={onDone} disabled={busy}>
            Cancel
          </Button>
          <Button kind="main" size={32} type="submit" disabled={busy}>
            Save
          </Button>
        </span>
      </div>
    </form>
  );
}

/** Add amount: the materials as priced, in dollars at cost. */
function AmountForm({ cents, save, onDone }: { cents: number | null; save: Save; onDone: () => void }) {
  const [text, setText] = useState(cents ? String(cents / 100) : "");
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const clean = text.replace(/[$,\s]/g, "");
    const dollars = clean === "" ? 0 : Number(clean);
    if (!Number.isFinite(dollars) || dollars < 0) return setWrong("Type the materials in dollars.");
    setBusy(true);
    const why = await save({ materialsCents: dollars ? Math.round(dollars * 100) : null });
    setBusy(false);
    if (why) setWrong(why);
    else onDone();
  };
  return (
    <form className="jtr-plan" onSubmit={submit} aria-label="Materials as priced">
      <div className="jtr-visit">
        <b>At cost</b>
        <span>$</span>
        <TextInput size={32} className="jtr-money" inputMode="decimal" aria-label="Materials as priced, at cost" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      {wrong && <p className="jtr-wrong" role="alert">{wrong}</p>}
      <div className="jtr-tot">
        <span />
        <span className="jtr-acts">
          <Button kind="quiet" size={32} onClick={onDone} disabled={busy}>
            Cancel
          </Button>
          <Button kind="main" size={32} type="submit" disabled={busy}>
            Save
          </Button>
        </span>
      </div>
    </form>
  );
}

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
  action,
  extra,
}: {
  name: string;
  /** What Show opens: days, materials, equipment (rule 49). */
  noun: string;
  figure: ReactNode;
  word: ReactNode;
  meter?: ReactNode;
  under?: string | null;
  items: TrackerItem[];
  /** the line's own button where it has one in place of Show (Add hours) */
  action?: ReactNode;
  /** under the bar: who planned it, or the form adding it */
  extra?: ReactNode;
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
        {action ??
          (items.length > 0 && (
            <Button kind="quiet" size={32} className="jtr-show" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              {open ? `Hide ${noun}` : `Show ${noun}`}
            </Button>
          ))}
      </div>
      {(meter || under) && (
        <div className="jtr-bar">
          {meter}
          {under && <span className="jtr-under">{under}</span>}
        </div>
      )}
      {extra}
      {open && <Rows items={items} />}
    </li>
  );
}

export function JobTracker({ read, jobId, onRead }: { read: TrackerRead | null; jobId?: string; onRead?: (r: TrackerRead) => void }) {
  const [editing, setEditing] = useState<"hours" | "amount" | null>(null);
  if (!read) {
    return (
      <JobSection name="Job tracker" icon="gauge" hue="purple">
        <p className="jov-none">Reading the job</p>
      </JobSection>
    );
  }
  const lab = trackerLabour(read.labour);
  const mat = trackerMaterials(read.materials);
  const save: Save = async (change) => {
    if (!jobId) return SAVE_FAILED;
    const j = await postPlan(jobId, change);
    if (!j?.ok || !j.tracker) return j?.reason ?? SAVE_FAILED;
    onRead?.(j.tracker);
    return null;
  };
  const canEdit = !!jobId && !!onRead;
  const hoursPlan = read.labour.plan ?? null;
  const addHours = canEdit && read.labour.canPlan && !hoursPlan && editing !== "hours";
  const addAmount = canEdit && read.materials.canPlan && !read.materials.plan && editing !== "amount";
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
          action={
            addHours ? (
              <Button kind="quiet" size={32} className="jtr-show" onClick={() => setEditing("hours")}>
                Add hours
              </Button>
            ) : undefined
          }
          extra={
            editing === "hours" ? (
              <HoursForm read={read.labour} save={save} onDone={() => setEditing(null)} />
            ) : hoursPlan && canEdit ? (
              <PlannedBy words={`Planned${hoursPlan.by ? ` by ${hoursPlan.by}` : ""}: ${planWords(hoursPlan.visits)}.`} onChange={() => setEditing("hours")} />
            ) : null
          }
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
          action={
            addAmount ? (
              <Button kind="quiet" size={32} className="jtr-show" onClick={() => setEditing("amount")}>
                Add amount
              </Button>
            ) : undefined
          }
          extra={
            editing === "amount" ? (
              <AmountForm cents={read.materials.plan ? read.materials.allowance : null} save={save} onDone={() => setEditing(null)} />
            ) : read.materials.plan && canEdit ? (
              <PlannedBy words={`Added${read.materials.plan.by ? ` by ${read.materials.plan.by}` : ""}, at cost.`} onChange={() => setEditing("amount")} />
            ) : null
          }
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
