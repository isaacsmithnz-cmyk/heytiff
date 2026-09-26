"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ScreenBand } from "@/components/shell/screen-band";
import { fmtAuWeekdayDateLong } from "@/lib/au-dates";
import {
  DEFAULT_FACE,
  FACE_SLIDE_MS,
  partShown,
  slidePlan,
  type DeskFace,
  type DeskFocus,
  type SlidePart,
  type SlidePlan,
} from "@/lib/dashboard/desk-focus";
import { motionAllowed } from "@/lib/dashboard/day-flip";
import { placeHomeList } from "@/lib/dashboard/home-list";
import type { DashboardData } from "@/lib/dashboard/page-data";
import { HomeCalendarFace } from "./home-calendar-face";
import { HomeDay } from "./home-day";
import { KEEPS_DAY } from "./home-day-bar";
import { HomeDiary } from "./home-diary";
import { HomeFaceTabs } from "./home-face-tabs";
import { DeskJobHost } from "./home-job-sheet";
import { HomeList } from "./home-list";
import { HomeTasks } from "./home-tasks";

/* THE NEW HOME — the desk (docs/design.md, "Home is the day, three tabs and
   the list", 2026-09-25). Behind HOME_DESK (lib/dashboard/desk-flag): the
   owner's until the flip, and the crew's Home (./home) does not change.

   The date is the h1, in the band every screen wears. Under it "Your day",
   which stays on every face (Isaac, 2026-09-25: "The top hero can stay as it
   is, that says Your day"). Under that ONE row of tabs, Diary | Tasks |
   Calendar, which never moves, and under the tabs the body, which SLIDES:
   the Calendar across the whole body, Tasks across the diary column, in tab
   order ("Calendar should slide across"). Only the faces scroll.

   THE FACES ARE HELD, NOT BUILT, in this first cut: today's diary, tasks and
   calendar stand in them, in their own dress, until each face's own lands.
   "Your day" is his own already (./home-day), and so is THE LIST in the
   right-hand column beside Diary and Tasks (./home-list), which the
   Calendar slides across with the column. Every new file mounts here and
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

const taskDoor = (id: string): DeskFocus => ({ face: "tasks", kind: "task", ids: [id] });

function Desk({ data, taskId }: { data: DashboardData; taskId: string | null }) {
  const { calendar, tasks, journal, issues, assignable, canManage, viewerStaffId, today, rail } = data;
  /* The list, placed from its own reads and what the page already holds —
     pure, and dated on the server by the workspace's day. */
  const list = useMemo(() => (data.desk ? placeHomeList(data.desk.list, data) : null), [data]);

  const [face, setFace] = useState<DeskFace>(taskId ? "tasks" : DEFAULT_FACE);
  const [motion, setMotion] = useState<Motion | null>(null);
  /* A door from one face to another, until the face it names has shown it. */
  const [focus, setFocus] = useState<DeskFocus | null>(taskId ? taskDoor(taskId) : null);

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
      setFocus(taskDoor(taskId));
    }
  }
  /* The entry today's diary is reading — null reads the newest. */
  const [entryId, setEntryId] = useState<string | null>(null);

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

  /* THE ONE DOOR. Today's diary reads a chosen entry rather than taking a
     door, so an entry is chosen here; today's tasks take a task by id and
     hand the door back once it is shown. A door pressed with a pointer
     slides its face in like a tab; one pressed from the keyboard does not. */
  const show = (to: DeskFocus, pointer: boolean) => {
    go(to.face, pointer);
    if (to.face === "diary" && to.kind === "entry") {
      setEntryId(to.ids[0] ?? null);
      return;
    }
    setFocus(to);
  };
  const openTask = (id: string, pointer: boolean) => show(taskDoor(id), pointer);
  const openEntry = (id: string, pointer: boolean) => show({ face: "diary", kind: "entry", ids: [id] }, pointer);
  const taskFocus = focus?.face === "tasks" && focus.kind === "task" ? (focus.ids[0] ?? null) : null;
  /* Rows a door asked to see stand in the list, beside Diary and Tasks
     alike; the list lights them once and hands the door back. */
  const rowsFocus = focus?.kind === "rows" ? focus : null;
  const rowsShown = useCallback(() => setFocus(null), []);

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
                    <div className="hm-face two">
                      <HomeDiary
                        entries={journal}
                        today={today}
                        selectedId={entryId}
                        onSelect={setEntryId}
                        onOpenTask={openTask}
                        onOpenIssue={openTask}
                      />
                    </div>,
                  )}
                  {facePanel(
                    "tasks",
                    <div className="hm-face two">
                      <HomeTasks
                        today={today}
                        mine={tasks.mine}
                        team={tasks.team}
                        done={tasks.done}
                        reported={tasks.reported}
                        issues={issues}
                        viewerStaffId={viewerStaffId}
                        canManage={canManage}
                        assignable={assignable}
                        journal={journal}
                        tz={rail.tz}
                        onOpenEntry={openEntry}
                        focusTaskId={taskFocus}
                        onFocusHandled={() => setFocus(null)}
                        /* where each task's Done stands with ServiceM8 —
                           empty, from no read, without notes */
                        sm8Lines={tasks.sm8?.lines}
                        sm8Sender={tasks.sm8?.sender ?? null}
                      />
                    </div>,
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
                    onFlashDone={rowsShown}
                    inert={face === "calendar"}
                  />
                )}
              </div>
              {facePanel(
                "calendar",
                <div className="hm-face one">
                  <HomeCalendarFace cal={calendar} today={today} />
                </div>,
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
