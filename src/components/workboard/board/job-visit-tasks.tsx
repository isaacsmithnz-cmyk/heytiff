"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { attachJobDocument } from "@/app/actions/job-documents";
import { Waiting } from "@/components/ui/orb";
import { uploadFile } from "@/lib/documents/upload-client";
import { sameModel } from "@/lib/workboard/plate-read";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { VISIT_STAGES, type VisitStage } from "@/lib/quotes/buildup";
import {
  MAX_NOTE,
  doneCount,
  placeTasks,
  taskRows,
  visitOfDay,
  visitSlots,
  type JobTask,
  type TaskLine,
  type TaskPhoto,
  type TaskUpdate,
  type VisitSlot,
} from "@/lib/workboard/visit-tasks";

/* INSTALLATION, BY VISIT (Isaac, 2026-10-06, on the mock-up of 2905: "yes
   thats right, build it"). A card a visit — the days worked, today, the
   days booked, then the quote's visits not booked yet — each with its
   tasks: what was done on it, and what's still to do on it. The same tasks
   as one list, by the quote's stages, with All tasks. A task not finished
   carries to the next visit with how far it got and the note
   (visit-tasks.ts works out where each one shows).

   The crew ticks and says how far; a manager makes the list from the quote
   (Tiff), adds to it, moves a task to another visit, or takes one off. */

const ROUTE = "/api/workboard/job-tasks";

type Answer =
  | {
      ok: true;
      tasks: JobTask[];
      updates: TaskUpdate[];
      photos: TaskPhoto[];
      today: string;
      /** days booked since the work order that nobody checked in on */
      booked?: { day: string; crew: string[] }[];
      /** the accepted option's labour in person-hours, its crew and visits */
      quoted?: { hours: number; people: number; visits: number } | null;
      canMake: boolean;
      manage: boolean;
      /** done, with something to say: the plate couldn't be read */
      note?: string | null;
    }
  | { ok: false; reason: string };
type Loaded = Extract<Answer, { ok: true }>;

/** A day on site, as the card already draws it. */
export type VisitDay = { day: string; crew: string[]; crewNode: ReactNode; length: string | null; hours: string | null; onSite: boolean };

const STATE_WORD: Record<VisitSlot["state"], { text: string; tone: string }> = {
  done: { text: "Done", tone: "ok" },
  today: { text: "Today", tone: "info" },
  booked: { text: "Booked", tone: "quiet" },
  planned: { text: "Not booked", tone: "quiet" },
};

/** The answer's tasks, or why they couldn't be had: a call, so a try/catch
    below holds no value block React Compiler 1.0 can't lower. */
const loadedOf = (a: Answer): Loaded | null => (a.ok ? { ...a, photos: a.photos ?? [] } : null);

/** A photo onto the job's documents, as the Documents face files one: out
    here, as a plain function, because React Compiler 1.0 can't lower a
    conditional inside a component's try. */
async function photoOnJob(file: File, job: string): Promise<{ ok: true; documentId: string } | { ok: false; error: string }> {
  try {
    const up = await uploadFile(file, "job_document");
    if (!up.ok) return { ok: false, error: up.error };
    if (up.file.previewUrl) URL.revokeObjectURL(up.file.previewUrl);
    const put = await attachJobDocument(up.file.documentId, job);
    if (!put.ok) return { ok: false, error: put.error };
    return { ok: true, documentId: up.file.documentId };
  } catch {
    return { ok: false, error: "That photo didn't upload. Try again." };
  }
}

/** The time now, for the handlers that ask when the tasks were read —
    never read while rendering. */
const clockMs = () => Date.now();

const ROLE_WORDS: Record<TaskPhoto["role"], string> = { unit: "The unit in place", plate: "The rating plate", other: "A photo" };

/** What a unit task's line says of its photos. */
function photoWords(task: JobTask, photos: readonly TaskPhoto[]): string | null {
  if (task.kind !== "unit") return null;
  const n = photos.filter((p) => p.taskId === task.id).length;
  if (n === 0) return "Unit and plate photos";
  return `${n} photo${n === 1 ? "" : "s"}${task.serial ? ", serial read" : ""}`;
}
const reasonOf = (a: Answer): string | null => (a.ok ? (a.note ?? null) : a.reason);

