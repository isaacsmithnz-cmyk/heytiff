"use client";

import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Waiting } from "@/components/ui/orb";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { fileOnJob } from "@/lib/documents/file-on-job";
import { VISIT_STAGES, type VisitStage } from "@/lib/quotes/buildup";
import { fmtMinutesAsHours } from "@/lib/workboard/all-jobs";
import { sameModel } from "@/lib/workboard/plate-read";
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
   thats right, build it"). The visits in a row; the one open with its
   tasks; the same tasks as one list with All tasks. The crew ticks and says
   how far; a manager makes the list from the quote, adds to it, moves a
   task to another visit, or takes one off. visit-tasks.ts works out where
   each task shows.

   A MANAGER PLANS THE VISITS (Isaac, 2026-10-10: "tasks can probably just
   be dragged and dropped or clicked to add to visit one. And just show the
   full list next to it… rather than just placing them on random days,
   because obviously the order can change depending on the job"): beside the
   visit open, Still to do, every task on no visit yet, each added to it with
   a press or dragged onto it or onto another visit; the visit says its hours
   planned against its crew's day. */

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
      /** the business's working day, in hours; null when it hasn't set one */
      dayHours?: number | null;
      canMake: boolean;
      manage: boolean;
      /** done, with something to say: the plate couldn't be read */
      note: string | null;
    }
  | { ok: false; reason: string };
type Loaded = Extract<Answer, { ok: true }>;

/** A day on site, as the card already draws it. */
export type VisitDay = { day: string; crewNode: ReactNode; minutes: number; length: string | null; onSite: boolean };

const STATE_WORD: Record<VisitSlot["state"], { text: string; tone: string }> = {
  done: { text: "Done", tone: "ok" },
  today: { text: "Today", tone: "info" },
  booked: { text: "Booked", tone: "quiet" },
  planned: { text: "Not booked", tone: "quiet" },
};
const ROLE_WORDS: Record<TaskPhoto["role"], string> = { unit: "The unit in place", plate: "The rating plate", other: "A photo" };

const readTasks = (job: string) => fetch(`${ROUTE}?job=${encodeURIComponent(job)}`).then((r) => r.json() as Promise<Answer>);
const reasonOf = (a: Answer): string | null => (a.ok ? a.note : a.reason);
/** The time now, for the handlers that ask when the tasks were read —
    never read while rendering. */
const clockMs = () => Date.now();
const hoursOf = (minutes: number) => fmtMinutesAsHours(Math.round(minutes));
/** a task's hours as the quote gave them: "5 h", "2.5 h" */
const hWords = (h: number) => `${Math.round(h * 100) / 100} h`;
/** the task a drag carries */
const DRAG = "application/x-heytiff-task";

/** What a unit task's or a photos task's line says of its photos. */
function photoWords(task: JobTask, photos: readonly TaskPhoto[]): string | null {
  if (task.kind !== "unit" && task.kind !== "photos") return null;
  const n = photos.filter((p) => p.taskId === task.id).length;
  if (n === 0) return task.kind === "photos" ? "Photos" : "Unit and plate photos";
  return `${n} photo${n === 1 ? "" : "s"}${task.serial ? ", serial read" : ""}`;
}

/** What unticking a task takes it back to: how far it had got before it
    was marked done. */
function undoTo(task: JobTask, updates: readonly TaskUpdate[]): number {
  const last = [...updates].reverse().find((u) => u.taskId === task.id && u.to >= 100);
  return last ? last.from : 0;
}

