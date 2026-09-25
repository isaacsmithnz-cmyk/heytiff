"use client";

import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { completeTask, reopenIssue, reopenTask, resolveIssue } from "@/app/actions/dashboard";
import { clearVisitPlacement, placeVisit } from "@/app/actions/workboard-maintenance";
import { Icon } from "@/components/shell/icon";
import { DateField } from "@/components/ui/date-field";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import type { DeskFocus } from "@/lib/dashboard/desk-focus";
import { motionAllowed } from "@/lib/dashboard/day-flip";
import {
  LIST_EMPTY,
  type Door,
  type Dot,
  type HomeList as HomeListData,
  type ListAlertRow,
  type ListGroupKey,
  type ListIssueRow,
  type ListRollupRow,
  type ListRow,
  type ListTaskRow,
  type Verb,
} from "@/lib/dashboard/home-list";
import { sheetRowOf } from "@/lib/workboard/all-jobs";
import { HomeListIssue } from "./home-list-issue";
import { useDeskJobs } from "./home-job-sheet";

/* THE NEW HOME'S LIST — the right-hand column beside Diary and Tasks
   (docs/design.md, "Home is the day, three tabs and the list"). What is
   waiting on you, in five groups by urgency: Late, Today, Jobs to book, No
   date, Later. Placed on the server by `placeHomeList` (lib/dashboard/
   home-list), which owns the rules and the words; this file draws them and
   acts on them.

   A GROUP is its title at 16/600 — Late in the late red, Today in the one
   teal — with its count 8px after it in the quiet grey. The count counts
   things, not rows ("Jobs to book 17" over one roll-up). An empty group is
   not there, and an empty list says so in one line.

   TASKS COME FIRST in every group: a box you tick, the title, a line under
   it, and someone else's first name on the right when it is theirs (his
   tag, a named exemption). Ticking says "Done." with Undo for four
   seconds, then the row folds away and the count follows.

   ALERTS FOLLOW: a dot, the title as the door to its thing, a figure on the
   right, and at most one small verb. The whole row opens its door — a
   press anywhere on it goes through the title — but the verb and the box
   are their own. Doors are data (`Door`); the desk decides what each
   means: a URL is followed, a job opens the desk's one card
   (`useDeskJobs`), a diary entry, a mention or a task is a `DeskFocus`
   handed up (`onShow`). A roll-up and an issue open in place instead.

   UNTIL THE ROW HAS FOLDED, THE LIST HOLDS STILL. Every action here
   brings the page back fresh, and the list the server sends no longer has
   the row that was ticked — so while any row is saying "Done.",
   "Resolved." or "Booked for …", the list on screen is the one the press
   was made on, and the fresh one is taken when the last of them has
   folded away. A row that folds while another still holds the list stays
   folded: it is taken off the held list, and its group counts one fewer.
   A failed action puts its own words where the sub-line was.

   ROWS ARE MADE OF PARTS THE CALENDAR'S RAIL USES TOO: `ListGroup`,
   `ListLine` and `ListDot`, exported below, in the `hd-ls-` dress. */

/** How long a row says "Done." (or "Resolved.", or "Booked for …") with
    Undo before it folds away. */
export const HOLD_MS = 4000;
/** The fold: `--t-move`. */
export const FOLD_MS = 200;
/** How long a row a door asked for stays lit. */
export const FLASH_MS = 1600;

const fmt = fmtAuWeekdayDayMonth;
const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/* ── the parts the calendar's rail reuses ── */

export type GroupTone = "late" | "today" | "";

/** A group: its title and count, and its rows as a list under them. */
export function ListGroup({
  id,
  title,
  count,
  tone = "",
  children,
}: {
  id: string;
  title: string;
  count: number;
  tone?: GroupTone;
  children: ReactNode;
}) {
  return (
    <section className="hd-ls-g" aria-labelledby={id}>
      <h2 className={cx("hd-ls-grp", tone)} id={id}>
        {title}{" "}
        <span className="hd-ls-n">{count}</span>
      </h2>
      <ul className="hd-ls-rows">{children}</ul>
    </section>
  );
}

