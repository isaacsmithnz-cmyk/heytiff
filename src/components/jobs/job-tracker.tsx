"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
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
  type TrackerLook,
  type TrackerRead,
} from "@/lib/jobs/job-tracker";
import { fmtAud } from "@/lib/workboard/project-money";
import { JobSection } from "./job-section";

/* THE JOB TRACKER (Isaac, 3 and 4 November 2026: "a bar line per section";
   "show the simple lines first and then you can drop them down"; rows A on
   https://claude.ai/artifact/YGZXZsQMdaJTQEckLEJ5to, checked against the
   laws on https://claude.ai/artifact/8L3hw5D8QxHZidsAAQNcX6, "build it").
   Three against the quote, each a ring of what's used against what was
   quoted, side by side (the Billing mock, 16 November 2026, yes to it):

     Labour     hours worked of the quote's hours; overtime's extra paid
                hours follow on the bar in orange, and only what passes
                the quote is red (design.md, "On a job's page")
     Materials  what was used, priced from the price book, of the quote's
                materials
     Equipment  the quote's units, as quoted

   Each one's Show opens its rows under the three: the days, the things
   used, the units.

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

/** A ring of what's used against what was quoted (the Billing mock, 16
    November 2026): green used, orange overtime's extra paid hours, red
    only past the quote; the share in the middle. `whole` is the quote's
    own units, drawn full in ink. */
function Ring({ parts, pct, sub, label, whole = false }: { parts: TrackerLook["parts"]; pct: string; sub?: string; label: string; whole?: boolean }) {
  const R = 44;
  const C = 2 * Math.PI * R;
  let at = 0;
  const arcs = whole
    ? [<circle key="whole" className="jtr-arc jtr-whole" cx="50" cy="50" r={R} />]
    : parts
        .filter((p) => p.share > 0)
        .map((p) => {
          const len = Math.min(1, p.share) * C;
          const arc = (
            <circle
              key={p.kind}
              className={`jtr-arc jtr-${p.kind}`}
              cx="50"
              cy="50"
              r={R}
              strokeDasharray={`${len} ${C}`}
              strokeDashoffset={-at}
              transform="rotate(-90 50 50)"
            />
          );
          at += len;
          return arc;
        });
  return (
    <span className="jtr-ring" role="img" aria-label={label}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="jtr-track" cx="50" cy="50" r={R} />
        {arcs}
      </svg>
      <span className="jtr-pct" aria-hidden="true">
        <b>{pct}</b>
        {sub && <span>{sub}</span>}
      </span>
    </span>
  );
}

