"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ScreenBand } from "@/components/shell/screen-band";
import { useTiff, type TiffLanded } from "@/components/tiff/modal/tiff-context";
import { fmtAuWeekdayDateLong } from "@/lib/au-dates";
import {
  DEFAULT_FACE,
  FACE_SLIDE_MS,
  partShown,
  slidePlan,
  thingsDoor,
  type DeskArrival,
  type DeskFace,
  type DeskFocus,
  type SlidePart,
  type SlidePlan,
} from "@/lib/dashboard/desk-focus";
import { motionAllowed } from "@/lib/dashboard/day-flip";
import { diaryHolds } from "@/lib/dashboard/diary-conversation";
import { placeHomeList, thingsOnList, type HomeListBase } from "@/lib/dashboard/home-list";
import type { DashboardData } from "@/lib/dashboard/page-data";
import { HomeCalendarPage } from "./home-cal-page";
import { HomeDay } from "./home-day";
import { KEEPS_DAY } from "./home-day-bar";
import { HomeDiaryFeed } from "./home-diary-feed";
import { HomeFaceTabs } from "./home-face-tabs";
import { DeskJobHost } from "./home-job-sheet";
import { HomeList } from "./home-list";
import { HomeTasksFace } from "./home-tasks-face";

/* THE NEW HOME — the desk (docs/design.md, "Home is the day, three tabs and
   the list", 2026-09-25). Behind HOME_DESK (lib/dashboard/desk-flag): the
   owner's until the flip, and the crew's Home (./home) does not change.

   The date is the h1, in the band every screen wears. Under it "Your day",
   which stays on every face (Isaac, 2026-09-25: "The top hero can stay as it
   is, that says Your day"). Under that ONE row of tabs, Diary | Tasks |
   Calendar, which never moves, and under the tabs the body, which SLIDES:
   the Calendar across the whole body, Tasks across the diary column, in tab
   order ("Calendar should slide across"). Only the faces scroll.

   THE FACES ARE BUILT ONE BY ONE. "Your day" is his own already
   (./home-day), and so are THE DIARY (./home-diary-feed), THE LIST in the
   right-hand column beside Diary and Tasks (./home-list), THE TASKS FACE
   (./home-tasks-face), every task you have a hand in, open and done, each
   opening in place, and THE CALENDAR (./home-cal-page), which slides
   across the column and the list alike. Every new file mounts here and
   nowhere else, which is what keeps the crew's Home as it is.

   THE DAY'S OPEN CARD STAYS OPEN across faces, so a press on the tabs or
   in the Calendar does not close it (`KEEPS_DAY`); a click anywhere else
   on the page does.

   ALL MOUNTED, NEVER KEYED. A face is shown or hidden, so what you typed in
   one is still there when you come back, and the row of tabs is one node
   whatever face is up. The chosen face is state, not the URL: writing the
   URL remounts the page (the outlet is keyed on its path).

   ONE CARD. Every door on this Home opens its job through `DeskJobHost`
   (./home-job-sheet); nothing here mounts a sheet of its own.

   ONE DOOR BETWEEN FACES, `DeskFocus` (lib/dashboard/desk-focus): a face,
   what kind of thing, which ones. The face that receives it decides what
   showing means. */

type Motion = {
  from: DeskFace;
  to: DeskFace;
  /** Where the leaving part starts, when a press lands mid-slide: the next
      slide starts from where that face is, not from rest. */
  x0: number;
};

/** How far across its slide a part stands right now, in pixels. */
function offsetOf(el: HTMLElement | null): number {
  if (!el || typeof DOMMatrixReadOnly !== "function") return 0;
  const t = getComputedStyle(el).transform;
  return !t || t === "none" ? 0 : new DOMMatrixReadOnly(t).m41;
}

export function DashboardDesk({
  data,
  taskId = null,
}: {
  data: DashboardData;
  /** A task the address names (`/dashboard?task=<id>`, the bell's door onto
      a Done that didn't go to ServiceM8): the desk opens on Tasks with it
      chosen, as today's Home does (./home). */
  taskId?: string | null;
}) {
  return (
    <DeskJobHost manage={data.rail.manage} moneyVisible={data.rail.moneyVisible}>
      <Desk data={data} taskId={taskId} />
    </DeskJobHost>
  );
}

/* A task the address names arrives as a door no hand pressed: nothing
   slides for it, and the face it lands on moves nothing (law 8). */
