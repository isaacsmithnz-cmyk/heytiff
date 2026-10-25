"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { readJobConversation } from "@/app/actions/job-conversation";
import { undoNote } from "@/app/actions/workboard-notes";
import { useNoteScope } from "@/components/notes/note-context";
import { useTiff } from "@/components/tiff/modal/tiff-context";
import { useConversation, type Opening } from "@/components/tiff/modal/use-conversation";
import { nextVisitOf, type JobConversationRead, type RailTask } from "@/lib/jobs/job-conversation";
import type { StoryEntry } from "@/lib/workboard/job-story";
import type { MirrorJobDetail } from "@/lib/workboard/all-jobs-query";
import { JobConversation, type ConversationDiary } from "./job-conversation";
import { JobFacts } from "./job-facts";
import { JobSummary } from "./job-summary";
import { JobTodo } from "./job-todo";
import { useTasksChanged } from "@/lib/tasks/changed";
import dynamic from "next/dynamic";

/* a task's own form, loaded when one is opened: the job card carries this
   Overview onto every screen and none needs the form until then */
const TaskForm = dynamic(() => import("@/components/making/task-form").then((m) => m.TaskForm), { ssr: false });

/* A JOB'S OVERVIEW (v2, step 6, slice A; the board JC-1; laid out again as
   Isaac's refined Overview A, 25 October 2026: "Yes, build the refined
   Overview A"). Top to bottom:

     the stages line, handed in by the page (it lives on Overview only);
     the strip of facts (job-facts.tsx): Site, Contact, Next visit and,
       for whoever sees money, Money;
     what the page puts under the strip: a tracked job's board;
     two columns split by a full-height hairline: on the left the Summary
       (job-summary.tsx) and To do (job-todo.tsx), on the right the
       Activity feed (job-conversation.tsx), Tiff's box at its head.

   Every section is one recipe (job-section.tsx): a coloured block and its
   title, at most one button on the right, then rows under hairlines.

   It reads what the card's record doesn't hold (app/actions/job-conversation):
   what Tiff said back to each note and what she made, and the job's open
   tasks. It reads again when something here changes them: Tiff files or
   takes back from the box, an Undo or a tick lands, a note lands in the
   diary, or the Tiff modal (the mic on another door, a Tiff button) closes
   on something it filed. Until it answers, the diary's own entries are
   already drawn.

   The box's conversation is the Tiff modal's (use-conversation), held
   here, aimed at this job, in the job's diary room: what she is told
   here is routed, asked about and filed exactly as the modal does it,
   replying in the language she was told it in and recording in English
   (lib/lang/policy, in the router). It never listens by itself; the box's
   microphone puts said words in the box, which go as voice. */

/** The room a sticking column keeps above it, and below it, in the page's scroller. */
const STICK_GAP = 24;

/* THE LEFT COLUMN STAYS IN VIEW (the walk of 25 October 2026: the feed
   runs long, and Summary and To do ended halfway down). It sticks in the
   page's scroller as the feed scrolls, but only while it fits in the
   scroller's height: a Summary taller than that scrolls with the page, so
   nothing in it is ever out of reach. */
function useStickWhileItFits() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [fits, setFits] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const scroller = el.closest<HTMLElement>(".outlet");
    const measure = () => {
      const room = (scroller?.clientHeight ?? window.innerHeight) - 2 * STICK_GAP;
      setFits(el.offsetHeight > 0 && el.offsetHeight <= room);
    };
    measure();
    const seen = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    seen?.observe(el);
    if (scroller) seen?.observe(scroller);
    window.addEventListener("resize", measure);
    return () => {
      seen?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return [ref, fits] as const;
}

const OPENING: Opening = { origin: null, still: true, at: 0, room: "diary" };

/* The tick's actions, reached when a tick is pressed: the job card carries
   this Overview into every screen it opens on, and none of them needs the
   task actions until someone ticks one here. */
const taskActions = () => import("@/app/actions/dashboard");