function Rows({ items, label }: { items: TrackerItem[]; label: string }) {
  return (
    <ul className="jov-rows jtr-rows" aria-label={label}>
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

/** One of the three: its ring, then its name, figure, overtime and word. */
function Tile({
  name,
  ring,
  figure,
  under,
  word,
  action,
  by,
}: {
  name: string;
  ring: ReactNode;
  figure: ReactNode;
  under?: string | null;
  word?: ReactNode;
  /** Show its rows, or Add hours where the quote doesn't say */
  action?: ReactNode;
  /** who planned it, with Change */
  by?: ReactNode;
}) {
  return (
    <li className="jtr-line">
      {ring}
      <div className="jtr-words">
        <b className="jtr-name">{name}</b>
        <span className="jtr-fig">{figure}</span>
        {under && <span className="jtr-under">{under}</span>}
        {word}
        {by}
        {action}
      </div>
    </li>
  );
}

const pctOf = (used: number, of: number | null) => (of !== null && of > 0 ? `${Math.round((used / of) * 100)}%` : "—");

export function JobTracker({ read, jobId, onRead }: { read: TrackerRead | null; jobId?: string; onRead?: (r: TrackerRead) => void }) {
  const [editing, setEditing] = useState<"hours" | "amount" | null>(null);
  const [open, setOpen] = useState<"labour" | "materials" | "equipment" | null>(null);
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
  const days = read.labour.days.map((d) => ({
    name: d.day,
    detail: [d.who, d.paidAs !== null ? `Paid as ${fmtHours(d.paidAs)}` : null].filter(Boolean).join(". ") || null,
    amount: fmtHours(d.hours),
  }));
  const units = read.equipment.items;
  /* Show opens a line's rows under the three, the width of the card */
  const show = (key: "labour" | "materials" | "equipment", noun: string, items: TrackerItem[]) =>
    items.length > 0 ? (
      <Button kind="quiet" size={32} className="jtr-show" aria-expanded={open === key} onClick={() => setOpen((o) => (o === key ? null : key))}>
        {open === key ? `Hide ${noun}` : `Show ${noun}`}
      </Button>
    ) : undefined;
  const add = (words: string, what: "hours" | "amount") => (
    <Button kind="quiet" size={32} className="jtr-show" onClick={() => setEditing(what)}>
      {words}
    </Button>
  );
  const quoted = read.labour.quotedHours;
  const allowance = read.materials.spent !== null ? read.materials.allowance : null;
  return (
    <JobSection name="Job tracker" icon="gauge" hue="purple">
      <ul className="jtr">
        <Tile
          name="Labour"
          ring={
            <Ring
              parts={lab.parts}
              pct={pctOf(read.labour.workedHours, quoted)}
              sub={quoted !== null && quoted > 0 ? "used" : undefined}
              label={lab.label}
            />
          }
          figure={
            quoted !== null ? (
              <>
                <b>{fmtHours(read.labour.workedHours)}</b> of {fmtHours(quoted)}
              </>
            ) : (
              <>
                <b>{fmtHours(read.labour.workedHours)}</b> worked
              </>
            )
          }
          under={lab.under}
          word={<StateWord tone={lab.tone}>{lab.word}</StateWord>}
          by={
            hoursPlan && canEdit && editing !== "hours" ? (
              <PlannedBy words={`Planned${hoursPlan.by ? ` by ${hoursPlan.by}` : ""}: ${planWords(hoursPlan.visits)}.`} onChange={() => setEditing("hours")} />
            ) : null
          }
          action={addHours ? add("Add hours", "hours") : show("labour", "days", days)}
        />
        <Tile
          name="Materials"
          ring={
            <Ring
              parts={mat.parts}
              pct={pctOf(read.materials.spent ?? 0, allowance)}
              sub={allowance !== null && allowance > 0 ? "used" : undefined}
              label={mat.label}
            />
          }
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
          under={mat.under}
          word={<StateWord tone={mat.tone}>{mat.word}</StateWord>}
          by={
            read.materials.plan && canEdit && editing !== "amount" ? (
              <PlannedBy words={`Added${read.materials.plan.by ? ` by ${read.materials.plan.by}` : ""}, at cost.`} onChange={() => setEditing("amount")} />
            ) : null
          }
          action={addAmount ? add("Add amount", "amount") : show("materials", "materials", read.materials.items)}
        />
        <Tile
          name="Equipment"
          ring={
            <Ring
              parts={[]}
              whole={units.length > 0}
              pct={units.length > 0 ? "100%" : "—"}
              sub={units.length > 0 ? "as quoted" : undefined}
              label={units.length > 0 ? `Equipment: ${units.length} on the quote, as quoted` : "Equipment: no units on the quote"}
            />
          }
          figure={
            units.length === 0 ? (
              "No units on the quote"
            ) : read.equipment.total !== null ? (
              <>
                <b>{fmtAud(read.equipment.total)}</b> as quoted
              </>
            ) : (
              <>
                <b>{units.length}</b> on the quote
              </>
            )
          }
          action={show("equipment", "equipment", units)}
        />
      </ul>
      {editing === "hours" && <HoursForm read={read.labour} save={save} onDone={() => setEditing(null)} />}
      {editing === "amount" && (
        <AmountForm cents={read.materials.plan ? read.materials.allowance : null} save={save} onDone={() => setEditing(null)} />
      )}
      {open === "labour" && <Rows items={days} label="Days" />}
      {open === "materials" && <Rows items={read.materials.items} label="Materials" />}
      {open === "equipment" && <Rows items={units} label="Equipment" />}
    </JobSection>
  );
}

/** THE JOB TRACKER ON BILLING (Isaac, 13 November 2026: "Job tracker ->
    Billing"), under the payments, with its own read, a route of its own
    (the card's server actions run one at a time). Billing is money's, so
    only whoever sees money reaches it. Nothing when the job has none. */
export function JobTrackerOnBilling({ jobId }: { jobId: string }) {
  const [tracker, setTracker] = useState<TrackerRead | null | "none">(null);
  useEffect(() => {
    let live = true;
    void fetch(`/api/workboard/job-tracker?job=${encodeURIComponent(jobId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { ok?: boolean; tracker?: TrackerRead } | null) => {
        if (live) setTracker(j?.ok && j.tracker ? j.tracker : "none");
      })
      .catch(() => {
        if (live) setTracker("none");
      });
    return () => {
      live = false;
    };
  }, [jobId]);
  if (tracker === "none") return null;
  return (
    <div className="jbl-tracker">
      <JobTracker read={tracker} jobId={jobId} onRead={setTracker} />
    </div>
  );
}