/** The state dot: late, today, or quiet. */
export function ListDot({ dot }: { dot: Dot }) {
  return <i className="hd-ls-dot" data-dot={dot} aria-hidden="true" />;
}

/** What a row's title does: follow a URL, or open something — a door
    elsewhere, or what the row holds, in place (`expanded`). */
export type LineOpen =
  | { href: string }
  | {
      onOpen: (pointer: boolean, from: HTMLElement) => void;
      expanded?: boolean;
      controls?: string;
    };

/* What a press on the row itself must leave alone: anything that is its
   own control. */
const OWN_CONTROL = "a, button, input, select, textarea, [role='checkbox']";

/** ONE ROW: the lead (a dot or a box), the title, a figure on the right,
    the line under it, at most one verb, and whatever opens in place under
    it. A press on the row that lands on none of its controls goes through
    the title, and a press is always a pointer's. */
export function ListLine({
  lead,
  title,
  titleId,
  open,
  sub,
  subTone = "",
  figure = null,
  verb = null,
  done = false,
  thing,
  lit = false,
  leaving = false,
  children,
}: {
  lead: ReactNode;
  title: string;
  titleId?: string;
  open: LineOpen | null;
  sub: ReactNode;
  subTone?: "late" | "fresh" | "";
  figure?: ReactNode;
  verb?: ReactNode;
  /** A task ticked off: its title struck through. */
  done?: boolean;
  /** What a door between faces names this row by (`DeskFocus` ids). */
  thing?: string;
  /** A door asked for this row: lit, once. */
  lit?: boolean;
  /** Folding away. */
  leaving?: boolean;
  children?: ReactNode;
}) {
  const titleRef = useRef<HTMLButtonElement>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);

  const onRow = (e: MouseEvent<HTMLDivElement>) => {
    if (!open) return;
    const hit = (e.target as Element).closest(OWN_CONTROL);
    if (hit && e.currentTarget.contains(hit)) return;
    if ("href" in open) linkRef.current?.click();
    else if (titleRef.current) open.onOpen(true, titleRef.current);
  };

  return (
    <li className="hd-ls-it" data-thing={thing} data-leaving={leaving ? "" : undefined}>
      <div className="hd-ls-fold">
        <div
          className={cx("hd-ls-row", open && "opens", verb !== null && "has-vb", done && "done")}
          data-lit={lit ? "" : undefined}
          onClick={onRow}
        >
          <span className="hd-ls-lead">{lead}</span>
          {open && "href" in open ? (
            <Link ref={linkRef} id={titleId} className="hd-ls-t" href={open.href}>
              {title}
            </Link>
          ) : open ? (
            <button
              ref={titleRef}
              id={titleId}
              type="button"
              className="hd-ls-t"
              aria-expanded={open.expanded}
              aria-controls={open.controls}
              onClick={(e) => open.onOpen(e.detail > 0, e.currentTarget)}
            >
              {title}
            </button>
          ) : (
            <span id={titleId} className="hd-ls-t">
              {title}
            </span>
          )}
          {figure !== null && <span className="hd-ls-fig">{figure}</span>}
          <span className={cx("hd-ls-sub", subTone)}>{sub}</span>
          {verb !== null && <span className="hd-ls-vbs">{verb}</span>}
        </div>
        {children}
      </div>
    </li>
  );
}

/* ── the list ── */

type Res = { ok: true } | { ok: false; error: string };

/** An action's answer, or its own words when it could not give one. */
async function settle(run: () => Promise<Res | { ok: true; id?: string }>, words: string): Promise<Res> {
  try {
    const res = await run();
    return res.ok ? { ok: true } : { ok: false, error: res.error || words };
  } catch {
    return { ok: false, error: words };
  }
}

type HoldKind = "done" | "resolved" | "booked";

/** A row that has just been acted on and is saying so. */
type Hold = {
  kind: HoldKind;
  /** What Undo takes back: the task, the issue or the visit. */
  target: string;
  /** The day a visit was booked for. */
  on: string | null;
  /** The action (or its Undo) is still out. */
  busy: boolean;
  /** The four seconds are up: folding away. */
  leaving: boolean;
  /** Taken back by Undo: the row stands as it was, on the list that was
      current then, until a fresher one arrives (below). */
  undone: HomeListData | null;
};

