"use client";

import {
  startTransition,
  useEffect,
  useId,
  useLayoutEffect,
  useOptimistic,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { addTask, completeTask, deleteTask, giveTask, reopenTask, setTaskDue } from "@/app/actions/dashboard";
import { confirmMySm8Link } from "@/app/actions/job-note-sm8";
import { retryTaskDone } from "@/app/actions/task-sm8";
import { Icon } from "@/components/shell/icon";
import { TiffBox, type BoxSaved } from "@/components/tiff/modal/tiff-box";
import { useTiff } from "@/components/tiff/modal/tiff-context";
import { DateField } from "@/components/ui/date-field";
import { motionAllowed } from "@/lib/dashboard/day-flip";
import type { TaskDoneLine } from "@/lib/dashboard/task-done-query";
import type { NoteSender } from "@/lib/integrations/links";
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
import { TaskSm8Line, type TaskSm8Doors } from "./task-sm8-line";

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
   simply there (law 8). Delete asks twice (./home-confirm), and Give it to
   names the people in its place and gives only on the name you press.

   WHAT YOU PRESS SHOWS AT ONCE. A tick, a date, a hand-over or a delete
   is drawn as done (`useOptimistic` over `withChanges`) while its action
   is out; the action's own revalidation brings the page back with it,
   and one that says no puts the task back as it was, with the action's
   words where its line was, and asks the page again. A second press on a
   row while its action is out is not sent. A ticked row moves to Done and
   stays open there, so Not done yet is under your hand.

   A TICK ANSWERS THE MENTION a task was made from, and Not done yet takes
   that answer back (`postDone`, `takeBackDone`: two-way phase 2, PR C) —
   both nothing where the deployment doesn't send notes. Where that Done
   stands is drawn in the row, under what happened to it, in the diary's
   own words and with its own doors (./task-sm8-line, `sm8Lines`); one
   that went wrong says so on the row's line too, so a closed row shows
   it. What a Reopen could not take back is said where a refusal is.

   FOCUS STAYS WHERE YOUR HAND IS. A press that moves things out from under
   the control it was made with — a row changing groups or places, a
   question answered, a row deleted — puts focus back on that control in
   its new place (the neighbouring task, for a delete), and again if a
   refusal puts the row back; never once focus has gone somewhere else.
   Focus follows a row out of sight only for the keyboard, and for Mark
   done, whose row you are reading: a tick made with the pointer leaves
   the face where it is.

   A ROW IS LIT, once, when something sent you to it: a door from another
   face (`focusTaskId`, brought into the middle of the face, and focused
   when focus was not already here), the task you just saved, one Tiff has
   just filed, or one a press just moved — ticked, taken back, dated or
   given. Only a pointer's door or Save glides it into view. */

type Res = { ok: true; note?: string } | { ok: false; error: string };

/** Someone a task can be given to. */
type Person = { id: string; name: string };

/** The row that is open, and whether it grows open (a pointer opened it
    and motion is allowed) or is simply there. */
type Opened = { id: string; grow: boolean };

/** A question standing where a row's actions were: Delete for good?, or
    who to give it to. */
type Asking = { id: string; what: "delete" | "give" };

/** A control that focus can be put back on, in a row. */
type LandOn = "tick" | "finish" | "give" | "delete" | "title";

/** Where focus belongs once a press has moved things out from under it. */
type Landing = {
  /** The row it belongs in; null for the box on top. */
  id: string | null;
  on: LandOn;
  /** The task whose action is out: the landing holds until that action
      has answered, so a refusal that puts the row back puts focus back
      with it. Null: spent on the next commit. */
  until: string | null;
  /** The action has been seen out. */
  seen: boolean;
  /** Focus may bring the control into view: a keyboard's press, or Mark
      done. A pointer's press elsewhere leaves the face where it is. */
  scroll: boolean;
};

const LAND: Record<LandOn, string> = {
  tick: ".hd-ls-cb",
  finish: "[data-act='finish']",
  give: "[data-act='give']",
  delete: "[data-act='delete']",
  title: ".hd-ls-t",
};

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

/** The row that shows this task, on this face. */
function rowOf(root: HTMLElement | null, id: string): HTMLElement | undefined {
  return [...(root?.querySelectorAll<HTMLElement>("[data-thing]") ?? [])].find((el) => el.dataset.thing === id);
}

/** The control a landing names. */
function landOf(root: HTMLElement | null, l: Landing): HTMLElement | null {
  if (!root) return null;
  if (l.id === null) return root.querySelector<HTMLElement>(".hd-tk-box input");
  return rowOf(root, l.id)?.querySelector<HTMLElement>(LAND[l.on]) ?? null;
}

/** Focus has gone nowhere: what had it left the page. */
function focusDropped(): boolean {
  const at = document.activeElement;
  return !at || at === document.body;
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
/** No ServiceM8 lines: the deployment doesn't send notes, or none is read. */
const NO_LINES: Readonly<Record<string, readonly TaskDoneLine[]>> = {};
const NO_DONE_LINES: readonly TaskDoneLine[] = [];

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
  errors: Readonly<Record<string, string>>;
  busy: ReadonlySet<string>;
  sm8Lines: Readonly<Record<string, readonly TaskDoneLine[]>>;
  sm8Sender: NoteSender | null;
  lit: (id: string) => boolean;
  toggle: (id: string, pointer: boolean) => void;
  finish: (t: RecordTask, on: "tick" | "finish", pointer: boolean) => void;
  move: (t: RecordTask, due: string | null) => void;
  give: (t: RecordTask, to: Person) => void;
  ask: (id: string, what: Asking["what"]) => void;
  keep: (id: string) => void;
  remove: (id: string) => void;
  /** A door on a Done's line, for the row it stands in. */
  send: (id: string, run: () => Promise<Res>) => void;
  openJob: (uuid: string, from: HTMLElement) => void;
  onOpenEntry?: (entryId: string, pointer: boolean) => void;
  canOpenEntry?: (entryId: string) => boolean;
  onOpenConversation?: (noteUuid: string, pointer: boolean) => void;
  canOpenConversation?: (noteUuid: string) => boolean;
};

export function HomeTasksFace({
  today,
  record,
  viewerStaffId,
  canManage,
  assignable,
  tz,
  focusTaskId = null,
  focusByPointer = false,
  onFocusHandled,
  onOpenEntry,
  canOpenEntry,
  onOpenConversation,
  canOpenConversation,
  sm8Lines = NO_LINES,
  sm8Sender = null,
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
  /** The door was pressed with a pointer: its row may glide into view. */
  focusByPointer?: boolean;
  /** The door's task has had its moment. */
  onFocusHandled?: () => void;
  /** The diary entry that made a task — the desk's door to the Diary face.
      `pointer` is false for a press from the keyboard. */
  onOpenEntry?: (entryId: string, pointer: boolean) => void;
  /** Whether the Diary holds that entry to open: a door to one it doesn't
      hold would open another. Without it, every entry can be opened. */
  canOpenEntry?: (entryId: string) => boolean;
  /** The ServiceM8 conversation a task came from, by the ask's note — the
      desk's door to the Diary, which shows conversations. Without it a
      mention's task has no such door. */
  onOpenConversation?: (noteUuid: string, pointer: boolean) => void;
  /** Whether the Diary holds that conversation to open: it reaches back
      sixty days, and an ask deleted in ServiceM8 leaves none. Without it,
      every conversation can be opened. */
  canOpenConversation?: (noteUuid: string) => boolean;
  /** Where each task's Done stands with ServiceM8, by task (two-way phase
      2, PR C) — empty where the deployment doesn't send notes, and then
      the face is as it would be without them. */
  sm8Lines?: Readonly<Record<string, readonly TaskDoneLine[]>>;
  /** Who the viewer is in ServiceM8: the link question's Yes answers for
      it. */
  sm8Sender?: NoteSender | null;
}) {
  const router = useRouter();
  const { openJob } = useDeskJobs();
  const { landed } = useTiff();
  const root = useRef<HTMLDivElement>(null);
  const [changes, change] = useOptimistic<readonly TaskChange[], TaskChange>(NO_CHANGES, (now, c) => [...now, c]);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  /* The task Save just made, lit while it arrives; `pointer` if a pointer
     pressed Save, which alone may glide it into view. */
  const [fresh, setFresh] = useState<{ id: string; pointer: boolean } | null>(null);
  /* The row a press just moved — ticked, taken back, dated or given — lit
     for its moment where it has gone; a new object each press, so a second
     press starts the moment again. */
  const [moved, setMoved] = useState<{ id: string } | null>(null);
  /* Where focus goes once the press in hand has moved things (see
     `Landing`); read after each commit, never in render. */
  const landing = useRef<Landing | null>(null);
  /* Whether the last press in the box was a pointer's: Save is the box's,
     and says nothing of how it was pressed. */
  const boxPointer = useRef(false);

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

  /* ...brings it into the middle of the face, lit — gliding only for a
     pointer's door (law 8) — takes focus to its title if the door left
     focus behind on the face it came from, then hands the door back so
     the next press of it is a press. */
  useEffect(() => {
    if (!focusTaskId) return;
    const row = rowOf(root.current, focusTaskId);
    row?.scrollIntoView?.({ block: "center", behavior: focusByPointer && motionAllowed() ? "smooth" : "auto" });
    const at = document.activeElement;
    if (row && (focusDropped() || !root.current?.contains(at))) {
      row.querySelector<HTMLElement>(LAND.title)?.focus({ preventScroll: true });
    }
    const t = setTimeout(() => onFocusHandled?.(), FLASH_MS);
    return () => clearTimeout(t);
  }, [focusTaskId, focusByPointer, onFocusHandled]);

  /* What Save made is lit for as long as a door's row is, and brought into
     view once the page has come back with it. */
  useEffect(() => {
    if (!fresh) return;
    const t = setTimeout(() => setFresh(null), FLASH_MS);
    return () => clearTimeout(t);
  }, [fresh]);
  useEffect(() => {
    if (!fresh) return;
    rowOf(root.current, fresh.id)?.scrollIntoView?.({
      block: "nearest",
      behavior: fresh.pointer && motionAllowed() ? "smooth" : "auto",
    });
  }, [fresh, record]);
  useEffect(() => {
    if (!moved) return;
    const t = setTimeout(() => setMoved(null), FLASH_MS);
    return () => clearTimeout(t);
  }, [moved]);

  const { open, done } = withChanges(record, changes);
  const busy = new Set(changes.map((c) => c.id));
  const landedIds = landed?.ids ?? [];
  const lit = (id: string) =>
    id === focusTaskId || id === fresh?.id || id === moved?.id || landedIds.includes(id);

  /* THE LANDING, after the commit a press lands in and the one its answer
     lands in, and no other: focus that fell out of the page there goes
     where the press left it. A landing is spent once its action has
     answered, so it never takes focus from wherever it went next — nor
     meanwhile, whatever else draws. */
  useLayoutEffect(() => {
    const l = landing.current;
    if (!l) return;
    const out = l.until !== null && busy.has(l.until);
    if ((!l.seen || !out) && focusDropped()) landOf(root.current, l)?.focus({ preventScroll: !l.scroll });
    if (l.until === null) landing.current = null;
    else if (out) l.seen = true;
    else if (l.seen) landing.current = null;
  });

  const land = (id: string | null, on: LandOn, until: string | null = null, scroll = false) => {
    landing.current = { id, on, until, seen: false, scroll };
  };

  /* One action: drawn as done at once, and put back with its words if it
     says no. A row that moves groups under it remounts; it must not grow
     open a second time, and a question left on it is answered. An action
     that stands but has something to say (a Reopen that couldn't take a
     Done back out of ServiceM8) says it where a refusal would. `ask`: the
     action doesn't bring the page back itself, so it is asked for. */
  const act = (c: TaskChange, run: () => Promise<Res>, words: string, ask = false) => {
    setErrors((e) => (c.id in e ? omit(e, c.id) : e));
    setOpened((o) => (o && o.id === c.id && o.grow ? { id: o.id, grow: false } : o));
    setAsking(null);
    startTransition(async () => {
      change(c);
      const res = await settle(run, words);
      const said = res.ok ? res.note : res.error;
      if (said) setErrors((e) => ({ ...e, [c.id]: said }));
      if (!res.ok || ask) router.refresh();
    });
  };

  const toggle = (id: string, pointer: boolean) => {
    const grow = pointer && motionAllowed();
    setAsking(null);
    setOpened((o) => (o?.id === id ? null : { id, grow }));
  };

  /* A tick made with the pointer keeps the face still: the box comes back
     under focus in Done without scrolling there. From the keyboard, and
     from Mark done inside the row you are reading, focus follows it. */
  const finish = (t: RecordTask, on: "tick" | "finish", pointer: boolean) => {
    if (busy.has(t.id)) return;
    land(t.id, on, t.id, on === "finish" || !pointer);
    setMoved({ id: t.id });
    if (t.status === "open") {
      act(
        { id: t.id, kind: "done", at: new Date().toISOString(), by: viewerStaffId },
        () => completeTask(t.id, { postDone: true }),
        "Couldn't complete that task.",
      );
    } else {
      act({ id: t.id, kind: "open" }, () => reopenTask(t.id, { takeBackDone: true }), "Couldn't reopen that task.");
    }
  };

  /* A later date moves the row down Open. The row is the same element
     moved, and React gives focus back to what it moved — so long as it can
     still take focus, which is why the date field is never disabled. */
  const move = (t: RecordTask, due: string | null) => {
    if (busy.has(t.id) || due === t.dueDate) return;
    setMoved({ id: t.id });
    act({ id: t.id, kind: "due", due }, () => setTaskDue(t.id, due), "Couldn't move that task.");
  };

  /* Reached only from the names, which are never asked for while the row's
     action is out, and which any action takes away. */
  const give = (t: RecordTask, to: Person) => {
    land(t.id, "give", t.id);
    setMoved({ id: t.id });
    act({ id: t.id, kind: "give", to: to.id, name: to.name }, () => giveTask(t.id, to.id), "Couldn't give that task.");
  };

  /* A door on a Done's line — Try again, Send again, Yes, Not me. It draws
     nothing ahead of its answer; the row waits for it as for any action
     (the line's own doors are off while the row's action is out), and the
     page is asked again for where the Done now stands. Focus left on a
     door the line takes away goes to the row's title. */
  const send = (id: string, run: () => Promise<Res>) => {
    land(id, "title", id);
    act({ id, kind: "send" }, run, "Couldn't reach ServiceM8.", true);
  };

  /* The row goes, and focus goes to the task that took its place: the one
     after it, else the one before, else the box. */
  const remove = (id: string) => {
    const rows = [...(root.current?.querySelectorAll<HTMLElement>("[data-thing]") ?? [])];
    const at = rows.findIndex((el) => el.dataset.thing === id);
    const next = at < 0 ? undefined : (rows[at + 1] ?? rows[at - 1]);
    land(next?.dataset.thing ?? null, "title", id);
    setOpened((o) => (o?.id === id ? null : o));
    act({ id, kind: "gone" }, () => deleteTask(id), "Couldn't delete that task.");
  };

  /* Save: a task of the words as they are, for you, with no date. */
  const save = async (text: string): Promise<BoxSaved> => {
    const pointer = boxPointer.current;
    const res = await addTask(text);
    if (!res.ok) return { ok: false, error: res.error };
    setFresh({ id: res.taskId, pointer });
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
    errors,
    busy,
    sm8Lines,
    sm8Sender,
    lit,
    toggle,
    finish,
    move,
    give,
    send,
    ask: (id, what) => {
      if (!busy.has(id)) setAsking({ id, what });
    },
    /* Backing out of a question: focus to the button that asked it. */
    keep: (id) => {
      const on = asking?.id === id && asking.what === "give" ? "give" : "delete";
      land(id, on);
      setAsking(null);
    },
    remove,
    openJob: (uuid, from) => openJob(uuid, { from }),
    onOpenEntry,
    canOpenEntry,
    onOpenConversation,
    canOpenConversation,
  };

  return (
    <div className="hd-tk" ref={root}>
      {/* A click's `detail` is 0 when a key pressed it: read on the way
          down, before the box's own Save hears it. */}
      <div
        className="hd-tk-box"
        onClickCapture={(e) => {
          boxPointer.current = e.detail > 0;
        }}
      >
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
  /* A Done that went wrong in ServiceM8 says so on the row's own line, so
     the row says it closed; what the action just said comes first. */
  const trouble = (ctl.sm8Lines[t.id] ?? NO_DONE_LINES).find((l) => l.state.tone === "bad")?.state.text ?? null;
  const said = error ?? trouble;

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
           back when the row lands in its new group. The face sends
           nothing while the row's action is out. */
        aria-disabled={busy || undefined}
        className={isDone ? "hd-ls-cb on" : "hd-ls-cb"}
        /* a click's `detail` is 0 when a key pressed it */
        onClick={(e) => ctl.finish(t, "tick", e.detail > 0)}
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
      sub={said ?? sourceLine(about, t, ctl.viewer, ctl.today, ctl.people)}
      subTone={said ? "late" : ""}
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
  /* His late fact: the day in ink, how late in the late red. */
  return (
    <div>
      <dt>{fact.label}</dt>
      <dd>
        {fact.late ? (
          <>
            {`${fact.value}, `}
            <span data-late="">{fact.late}</span>
          </>
        ) : (
          fact.value
        )}
      </dd>
    </div>
  );
}

type Choice = Person & { word: string };

/** Who a task can go to: you, then everyone else, never who has it. */
function choicesFor(t: RecordTask, ctl: Ctl): Choice[] {
  return [
    ...(ctl.viewer !== null && t.assigneeId !== ctl.viewer
      ? [{ id: ctl.viewer, name: ctl.viewerName, word: "You" }]
      : []),
    ...ctl.assignable
      .filter((s) => s.id !== t.assigneeId && s.id !== ctl.viewer)
      .map((s) => ({ id: s.id, name: s.name, word: s.name })),
  ];
}

/* GIVE IT TO, asked in place as Delete is: the names where the actions
   were, and a task changes hands only on the name you press — never on an
   arrow key or a typed letter, as a closed select would give it away, and
   a hand-over rings the new person's bell. Focus lands on Cancel, so a
   second Enter backs out rather than gives. */
function GiveTo({ choices, onGive, onKeep }: { choices: Choice[]; onGive: (c: Choice) => void; onKeep: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancel.current?.focus();
  }, []);
  return (
    <div
      className="hd-cf"
      role="group"
      aria-label="Give it to"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        onKeep();
      }}
    >
      <span className="hd-cf-q">Give it to</span>
      {choices.map((c) => (
        <button key={c.id} type="button" className="hd-ls-vb" onClick={() => onGive(c)}>
          {c.word}
        </button>
      ))}
      <button type="button" className="hd-ls-vb" ref={cancel} onClick={onKeep}>
        Cancel
      </button>
    </div>
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
  const asking = ctl.asking?.id === t.id ? ctl.asking.what : null;
  const choices = powers.give ? choicesFor(t, ctl) : [];
  /* The doors to where it came from, each only where the Diary holds it:
     the conversation; your own diary entry — nobody reads someone else's
     diary. */
  const openConversation = ctl.onOpenConversation;
  const noteUuid =
    about.source === "sm8" && about.sm8NoteUuid && (ctl.canOpenConversation?.(about.sm8NoteUuid) ?? true)
      ? about.sm8NoteUuid
      : null;
  const openEntry = ctl.onOpenEntry;
  const entryId =
    about.source === "diary" &&
    ctl.viewer !== null &&
    about.authorId === ctl.viewer &&
    about.noteId &&
    (ctl.canOpenEntry?.(about.noteId) ?? true)
      ? about.noteId
      : null;
  const doneLines = ctl.sm8Lines[t.id] ?? NO_DONE_LINES;
  /* The line's doors, each on its own row. Yes (or Not me) is kept for the
     link the viewer holds, and then that row is pressed again: after Yes
     it goes; after Not me the line says why it can't. */
  const doors: TaskSm8Doors = {
    onRetry: (noteId, act) => ctl.send(t.id, () => retryTaskDone({ taskId: t.id, noteId, act })),
    onConfirm: (noteId, remoteId, answer) =>
      ctl.send(t.id, async () => {
        const answered = await confirmMySm8Link({ remoteId, answer });
        if (!answered.ok) return answered;
        return retryTaskDone({ taskId: t.id, noteId, act: "send_again" });
      }),
  };

  let doing: ReactNode;
  if (asking === "delete") {
    doing = <Confirm onGo={() => ctl.remove(t.id)} onKeep={() => ctl.keep(t.id)} />;
  } else if (asking === "give" && choices.length > 0) {
    doing = <GiveTo choices={choices} onGive={(c) => ctl.give(t, c)} onKeep={() => ctl.keep(t.id)} />;
  } else {
    /* Nothing here is `disabled` while the row's action is out: a disabled
       control drops the focus it holds. Each says so and sends nothing. */
    doing = (
      <div className="hd-tk-a">
        {powers.finish && (
          <button
            type="button"
            className={isDone ? "hd-ls-vb" : "hd-ls-vb hd-tk-go"}
            data-act="finish"
            aria-disabled={busy || undefined}
            onClick={(e) => ctl.finish(t, "finish", e.detail > 0)}
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
            onChange={(iso) => ctl.move(t, iso)}
          />
        )}
        {choices.length > 0 && (
          <button
            type="button"
            className="hd-ls-vb"
            data-act="give"
            aria-disabled={busy || undefined}
            onClick={() => ctl.ask(t.id, "give")}
          >
            Give it to
          </button>
        )}
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
            data-act="delete"
            aria-disabled={busy || undefined}
            onClick={() => ctl.ask(t.id, "delete")}
          >
            Delete task
          </button>
        )}
      </div>
    );
  }

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
        {/* THE ANSWER IT SENT, when the task was made from a ServiceM8
            mention: the Done (or the reply that closed it) in quotes, then
            where it stands, under the line that says it was done. */}
        {doneLines.length > 0 && (
          <div className="hd-tk-sm8">
            <TaskSm8Line lines={doneLines} sender={ctl.sm8Sender} pending={busy} doors={doors} />
          </div>
        )}
        {doing}
      </div>
    </div>
  );
}