export function JobVisitTasks({
  job,
  visible,
  onSite,
  ahead,
  workOrderDate,
  onSiteMinutes,
  onBook,
  emptyWords,
  askAdd = 0,
}: {
  job: string;
  /** whether the face is open: the tasks are read the first time it is */
  visible: boolean;
  /** days worked */
  onSite: readonly VisitDay[];
  /** days booked from today on */
  ahead: readonly VisitDay[];
  /** the work order's day: days on site before it are site visits */
  workOrderDate: string | null;
  /** person-minutes on site, all told */
  onSiteMinutes: number | null;
  /** opens the job's Book in, where the deployment books */
  onBook?: () => void;
  /** what to say when there's nothing at all; empty when the face already
      says something */
  emptyWords: string;
  /** bumped by the card's Add > Task: the list opens on All tasks, where
      Add a task is, with its box ready to type in */
  askAdd?: number;
}) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"visit" | "all">("visit");
  const [openId, setOpenId] = useState<string | null>(null);
  /* a new ask from Add, seen while rendering, the way a window host sees a
     new pathname: no effect, so nothing paints the old view first */
  const [askSeen, setAskSeen] = useState(askAdd);
  if (askAdd !== askSeen) {
    setAskSeen(askAdd);
    setView("all");
    setOpenId(null);
  }
  /* the visit open: a visit's number, or a site visit's day; null is the
     one the card opens on */
  const [pick, setPick] = useState<number | string | null>(null);
  /* a task being dragged onto a visit, or back to the list */
  const [dragging, setDragging] = useState(false);
  const [making, setMaking] = useState(false);
  const [saving, setSaving] = useState(false);
  /* when the tasks were read: a photo's link lasts an hour */
  const readAt = useRef(0);
  const land = (a: Answer) => {
    if (!a.ok) return false;
    readAt.current = clockMs();
    setData(a);
    return true;
  };

  /* read once, the first time the face is open; no cancel on a tab switch,
     or a read that lands while another face is up would be dropped and
     never asked again */
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
  const tick = (id: string, to: number) => void edit({ kind: "progress", id, to, note: "" });
  /* a task opened: what was said about the last one goes, and its photos'
     links are read afresh when the last read is near their hour */
  const openTask = (id: string | null) => {
    setOpenId(id);
    setError(null);
    if (id && clockMs() - readAt.current > 50 * 60 * 1000) void readTasks(job).then(land).catch(() => undefined);
  };

  const today = data?.today ?? null;
  const tasks = data?.tasks ?? [];
  const updates = data?.updates ?? [];
  const photos = data?.photos ?? [];
  const manage = data?.manage ?? false;
  const from = workOrderDate ? workOrderDate.slice(0, 10) : null;
  /* a day booked since the work order that nobody checked in on is a visit */
  const checkedIn = new Set(onSite.map((v) => v.day.slice(0, 10)));
  const went: VisitDay[] = [
    ...onSite,
    ...(data?.booked ?? [])
      .filter((b) => !checkedIn.has(b.day))
      .map((b) => ({ day: b.day, crewNode: b.crew.length ? b.crew.join(", ") : null, minutes: 0, length: null, onSite: false })),
  ];
  /* until the account's today is read, the booked days are still ahead and
     the cards say no state */
  const firstAhead = ahead.map((v) => v.day.slice(0, 10)).sort()[0] ?? "9999-12-31";
  const slots = visitSlots({
    days: [...went, ...ahead].map((v) => v.day),
    today: today ?? firstAhead,
    from,
    /* the visits the quote planned are there to plan onto, booked or not */
    planned: Math.max(
      tasks.reduce((m, t) => Math.max(m, t.visit ?? 0), 0),
      data?.quoted?.visits ?? 0
    ),
  });
  const site = onSite.filter((v) => from && v.day.slice(0, 10) < from).sort((a, b) => a.day.localeCompare(b.day));
  const dayOf = new Map([...ahead, ...went].map((v) => [v.day.slice(0, 10), v]));
  const placed = placeTasks(tasks, updates, slots);
  const open = openId ? (tasks.find((t) => t.id === openId) ?? null) : null;

  /* the card opens on today's visit, or the next one, or the newest */
  const focusN = (slots.find((s) => s.state === "today") ?? slots.find((s) => s.state === "booked") ?? slots[slots.length - 1])?.n ?? null;
  const shown: number | string | null = pick != null && (typeof pick === "string" ? site.some((v) => v.day === pick) : slots.some((s) => s.n === pick)) ? pick : (focusN ?? site[0]?.day ?? null);

  const empty = slots.length === 0 && site.length === 0 && tasks.length === 0;
  /* nothing to show, and nothing a manager could add */
  if (empty && !manage) {
    return (
      <>
        {error && <p className="wb2-sherr">{error}</p>}
        {emptyWords && <p className="int-hint">{emptyWords}</p>}
      </>
    );
  }

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
        onBack={() => openTask(null)}
        onEdit={edit}
      />
    );
  }

  const counts = doneCount(tasks);
  const totalWords = [
    went.length ? `${went.length} visit${went.length === 1 ? "" : "s"}` : null,
    onSiteMinutes ? `${hoursOf(onSiteMinutes)} on site` : null,
    tasks.length ? `${counts.done} of ${counts.of} tasks done` : null,
  ]
    .filter(Boolean)
    .join(", ");
  /* the hours against the quote count the work, not a site measure before it */
  const workMinutes = onSite.filter((v) => !from || v.day.slice(0, 10) >= from).reduce((a, v) => a + v.minutes, 0);
  const item = (l: TaskLine, live: boolean, key: string, drag?: (e: DragEvent<HTMLElement>) => void) => (
    <TaskItem
      key={key}
      line={l}
      camera={photoWords(l.task, photos)}
      live={live}
      saving={saving}
      onOpen={() => openTask(l.task.id)}
      onTick={(to) => tick(l.task.id, to)}
      undoTo={undoTo(l.task, updates)}
      onDragStart={drag}
      onDragEnd={drag ? () => setDragging(false) : undefined}
    />
  );

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

      {data?.quoted && <HoursBar minutes={workMinutes} quoted={data.quoted} />}

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
      {empty && emptyWords && <p className="int-hint">{emptyWords}</p>}

      {view === "visit" ? (
        <ByVisit
          site={site}
          visits={placed.visits}
          unplaced={placed.unplaced}
          anyTasks={tasks.length > 0}
          shown={shown}
          onShow={setPick}
          dayOf={dayOf}
          checkedIn={checkedIn}
          today={today}
          manage={manage}
          saving={saving}
          crew={data?.quoted?.people ?? null}
          dayHours={data?.dayHours ?? null}
          dragging={dragging}
          onDrag={setDragging}
          onPlace={(id, visit) => void edit({ kind: "visit", id, visit })}
          onBook={onBook}
          item={item}
        />
      ) : (
        <div className="jcl-tall">
          {taskRows(tasks, updates, slots, fmtAuWeekdayDayMonth).map((g) => (
            <div className="jcl-tgroup" key={g.stage}>
              <div className="jcl-tghead">
                <b>{g.stage}</b>
              </div>
              <ul className="jcl-tasks rows">
                {g.rows.map((r) => (
                  <TaskItem key={r.task.id} line={r} live saving={saving} onOpen={() => openTask(r.task.id)} onTick={(to) => tick(r.task.id, to)} undoTo={undoTo(r.task, updates)}>
                    <span className="jcl-tvis">
                      {r.visits ??
                        (manage ? (
                          <VisitPick slots={slots} value={null} label={`Add ${r.task.name} to a visit`} disabled={saving} onPick={(visit) => void edit({ kind: "visit", id: r.task.id, visit })} />
                        ) : (
                          "Not on a visit"
                        ))}
                    </span>
                    <span className={`jcl-tstat ${r.status?.tone ?? ""}`}>{r.status?.text ?? ""}</span>
                  </TaskItem>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {manage && data && (tasks.length ? view === "all" : !data.canMake) && <AddTask slots={slots} saving={saving} onAdd={edit} ask={askAdd} />}
    </div>
  );
}

/* BY VISIT: a card a visit, oldest first, scrolling sideways, each with
   its tasks and who went; a manager drags a task from one card to another.
   While a manager has tasks on no visit, it plans: the visits as a row of
   tabs, the one open, and Still to do beside it (Isaac, 2026-10-10). */
function ByVisit({
  site,
  visits,
  unplaced,
  anyTasks,
  shown,
  onShow,
  dayOf,
  checkedIn,
  today,
  manage,
  saving,
  crew,
  dayHours,
  dragging,
  onDrag,
  onPlace,
  onBook,
  item,
}: {
  site: readonly VisitDay[];
  visits: readonly { slot: VisitSlot; lines: TaskLine[] }[];
  unplaced: readonly TaskLine[];
  anyTasks: boolean;
  shown: number | string | null;
  onShow: (v: number | string) => void;
  dayOf: ReadonlyMap<string, VisitDay>;
  checkedIn: ReadonlySet<string>;
  today: string | null;
  manage: boolean;
  saving: boolean;
  /** the crew the quote planned, for a visit's day */
  crew: number | null;
  dayHours: number | null;
  dragging: boolean;
  onDrag: (on: boolean) => void;
  onPlace: (id: string, visit: number | null) => void;
  onBook?: () => void;
  item: (l: TaskLine, live: boolean, key: string, drag?: (e: DragEvent<HTMLElement>) => void) => ReactNode;
}) {
  const strip = useRef<HTMLOListElement>(null);
  const planning = manage && unplaced.length > 0 && visits.length > 0;
  const focus = typeof shown === "number" ? shown : null;
  /* the strip opens on the visit the card opens on */
  useLayoutEffect(() => {
    const ol = strip.current;
    if (!ol || planning) return;
    const card = focus != null ? ol.querySelector<HTMLElement>(`[data-visit="${focus}"]`) : null;
    ol.scrollLeft = card ? Math.max(0, card.offsetLeft - ol.offsetLeft - 16) : ol.scrollWidth;
  }, [focus, planning]);

  /* a drag: what it carries, and where it lands */
  const carry = (id: string) => (e: DragEvent<HTMLElement>) => {
    e.dataTransfer.setData(DRAG, id);
    e.dataTransfer.effectAllowed = "move";
    onDrag(true);
  };
  const landOn = (visit: number | null) => ({
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (e.dataTransfer.types.includes(DRAG)) e.preventDefault();
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      const id = e.dataTransfer.getData(DRAG);
      onDrag(false);
      if (!id) return;
      e.preventDefault();
      onPlace(id, visit);
    },
  });
  /* a visit's tasks still to finish a manager can move, by dragging */
  const tasksOf = (slot: VisitSlot, lines: readonly TaskLine[]) =>
    lines.map((l) => item(l, slot.state !== "done" || l.lastDay === today, `${slot.n}-${l.task.id}`, manage && l.task.progress < 100 ? carry(l.task.id) : undefined));
  const wordOf = (slot: VisitSlot, day: VisitDay | undefined) =>
    !today ? null : slot.state === "today" && day?.onSite ? { text: "On site now", tone: "info" } : STATE_WORD[slot.state];

  if (!planning) {
    return (
      <>
        {(site.length > 0 || visits.length > 0) && (
          <ol className={"jcl-visits" + (anyTasks ? " tasks" : "")} ref={strip} aria-label="Visits, oldest first">
            {site.map((v) => (
              <li className="jcl-visit" key={`site-${v.day}`}>
                <span className="jcl-vh">
                  <b>Site visit</b>
                </span>
                <span className="jcl-vday">{fmtAuWeekdayDayMonth(v.day.slice(0, 10))}</span>
                <em>{v.crewNode}</em>
                {v.length && <span className="jcl-vlen">{v.length}</span>}
                <span className="jcl-vhrs">{v.minutes > 0 ? hoursOf(v.minutes) : "—"}</span>
              </li>
            ))}
            {visits.map(({ slot, lines }) => {
              const day = slot.day ? dayOf.get(slot.day) : undefined;
              const word = wordOf(slot, day);
              const worked = !!slot.day && checkedIn.has(slot.day);
              return (
                <li
                  className={"jcl-visit" + (slot.state === "today" ? " now" : "") + (slot.state === "planned" ? " plan" : "") + (dragging && manage ? " drop" : "")}
                  key={slot.n}
                  data-visit={slot.n}
                  {...(manage ? landOn(slot.n) : {})}
                >
                  <span className="jcl-vh">
                    <b>{`Visit ${slot.n}`}</b>
                    {word && <span className={`jcl-vword ${word.tone}`}>{word.text}</span>}
                  </span>
                  <span className="jcl-vday">{slot.day ? fmtAuWeekdayDayMonth(slot.day) : "Not booked yet"}</span>
                  {day?.crewNode && <em>{day.crewNode}</em>}
                  {lines.length > 0 && <ul className="jcl-tasks">{tasksOf(slot, lines)}</ul>}
                  {slot.state === "planned" && onBook && (
                    <div className="wb2-jqacts">
                      <button type="button" className="pbtn ghost sm" onClick={onBook}>{`Book visit ${slot.n}`}</button>
                    </div>
                  )}
                  {/* the hours last: a day with nothing believable says no figure */}
                  {day && worked && day.length && <span className="jcl-vlen">{day.length}</span>}
                  {day && worked && <span className="jcl-vhrs">{day.minutes > 0 ? hoursOf(day.minutes) : "—"}</span>}
                </li>
              );
            })}
          </ol>
        )}
        {unplaced.length > 0 && <Loose lines={unplaced} item={item} />}
      </>
    );
  }

  const open = typeof shown === "number" ? visits.find((v) => v.slot.n === shown) : undefined;
  const openSite = typeof shown === "string" ? site.find((v) => v.day === shown) : undefined;
  const card = (() => {
    if (openSite) {
      return (
        <section className="jcl-vcard" aria-label="Site visit">
          <header className="jcl-vch">
            <b>Site visit</b>
            <span className="jcl-vday">{fmtAuWeekdayDayMonth(openSite.day.slice(0, 10))}</span>
          </header>
          {openSite.crewNode && <em className="jcl-vcrew">{openSite.crewNode}</em>}
          <p className="jcl-vfoot">
            {openSite.length && <span className="jcl-vlen">{openSite.length}</span>}
            <span className="jcl-vhrs">{openSite.minutes > 0 ? hoursOf(openSite.minutes) : "—"}</span>
          </p>
        </section>
      );
    }
    if (!open) return null;
    const { slot, lines } = open;
    const day = slot.day ? dayOf.get(slot.day) : undefined;
    const word = wordOf(slot, day);
    const worked = !!slot.day && checkedIn.has(slot.day);
    /* its hours planned: every task planned for it, against its crew's day */
    const planned = lines.filter((l) => l.task.visit === slot.n).reduce((n, l) => n + (l.task.hours ?? 0), 0);
    const room = crew && dayHours ? crew * dayHours : null;
    return (
      <section className={"jcl-vcard" + (slot.state === "today" ? " now" : "") + (dragging ? " drop" : "")} aria-label={`Visit ${slot.n}`} {...landOn(slot.n)}>
        <header className="jcl-vch">
          <b>{`Visit ${slot.n}`}</b>
          {word && <span className={`jcl-vword ${word.tone}`}>{word.text}</span>}
          <span className="jcl-vday">{slot.day ? fmtAuWeekdayDayMonth(slot.day) : "Not booked yet"}</span>
          {planned > 0 && <em className="jcl-vplan">{room ? `${hWords(planned)} of ${hWords(room)} planned` : `${hWords(planned)} planned`}</em>}
        </header>
        {planned > 0 && room && (
          <div className="jcl-tbar" role="img" aria-label={`${Math.round((planned / room) * 100)}% of the crew's day planned`}>
            <i className={planned <= room ? "ok" : "warn"} style={{ width: `${Math.min(100, (planned / room) * 100)}%` }} />
          </div>
        )}
        {day?.crewNode && <em className="jcl-vcrew">{day.crewNode}</em>}
        {lines.length > 0 && <ul className="jcl-tasks">{tasksOf(slot, lines)}</ul>}
        {slot.state === "planned" && onBook && (
          <div className="wb2-jqacts">
            <button type="button" className="pbtn ghost sm" onClick={onBook}>{`Book visit ${slot.n}`}</button>
          </div>
        )}
        {day && worked && (
          <p className="jcl-vfoot">
            {day.length && <span className="jcl-vlen">{day.length}</span>}
            <span className="jcl-vhrs">{day.minutes > 0 ? hoursOf(day.minutes) : "—"}</span>
          </p>
        )}
      </section>
    );
  })();

  /* Still to do: the tasks on no visit, by the quote's stages */
  const stages = VISIT_STAGES.filter((st) => unplaced.some((l) => l.task.stage === st));
  const left = unplaced.reduce((n, l) => n + (l.task.hours ?? 0), 0);
  const into = open ? open.slot.n : null;

  return (
    <>
      <div className="jcl-vtabs" role="tablist" aria-label="Visits, oldest first">
        {site.map((v) => (
          <button key={`site-${v.day}`} type="button" role="tab" aria-selected={shown === v.day} className={"jcl-vtab" + (shown === v.day ? " on" : "")} onClick={() => onShow(v.day)}>
            <b>Site visit</b>
            <span>{fmtAuWeekdayDayMonth(v.day.slice(0, 10))}</span>
          </button>
        ))}
        {visits.map(({ slot }) => (
          <button
            key={slot.n}
            type="button"
            role="tab"
            aria-selected={shown === slot.n}
            className={"jcl-vtab" + (shown === slot.n ? " on" : "") + (slot.state === "today" ? " now" : "")}
            onClick={() => onShow(slot.n)}
            {...landOn(slot.n)}
          >
            <b>{`Visit ${slot.n}`}</b>
            <span>{slot.day ? fmtAuWeekdayDayMonth(slot.day) : "Not booked"}</span>
          </button>
        ))}
      </div>
      <div className="jcl-plan">
        {card}
        <section className={"jcl-todo" + (dragging ? " drop" : "")} aria-label="Still to do" {...landOn(null)}>
          <header className="jcl-vch">
            <b>Still to do</b>
            <em className="jcl-vplan">{`${unplaced.length} task${unplaced.length === 1 ? "" : "s"}${left > 0 ? `, ${hWords(left)}` : ""}`}</em>
          </header>
          {stages.map((st) => (
            <div key={st} className="jcl-todog">
              <h4 className="jcl-todoh">{st}</h4>
              <ul className="jcl-todol">
                {unplaced
                  .filter((l) => l.task.stage === st)
                  .map((l) => (
                    <li key={l.task.id} className="jcl-todor" draggable={!saving} onDragStart={carry(l.task.id)} onDragEnd={() => onDrag(false)}>
                      <span className="jcl-todon">{l.task.name}</span>
                      {l.task.hours != null && <em className="jcl-thr">{hWords(l.task.hours)}</em>}
                      {into != null && (
                        <button type="button" className="pbtn ghost sm" disabled={saving} onClick={() => onPlace(l.task.id, into)}>
                          {`Add to visit ${into}`}
                        </button>
                      )}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}

/** The tasks on no visit yet, for the crew: under the visit open. */
function Loose({ lines, item }: { lines: readonly TaskLine[]; item: (l: TaskLine, live: boolean, key: string) => ReactNode }) {
  return (
    <div className="jcl-tloose">
      <div className="jcl-tghead">
        <b>Not on a visit yet</b>
        <em>{`${lines.length} task${lines.length === 1 ? "" : "s"}`}</em>
      </div>
      <ul className="jcl-tasks cols">{lines.map((l) => item(l, true, l.task.id))}</ul>
    </div>
  );
}

/* THE HOURS AGAINST THE QUOTE (Isaac, 2026-10-03): "17.5 h on site of 32 h
   quoted", green while under, amber up to 15% over, red past that. */
function HoursBar({ minutes, quoted }: { minutes: number; quoted: { hours: number; people: number; visits: number } }) {
  const ratio = minutes / 60 / quoted.hours;
  const tone = ratio <= 1 ? "ok" : ratio <= 1.15 ? "warn" : "bad";
  return (
    <div className="jcl-hbar">
      <p className="jcl-hrs">
        <b>{hoursOf(minutes)}</b>
        <span>{`on site of ${hoursOf(quoted.hours * 60)} quoted`}</span>
        <em>{`${quoted.people} ${quoted.people === 1 ? "person" : "people"}, ${quoted.visits} visit${quoted.visits === 1 ? "" : "s"}`}</em>
      </p>
      <div className="jcl-tbar" role="img" aria-label={`${Math.round(ratio * 100)}% of the hours quoted`}>
        <i className={tone} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
    </div>
  );
}

type ItemLine = Pick<TaskLine, "task" | "mark" | "pct" | "note"> & Partial<Pick<TaskLine, "pctWords" | "meta">>;

/** A task's line: its box, its name (which opens it), how far, its note,
    its photos; the whole list adds its visits and state after it. */
function TaskItem({
  line,
  camera,
  live,
  saving,
  onOpen,
  onTick,
  undoTo,
  onDragStart,
  onDragEnd,
  children,
}: {
  line: ItemLine;
  /** a unit task's photos, said in a few words */
  camera?: string | null;
  live: boolean;
  saving: boolean;
  onOpen: () => void;
  onTick: (to: number) => void;
  undoTo: number;
  /** a manager's: the task dragged to another visit, or back to Still to do */
  onDragStart?: (e: DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
  children?: ReactNode;
}) {
  const { task, mark, pct } = line;
  /* a task measured in how far it's got opens to say how far; the rest tick */
  const measured = task.kind === "progress" && mark !== "done";
  const name = (
    <button type="button" className="jcl-tname" onClick={onOpen}>
      {task.name}
    </button>
  );
  return (
    <li className={`jcl-task ${mark}`} draggable={!!onDragStart} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <button
        type="button"
        role="checkbox"
        aria-checked={mark === "done" ? true : mark === "part" ? "mixed" : false}
        aria-label={`${task.name}: ${mark === "done" ? "done" : mark === "part" ? `${pct}%` : "not done"}`}
        className={`jcl-tbox ${mark}`}
        style={mark === "part" ? ({ "--p": `${pct}%` } as React.CSSProperties) : undefined}
        disabled={!live || saving}
        onClick={() => (measured ? onOpen() : onTick(mark === "done" ? undoTo : 100))}
      >
        {mark === "done" && <Icon name="check" size={11} />}
        {mark === "part" && <i aria-hidden="true" />}
      </button>
      <span className="jcl-ttx">
        {/* the hours the quote gave it (slice 8.2) */}
        {task.hours != null ? (
          <span className="jcl-thead">
            {name}
            <em className="jcl-thr">{`${task.hours} h`}</em>
          </span>
        ) : (
          name
        )}
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
      {children}
    </li>
  );
}

/** A visit to put a task on: the visits to come, the one it's planned for
    even when that's gone, and the next one after. */
function VisitPick({ slots, value, label, disabled, onPick }: { slots: readonly VisitSlot[]; value: number | null; label: string; disabled: boolean; onPick: (visit: number | null) => void }) {
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

function AddTask({
  slots,
  saving,
  onAdd,
  ask = 0,
}: {
  slots: readonly VisitSlot[];
  saving: boolean;
  onAdd: (e: Record<string, unknown>) => Promise<boolean>;
  /** the card's Add > Task: the box takes the keys, here or as it arrives */
  ask?: number;
}) {
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ask > 0) box.current?.focus();
  }, [ask]);
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
      <input ref={box} className="wb2-fi" aria-label="A new task" placeholder="A new task" value={name} disabled={saving} onChange={(e) => setName(e.target.value)} />
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
      {task.kind === "photos" && <TaskShots job={job} task={task} photos={photos} saving={saving} onEdit={onEdit} />}

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
            <label>
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

      {updates.length > 0 && (
        <div className="jcl-thist">
          <span className="jcl-tghead">
            <b>So far</b>
          </span>
          <ul>
            {[...updates].reverse().map((u) => {
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
   unit in place and its rating plate, whose model and serial are read,
   checked against the quote, and go on the certificate. */
/** A task done by taking photos (a starter: the damage before, the work
    after): what's been taken, and another. */
function TaskShots({
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const take = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const up = await fileOnJob(file, job);
    if (up.ok) await onEdit({ kind: "photo", id: task.id, documentId: up.documentId, role: "other" });
    else setError(up.error);
    setBusy(false);
  };
  return (
    <div className="jcl-tunit">
      {photos.length > 0 && (
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
            </figure>
          ))}
        </div>
      )}
      <div className="wb2-jqacts">
        {busy ? (
          <Waiting note="Adding the photo" />
        ) : (
          <label className={`pbtn ${photos.length ? "ghost" : "primary"} sm jcl-tfile`}>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              className="sr-only"
              disabled={saving}
              onChange={(e) => {
                void take(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {photos.length ? "Another photo" : "Take a photo"}
          </label>
        )}
      </div>
      {error && <p className="wb2-sherr">{error}</p>}
    </div>
  );
}

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
    const up = await fileOnJob(file, job);
    if (up.ok) await onEdit({ kind: "photo", id: task.id, documentId: up.documentId, role });
    else setError(up.error);
    setBusy(null);
  };
  const read = !!(task.modelRead || task.serial);
  const quoted = task.unit?.model ?? "";
  const matches = sameModel(task.modelRead, quoted);
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
                  {task.modelRead && quoted && <em className={matches ? "ok" : "warn"}>{matches ? "Matches the quote" : `The quote says ${quoted}`}</em>}
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