type Held = {
  /** The list the first press was made on, kept on screen until the last
      held row has folded. */
  list: HomeListData | null;
  rows: Record<string, Hold>;
  /** Rows that have folded away while another row still holds `list`,
      which has them yet: kept off the screen until `list` is let go. */
  gone: readonly string[];
};

/** A record without one key. Out here, not destructured in place: the React
    Compiler skips a component that destructures a computed key, silently. */
function omit<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

/** `held` without these rows — and letting go of its list once none is
    left. Rows that have `folded` away stay off the list while it is held;
    a row let go any other way (its action failed, or Undo took it back)
    stands on it as it was. */
function without(s: Held, rowIds: readonly string[], folded = false): Held {
  if (!rowIds.some((id) => id in s.rows)) return s;
  const rows = { ...s.rows };
  for (const id of rowIds) delete rows[id];
  if (Object.keys(rows).length === 0) return { list: null, rows, gone: [] };
  return { list: s.list, rows, gone: folded ? [...s.gone, ...rowIds] : s.gone };
}

/** What a run of rows counts: a roll-up counts what it holds. */
const things = (rows: readonly ListRow[]) => rows.reduce((n, r) => n + (r.kind === "rollup" ? r.count : 1), 0);

/** The held list without the rows that have folded off it. Each group's
    count follows, as it would on the fresh list, and a roll-up or a group
    left with nothing goes too. A roll-up keeps the words it was placed
    with (its "2 services due …"): the fresh list re-words it when the last
    held row folds, and until then another row on it is still saying what
    was done. */
function lessGone(list: HomeListData, gone: readonly string[]): HomeListData {
  if (gone.length === 0) return list;
  const keep = (rows: readonly ListRow[]): ListRow[] =>
    rows.flatMap((r): ListRow[] => {
      if (gone.includes(r.id)) return [];
      if (r.kind !== "rollup") return [r];
      const kids = keep(r.rows);
      if (kids.length === r.rows.length) return [r];
      return kids.length > 0 ? [{ ...r, rows: kids, count: r.count - things(r.rows) + things(kids) }] : [];
    });
  const groups = list.groups.flatMap((g) => {
    const rows = keep(g.rows);
    return rows.length > 0 ? [{ ...g, rows, count: g.count - things(g.rows) + things(rows) }] : [];
  });
  return { ...list, groups };
}

/* A TICK HERE IS A PERSON'S, and so is its Undo (two-way phase 2, PR C): a
   task made from a ServiceM8 mention sends its Done as whoever ticked
   (`postDone`), and the Undo takes that Done back (`takeBackDone`). Both
   are no-ops where the deployment doesn't send notes. Written as calls, so
   the callers guard (task-sm8-callers.test) can read the flags. */
const UNDO: Record<HoldKind, { run: (id: string) => Promise<Res>; words: string }> = {
  done: { run: (id) => reopenTask(id, { takeBackDone: true }), words: "Couldn't reopen that task." },
  resolved: { run: reopenIssue, words: "Couldn't reopen that issue." },
  booked: { run: clearVisitPlacement, words: "Couldn't clear the placement." },
};

/** Everything a row needs from the list: its state, and what it can do. */
type Ctl = {
  day: string;
  holds: Record<string, Hold>;
  errors: Record<string, string>;
  /** Rows open in place, and whether a pointer opened them. */
  opened: Record<string, "pointer" | "key">;
  picking: string | null;
  lit: ReadonlySet<string>;
  go: (door: Door, pointer: boolean, from: HTMLElement | null) => void;
  toggle: (rowId: string, pointer: boolean) => void;
  pick: (rowId: string) => void;
  tick: (row: ListTaskRow) => void;
  resolve: (row: ListIssueRow) => void;
  book: (rowId: string, visitId: string, day: string) => void;
  undo: (rowId: string) => void;
  showEntry: (entryId: string, pointer: boolean) => void;
};

