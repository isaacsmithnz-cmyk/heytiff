"use client";

import { startTransition, useEffect, useId, useOptimistic, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { addTask, completeTask, deleteTask, giveTask, reopenTask, setTaskDue } from "@/app/actions/dashboard";
import { Icon } from "@/components/shell/icon";
import { TiffBox, type BoxSaved } from "@/components/tiff/modal/tiff-box";
import { useTiff } from "@/components/tiff/modal/tiff-context";
import { DateField } from "@/components/ui/date-field";
import { motionAllowed } from "@/lib/dashboard/day-flip";
import {
  dueWord,
  factsOf,
  historyOf,
  nameTag,
  powersOf,
  sourceLine,
  typedAbout,
  withChanges,
  wordsCaption,
  type RecordTask,
  type TaskAbout,
  type TaskChange,
  type TaskFact,
  type TaskRecord,
} from "@/lib/dashboard/task-record";
import { Confirm } from "./home-confirm";
import { useDeskJobs } from "./home-job-sheet";
import { FLASH_MS, ListDot, ListGroup, ListLine } from "./home-list";

/* THE NEW HOME'S TASKS FACE — the diary column's second face, beside the
   list (docs/design.md, "Home is the day, three tabs and the list"). Every
   task you have a hand in, open and done, and all there is to know about
   each one, opened where it stands.

   THE BOX ON TOP is the one entry box (tiff-box), in the room "tasks":
   Save makes you a task of the words as they are (`addTask`, no date), and
   Sort it out, Enter or the Tiff button take them to Tiff, who is told
   they were said on Tasks.

   TWO GROUPS, Open and Done, in the list's own dress (its group title, its
   row, its box and his name tag, ./home-list), so a task reads the same in
   the column and beside it. Open is yours, and with `team` the team's
   delegated work, most urgent first; Done is what you finished, what came
   back finished from work you handed out and what you ticked, the last 90
   days, newest first. Every word a row says is lib/dashboard/task-record's.

   A TITLE OPENS ITS ROW IN PLACE, one row at a time: the facts (For, Due or
   Done, Time, Job — the Job opens the desk's one card), their own words
   (your diary entry, or the ServiceM8 note), what has happened to it, and
   what you may do to it — Mark done, Move due date, Give it to, Open in
   diary, Delete task — each offered only where its action would say yes
   (`powersOf`). Opened by a pointer it grows; from the keyboard it is
   simply there (law 8). Delete asks twice (./home-confirm).

   WHAT YOU PRESS SHOWS AT ONCE. A tick, a date, a hand-over or a delete
   is drawn as done (`useOptimistic` over `withChanges`) while its action
   is out; the action's own revalidation brings the page back with it,
   and one that says no puts the task back as it was, with the action's
   words where its line was, and asks the page again. A ticked row moves
   to Done and stays open there, so Not done yet is under your hand, and
   focus goes with it.

   A ROW IS LIT, once, when something sent you to it: a door from another
   face (`focusTaskId`, scrolled into the middle), the task you just saved,
   or one Tiff has just filed. */

type Res = { ok: true } | { ok: false; error: string };

/** Someone a task can be given to. */
type Person = { id: string; name: string };

/** The row that is open, and whether it grows open (a pointer opened it
    and motion is allowed) or is simply there. */
type Opened = { id: string; grow: boolean };

/** A delete being asked about; `kept` once Keep said no, so the button it
    came from takes focus back as it returns. */
type Asking = { id: string; kept: boolean };

/** Where focus goes when a row moves between the groups under it: the box
    that ticked it, or the button that finished it. */
type Refocus = { id: string; on: "tick" | "button" };

/** An action's answer, or its own words when it could not give one. Out
    here, not in the component: a try in a component is one the React
    Compiler can refuse. */
async function settle(run: () => Promise<Res>, words: string): Promise<Res> {
  try {
    const res = await run();
    return res.ok ? res : { ok: false, error: res.error || words };
  } catch {
    return { ok: false, error: words };
  }
}

/** Focus, once, as the element arrives: one callback for every render, so
    a render that keeps the element never takes focus again. */
const focusOnArrival = (el: HTMLElement | null) => {
  el?.focus();
};

/** The row that shows this task, on this face. */
function rowOf(root: HTMLElement | null, id: string): HTMLElement | undefined {
  return [...(root?.querySelectorAll<HTMLElement>("[data-thing]") ?? [])].find((el) => el.dataset.thing === id);
}

/** A record without one key. Out here: the React Compiler skips a
    component that destructures a computed key. */
function omit<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

const EMPTY_ABOUT: TaskAbout = typedAbout();
/** Nothing pressed and waiting: the base every optimistic change sits on. */
const NO_CHANGES: readonly TaskChange[] = [];

/** Everything a row needs from the face: what it knows, and what it can do. */
type Ctl = {
  today: string;
  tz: string | null;
  viewer: string | null;
  viewerName: string;
  canManage: boolean;
  people: Readonly<Record<string, string>>;
  about: Readonly<Record<string, TaskAbout>>;
  assignable: readonly Person[];
  opened: Opened | null;
  asking: Asking | null;
  refocus: Refocus | null;
  errors: Readonly<Record<string, string>>;
  busy: ReadonlySet<string>;
  lit: (id: string) => boolean;
  toggle: (id: string, pointer: boolean) => void;
  finish: (t: RecordTask, on: Refocus["on"]) => void;
  move: (t: RecordTask, due: string | null) => void;
  give: (t: RecordTask, to: Person) => void;
  ask: (id: string) => void;
  keep: (id: string) => void;
  remove: (id: string) => void;
  openJob: (uuid: string, from: HTMLElement) => void;
  onOpenEntry?: (entryId: string, pointer: boolean) => void;
  onOpenConversation?: (noteUuid: string, pointer: boolean) => void;
};

export function HomeTasksFace({
  today,
  record,
  viewerStaffId,
  canManage,
  assignable,
  tz,
  focusTaskId = null,
  onFocusHandled,
  onOpenEntry,
  onOpenConversation,
}: {
  /** The workspace's day — the one the list beside it places by. */
  today: string;
  record: TaskRecord;
  viewerStaffId: string | null;
  canManage: boolean;
  /** Who a task can be given to — loaded for managers only. */
  assignable: readonly Person[];
  /** The workspace's zone, for the hour a task names. */
  tz: string | null;
  /** A task a door from another face named: opened, brought into view and
      lit, once. */
  focusTaskId?: string | null;
  /** The door's task has had its moment. */
  onFocusHandled?: () => void;
  /** The diary entry that made a task — the desk's door to the Diary face.
      `pointer` is false for a press from the keyboard. */
  onOpenEntry?: (entryId: string, pointer: boolean) => void;
  /** The ServiceM8 conversation a task came from, once the Diary shows
      conversations; until then a mention's task has no such door. */
  onOpenConversation?: (noteUuid: string, pointer: boolean) => void;
}) {
  const router = useRouter();
  const { openJob } = useDeskJobs();
  const { landed } = useTiff();
  const root = useRef<HTMLDivElement>(null);
  const [changes, change] = useOptimistic<readonly TaskChange[], TaskChange>(NO_CHANGES, (now, c) => [...now, c]);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [refocus, setRefocus] = useState<Refocus | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  /* The task Save just made, lit while it arrives. */
  const [fresh, setFresh] = useState<string | null>(null);

  /* A DOOR FROM ANOTHER FACE opens the row it names, in the same paint as
     the face (adjusted in render, against the door before it — the desk
     clears the door once it has been shown, so the same door pressed again
     arrives as a new one). */
  const [door, setDoor] = useState<string | null>(null);
  if (focusTaskId !== door) {
    setDoor(focusTaskId);
    if (focusTaskId) {
      setOpened({ id: focusTaskId, grow: false });
      setAsking(null);
    }
  }

  /* ...and brings it into the middle of the face, lit, then hands the door
     back so the next press of it is a press. */
  useEffect(() => {
    if (!focusTaskId) return;
    rowOf(root.current, focusTaskId)?.scrollIntoView?.({
      block: "center",
      behavior: motionAllowed() ? "smooth" : "auto",
    });
    const t = setTimeout(() => onFocusHandled?.(), FLASH_MS);
    return () => clearTimeout(t);
  }, [focusTaskId, onFocusHandled]);

  /* What Save made is lit for as long as a door's row is, and brought into
     view once the page has come back with it. */
  useEffect(() => {
    if (!fresh) return;
    const t = setTimeout(() => setFresh(null), FLASH_MS);
    return () => clearTimeout(t);
  }, [fresh]);
  useEffect(() => {
    if (!fresh) return;
    rowOf(root.current, fresh)?.scrollIntoView?.({ block: "nearest", behavior: motionAllowed() ? "smooth" : "auto" });
  }, [fresh, record]);

  const { open, done } = withChanges(record, changes);
  const busy = new Set(changes.map((c) => c.id));
  const landedIds = landed?.ids ?? [];
  const lit = (id: string) => id === focusTaskId || id === fresh || landedIds.includes(id);

  /* One action: drawn as done at once, and put back with its words if it
     says no. A row that moves groups under it remounts; it must not grow
     open a second time. */
  const act = (c: TaskChange, run: () => Promise<Res>, words: string) => {
    setErrors((e) => (c.id in e ? omit(e, c.id) : e));
    setOpened((o) => (o && o.id === c.id && o.grow ? { id: o.id, grow: false } : o));
    startTransition(async () => {
      change(c);
      const res = await settle(run, words);
      if (!res.ok) {
        setErrors((e) => ({ ...e, [c.id]: res.error }));
        router.refresh();
      }
    });
  };

  const toggle = (id: string, pointer: boolean) => {
    const grow = pointer && motionAllowed();
    setAsking(null);
    setRefocus(null);
    setOpened((o) => (o?.id === id ? null : { id, grow }));
  };

  const finish = (t: RecordTask, on: Refocus["on"]) => {
    setRefocus({ id: t.id, on });
    if (t.status === "open") {
      act(
        { id: t.id, kind: "done", at: new Date().toISOString(), by: viewerStaffId },
        () => completeTask(t.id),
        "Couldn't complete that task.",
      );
    } else {
      act({ id: t.id, kind: "open" }, () => reopenTask(t.id), "Couldn't reopen that task.");
    }
  };

  const move = (t: RecordTask, due: string | null) => {
    if (due === t.dueDate) return;
    act({ id: t.id, kind: "due", due }, () => setTaskDue(t.id, due), "Couldn't move that task.");
  };

  const give = (t: RecordTask, to: Person) =>
    act({ id: t.id, kind: "give", to: to.id, name: to.name }, () => giveTask(t.id, to.id), "Couldn't give that task.");

  const remove = (id: string) => {
    setAsking(null);
    setOpened((o) => (o?.id === id ? null : o));
    act({ id, kind: "gone" }, () => deleteTask(id), "Couldn't delete that task.");
  };

  /* Save: a task of the words as they are, for you, with no date. */
  const save = async (text: string): Promise<BoxSaved> => {
    const res = await addTask(text);
    if (!res.ok) return { ok: false, error: res.error };
    setFresh(res.taskId);
    return { ok: true };
  };

  const viewerName =
    (viewerStaffId && (record.people[viewerStaffId] ?? assignable.find((s) => s.id === viewerStaffId)?.name)) || "";

  const ctl: Ctl = {
    today,
    tz,
    viewer: viewerStaffId,
    viewerName,
    canManage,
    people: record.people,
    about: record.about,
    assignable,
    opened,
    asking,
    refocus,
    errors,
    busy,
    lit,
    toggle,
    finish,
    move,
    give,
    ask: (id) => setAsking({ id, kept: false }),
    keep: (id) => setAsking({ id, kept: true }),
    remove,
    openJob: (uuid, from) => openJob(uuid, { from }),
    onOpenEntry,
    onOpenConversation,
  };

  return (
    <div className="hd-tk" ref={root}>
      <div className="hd-tk-box">
        <TiffBox room="tasks" placeholder="Add a task…" save={save} />
      </div>
      {open.length === 0 && done.length === 0 ? (
        <p className="hd-ls-none">No tasks yet.</p>
      ) : (
        <div className="hd-tk-list">
          {open.length > 0 ? (
            <ListGroup id="hdtk-open" title="Open" count={open.length}>
              {open.map((t) => (
                <TaskRow key={t.id} t={t} ctl={ctl} />
              ))}
            </ListGroup>
          ) : (
            <p className="hd-ls-none">Nothing open.</p>
          )}
          {done.length > 0 && (
            <ListGroup id="hdtk-done" title="Done" count={done.length}>
              {done.map((t) => (
                <TaskRow key={t.id} t={t} ctl={ctl} />
              ))}
            </ListGroup>
          )}
          {record.doneCapped && <p className="hd-ls-none">Showing the latest {record.done.length}.</p>}
        </div>
      )}
    </div>
  );
}

/* ── a row ── */

function TaskRow({ t, ctl }: { t: RecordTask; ctl: Ctl }) {
  const detailId = useId();
  const about = ctl.about[t.id] ?? EMPTY_ABOUT;
  const powers = powersOf(t, ctl.viewer, ctl.canManage);
  const isDone = t.status === "done";
  const due = dueWord(t, ctl.today);
  const tag = nameTag(t, ctl.viewer);
  const expanded = ctl.opened?.id === t.id;
  const busy = ctl.busy.has(t.id);
  const error = ctl.errors[t.id];
  const focusTick = ctl.refocus?.id === t.id && ctl.refocus.on === "tick";

  /* The box you tick — or, on work someone else finished for you, a tick
     with no control: yours to read, theirs to take back. */
  let lead: ReactNode;
  if (powers.finish) {
    lead = (
      <button
        type="button"
        role="checkbox"
        aria-checked={isDone}
        aria-label={t.title}
        /* Not `disabled`: a disabled box cannot hold the focus it takes
           back when the row lands in its new group. */
        aria-disabled={busy || undefined}
        className={isDone ? "hd-ls-cb on" : "hd-ls-cb"}
        ref={focusTick ? focusOnArrival : undefined}
        onClick={() => {
          if (!busy) ctl.finish(t, "tick");
        }}
      >
        {isDone ? <Icon name="check" size={12} /> : null}
      </button>
    );
  } else if (isDone) {
    lead = (
      <span className="hd-tk-tick" role="img" aria-label="Done">
        <Icon name="check" size={12} />
      </span>
    );
  } else {
    lead = <ListDot dot="quiet" />;
  }

  return (
    <ListLine
      thing={t.id}
      lit={ctl.lit(t.id)}
      done={isDone}
      lead={lead}
      title={t.title}
      open={{ onOpen: (pointer) => ctl.toggle(t.id, pointer), expanded, controls: detailId }}
      figure={
        tag || due ? (
          <>
            {tag && <span className="hd-ls-tag">{tag}</span>}
            {due && (
              <span className="hd-tk-due" data-state={due.state ?? undefined}>
                {due.text}
              </span>
            )}
          </>
        ) : null
      }
      sub={error ?? sourceLine(about, t, ctl.viewer, ctl.today, ctl.people)}
      subTone={error ? "late" : ""}
    >
      {expanded && <TaskDetail id={detailId} t={t} about={about} powers={powers} ctl={ctl} />}
    </ListLine>
  );
}

/* ── what opens under it ── */

function Fact({ fact, ctl }: { fact: TaskFact; ctl: Ctl }) {
  if (fact.label === "Job") {
    const job = fact.job;
    return (
      <div>
        <dt>Job</dt>
        <dd>
          {job ? (
            <button type="button" className="hd-ls-link" onClick={(e) => ctl.openJob(job, e.currentTarget)}>
              {fact.value}
            </button>
          ) : (
            fact.value
          )}
        </dd>
      </div>
    );
  }
  return (
    <div>
      <dt>{fact.label}</dt>
      <dd data-late={fact.late ? "" : undefined}>{fact.value}</dd>
    </div>
  );
}

/** Give it to: you, then everyone else, never the person who has it. */
function GiveTo({ t, ctl, disabled }: { t: RecordTask; ctl: Ctl; disabled: boolean }) {
  const choices = [
    ...(ctl.viewer !== null && t.assigneeId !== ctl.viewer
      ? [{ id: ctl.viewer, name: ctl.viewerName, word: "You" }]
      : []),
    ...ctl.assignable
      .filter((s) => s.id !== t.assigneeId && s.id !== ctl.viewer)
      .map((s) => ({ id: s.id, name: s.name, word: s.name })),
  ];
  if (choices.length === 0) return null;
  return (
    <select
      className="hd-tk-pick"
      aria-label="Give it to"
      value=""
      disabled={disabled}
      onChange={(e) => {
        const to = choices.find((c) => c.id === e.target.value);
        if (to) ctl.give(t, { id: to.id, name: to.name });
      }}
    >
      <option value="" disabled>
        Give it to
      </option>
      {choices.map((c) => (
        <option key={c.id} value={c.id}>
          {c.word}
        </option>
      ))}
    </select>
  );
}

function TaskDetail({
  id,
  t,
  about,
  powers,
  ctl,
}: {
  id: string;
  t: RecordTask;
  about: TaskAbout;
  powers: ReturnType<typeof powersOf>;
  ctl: Ctl;
}) {
  const isDone = t.status === "done";
  const facts = factsOf(t, about, ctl.viewer, ctl.today, ctl.tz);
  const caption = wordsCaption(about, ctl.today);
  const lines = historyOf(t, about, ctl.people, ctl.viewer, ctl.today);
  const busy = ctl.busy.has(t.id);
  const asking = ctl.asking?.id === t.id ? ctl.asking : null;
  const focusFinish = ctl.refocus?.id === t.id && ctl.refocus.on === "button";
  /* The doors to where it came from: the conversation, once the Diary has
     them; your own diary entry — nobody reads someone else's diary. */
  const openConversation = ctl.onOpenConversation;
  const noteUuid = about.source === "sm8" ? about.sm8NoteUuid : null;
  const openEntry = ctl.onOpenEntry;
  const entryId =
    about.source === "diary" && ctl.viewer !== null && about.authorId === ctl.viewer ? about.noteId : null;

  return (
    <div className="hd-ls-in" id={id} data-grow={ctl.opened?.grow ? "" : undefined}>
      <div className="hd-tk-d">
        {t.detail && <p className="hd-tk-note">{t.detail}</p>}
        <dl className="hd-tk-f">
          {facts.map((f) => (
            <Fact key={f.label} fact={f} ctl={ctl} />
          ))}
        </dl>
        {caption && about.words && (
          <figure className="hd-tk-q">
            <figcaption>
              <b>{caption.strong}</b>
              {caption.rest}
            </figcaption>
            <p>{about.words}</p>
          </figure>
        )}
        {lines.length > 0 && (
          <ol className="hd-tk-h">
            {lines.map((l, i) => (
              <li key={`${l.iso}:${i}`}>
                <span>{l.at}</span>
                {l.text}
              </li>
            ))}
          </ol>
        )}
        {asking && !asking.kept ? (
          <Confirm onGo={() => ctl.remove(t.id)} onKeep={() => ctl.keep(t.id)} />
        ) : (
          <div className="hd-tk-a">
            {powers.finish && (
              <button
                type="button"
                className={isDone ? "hd-ls-vb" : "hd-ls-vb hd-tk-go"}
                aria-disabled={busy || undefined}
                ref={focusFinish ? focusOnArrival : undefined}
                onClick={() => {
                  if (!busy) ctl.finish(t, "button");
                }}
              >
                {isDone ? "Not done yet" : "Mark done"}
              </button>
            )}
            {powers.move && (
              /* The Due fact above already says the day, so the picker says
                 what it does. Clear takes the date off. */
              <DateField
                value={t.dueDate}
                today={ctl.today}
                clearable
                label={t.dueDate ? "Move due date" : "Set due date"}
                disabled={busy}
                onChange={(iso) => ctl.move(t, iso)}
              />
            )}
            {powers.give && <GiveTo t={t} ctl={ctl} disabled={busy} />}
            {!isDone && noteUuid && openConversation && (
              <button type="button" className="hd-ls-vb" onClick={(e) => openConversation(noteUuid, e.detail > 0)}>
                Open conversation
              </button>
            )}
            {!isDone && entryId && openEntry && (
              <button type="button" className="hd-ls-vb" onClick={(e) => openEntry(entryId, e.detail > 0)}>
                Open in diary
              </button>
            )}
            {powers.remove && (
              <button
                type="button"
                className="hd-tk-del"
                aria-disabled={busy || undefined}
                ref={asking?.kept ? focusOnArrival : undefined}
                onClick={() => {
                  if (!busy) ctl.ask(t.id);
                }}
              >
                Delete task
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