export function JobVisitTasks({
  job,
  visible,
  onSite,
  ahead,
  workOrderDate,
  onSiteWords,
  onSiteMinutes,
  onBook,
  emptyWords,
}: {
  job: string;
  /** whether the face is open: the tasks are read the first time it is */
  visible: boolean;
  /** days worked, newest or oldest first */
  onSite: readonly VisitDay[];
  /** days booked from today on */
  ahead: readonly VisitDay[];
  /** the work order's day: days on site before it are site visits */
  workOrderDate: string | null;
  /** "44 h on site", when anyone has been */
  onSiteWords: string | null;
  /** person-minutes on site so far, for the hours against the quote */
  onSiteMinutes?: number | null;
  /** opens the job's Book in, where the deployment books; a visit the
      quote planned that isn't booked offers it */
  onBook?: () => void;
  /** what to say when there's nothing at all (no visits, nothing booked, no
      tasks); empty when the face already says something */
  emptyWords: string;
}) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"visit" | "all">("visit");
  const [openId, setOpenId] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const [saving, setSaving] = useState(false);
  const strip = useRef<HTMLOListElement>(null);
  /* when the tasks were read: a photo's link lasts an hour */
  const readAt = useRef(0);

  /* read once, the first time the face is open; no cancel on a tab switch,
     or a read that lands while another face is up would be dropped and
     never asked again */
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!visible || asked.current === job) return;
    asked.current = job;
    fetch(`${ROUTE}?job=${encodeURIComponent(job)}`)
      .then((r) => r.json() as Promise<Answer>)
      .then((a) => {
        readAt.current = clockMs();
        setData(loadedOf(a));
        setError(reasonOf(a));
      })
      .catch(() => {
        asked.current = null;
        setError("The tasks couldn't be read just now.");
      });
  }, [job, visible]);

  const send = async (method: "POST" | "PUT", body: Record<string, unknown>): Promise<boolean> => {
    let a: Answer;
    try {
      const res = await fetch(ROUTE, { method, headers: { "content-type": "application/json" }, body: JSON.stringify({ job, ...body }) });
      a = (await res.json()) as Answer;
    } catch {
      a = { ok: false, reason: "That couldn't be saved. Try again." };
    }
    const next = loadedOf(a);
    if (next) readAt.current = clockMs();
    if (next) setData(next);
    setError(reasonOf(a));
    return !!next;
  };

  /* a task opened, its photos' links read afresh when the last read is
     near the hour they last */
  const openTask = (id: string) => {
    setOpenId(id);
    if (clockMs() - readAt.current < 50 * 60 * 1000) return;
    void fetch(`${ROUTE}?job=${encodeURIComponent(job)}`)
      .then((r) => r.json() as Promise<Answer>)
      .then((a) => {
        const next = loadedOf(a);
        if (next) readAt.current = clockMs();
        if (next) setData(next);
      })
      .catch(() => undefined);
  };

  const make = async () => {
    setMaking(true);
    await send("POST", { make: true });
    setMaking(false);
  };
  const edit = async (e: Record<string, unknown>) => {
    setSaving(true);
    const ok = await send("PUT", { edit: e });
    setSaving(false);
    return ok;
  };

  const today = data?.today ?? null;
  const tasks = data?.tasks ?? [];
  const updates = data?.updates ?? [];
  const photos = data?.photos ?? [];
  const from = workOrderDate ? workOrderDate.slice(0, 10) : null;
  const planned = tasks.reduce((m, t) => Math.max(m, t.visit ?? 0), 0);
  /* until the account's today is read, the booked days are still ahead and
     the cards say no state */
  const firstAhead = ahead.map((v) => v.day.slice(0, 10)).sort()[0] ?? "9999-12-31";
  /* a day booked since the work order that nobody checked in on is still a
     visit: without it every visit after would be numbered one short */
  const checkedIn = new Set(onSite.map((v) => v.day.slice(0, 10)));
  const bookedPast: VisitDay[] = (data?.booked ?? [])
    .filter((b) => !checkedIn.has(b.day))
    .map((b) => ({ day: b.day, crew: b.crew, crewNode: b.crew.length ? b.crew.join(", ") : null, length: null, hours: null, onSite: false }));
  const went = [...onSite, ...bookedPast];
  const slots = visitSlots({ onSite: went, ahead, today: today ?? firstAhead, from, planned });
  const site = onSite.filter((v) => from && v.day.slice(0, 10) < from).sort((a, b) => a.day.localeCompare(b.day));
  const dayOf = new Map([...ahead, ...went].map((v) => [v.day.slice(0, 10), v]));
  const workedDays = checkedIn;
  const placed = placeTasks(tasks, updates, slots);
  const manage = data?.manage ?? false;
  const open = openId ? tasks.find((t) => t.id === openId) ?? null : null;

  /* the strip opens on today's visit, or the next one, or the newest */
  const focusN = (slots.find((s) => s.state === "today") ?? slots.find((s) => s.state === "booked") ?? slots[slots.length - 1])?.n ?? null;
  useLayoutEffect(() => {
    const ol = strip.current;
    if (!ol || view !== "visit" || open) return;
    const card = focusN != null ? ol.querySelector<HTMLElement>(`[data-visit="${focusN}"]`) : null;
    ol.scrollLeft = card ? Math.max(0, card.offsetLeft - ol.offsetLeft - 16) : ol.scrollWidth;
  }, [focusN, view, open]);

  /* nothing to show, and nothing a manager could add */
  const nothing = slots.length === 0 && site.length === 0 && tasks.length === 0 && !data?.canMake && !data?.manage;
  if (nothing) {
    return (
      <>
        {error && <p className="wb2-sherr">{error}</p>}
        {emptyWords && <p className="int-hint">{emptyWords}</p>}
      </>
    );
  }

  const counts = doneCount(tasks);
  const totalWords = [
    /* the days on site so far, as the face has always counted them */
    went.length ? `${went.length} visit${went.length === 1 ? "" : "s"}` : null,
    onSiteWords,
    tasks.length ? `${counts.done} of ${counts.of} tasks done` : null,
  ]
    .filter(Boolean)
    .join(", ");

  if (open && today) {
    return (
      <TaskDetail
        job={job}
        task={open}
        updates={updates.filter((u) => u.taskId === open.id)}
        photos={photos.filter((p) => p.taskId === open.id)}
        slots={slots}
        today={today}
        manage={manage}
        saving={saving}
        error={error}
        onBack={() => setOpenId(null)}
        onEdit={edit}
      />
    );
  }

  return (
    <div className="wb2-jcsec">
      <div className="wb2-jcdhead">
        <b>Visits</b>
        <em>{totalWords}</em>
        {tasks.length > 0 && (
          <div className="wb2-ckseg" role="radiogroup" aria-label="Show the tasks">
            {(["visit", "all"] as const).map((v) => (
              <button key={v} type="button" role="radio" aria-checked={view === v} className={view === v ? "on" : undefined} onClick={() => setView(v)}>
                {v === "visit" ? "By visit" : "All tasks"}
              </button>
            ))}
          </div>
        )}
      </div>

      {data?.quoted && <HoursBar minutes={onSiteMinutes ?? 0} quoted={data.quoted} />}

      {tasks.length === 0 && data?.canMake && (
        <div className="jcl-tmake">
          {making ? (
            <Waiting note="Tiff is writing the tasks from the quote" />
          ) : (
            <button type="button" className="pbtn primary" onClick={() => void make()}>
              Make the tasks from the quote
            </button>
          )}
        </div>
      )}
      {error && <p className="wb2-sherr">{error}</p>}
      {slots.length === 0 && site.length === 0 && tasks.length === 0 && emptyWords && <p className="int-hint">{emptyWords}</p>}

      {view === "visit" ? (
        <>
          {(site.length > 0 || slots.length > 0) && (
            <ol className={"jcl-visits" + (tasks.length ? " tasks" : "")} ref={strip} aria-label="Visits, oldest first">
              {site.map((v) => (
                <li className="jcl-visit" key={`site-${v.day}`}>
                  <span className="jcl-vh">
                    <b>Site visit</b>
                  </span>
                  <span className="jcl-vday">{fmtAuWeekdayDayMonth(v.day.slice(0, 10))}</span>
                  <em>{v.crewNode}</em>
                  {v.length && <span className="jcl-vlen">{v.length}</span>}
                  <span className="jcl-vhrs">{v.hours ?? "—"}</span>
                </li>
              ))}
              {placed.visits.map(({ slot, lines }) => {
                const day = slot.day ? dayOf.get(slot.day) : undefined;
                const word = !today ? null : slot.state === "today" && day?.onSite ? { text: "On site now", tone: "info" } : STATE_WORD[slot.state];
                const worked = !!slot.day && workedDays.has(slot.day);
                return (
                  <li className={"jcl-visit" + (slot.state === "today" ? " now" : "") + (slot.state === "planned" ? " plan" : "")} key={slot.n} data-visit={slot.n}>
                    <span className="jcl-vh">
                      <b>{`Visit ${slot.n}`}</b>
                      {word && <span className={`jcl-vword ${word.tone}`}>{word.text}</span>}
                    </span>
                    <span className="jcl-vday">{slot.day ? fmtAuWeekdayDayMonth(slot.day) : "Not booked yet"}</span>
                    {day?.crewNode && <em>{day.crewNode}</em>}
                    {lines.length > 0 && (
                      <ul className="jcl-tasks">
                        {lines.map((l) => (
                          <TaskItem
                            key={`${slot.n}-${l.task.id}`}
                            line={l}
                            camera={photoWords(l.task, photos)}
                            live={slot.state !== "done" || l.lastDay === today}
                            saving={saving}
                            onOpen={() => openTask(l.task.id)}
                            onTick={(to) => void edit({ kind: "progress", id: l.task.id, to, note: "" })}
                            undoTo={undoTo(l.task, updates)}
                          />
                        ))}
                      </ul>
                    )}
                    {slot.state === "planned" && onBook && (
                      <div className="wb2-jqacts">
                        <button type="button" className="pbtn ghost sm" onClick={onBook}>{`Book visit ${slot.n}`}</button>
                      </div>
                    )}
                    {/* the hours last: a day with nothing believable says no figure */}
                    {day && worked && day.length && <span className="jcl-vlen">{day.length}</span>}
                    {day && worked && <span className="jcl-vhrs">{day.hours ?? "—"}</span>}
                  </li>
                );
              })}
            </ol>
          )}
          {placed.unplaced.length > 0 && (
            <div className="jcl-tloose">
              <div className="jcl-tghead">
                <b>Not on a visit yet</b>
                <em>{`${placed.unplaced.length} task${placed.unplaced.length === 1 ? "" : "s"}`}</em>
              </div>
              <ul className="jcl-tasks cols">
                {placed.unplaced.map((l) => (
                  <TaskItem
                    key={l.task.id}
                    line={l}
                    camera={photoWords(l.task, photos)}
                    live
                    saving={saving}
                    onOpen={() => openTask(l.task.id)}
                    onTick={(to) => void edit({ kind: "progress", id: l.task.id, to, note: "" })}
                    undoTo={undoTo(l.task, updates)}
                  />
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <AllTasks tasks={tasks} updates={updates} slots={slots} manage={manage} saving={saving} onOpen={openTask} onEdit={edit} />
      )}
      {manage && data && tasks.length > 0 && view === "all" && <AddTask slots={slots} saving={saving} onAdd={edit} />}
      {manage && data && tasks.length === 0 && !data.canMake && <AddTask slots={slots} saving={saving} onAdd={edit} />}
    </div>
  );
}

/** "18h 30m", the way the card writes hours on site. */
const hoursWords = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
};

/* THE HOURS AGAINST THE QUOTE (Isaac, 2026-10-03): "17.5 h on site of 32 h
   quoted", green while under, amber up to 15% over, red past that. */
function HoursBar({ minutes, quoted }: { minutes: number; quoted: { hours: number; people: number; visits: number } }) {
  const ratio = quoted.hours > 0 ? minutes / 60 / quoted.hours : 0;
  const tone = ratio <= 1 ? "ok" : ratio <= 1.15 ? "warn" : "bad";
  return (
    <div className="jcl-hbar">
      <p className="jcl-hrs">
        <b>{hoursWords(minutes)}</b>
        <span>{`on site of ${hoursWords(quoted.hours * 60)} quoted`}</span>
        <em>{`${quoted.people} ${quoted.people === 1 ? "person" : "people"}, ${quoted.visits} visit${quoted.visits === 1 ? "" : "s"}`}</em>
      </p>
      <div className="jcl-htrack" role="img" aria-label={`${Math.round(ratio * 100)}% of the hours quoted`}>
        <i className={tone} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
    </div>
  );
}

/** What unticking a task takes it back to: how far it had got before it
    was marked done. */
function undoTo(task: JobTask, updates: readonly TaskUpdate[]): number {
  const last = [...updates].reverse().find((u) => u.taskId === task.id && u.to >= 100);
  return last ? last.from : 0;
}

function TaskBox({ line, live, saving, onOpen, onTick, undoTo }: { line: { task: JobTask; mark: TaskLine["mark"]; pct: number }; live: boolean; saving: boolean; onOpen: () => void; onTick: (to: number) => void; undoTo: number }) {
  const { task, mark, pct } = line;
  /* a task measured in how far it's got opens to say how far; the rest tick */
  const measured = task.kind === "progress" && mark !== "done";
  const label = `${task.name}: ${mark === "done" ? "done" : mark === "part" ? `${pct}%` : "not done"}`;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mark === "done" ? true : mark === "part" ? "mixed" : false}
      aria-label={label}
      className={`jcl-tbox ${mark}`}
      style={mark === "part" ? ({ "--p": `${pct}%` } as React.CSSProperties) : undefined}
      disabled={!live || saving}
      onClick={() => (measured ? onOpen() : onTick(mark === "done" ? undoTo : 100))}
    >
      {mark === "done" && <Icon name="check" size={11} />}
      {mark === "part" && <i aria-hidden="true" />}
    </button>
  );
}

function TaskItem({
  line,
  camera,
  live,
  saving,
  onOpen,
  onTick,
  undoTo,
}: {
  line: TaskLine;
  /** a unit task's photos, said in a few words */
  camera?: string | null;
  live: boolean;
  saving: boolean;
  onOpen: () => void;
  onTick: (to: number) => void;
  undoTo: number;
}) {
  return (
    <li className={`jcl-task ${line.mark}`}>
      <TaskBox line={line} live={live} saving={saving} onOpen={onOpen} onTick={onTick} undoTo={undoTo} />
      <span className="jcl-ttx">
        <button type="button" className="jcl-tname" onClick={onOpen}>
          {line.task.name}
        </button>
        {(line.pctWords || line.meta) && (
          <span className="jcl-tmeta">
            {line.pctWords && <b>{line.pctWords}</b>}
            {line.meta}
          </span>
        )}
        {line.note && (
          <span className="jcl-tnote">
            {line.note.by ? `${line.note.by.split(" ")[0]}: ` : ""}
            <q>{line.note.text}</q>
          </span>
        )}
        {camera && (
          <span className="jcl-tcam">
            <Icon name="cam" size={12} />
            {camera}
          </span>
        )}
      </span>
    </li>
  );
}

function AllTasks({
  tasks,
  updates,
  slots,
  manage,
  saving,
  onOpen,
  onEdit,
}: {
  tasks: readonly JobTask[];
  updates: readonly TaskUpdate[];
  slots: readonly VisitSlot[];
  manage: boolean;
  saving: boolean;
  onOpen: (id: string) => void;
  onEdit: (e: Record<string, unknown>) => Promise<boolean>;
}) {
  const groups = taskRows(tasks, updates, slots, (d) => fmtAuWeekdayDayMonth(d));
  return (
    <div className="jcl-tall">
      {groups.map((g) => (
        <div className="jcl-tgroup" key={g.stage}>
          <div className="jcl-tghead">
            <b>{g.stage}</b>
          </div>
          <ul className="jcl-tasks rows">
            {g.rows.map((r) => (
              <li className={`jcl-task ${r.mark}`} key={r.task.id}>
                <TaskBox
                  line={r}
                  live
                  saving={saving}
                  onOpen={() => onOpen(r.task.id)}
                  onTick={(to) => void onEdit({ kind: "progress", id: r.task.id, to, note: "" })}
                  undoTo={undoTo(r.task, updates)}
                />
                <span className="jcl-ttx">
                  <button type="button" className="jcl-tname" onClick={() => onOpen(r.task.id)}>
                    {r.task.name}
                  </button>
                  {r.note && (
                    <span className="jcl-tnote">
                      {r.note.by ? `${r.note.by.split(" ")[0]}: ` : ""}
                      <q>{r.note.text}</q>
                    </span>
                  )}
                </span>
                <span className="jcl-tvis">
                  {r.visits ??
                    (manage ? (
                      <VisitPick slots={slots} value={null} label={`Add ${r.task.name} to a visit`} disabled={saving} onPick={(visit) => void onEdit({ kind: "visit", id: r.task.id, visit })} />
                    ) : (
                      "Not on a visit"
                    ))}
                </span>
                <span className={`jcl-tstat ${r.status?.tone ?? ""}`}>{r.status?.text ?? ""}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** A visit to put a task on: the visits to come, and the next one after. */
function VisitPick({ slots, value, label, disabled, onPick }: { slots: readonly VisitSlot[]; value: number | null; label: string; disabled: boolean; onPick: (visit: number | null) => void }) {
  /* the visits to come, and the one it's planned for even when that's gone */
  const ahead = slots.filter((s) => s.state !== "done" || s.n === value);
  const next = (slots[slots.length - 1]?.n ?? 0) + 1;
  return (
    <select className="wb2-sel jcl-tsel" aria-label={label} value={value ?? ""} disabled={disabled} onChange={(e) => onPick(e.target.value ? Number(e.target.value) : null)}>
      <option value="">{value == null ? "Add to a visit" : "Not on a visit"}</option>
      {ahead.map((s) => (
        <option key={s.n} value={s.n}>
          {s.day ? `Visit ${s.n}, ${fmtAuWeekdayDayMonth(s.day)}` : `Visit ${s.n}`}
        </option>
      ))}
      {!ahead.some((s) => s.n === next) && <option value={next}>{`Visit ${next}`}</option>}
    </select>
  );
}

function AddTask({ slots, saving, onAdd }: { slots: readonly VisitSlot[]; saving: boolean; onAdd: (e: Record<string, unknown>) => Promise<boolean> }) {
  const [name, setName] = useState("");
  const [stage, setStage] = useState<VisitStage>("Install");
  const [measured, setMeasured] = useState(false);
  const [visit, setVisit] = useState<number | null>(null);
  const add = async () => {
    if (!name.trim()) return;
    const ok = await onAdd({ kind: "add", name: name.trim(), stage, taskKind: measured ? "progress" : "tick", visit });
    if (ok) setName("");
  };
  return (
    <div className="jcl-tadd">
      <input className="wb2-fi" aria-label="A new task" placeholder="A new task" value={name} disabled={saving} onChange={(e) => setName(e.target.value)} />
      <select className="wb2-sel" aria-label="Its stage" value={stage} disabled={saving} onChange={(e) => setStage(e.target.value as VisitStage)}>
        {VISIT_STAGES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <VisitPick slots={slots} value={visit} label="Its visit" disabled={saving} onPick={setVisit} />
      <label className="jcl-tchk">
        <input type="checkbox" checked={measured} disabled={saving} onChange={(e) => setMeasured(e.target.checked)} />
        Measured in %
      </label>
      <button type="button" className="pbtn ghost" disabled={saving || !name.trim()} onClick={() => void add()}>
        Add a task
      </button>
    </div>
  );
}

function TaskDetail({
  job,
  task,
  updates,
  photos,
  slots,
  today,
  manage,
  saving,
  error,
  onBack,
  onEdit,
}: {
  job: string;
  task: JobTask;
  updates: readonly TaskUpdate[];
  photos: readonly TaskPhoto[];
  slots: readonly VisitSlot[];
  today: string;
  manage: boolean;
  saving: boolean;
  error: string | null;
  onBack: () => void;
  onEdit: (e: Record<string, unknown>) => Promise<boolean>;
}) {
  const [pct, setPct] = useState(String(task.progress >= 100 ? 100 : task.progress));
  const [note, setNote] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [name, setName] = useState(task.name);
  const n = Number(pct.trim());
  const valid = pct.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= 100;
  const todayVisit = slots.find((s) => s.day === today)?.n ?? null;
  const save = async (to: number) => {
    const ok = await onEdit({ kind: "progress", id: task.id, to, note: note.trim() });
    if (ok) setNote("");
  };
  const done = task.progress >= 100;
  const history = [...updates].reverse();
  return (
    <div className="wb2-jcsec jcl-tdetail">
      <button type="button" className="jcl-back" onClick={onBack}>
        <Icon name="chevL" size={14} />
        Visits
      </button>
      <div className="wb2-jcdhead">
        {renaming ? (
          <span className="jcl-trename">
            <input className="wb2-fi" aria-label="The task's name" value={name} disabled={saving} onChange={(e) => setName(e.target.value)} />
            <button type="button" className="pbtn ghost sm" disabled={saving} onClick={() => setRenaming(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="pbtn primary sm"
              disabled={saving || !name.trim()}
              onClick={() => void onEdit({ kind: "rename", id: task.id, name: name.trim() }).then((ok) => ok && setRenaming(false))}
            >
              Save
            </button>
          </span>
        ) : (
          <b>{task.name}</b>
        )}
        <em>{`${task.stage}, ${task.source === "quote" ? "from the quote" : "added"}`}</em>
      </div>

      {task.kind === "unit" && <UnitPhotos job={job} task={task} photos={photos} saving={saving} onEdit={onEdit} />}

      {task.kind === "progress" && (
        <div className="jcl-tprog">
          <div className="jcl-hrs">
            <b>{`${task.progress}%`}</b>
            <span>{done ? "Done" : updates.length ? `after ${updates.length === 1 ? "one update" : `${updates.length} updates`}` : "Not started"}</span>
          </div>
          <div className="jcl-tbar">
            <i style={{ width: `${task.progress}%` }} />
          </div>
        </div>
      )}

      <div className="jcl-tupd">
        <span className="jcl-tghead">
          <b>{todayVisit != null ? `Today, visit ${todayVisit}` : "Today"}</b>
        </span>
        <div className="jcl-tform">
          {task.kind === "progress" && (
            <label className="s">
              <span>How far</span>
              <span className="jcl-tpin">
                <input className="wb2-fi" inputMode="numeric" aria-label="How far, percent" value={pct} disabled={saving} onChange={(e) => setPct(e.target.value)} />
                <i>%</i>
              </span>
            </label>
          )}
          <label>
            <span>Note</span>
            <input className="wb2-fi" aria-label="Note" maxLength={MAX_NOTE} value={note} disabled={saving} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
        <div className="wb2-jqacts">
          {done ? (
            <button type="button" className="pbtn ghost" disabled={saving} onClick={() => void save(undoTo(task, updates))}>
              Not done
            </button>
          ) : (
            <button type="button" className={task.kind === "progress" ? "pbtn ghost" : "pbtn primary"} disabled={saving} onClick={() => void save(100)}>
              {task.kind === "progress" ? "Done, 100%" : "Done"}
            </button>
          )}
          {task.kind === "progress" && !done && (
            <button type="button" className="pbtn primary" disabled={saving || !valid || n === 100 || (n === task.progress && !note.trim())} onClick={() => void save(n)}>
              {valid && n !== 100 ? `Save ${n}%` : "Save"}
            </button>
          )}
          {task.kind !== "progress" && !done && note.trim() && (
            <button type="button" className="pbtn ghost" disabled={saving} onClick={() => void save(task.progress)}>
              Save the note
            </button>
          )}
        </div>
        {error && <p className="wb2-sherr">{error}</p>}
      </div>

      {history.length > 0 && (
        <div className="jcl-thist">
          <span className="jcl-tghead">
            <b>So far</b>
          </span>
          <ul>
            {history.map((u) => {
              const v = visitOfDay(slots, u.day);
              return (
                <li key={u.id}>
                  <b>{v != null ? `Visit ${v}` : "Before the visits"}</b>
                  <span>{[fmtAuWeekdayDayMonth(u.day), u.by].filter(Boolean).join(", ")}</span>
                  <strong>{u.to >= 100 && u.from === 0 ? "Done" : u.to >= 100 ? `${u.from}% to done` : u.to === u.from ? "A note" : `${u.from}% to ${u.to}%`}</strong>
                  {u.note && (
                    <p>
                      <q>{u.note}</q>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {manage && (
        <div className="jcl-tmanage">
          <VisitPick slots={slots} value={task.visit} label="Its visit" disabled={saving} onPick={(visit) => void onEdit({ kind: "visit", id: task.id, visit })} />
          {!renaming && (
            <button type="button" className="pbtn ghost sm" disabled={saving} onClick={() => setRenaming(true)}>
              Rename
            </button>
          )}
          {removing ? (
            <>
              <button type="button" className="pbtn ghost sm" disabled={saving} onClick={() => setRemoving(false)}>
                Keep it
              </button>
              <button type="button" className="pbtn ghost sm dan" disabled={saving} onClick={() => void onEdit({ kind: "remove", id: task.id }).then((ok) => ok && onBack())}>
                Take it off for good
              </button>
            </>
          ) : (
            <button type="button" className="pbtn ghost sm dan" disabled={saving} onClick={() => setRemoving(true)}>
              Take it off
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* A UNIT'S PHOTOS (Isaac, 2026-10-06: "snap the photo of that particular
   unit, and serial numbers etc. can be read from there using photos"): the
   unit in place and its rating plate. The plate's model and serial are
   read from its photo, checked against the quote, and go on the
   certificate; a person can change what was read. */
function UnitPhotos({
  job,
  task,
  photos,
  saving,
  onEdit,
}: {
  job: string;
  task: JobTask;
  photos: readonly TaskPhoto[];
  saving: boolean;
  onEdit: (e: Record<string, unknown>) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState<TaskPhoto["role"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [model, setModel] = useState(task.modelRead ?? "");
  const [serial, setSerial] = useState(task.serial ?? "");
  const take = async (file: File | undefined, role: TaskPhoto["role"]) => {
    if (!file) return;
    setBusy(role);
    setError(null);
    const up = await photoOnJob(file, job);
    if (up.ok) await onEdit({ kind: "photo", id: task.id, documentId: up.documentId, role });
    else setError(up.error);
    setBusy(null);
  };
  const read = !!(task.modelRead || task.serial);
  const quoted = task.unit?.model ?? "";
  return (
    <div className="jcl-tunit">
      <div className="jcl-tshots">
        {photos.map((p) => (
          <figure key={p.id}>
            {p.url ? (
              <a href={p.url} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- a signed link to our own bucket */}
                <img src={p.url} alt={ROLE_WORDS[p.role]} />
              </a>
            ) : (
              <span className="jcl-tshot-gone">No longer here</span>
            )}
            <figcaption>{ROLE_WORDS[p.role]}</figcaption>
          </figure>
        ))}
      </div>
      <div className="wb2-jqacts">
        {busy ? (
          <Waiting note={busy === "plate" ? "Reading the plate" : "Adding the photo"} />
        ) : (
          (["unit", "plate"] as const).map((role) => (
            <label key={role} className={`pbtn ${role === "plate" && !photos.some((p) => p.role === "plate") ? "primary" : "ghost"} sm jcl-tfile`}>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                className="sr-only"
                disabled={saving}
                onChange={(e) => {
                  void take(e.target.files?.[0], role);
                  e.target.value = "";
                }}
              />
              {role === "unit" ? "Photo of the unit" : "Photo of the plate"}
            </label>
          ))
        )}
      </div>
      {error && <p className="wb2-sherr">{error}</p>}
      {(read || changing) && (
        <div className="jcl-tread">
          <span className="jcl-tghead">
            <b>Read from the plate photo</b>
          </span>
          {changing ? (
            <>
              <div className="jcl-tform">
                <label>
                  <span>Model</span>
                  <input className="wb2-fi" aria-label="Model" value={model} disabled={saving} onChange={(e) => setModel(e.target.value)} />
                </label>
                <label>
                  <span>Serial</span>
                  <input className="wb2-fi" aria-label="Serial" value={serial} disabled={saving} onChange={(e) => setSerial(e.target.value)} />
                </label>
              </div>
              <div className="wb2-jqacts">
                <button type="button" className="pbtn ghost" disabled={saving} onClick={() => setChanging(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="pbtn primary"
                  disabled={saving}
                  onClick={() => void onEdit({ kind: "plate", id: task.id, model, serial }).then((ok) => ok && setChanging(false))}
                >
                  Save
                </button>
              </div>
            </>
          ) : (
            <>
              <dl className="jcl-tkv">
                <dt>Model</dt>
                <dd>
                  <b>{task.modelRead || "Not read"}</b>
                  {task.modelRead && quoted && (
                    <em className={sameModel(task.modelRead, quoted) ? "ok" : "warn"}>{sameModel(task.modelRead, quoted) ? "Matches the quote" : `The quote says ${quoted}`}</em>
                  )}
                </dd>
                <dt>Serial</dt>
                <dd>
                  <b>{task.serial || "Not read"}</b>
                </dd>
              </dl>
              <div className="wb2-jqacts">
                <button
                  type="button"
                  className="pbtn ghost sm"
                  disabled={saving}
                  onClick={() => {
                    setModel(task.modelRead ?? "");
                    setSerial(task.serial ?? "");
                    setChanging(true);
                  }}
                >
                  Change what was read
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {!read && !changing && (
        <button type="button" className="pbtn ghost sm" disabled={saving} onClick={() => setChanging(true)}>
          Type the model and serial
        </button>
      )}
    </div>
  );
}