export function HomeList({
  list,
  onShow,
  flash = null,
  onFlashDone,
  inert = false,
}: {
  list: HomeListData;
  /** A door to another face: the desk's one door (lib/dashboard/desk-focus). */
  onShow: (to: DeskFocus, pointer: boolean) => void;
  /** Rows a door between faces asked to see (`kind: "rows"`): brought into
      view and lit once. */
  flash?: DeskFocus | null;
  /** The lit rows have had their moment. */
  onFlashDone?: () => void;
  /** Not the face that is up: the Calendar is sliding across it. */
  inert?: boolean;
}) {
  const { openJob } = useDeskJobs();
  const router = useRouter();
  const [held, setHeld] = useState<Held>({ list: null, rows: {}, gone: [] });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [opened, setOpened] = useState<Record<string, "pointer" | "key">>({});
  const [picking, setPicking] = useState<string | null>(null);
  const [spent, setSpent] = useState<DeskFocus | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const box = useRef<HTMLElement>(null);
  /* The page's latest list, for an answer that lands after a render. */
  const latest = useRef(list);
  useEffect(() => {
    latest.current = list;
  });

  /* A row taken back by Undo has waited for this: a list fresher than the
     one it was taken back on. Let it go (the adjust-in-render idiom, so the
     fresh list is on screen in the same paint). */
  const settled = Object.keys(held.rows).filter((id) => {
    const was = held.rows[id]!.undone;
    return was !== null && was !== list;
  });
  if (settled.length > 0) setHeld((s) => without(s, settled));

  const shown = held.list ? lessGone(held.list, held.gone) : list;

  /* ── holding a row ── */
  const clearTimer = (rowId: string) => {
    const t = timers.current.get(rowId);
    if (t !== undefined) clearTimeout(t);
    timers.current.delete(rowId);
  };
  const after = (rowId: string, ms: number, fn: () => void) => {
    clearTimer(rowId);
    timers.current.set(
      rowId,
      setTimeout(() => {
        timers.current.delete(rowId);
        fn();
      }, ms),
    );
  };
  const hold = (rowId: string, h: Hold) =>
    setHeld((s) => ({ ...s, list: s.list ?? list, rows: { ...s.rows, [rowId]: h } }));
  const patch = (rowId: string, p: Partial<Hold>) =>
    setHeld((s) => (s.rows[rowId] ? { ...s, rows: { ...s.rows, [rowId]: { ...s.rows[rowId]!, ...p } } } : s));
  const drop = (rowId: string) => {
    clearTimer(rowId);
    setHeld((s) => without(s, [rowId]));
  };
  const say = (rowId: string, words: string | null) =>
    setErrors((e) => {
      if (words === null && !(rowId in e)) return e;
      const next = { ...e };
      if (words === null) delete next[rowId];
      else next[rowId] = words;
      return next;
    });
  /** Four seconds of Undo, then the fold, then gone — and so are any words
      a failed Undo left on it, should the row come back on a later list. */
  const fold = (rowId: string) =>
    after(rowId, HOLD_MS, () => {
      patch(rowId, { leaving: true });
      after(rowId, FOLD_MS, () => {
        setHeld((s) => without(s, [rowId], true));
        say(rowId, null);
      });
    });
  /* A task's and an issue's actions revalidate Home themselves, and a
     Server Function's revalidation brings the page back with its answer.
     A visit's revalidate the board alone, so for those the list asks. */
  const fresh = (kind: HoldKind) => {
    if (kind === "booked") router.refresh();
  };

  const act = async (rowId: string, h: Pick<Hold, "kind" | "target" | "on">, run: () => Promise<Res>) => {
    clearTimer(rowId);
    say(rowId, null);
    hold(rowId, { ...h, busy: true, leaving: false, undone: null });
    const res = await run();
    if (!res.ok) {
      drop(rowId);
      say(rowId, res.error);
      return;
    }
    patch(rowId, { busy: false });
    fresh(h.kind);
    fold(rowId);
  };

  const tick = (row: ListTaskRow) =>
    void act(row.id, { kind: "done", target: row.id, on: null }, () =>
      settle(() => completeTask(row.id, { postDone: true }), "Couldn't complete that task."),
    );

  const resolve = (row: ListIssueRow) => {
    setOpened((o) => omit(o, row.id));
    void act(row.id, { kind: "resolved", target: row.issue.id, on: null }, () =>
      settle(() => resolveIssue(row.issue.id), "Couldn't resolve that issue."),
    );
  };

  const book = (rowId: string, visitId: string, day: string) => {
    setPicking(null);
    void act(rowId, { kind: "booked", target: visitId, on: day }, () =>
      settle(() => placeVisit(visitId, day), "Couldn't place the visit."),
    );
  };

  const undo = async (rowId: string) => {
    const h = held.rows[rowId];
    if (!h || h.busy || h.undone) return;
    clearTimer(rowId);
    say(rowId, null);
    patch(rowId, { busy: true });
    const res = await settle(() => UNDO[h.kind].run(h.target), UNDO[h.kind].words);
    if (!res.ok) {
      /* It stands as it was pressed — still done, still resolved, still
         booked — saying why, and folds away as it would have. */
      patch(rowId, { busy: false });
      say(rowId, res.error);
      fold(rowId);
      return;
    }
    /* Taken back: the row stands as it was until the page's list is fresher
       than the one on hand now — a booking's Undo revalidates the board, not
       Home, so that list can still be without it — or for four seconds if
       nothing comes. */
    patch(rowId, { busy: false, undone: latest.current });
    fresh(h.kind);
    after(rowId, HOLD_MS, () => drop(rowId));
  };

  /* Nothing may fire into a list that has gone. */
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of pending.values()) clearTimeout(t);
      pending.clear();
    };
  }, []);

  /* ── doors ── */
  const go = (door: Door, pointer: boolean, from: HTMLElement | null) => {
    switch (door.to) {
      case "href":
        router.push(door.href);
        return;
      case "job": {
        /* The row the board would open it on, when the list carries the
           job; otherwise the mirror is asked by its uuid (an issue's job). */
        const job = shown.jobs.find((j) => j.remoteId === door.remoteId);
        const row = job ? sheetRowOf(job, shown.day) : null;
        openJob(row ?? door.remoteId, { from });
        return;
      }
      case "entry":
        onShow({ face: "diary", kind: "entry", ids: [door.id] }, pointer);
        return;
      case "mention":
        onShow({ face: "diary", kind: "conversation", ids: [door.id] }, pointer);
        return;
      case "task":
        onShow({ face: "tasks", kind: "task", ids: [door.id] }, pointer);
        return;
    }
  };

  /* Opened by a pointer, what opens grows; from the keyboard, or under
     reduced motion, it is simply there (law 8). */
  const toggle = (rowId: string, pointer: boolean) => {
    const how = pointer && motionAllowed() ? "pointer" : "key";
    setOpened((o) => (rowId in o ? omit(o, rowId) : { ...o, [rowId]: how }));
  };

  const pick = (rowId: string) => setPicking((p) => (p === rowId ? null : rowId));

  /* ── the flash ── */
  const flashing = flash && flash.kind === "rows" && flash !== spent ? flash : null;
  const lit = new Set(flashing?.ids ?? []);
  useEffect(() => {
    if (!flash || flash.kind !== "rows") return;
    const first = [...(box.current?.querySelectorAll<HTMLElement>("[data-thing]") ?? [])].find((el) =>
      flash.ids.includes(el.dataset.thing ?? ""),
    );
    first?.scrollIntoView?.({ block: "nearest", behavior: motionAllowed() ? "smooth" : "auto" });
    const t = setTimeout(() => {
      setSpent(flash);
      onFlashDone?.();
    }, FLASH_MS);
    return () => clearTimeout(t);
  }, [flash, onFlashDone]);

  /* What a row says it has done; a row taken back says nothing of it. */
  const holds: Record<string, Hold> = {};
  for (const [id, h] of Object.entries(held.rows)) if (!h.undone) holds[id] = h;

  const ctl: Ctl = {
    day: shown.day,
    holds,
    errors,
    opened,
    picking,
    lit,
    go,
    toggle,
    pick,
    tick,
    resolve,
    book,
    undo: (rowId) => void undo(rowId),
    showEntry: (entryId, pointer) => onShow({ face: "diary", kind: "entry", ids: [entryId] }, pointer),
  };

  return (
    <aside className="hd-list" aria-label="The list" ref={box} inert={inert}>
      {shown.groups.length === 0 ? (
        <p className="hd-ls-none">{LIST_EMPTY}</p>
      ) : (
        shown.groups.map((g) => (
          <ListGroup key={g.key} id={`hdls-${g.key}`} title={g.title} count={g.count} tone={toneOf(g.key)}>
            {g.rows.map((r) => (
              <Item key={r.id} row={r} ctl={ctl} />
            ))}
          </ListGroup>
        ))
      )}
    </aside>
  );
}

