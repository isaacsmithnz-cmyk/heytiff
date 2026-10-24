"use client";

import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Icon } from "@/components/shell/icon";
import { Button, buttonClass } from "@/components/parts/button";
import { Dialog } from "@/components/parts/dialog";
import { Field, TextArea, TextInput } from "@/components/parts/field";
import { Initials } from "@/components/parts/initials";
import { Menu, type MenuItem } from "@/components/parts/menu";
import { Row, RowList } from "@/components/parts/row";
import { StateWord } from "@/components/parts/state";
import { Tick } from "@/components/parts/tick";
import { fmtAuTime, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { fileOnJob } from "@/lib/documents/file-on-job";
import { VISIT_STAGES, type VisitStage } from "@/lib/quotes/buildup";
import { fmtMinutesAsHours } from "@/lib/workboard/all-jobs";
import { placeTasks, visitSlots, type JobTask, type TaskLine, type TaskPhoto, type TaskUpdate } from "@/lib/workboard/visit-tasks";
import { dateBlock, rangeWords } from "@/lib/workboard/visit-words";

/* A JOB'S VISITS (Isaac's mock of 25 October 2026, frames 1 to 4: "now I
   think we're ready to build").

   On the left, Coming up: each visit a card drawn as the Schedule draws a
   booking, the date in a block, the time with a clock, the people as
   initials only ("It's double handling" to write their names beside), and
   on the right what its tasks come to. Today's card wears an ink outline
   and says Today. The visit that is today, or else the next one, shows its
   tasks under it, where the crew ticks one done, says how far it got
   (Started, 25, 50 or 75%) or says what's wrong with it (Issue). Then
   Previous: the last six days on site, two to a row, and Show all for the
   rest.

   On the right, Tasks to plan: the job's tasks not on a day yet, under
   their stage. A manager ticks a stage, or a few tasks, and adds them to a
   day at once, or drags one onto a visit; the field at the foot adds one.
   A task on a day shows under that visit, so no task carries a date.

   A visit pressed opens what it is (VisitDialog), drawn by the job's page,
   which holds the booking's doors. visit-tasks.ts works out where each
   task shows; the route writes. */

const ROUTE = "/api/workboard/job-tasks";

type Answer =
  | {
      ok: true;
      tasks: JobTask[];
      updates: TaskUpdate[];
      photos: TaskPhoto[];
      today: string;
      booked: { day: string; crew: string[] }[];
      quoted: { hours: number; people: number; visits: number } | null;
      dayHours?: number | null;
      canMake: boolean;
      manage: boolean;
      /** done, with something to say */
      note: string | null;
    }
  | { ok: false; reason: string };
type Loaded = Extract<Answer, { ok: true }>;

/** A visit booked from today on: everyone at the same start and end. */
export type ComingVisit = { key: string; start: string; end: string | null; crew: { name: string; title: string | null }[] };
/** A day somebody was on site: who went, and the minutes they recorded. */
export type PastVisit = { day: string; crew: string[]; minutes: number };

/** How many days on site Previous shows before Show all. */
const PREVIOUS_SHOWN = 6;
/** What Add a task makes a task's stage: the work itself. */
const ADD_STAGE: VisitStage = "Install";
/** the task a drag carries */
const DRAG = "application/x-heytiff-task";
const STARTED = [25, 50, 75] as const;

const readTasks = (job: string) => fetch(`${ROUTE}?job=${encodeURIComponent(job)}`).then((r) => r.json() as Promise<Answer>);
const reasonOf = (a: Answer): string | null => (a.ok ? a.note : a.reason);
/** a task's hours as the quote gave them: "3 h", "2.5 h" */
const hWords = (h: number) => `${Math.round(h * 100) / 100} h`;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** "9:40am", on the account's clock. */
const timeOf = (at: string | null | undefined, zone: string | null) => (at ? fmtAuTime(new Date(at), zone).replace(/\s/g, "") : "");

/** What unticking a task takes it back to: how far it had got before it
    was marked done. */
function undoTo(task: JobTask, updates: readonly TaskUpdate[]): number {
  const last = [...updates].reverse().find((u) => u.taskId === task.id && u.to >= 100);
  return last ? last.from : 0;
}

export function JobVisits({
  job,
  visible,
  client,
  zone,
  coming,
  previous,
  workOrderDate,
  pressed,
  onBook,
  onOpen,
  askAdd = 0,
}: {
  job: string;
  /** whether the section is open: the tasks are read the first time it is */
  visible: boolean;
  /** the job's client, for an issue's line */
  client: string;
  /** the account's zone, for the time a task was done */
  zone: string | null;
  /** booked from today on, in start order */
  coming: readonly ComingVisit[];
  /** days on site, newest first */
  previous: readonly PastVisit[];
  /** the work order's day: days on site before it are a site measure */
  workOrderDate: string | null;
  /** presses on their way to ServiceM8 that aren't a visit on the list yet */
  pressed?: ReactNode;
  /** opens Book a visit, where the deployment books */
  onBook?: () => void;
  /** a visit pressed */
  onOpen: (key: string) => void;
  /** bumped by the page's Add › Task: the Add a task field takes the keys */
  askAdd?: number;
}) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [making, setMaking] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [dragging, setDragging] = useState(false);
  const [all, setAll] = useState(false);
  const [issueOf, setIssueOf] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [dayMenu, setDayMenu] = useState(false);
  const dayBtn = useRef<HTMLButtonElement>(null);
  const addBox = useRef<HTMLInputElement>(null);
  const planId = useId();

  const land = (a: Answer) => {
    if (!a.ok) return false;
    setData(a);
    return true;
  };

  /* read once, the first time the section is open; no cancel on a tab
     switch, or a read that lands while another section is up would be
     dropped and never asked again */
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!visible || asked.current === job) return;
    asked.current = job;
    readTasks(job)
      .then((a) => {
        land(a);
        setError(reasonOf(a));
      })
      .catch(() => {
        asked.current = null;
        setError("The tasks couldn't be read just now.");
      });
  }, [job, visible]);

  /* the page's Add › Task: the field takes the keys, here or as it arrives */
  useEffect(() => {
    if (askAdd > 0) addBox.current?.focus();
  }, [askAdd, data]);

  const send = async (method: "POST" | "PUT", body: Record<string, unknown>): Promise<boolean> => {
    let a: Answer;
    try {
      const res = await fetch(ROUTE, { method, headers: { "content-type": "application/json" }, body: JSON.stringify({ job, ...body }) });
      a = (await res.json()) as Answer;
    } catch {
      a = { ok: false, reason: "That couldn't be saved. Try again." };
    }
    setError(reasonOf(a));
    return land(a);
  };
  const edit = async (e: Record<string, unknown>) => {
    setSaving(true);
    const ok = await send("PUT", { edit: e });
    setSaving(false);
    return ok;
  };
  const make = async () => {
    setMaking(true);
    await send("POST", { make: true });
    setMaking(false);
  };

  const today = data?.today ?? null;
  const tasks = data?.tasks ?? [];
  const updates = data?.updates ?? [];
  const manage = data?.manage ?? false;
  const from = workOrderDate ? workOrderDate.slice(0, 10) : null;

  /* THE VISITS, NUMBERED as the tasks are planned on them: the days on
     site, the days booked since the work order that nobody checked in on,
     and the days booked from today on */
  const comingDay = (v: ComingVisit) => v.start.slice(0, 10);
  const worked = new Set(previous.map((v) => v.day.slice(0, 10)));
  const days = [
    ...worked,
    ...(data?.booked ?? []).map((b) => b.day).filter((d) => !worked.has(d)),
    ...coming.map(comingDay),
  ];
  const firstAhead = coming.map(comingDay).sort()[0] ?? "9999-12-31";
  const slots = visitSlots({
    days,
    today: today ?? firstAhead,
    from,
    planned: Math.max(tasks.reduce((m, t) => Math.max(m, t.visit ?? 0), 0), data?.quoted?.visits ?? 0),
  });
  const placed = placeTasks(tasks, updates, slots);
  const slotOn = (day: string) => slots.find((s) => s.day === day) ?? null;
  const linesOn = (day: string) => placed.visits.find((v) => v.slot.day === day)?.lines ?? [];
  /* not on a day: on no visit, or on one the quote planned that isn't booked */
  const toPlan = [...placed.unplaced, ...placed.visits.filter((v) => !v.slot.day).flatMap((v) => v.lines)].filter((l) => l.task.progress < 100);
  const planIds = new Set(toPlan.map((l) => l.task.id));
  const ticked = [...picked].filter((id) => planIds.has(id));

  /* the visit that is today, or the next one: its tasks show under it */
  const onTheDay = data ? (coming.find((v) => comingDay(v) === today) ?? coming[0] ?? null) : null;
  /* a day's tasks are said once, on its first visit */
  const firstOfDay = new Map<string, string>();
  for (const v of coming) if (!firstOfDay.has(comingDay(v))) firstOfDay.set(comingDay(v), v.key);
  const wordOf = (v: ComingVisit): string | null => {
    if (firstOfDay.get(comingDay(v)) !== v.key) return null;
    const lines = linesOn(comingDay(v));
    if (lines.length === 0) return null;
    const done = lines.filter((l) => l.mark === "done").length;
    return done > 0 ? `${done} of ${lines.length} done` : plural(lines.length, "task");
  };

  /* PLANNING: tasks onto a day, or back off it */
  const place = async (ids: readonly string[], visit: number | null) => {
    if (ids.length === 0) return;
    if (await edit({ kind: "place", ids, visit })) setPicked(new Set());
  };
  const carry = (id: string) => (e: DragEvent<HTMLElement>) => {
    e.dataTransfer.setData(DRAG, id);
    e.dataTransfer.effectAllowed = "move";
    setDragging(true);
  };
  /** a drag carries the task, or every ticked task when it is one of them */
  const carried = (id: string) => (ticked.includes(id) ? ticked : [id]);
  const landOn = (day: string | null) =>
    manage
      ? {
          onDragOver: (e: DragEvent<HTMLElement>) => {
            if (e.dataTransfer.types.includes(DRAG)) e.preventDefault();
          },
          onDrop: (e: DragEvent<HTMLElement>) => {
            const id = e.dataTransfer.getData(DRAG);
            setDragging(false);
            if (!id) return;
            e.preventDefault();
            const n = day ? slotOn(day)?.n : null;
            if (day && n == null) return;
            void place(carried(id), n ?? null);
          },
        }
      : {};
  const toggle = (ids: readonly string[], on: boolean) =>
    setPicked((cur) => {
      const next = new Set(cur);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const add = async () => {
    const n = name.trim();
    if (!n || saving) return;
    if (await edit({ kind: "add", name: n, stage: ADD_STAGE, taskKind: "tick", visit: null })) setName("");
  };

  /* the days a ticked task can go on: each day booked, once */
  const dayItems: MenuItem[] = [...firstOfDay.keys()].filter((d) => slotOn(d)).map((d) => ({ key: d, label: fmtAuWeekdayDayMonth(d) }));
  const stages = VISIT_STAGES.filter((st) => toPlan.some((l) => l.task.stage === st));
  const issueTask = issueOf ? (tasks.find((t) => t.id === issueOf) ?? null) : null;
  const shownPrevious = all ? previous : previous.slice(0, PREVIOUS_SHOWN);

  return (
    <div className="jv">
      <div className="jv-main">
        <div className="jv-head">
          <h3>Coming up</h3>
          {onBook && (
            <Button kind="main" onClick={onBook}>
              Book a visit
            </Button>
          )}
        </div>
        {error && (
          <p className="jv-wrong">
            <StateWord tone="wrong">{error}</StateWord>
          </p>
        )}
        {pressed}
        {coming.length > 0 ? (
          <ul className="jv-cards">
            {coming.map((v) => {
              const day = comingDay(v);
              const lines = onTheDay?.key === v.key ? linesOn(day) : [];
              const block = dateBlock(day);
              const word = data ? wordOf(v) : null;
              return (
                <li key={v.key}>
                  <button
                    type="button"
                    className={"jv-card" + (today === day ? " today" : "") + (dragging && manage ? " drop" : "")}
                    onClick={() => onOpen(v.key)}
                    {...landOn(day)}
                  >
                    <span className="jv-date">
                      <span>{block.weekday}</span>
                      <b>{block.date}</b>
                      <span>{block.month}</span>
                    </span>
                    <span className="jv-body">
                      <span className="jv-time">
                        <Icon name="clock" size={14} />
                        <b>{rangeWords(v.start, v.end)}</b>
                        {today === day && <span className="jv-today">Today</span>}
                      </span>
                      <span className="jv-discs">
                        {v.crew.map((c, i) => (
                          <Initials key={`${c.name}-${i}`} name={c.name} size={24} />
                        ))}
                      </span>
                    </span>
                    {word && <span className="jv-word">{word}</span>}
                  </button>
                  {lines.length > 0 && (
                    <ul className="jv-day" aria-label={`Tasks, ${fmtAuWeekdayDayMonth(day)}`}>
                      {lines.map((l) => (
                        <DayTask
                          key={l.task.id}
                          line={l}
                          zone={zone}
                          saving={saving}
                          onTick={(on) => void edit({ kind: "progress", id: l.task.id, to: on ? 100 : undoTo(l.task, updates), note: "" })}
                          onStarted={(to) => void edit({ kind: "progress", id: l.task.id, to, note: "" })}
                          onIssue={() => setIssueOf(l.task.id)}
                          drag={manage && l.mark !== "done" && !saving ? carry(l.task.id) : undefined}
                          onDragEnd={() => setDragging(false)}
                        />
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="jv-none">Nothing booked yet.</p>
        )}

        {previous.length > 0 && (
          <section className="jv-prev" aria-labelledby={`${planId}-prev`}>
            <div className="jv-head">
              <h3 id={`${planId}-prev`}>Previous</h3>
              {previous.length > PREVIOUS_SHOWN && !all && (
                <Button kind="quiet" size={32} onClick={() => setAll(true)}>
                  {`Show all ${previous.length}`}
                </Button>
              )}
            </div>
            <ul className="jv-pgrid">
              {shownPrevious.map((v) => (
                <li key={v.day}>
                  <b>{fmtAuWeekdayDayMonth(v.day.slice(0, 10))}</b>
                  <span className="jv-discs">
                    {v.crew.map((c, i) => (
                      <Initials key={`${c}-${i}`} name={c} size={24} />
                    ))}
                  </span>
                  <em>{v.minutes > 0 ? fmtMinutesAsHours(Math.round(v.minutes)) : ""}</em>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {data && (manage || toPlan.length > 0) && (
        <section className={"jv-plan" + (dragging && manage ? " drop" : "")} aria-labelledby={planId} {...landOn(null)}>
          <h3 id={planId}>
            <Icon name="listCheck" size={16} />
            Tasks to plan
          </h3>
          {stages.map((st) => {
            const lines = toPlan.filter((l) => l.task.stage === st);
            const ids = lines.map((l) => l.task.id);
            return (
              <div className="jv-group" key={st}>
                {manage ? (
                  <Tick className="jv-ghead" label={st} checked={ids.every((id) => ticked.includes(id))} disabled={saving} onChange={(on) => toggle(ids, on)} />
                ) : (
                  <h4 className="jv-ghead">{st}</h4>
                )}
                <ul className="jv-tasks">
                  {lines.map((l) => (
                    <li
                      key={l.task.id}
                      className="jv-task"
                      draggable={manage && !saving}
                      onDragStart={manage ? carry(l.task.id) : undefined}
                      onDragEnd={() => setDragging(false)}
                    >
                      {manage ? (
                        <Tick label={l.task.name} checked={ticked.includes(l.task.id)} disabled={saving} onChange={(on) => toggle([l.task.id], on)} />
                      ) : (
                        <span className="jv-tname">{l.task.name}</span>
                      )}
                      {l.task.hours != null && <span className="jv-hours">{hWords(l.task.hours)}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {tasks.length === 0 && data.canMake && (
            <div>
              <Button kind="second" disabled={making} aria-busy={making || undefined} onClick={() => void make()}>
                {making ? "Writing the tasks from the quote" : "Make tasks from the quote"}
              </Button>
            </div>
          )}
          {manage && (
            <TextInput
              ref={addBox}
              size={32}
              aria-label="Add a task"
              placeholder="Add a task"
              value={name}
              disabled={saving}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                void add();
              }}
            />
          )}
          {manage && ticked.length > 0 && (
            <div className="jv-selbar">
              <span>{plural(ticked.length, "task")}</span>
              <Button ref={dayBtn} kind="second" size={32} disabled={saving || dayItems.length === 0} aria-haspopup="menu" aria-expanded={dayMenu} onClick={() => setDayMenu((o) => !o)}>
                Add to a day
                <span className="jv-chev" aria-hidden="true">
                  <Icon name="chevD" size={16} />
                </span>
              </Button>
              <Menu
                open={dayMenu}
                anchor={dayBtn}
                onClose={() => setDayMenu(false)}
                onSelect={(d) => {
                  setDayMenu(false);
                  const n = slotOn(d)?.n;
                  if (n != null) void place(ticked, n);
                }}
                items={dayItems}
                label="Add to a day"
                align="end"
              />
            </div>
          )}
        </section>
      )}

      {issueTask && (
        <IssueDialog
          job={job}
          task={issueTask}
          day={onTheDay ? comingDay(onTheDay) : today}
          client={client}
          onClose={() => setIssueOf(null)}
          onSave={(note, documentId) => edit({ kind: "issue", id: issueTask.id, note, documentId })}
        />
      )}
    </div>
  );
}

/** A task on the day: its tick (done), what it's come to, and one control,
    Started ⌄, whose menu says how far it got or that something's wrong. */
function DayTask({
  line,
  zone,
  saving,
  onTick,
  onStarted,
  onIssue,
  drag,
  onDragEnd,
}: {
  line: TaskLine;
  zone: string | null;
  saving: boolean;
  onTick: (done: boolean) => void;
  onStarted: (to: number) => void;
  onIssue: () => void;
  drag?: (e: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { task } = line;
  const done = line.mark === "done";
  const issue = !done ? (task.issue ?? null) : null;
  const who = (by: string | null | undefined, at: string | null | undefined) => [by, timeOf(at, zone)].filter(Boolean).join(", ");
  const said = done
    ? ["Done", who(line.last?.by, line.last?.at)].filter(Boolean).join(", ")
    : issue
      ? `${who(issue.by, issue.at)}${who(issue.by, issue.at) ? ": " : ""}“${issue.note}”`
      : line.pct > 0
        ? ["Started", who(line.last?.by, line.last?.at)].filter(Boolean).join(", ")
        : null;
  const word = issue ? "Issue" : line.pct > 0 ? `${line.pct}%` : "Started";
  return (
    <li className={"jv-dtask" + (done ? " done" : "")} draggable={!!drag} onDragStart={drag} onDragEnd={onDragEnd}>
      <Tick
        aria-label={task.name}
        checked={done}
        disabled={saving}
        onChange={onTick}
        label={
          <span className="jv-dtext">
            <b>{task.name}</b>
            {said && <em>{said}</em>}
          </span>
        }
      />
      {!done && (
        <>
          <Button ref={btn} kind="quiet" size={32} className={issue ? "jv-issue" : undefined} disabled={saving} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {word}
            <span className="jv-chev" aria-hidden="true">
              <Icon name="chevD" size={16} />
            </span>
          </Button>
          <Menu
            open={open}
            anchor={btn}
            onClose={() => setOpen(false)}
            onSelect={(key) => {
              setOpen(false);
              if (key === "issue") onIssue();
              else onStarted(Number(key));
            }}
            items={[...STARTED.map((p) => ({ key: String(p), label: `Started, ${p}%` })), { key: "issue", label: "Issue", rule: true }]}
            chosen={line.pct > 0 ? String(line.pct) : null}
            label={`How far ${task.name} got`}
            align="end"
          />
        </>
      )}
    </li>
  );
}

/* AN ISSUE WITH A TASK (frame 3): what's wrong, and a photo if there is
   one; Save issue puts it on the task, and a task that has one can have it
   cleared. */
function IssueDialog({
  job,
  task,
  day,
  client,
  onClose,
  onSave,
}: {
  job: string;
  task: JobTask;
  day: string | null;
  client: string;
  onClose: () => void;
  onSave: (note: string, documentId: string | null) => Promise<boolean>;
}) {
  const [note, setNote] = useState(task.issue?.note ?? "");
  const [photo, setPhoto] = useState<{ id: string; name: string | null } | null>(task.issue?.photo ? { id: task.issue.photo, name: null } : null);
  const [busy, setBusy] = useState<"photo" | "save" | null>(null);
  const [wrong, setWrong] = useState<string | null>(null);
  const take = async (file: File | undefined) => {
    if (!file) return;
    setBusy("photo");
    setWrong(null);
    const up = await fileOnJob(file, job);
    if (up.ok) setPhoto({ id: up.documentId, name: file.name });
    else setWrong(up.error);
    setBusy(null);
  };
  const save = async (text: string) => {
    setBusy("save");
    const ok = await onSave(text, text ? (photo?.id ?? null) : null);
    setBusy(null);
    if (ok) onClose();
  };
  return (
    <Dialog
      heading="An issue with this task"
      width={560}
      onClose={onClose}
      foot={
        <>
          {task.issue && (
            <Button kind="second" className="jv-footleft" disabled={!!busy} onClick={() => void save("")}>
              Clear the issue
            </Button>
          )}
          <Button kind="second" disabled={busy === "save"} onClick={onClose}>
            Cancel
          </Button>
          <Button kind="main" disabled={!note.trim() || !!busy} aria-busy={busy === "save" || undefined} onClick={() => void save(note.trim())}>
            {busy === "save" ? "Saving the issue" : "Save issue"}
          </Button>
        </>
      }
    >
      <div className="mk-form">
        <p className="jv-dline">{[`${task.name}.`, day ? `${fmtAuWeekdayDayMonth(day)},` : "", `${client}.`].filter(Boolean).join(" ")}</p>
        <Field label="What's wrong">
          <TextArea data-autofocus value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="jv-photo">
          <label className={buttonClass("second", 32, "jv-file")} aria-disabled={busy ? "true" : undefined}>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              disabled={!!busy}
              onChange={(e) => {
                void take(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <span className="pt-btn__word">{busy === "photo" ? "Adding the photo" : photo ? "Change the photo" : "Add a photo"}</span>
          </label>
          {photo && <span className="jv-photoname">{photo.name ?? "A photo is on it"}</span>}
        </div>
        {wrong && <StateWord tone="wrong">{wrong}</StateWord>}
      </div>
    </Dialog>
  );
}

/* A VISIT, PRESSED (frame 4): when and for whom, who's going, where its
   booking stands in ServiceM8, and its two doors. The job's page draws the
   state and holds the doors: Cancel visit only where this viewer may take
   the booking back, Change visit where Book a visit opens. */
export function VisitDialog({
  visit,
  jobLine,
  state,
  onClose,
  onCancel,
  cancelling = false,
  onChange,
}: {
  visit: ComingVisit;
  /** "Job 2043, JT Construct" */
  jobLine: string;
  /** the booking's state in ServiceM8, and Open in ServiceM8 */
  state: ReactNode;
  onClose: () => void;
  onCancel?: () => void;
  cancelling?: boolean;
  onChange?: () => void;
}) {
  const day = visit.start.slice(0, 10);
  return (
    <Dialog
      heading={`${fmtAuWeekdayDayMonth(day)}, ${rangeWords(visit.start, visit.end)}`}
      width={560}
      onClose={onClose}
      foot={
        onCancel || onChange ? (
          <>
            {onCancel && (
              <Button kind="delete" className="jv-footleft" disabled={cancelling} aria-busy={cancelling || undefined} onClick={onCancel}>
                {cancelling ? "Cancelling the visit" : "Cancel visit"}
              </Button>
            )}
            {onChange && (
              <Button kind="second" onClick={onChange}>
                Change visit
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      <div className="mk-form">
        <p className="jv-dline">{jobLine}</p>
        <div className="jv-going">
          <h3>Who&apos;s going</h3>
          <RowList label="Who's going">
            {visit.crew.map((c, i) => (
              <Row key={`${c.name}-${i}`} lead={<Initials name={c.name} size={32} beside />} name={c.name} line={c.title ?? undefined} />
            ))}
          </RowList>
        </div>
        {state && <div className="jv-state">{state}</div>}
      </div>
    </Dialog>
  );
}