const addressed = (id: string): DeskArrival => ({ face: "tasks", kind: "task", ids: [id], pointer: false });

function Desk({ data, taskId }: { data: DashboardData; taskId: string | null }) {
  const { assignable, canManage, viewerStaffId, today, rail } = data;
  /* A DOOR INTO THE DIARY ONLY FOR WHAT IT HOLDS. The page's journal is
     your sixty newest entries whatever their age, and the diary reaches
     back only sixty days once it reads ServiceM8 (diary-feed's ONE
     HORIZON); an ask ServiceM8 deleted leaves its task with no
     conversation. So the list and the Tasks tab are handed the entries and
     the asks the diary holds, and nothing else: a task from an entry before
     then opens on the Tasks tab, as one typed there does, rather than
     sliding the diary in on nothing and dropping the focus with the face it
     was pressed on. */
  const holds = useMemo(() => diaryHolds(data.desk?.diary.feed ?? null), [data.desk]);
  const journal = useMemo(() => data.journal.filter((e) => holds.entries.has(e.id)), [data.journal, holds]);
  /* The list, placed from its own reads and what the page already holds —
     pure, and dated on the server by the workspace's day. */
  const list = useMemo(() => {
    if (!data.desk) return null;
    const base: HomeListBase = data;
    return placeHomeList(data.desk.list, {
      ...base,
      journal,
      mentions: base.mentions?.filter((m) => holds.notes.has(m.noteId)),
    });
  }, [data, journal, holds]);

  const [face, setFace] = useState<DeskFace>(taskId ? "tasks" : DEFAULT_FACE);
  const [motion, setMotion] = useState<Motion | null>(null);
  /* A door from one face to another, until the face it names has shown it
     — with how it was pressed, so that face moves nothing for a key. */
  const [focus, setFocus] = useState<DeskArrival | null>(taskId ? addressed(taskId) : null);

  /* THE ADDRESS CAN NAME A TASK AFTER THE DESK IS UP — the bell's door onto
     a Done (two-way phase 2, PR C) is pressed from Home itself, and only the
     search changes, so nothing remounts the desk (the outlet is keyed on the
     pathname). A task newly named turns the desk to Tasks with it chosen,
     in the same paint and without a slide: the address moved, not a hand
     on the tabs. An address that stops naming one leaves the face where the
     reader put it. The adjust-in-render idiom today's Home uses. */
  const [namedTask, setNamedTask] = useState<string | null>(taskId);
  if (taskId !== namedTask) {
    setNamedTask(taskId);
    if (taskId) {
      setFace("tasks");
      setMotion(null);
      setFocus(addressed(taskId));
    }
  }

  /* What slides, and what clips each slide. Read only in the effect and the
     handlers, never in render. */
  const bodyRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const diaryRef = useRef<HTMLElement>(null);
  const tasksRef = useRef<HTMLElement>(null);
  const calendarRef = useRef<HTMLElement>(null);
  const faceRefs = { diary: diaryRef, tasks: tasksRef, calendar: calendarRef };
  const runs = useRef<Animation[]>([]);
  const partOf = (p: SlidePart): HTMLElement | null =>
    p === "main" ? mainRef.current : p === "diary" ? diaryRef.current : p === "tasks" ? tasksRef.current : calendarRef.current;
  const boxOf = (b: SlidePlan["box"]): HTMLElement | null => (b === "body" ? bodyRef.current : columnRef.current);

  /* `pointer` false: a face chosen from the keyboard (the arrows, Home and
     End, a tab pressed with a key, or a door between faces pressed with a
     key) is simply there — law 8, no motion on a keyboard-driven action —
     and a slide still in flight stops. Every caller says which it was:
     there is no default to fall back to. */
  const go = (next: DeskFace, pointer: boolean) => {
    if (next === face) return;
    const plan = slidePlan(face, next);
    const was = motion && slidePlan(motion.from, motion.to);
    /* the face on its way in is the one leaving now: it leaves from there */
    const x0 = plan && was && was.arriving === plan.leaving ? offsetOf(partOf(plan.leaving)) : 0;
    for (const a of runs.current) a.cancel();
    runs.current = [];
    setFace(next);
    setMotion(pointer && motionAllowed() ? { from: face, to: next, x0 } : null);
  };

  /* A TIFF LANDING WHILE THE CALENDAR IS UP. What her modal filed lands in
     the diary, which the Calendar covers, so the Diary comes in first — in
     tab order, from the left, as his prototype's did (v33, `land()`, the
     top bar's Tiff) — and the entry lights there once it is on screen
     (./home-diary-feed). Words said in the Calendar's own room are the
     Calendar's, and it keeps them (his `calLand`): nothing comes over it.
     Still under reduced motion, like every slide, and simply there for a
     conversation the keyboard drove (law 8). Taken from the host as it
     changes, while rendering, as the diary takes it; at rest there is no
     slide in flight to stop, so this is state alone. */
  const { landed } = useTiff();
  const [heard, setHeard] = useState<TiffLanded | null>(null);
  /** Counts the landings that brought the Diary in, for the focus below. */
  const [landings, setLandings] = useState(0);
  if (landed !== heard) {
    setHeard(landed);
    if (landed && landed.noteIds.length > 0 && landed.room !== "calendar" && face === "calendar" && !motion) {
      setFace("diary");
      setMotion(!landed.keyboard && motionAllowed() ? { from: "calendar", to: "diary", x0: 0 } : null);
      setLandings((n) => n + 1);
    }
  }
  /* The modal gave focus back as it closed; where that was in the Calendar,
     the Calendar has just gone inert, and focus would fall to the top of
     the page. The tab of the face that came in holds it instead. */
  useLayoutEffect(() => {
    if (!landings) return;
    if (calendarRef.current?.contains(document.activeElement))
      document.getElementById("hdtab-diary")?.focus({ preventScroll: true });
  }, [landings]);

  /* THE SLIDE. After the commit that shows both parts and before the paint:
     the one leaving goes out the far side and holds there, the one arriving
     comes in from the near side. At rest, the part that left is hidden by
     then, so its held pose can go. */
  useLayoutEffect(() => {
    if (!motion) {
      for (const a of runs.current) a.cancel();
      runs.current = [];
      return;
    }
    const plan = slidePlan(motion.from, motion.to);
    const clip = plan && boxOf(plan.box);
    const out = plan && partOf(plan.leaving);
    const inn = plan && partOf(plan.arriving);
    if (!plan || !clip || !out || !inn) return;
    const w = clip.clientWidth;
    const timing = { duration: FACE_SLIDE_MS, easing: "ease-out" };
    const leave = out.animate(
      [{ transform: `translateX(${motion.x0}px)` }, { transform: `translateX(${-plan.dir * w}px)` }],
      { ...timing, fill: "forwards" },
    );
    const come = inn.animate(
      [{ transform: `translateX(${motion.x0 + plan.dir * w}px)` }, { transform: "none" }],
      { ...timing, fill: "backwards" },
    );
    runs.current = [leave, come];
    let live = true;
    Promise.all([leave.finished, come.finished]).then(
      () => {
        if (live) setMotion(null);
      },
      /* cancelled by the next press, which has its own slide */
      () => {},
    );
    return () => {
      live = false;
    };
  }, [motion]);

  /* THE ONE DOOR. The face it names shows it and hands it back: the diary
     brings an entry or a conversation up and lights it, the Tasks face
     chooses a task by id. A door pressed with a pointer slides its face in
     like a tab; one pressed from the keyboard does not, and the face it
     lands on scrolls to what it names at once rather than smoothly
     (law 8). */
  const show = (to: DeskFocus, pointer: boolean) => {
    go(to.face, pointer);
    setFocus({ ...to, pointer });
  };
  const openEntry = (id: string, pointer: boolean) => show({ face: "diary", kind: "entry", ids: [id] }, pointer);
  /* A task's door to its entry is offered only for an entry the diary
     holds (`holds`, above): never one that would slide the diary in on
     nothing. */
  const inDiary = useCallback((id: string) => holds.entries.has(id), [holds]);
  /* A task an ask made opens its conversation, by the ask's note, as the
     list's door does — and only one the diary holds (`holds`): an ask older
     than its reach, or deleted in ServiceM8, has none. */
  const openConversation = (noteUuid: string, pointer: boolean) =>
    show({ face: "diary", kind: "conversation", ids: [noteUuid] }, pointer);
  const inConversation = useCallback((noteUuid: string) => holds.notes.has(noteUuid), [holds]);
  const taskFocus = focus?.face === "tasks" && focus.kind === "task" ? focus : null;
  /* The diary shows an entry, and a conversation by one of its notes (a
     task an ask made, from the list). */
  const diaryFocus =
    focus?.face === "diary" && (focus.kind === "entry" || focus.kind === "conversation") ? focus : null;
  /* Rows a door asked to see stand in the list, beside Diary and Tasks
     alike; the list lights them once and hands the door back, and so does
     the Tasks face its task. One callback for every render: each waits on
     it for its moment, and a new one would start the wait again. */
  const rowsFocus = focus?.kind === "rows" ? focus : null;
  const focusShown = useCallback(() => setFocus(null), []);
  /* A diary door names tasks, or an issue. Where the list beside it holds
     them, they light there and the diary stays; one the list does not hold
     (a task ticked off today) opens on the Tasks tab, if that has a row for
     it: every task you have a hand in, open, and done in the last 90 days.
     An issue is the list's alone — the Tasks face has none. One that
     neither holds (ticked off long ago, an issue resolved) has nowhere to
     land, and the diary says it rather than drawing a door that would open
     on some other row. */
  const onList = useMemo(() => (list ? thingsOnList(list) : new Set<string>()), [list]);
  const record = data.desk?.tasks;
  const onTasks = useMemo(
    () => new Set([...(record?.open ?? []), ...(record?.done ?? [])].map((t) => t.id)),
    [record],
  );
  const onPage = useMemo(() => new Set([...onList, ...onTasks]), [onList, onTasks]);
  const showThings = (ids: readonly string[], pointer: boolean) => {
    const to = thingsDoor(ids, { list: onList, tasks: onTasks });
    if (to) show(to, pointer);
  };

  const leaving = motion?.from ?? null;
  const shown = (p: SlidePart) => partShown(p, face, leaving);
  const facePanel = (f: DeskFace, body: ReactNode) => (
    <section
      ref={faceRefs[f]}
      className="hd-face"
      id={`hdsec-${f}`}
      role="tabpanel"
      aria-labelledby={`hdtab-${f}`}
      hidden={!shown(f)}
      inert={f !== face}
      {...(f === "calendar" ? KEEPS_DAY : {})}
    >
      {body}
    </section>
  );

  return (
    /* `full`: paper to the frame, like every screen. `.stg` is the frame's
       own flex column; `.hd-page` carries this Home's tokens. */
    <div className="page in full">
      <div className="wrap">
        <div className="stg hd-page">
          <ScreenBand title={fmtAuWeekdayDateLong(today)} />

          <HomeDay rail={rail} />

          <div className="hd-body">
            <HomeFaceTabs face={face} onGo={go} />
            <div className="hd-fx" ref={bodyRef}>
              <div className="hd-main" ref={mainRef} hidden={!shown("main")}>
                <div className="hd-col" ref={columnRef}>
                  {facePanel(
                    "diary",
                    data.desk && (
                      <HomeDiaryFeed
                        diary={data.desk.diary}
                        showing={face === "diary"}
                        viewerStaffId={viewerStaffId}
                        focus={diaryFocus}
                        onFocusShown={focusShown}
                        onPage={onPage}
                        onShowThings={showThings}
                      />
                    ),
                  )}
                  {facePanel(
                    "tasks",
                    /* Dated by the workspace's day, the one the list beside
                       it places by, so a task late here is late there. */
                    data.desk && (
                      <HomeTasksFace
                        today={rail.dayISO}
                        record={data.desk.tasks}
                        viewerStaffId={viewerStaffId}
                        canManage={canManage}
                        assignable={assignable}
                        tz={rail.tz}
                        onOpenEntry={openEntry}
                        canOpenEntry={inDiary}
                        onOpenConversation={openConversation}
                        canOpenConversation={inConversation}
                        focusTaskId={taskFocus?.ids[0] ?? null}
                        focusByPointer={taskFocus?.pointer === true}
                        onFocusHandled={focusShown}
                        /* where each task's Done stands with ServiceM8,
                           read over the face's own tasks — empty, from no
                           read, without notes */
                        sm8Lines={data.desk.taskLines.lines}
                        sm8Sender={data.desk.taskLines.sender}
                      />
                    ),
                  )}
                </div>
                {/* THE LIST, beside the column: the frame's grid takes a
                    second column when it is here. It stays put while Diary
                    and Tasks slide past each other, and goes with the
                    column when the Calendar slides across. */}
                {list && (
                  <HomeList
                    list={list}
                    onShow={show}
                    flash={rowsFocus}
                    onFlashDone={focusShown}
                    inert={face === "calendar"}
                  />
                )}
              </div>
              {facePanel("calendar", data.desk && <HomeCalendarPage cal={data.desk.calendar} />)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