const toneOf = (key: ListGroupKey): GroupTone => (key === "late" ? "late" : key === "today" ? "today" : "");

/* ── the rows ── */

function Item({ row, ctl }: { row: ListRow; ctl: Ctl }) {
  switch (row.kind) {
    case "task":
      return <TaskItem row={row} ctl={ctl} />;
    case "alert":
      return <AlertItem row={row} ctl={ctl} />;
    case "issue":
      return <IssueItem row={row} ctl={ctl} />;
    case "rollup":
      return <RollupItem row={row} ctl={ctl} />;
  }
}

/** "Done." and Undo — or "Resolved.", or "Booked for Mon 5 Oct." */
function Said({ rowId, hold, ctl }: { rowId: string; hold: Hold; ctl: Ctl }) {
  const words = hold.kind === "done" ? "Done." : hold.kind === "resolved" ? "Resolved." : `Booked for ${fmt(hold.on)}.`;
  const error = ctl.errors[rowId];
  return (
    <>
      {error ?? words}
      {!hold.leaving && (
        <>
          {" "}
          <button type="button" className="hd-ls-undo" disabled={hold.busy} onClick={() => ctl.undo(rowId)}>
            Undo
          </button>
        </>
      )}
    </>
  );
}

function TaskItem({ row, ctl }: { row: ListTaskRow; ctl: Ctl }) {
  const titleId = useId();
  const h = ctl.holds[row.id];
  const ticked = h?.kind === "done";
  const error = ctl.errors[row.id];
  return (
    <ListLine
      thing={row.id}
      lit={ctl.lit.has(row.id)}
      leaving={h?.leaving}
      done={ticked}
      titleId={titleId}
      lead={
        <button
          type="button"
          role="checkbox"
          aria-checked={ticked}
          aria-label="Tick it off"
          aria-describedby={titleId}
          className={cx("hd-ls-cb", ticked && "on")}
          disabled={h?.busy || h?.leaving}
          onClick={() => (ticked ? ctl.undo(row.id) : ctl.tick(row))}
        >
          {ticked ? <Icon name="check" size={12} /> : null}
        </button>
      }
      title={row.title}
      open={{ onOpen: (pointer, from) => ctl.go(row.door, pointer, from) }}
      figure={row.who ? <span className="hd-ls-tag">{row.who}</span> : null}
      sub={h ? <Said rowId={row.id} hold={h} ctl={ctl} /> : (error ?? row.sub)}
      subTone={error ? "late" : h ? "" : row.tone}
    />
  );
}