export function JobOverview({
  cardId,
  label,
  story,
  loading,
  moneyVisible,
  detail,
  fallbackWhat,
  diary,
  onToast,
  head,
  doors,
  under,
}: {
  cardId: string | null;
  /** What the job is called where Tiff says where words are going. */
  label?: string;
  story: StoryEntry[];
  loading: boolean;
  moneyVisible: boolean;
  detail: MirrorJobDetail | null;
  /** The row's title, until the detail's description is read. */
  fallbackWhat: string | null;
  diary: ConversationDiary;
  onToast: (message: string, undo?: () => void | Promise<void>) => void;
  /** Over the strip: the stages line. */
  head?: ReactNode;
  /** The sections' doors and the Money cell's insides, the page's own. */
  doors: {
    onVisits: () => void;
    onBook?: () => void;
    money?: ReactNode;
    onMoney?: () => void;
    onAddTask?: () => void;
    /** Contact's Edit, where saving customers is on. */
    onEditContact?: () => void;
    /** What's open on the job (the attention rows), at the head of To do. */
    open?: ReactNode;
    openCount?: number;
  };
  /** Under the strip: a tracked job's board. */
  under?: ReactNode;
}) {
  const router = useRouter();
  const scope = useNoteScope();
  const [mainRef, mainFits] = useStickWhileItFits();
  const tiff = useTiff();
  const convo = useConversation({
    opening: OPENING,
    voiceEnabled: false,
    target: cardId ? { kind: "job", id: cardId } : { kind: "none" },
    targetLabel: label,
    onLeave: (href) => router.push(href),
  });

  /* THE READ, and every reason to read it again */
  const [read, setRead] = useState<JobConversationRead | null>(null);
  /* the read answered or failed: the Summary reads the description then */
  const [readDone, setReadDone] = useState(false);
  const [kick, setKick] = useState(0);
  const again = () => setKick((k) => k + 1);
  const readAgain = useCallback(() => setKick((k) => k + 1), []);
  /* each answer Tiff gives in the box: a filing, an Undo's line, a question */
  const filedHere = convo.turns.filter((t) => t.who === "tiff").length;
  const ours = story.filter((e) => e.kind === "note" && e.origin === "heytiff").length;
  const landed = tiff.landed?.noteIds.join(",") ?? "";
  useEffect(() => {
    if (!cardId) return;
    let live = true;
    void readJobConversation(cardId)
      .then((r) => {
        if (live) setRead(r);
      })
      .catch(() => {
        /* the diary's own entries still stand; what Tiff made waits for the next read */
      })
      .finally(() => {
        if (live) setReadDone(true);
      });
    return () => {
      live = false;
    };
  }, [cardId, kick, filedHere, ours, landed]);

  /* a task made, changed or ticked anywhere on the page (New › Task, a row's
     own form) is read again here: it never reached this To do until a
     reload (25 October 2026) */
  useTasksChanged(readAgain);

  /* leaving: a note Tiff was still asking about is set aside, as the modal
     does when it closes */
  const close = useRef(convo.close);
  useEffect(() => {
    close.current = convo.close;
  });
  useEffect(() => () => void close.current(), []);

  /* A TICK closes the task; the toast's Undo opens it again */
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const untick = (id: string) =>
    setTicked((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  const tick = (t: RailTask) => {
    setTicked((s) => new Set(s).add(t.id));
    void taskActions()
      .then((a) => a.completeTask(t.id, { postDone: true }))
      .catch(() => ({ ok: false as const, error: "Couldn't complete that task." }))
      .then((res) => {
        if (!res.ok) {
          untick(t.id);
          onToast(res.error);
          return;
        }
        again();
        onToast("Task done", async () => {
          const back = await taskActions()
            .then((a) => a.reopenTask(t.id, { takeBackDone: true }))
            .catch(() => ({ ok: false as const, error: "Couldn't reopen that task." }));
          untick(t.id);
          if (!back.ok) onToast(back.error);
          again();
        });
      });
  };

  const undoTalk = async (noteId: string) => {
    const res = await undoNote(noteId);
    if (!res.ok) onToast(res.error);
    else onToast(res.summary);
    again();
  };

  /* a task's own form over the page, from To do (Isaac, 24 October 2026) */
  const [openTask, setOpenTask] = useState<string | null>(null);
  const today = read?.today ?? null;
  const tasks = (read?.tasks ?? []).filter((t) => !ticked.has(t.id));
  const what = (detail?.description ?? fallbackWhat ?? "").trim();

  return (
    <div className="jov">
      {head && <div className="jov-line">{head}</div>}
      <JobFacts
        detail={detail}
        next={detail ? nextVisitOf({ booked: detail.booked ?? null, nextBooking: detail.nextBooking }, today) : null}
        nextRead={!!detail}
        onVisits={doors.onVisits}
        onBook={doors.onBook}
        money={doors.money}
        onMoney={doors.onMoney}
        onEditContact={doors.onEditContact}
      />
      {under}
      <div className="jov-cols">
        <div className={`jov-main${mainFits ? " jov-main--stick" : ""}`} ref={mainRef}>
          <JobSummary fromQuote={read?.summary ?? null} description={what} read={readDone || !!read || (!cardId && !loading)} />
          <JobTodo
            tasks={tasks}
            tasksRead={!!read}
            onTick={tick}
            onAddTask={doors.onAddTask}
            open={doors.open}
            openCount={doors.openCount ?? 0}
            done={read?.done ?? []}
            onOpenTask={setOpenTask}
          />
          {openTask ? <TaskForm taskId={openTask} onClose={() => setOpenTask(null)} onChanged={again} /> : null}
        </div>
        <div className="jov-side">
          <JobConversation
            story={story}
            talks={read?.notes ?? []}
            today={today}
            loading={loading}
            moneyVisible={moneyVisible}
            diary={diary}
            convo={convo}
            canSend={!!cardId}
            viewerName={read?.viewer.name ?? null}
            voiceEnabled={scope.voiceEnabled}
            onUndoTalk={undoTalk}
          />
        </div>
      </div>
    </div>
  );
}