/** The one verb an alert carries: a URL, a door, or a visit's day picker. */
function VerbControl({ verb, rowId, pickId, ctl }: { verb: Verb; rowId: string; pickId: string; ctl: Ctl }) {
  if ("placeVisit" in verb) {
    return (
      <button
        type="button"
        className="hd-ls-vb"
        aria-expanded={ctl.picking === rowId}
        aria-controls={pickId}
        onClick={() => ctl.pick(rowId)}
      >
        {verb.label}
      </button>
    );
  }
  const door = verb.door;
  if (door.to === "href") {
    return (
      <Link className="hd-ls-vb" href={door.href}>
        {verb.label}
      </Link>
    );
  }
  return (
    <button type="button" className="hd-ls-vb" onClick={(e) => ctl.go(door, e.detail > 0, e.currentTarget)}>
      {verb.label}
    </button>
  );
}

function AlertItem({ row, ctl }: { row: ListAlertRow; ctl: Ctl }) {
  const pickId = useId();
  const h = ctl.holds[row.id];
  const error = ctl.errors[row.id];
  const visitId = row.verb && "placeVisit" in row.verb ? row.verb.placeVisit : null;
  const picking = ctl.picking === row.id && visitId !== null && !h;
  const door = row.door;
  return (
    <ListLine
      thing={row.id}
      lit={ctl.lit.has(row.id)}
      leaving={h?.leaving}
      lead={<ListDot dot={row.dot} />}
      title={row.title}
      open={door.to === "href" ? { href: door.href } : { onOpen: (pointer, from) => ctl.go(door, pointer, from) }}
      figure={row.figure}
      sub={h ? <Said rowId={row.id} hold={h} ctl={ctl} /> : (error ?? row.sub)}
      subTone={error ? "late" : h ? "" : row.tone}
      verb={row.verb && !h ? <VerbControl verb={row.verb} rowId={row.id} pickId={pickId} ctl={ctl} /> : null}
    >
      {picking && (
        <div className="hd-ls-pick" id={pickId}>
          <DayPicker day={ctl.day} onPick={(d) => ctl.book(row.id, visitId, d)} />
        </div>
      )}
    </ListLine>
  );
}

/** A visit's day, picked in the row: the app's own date field, focused as
    it appears so the next key or press opens its calendar. A visit is
    booked from today on. */
function DayPicker({ day, onPick }: { day: string; onPick: (day: string) => void }) {
  const field = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    field.current?.focus();
  }, []);
  return (
    <DateField
      ref={field}
      value={null}
      onChange={(iso) => {
        if (iso) onPick(iso);
      }}
      today={day}
      min={day}
      placeholder="Pick a day"
      aria-label="The day to book it in"
    />
  );
}

function IssueItem({ row, ctl }: { row: ListIssueRow; ctl: Ctl }) {
  const detailId = useId();
  const h = ctl.holds[row.id];
  const error = ctl.errors[row.id];
  const how = h ? undefined : ctl.opened[row.id];
  return (
    <ListLine
      thing={row.issue.id}
      lit={ctl.lit.has(row.issue.id)}
      leaving={h?.leaving}
      lead={<ListDot dot={row.dot} />}
      title={row.title}
      open={{ onOpen: (pointer) => ctl.toggle(row.id, pointer), expanded: how !== undefined, controls: detailId }}
      sub={h ? <Said rowId={row.id} hold={h} ctl={ctl} /> : (error ?? row.sub)}
      subTone={error ? "late" : ""}
      verb={row.verb && !h ? <VerbControl verb={row.verb} rowId={row.id} pickId={detailId} ctl={ctl} /> : null}
    >
      {how !== undefined && (
        <HomeListIssue
          id={detailId}
          issue={row.issue}
          entryId={row.entryId}
          grow={how === "pointer"}
          onOpenEntry={ctl.showEntry}
          onResolve={() => ctl.resolve(row)}
        />
      )}
    </ListLine>
  );
}

/** "Oldest **3050 Oatley**, won 2 months ago." — the named stretch in bold. */
function RollupSub({ sub, strong }: { sub: string; strong: string | null }) {
  const at = strong ? sub.indexOf(strong) : -1;
  if (!strong || at < 0) return <>{sub}</>;
  return (
    <>
      {sub.slice(0, at)}
      <b>{strong}</b>
      {sub.slice(at + strong.length)}
    </>
  );
}

function RollupItem({ row, ctl }: { row: ListRollupRow; ctl: Ctl }) {
  const inId = useId();
  const how = ctl.opened[row.id];
  return (
    <ListLine
      thing={row.id}
      lead={<ListDot dot="quiet" />}
      title={row.title}
      open={{ onOpen: (pointer) => ctl.toggle(row.id, pointer), expanded: how !== undefined, controls: inId }}
      sub={<RollupSub sub={row.sub} strong={row.strong} />}
      verb={row.verb ? <VerbControl verb={row.verb} rowId={row.id} pickId={inId} ctl={ctl} /> : null}
    >
      {how !== undefined && (
        <div className="hd-ls-in" id={inId} data-grow={how === "pointer" ? "" : undefined}>
          <ul className="hd-ls-kids">
            {row.rows.map((r) => (
              <Item key={r.id} row={r} ctl={ctl} />
            ))}
          </ul>
        </div>
      )}
    </ListLine>
  );
}
