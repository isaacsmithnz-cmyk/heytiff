"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { readJobConversation } from "@/app/actions/job-conversation";
import { undoNote } from "@/app/actions/workboard-notes";
import { useNoteScope } from "@/components/notes/note-context";
import { useTiff } from "@/components/tiff/modal/tiff-context";
import { TIFF_FILED, useConversation, type Opening } from "@/components/tiff/modal/use-conversation";
import { nextVisitOf, type JobConversationRead, type RailTask } from "@/lib/jobs/job-conversation";
import type { StoryEntry } from "@/lib/workboard/job-story";
import type { MirrorJobDetail } from "@/lib/workboard/all-jobs-query";
import { JobConversation, type ConversationDiary } from "./job-conversation";
import { JobFacts } from "./job-facts";
import type { Hue } from "@/components/parts/state";
import { useFitHeight } from "./use-fit-height";
import { useTasksChanged } from "@/lib/tasks/changed";
import dynamic from "next/dynamic";

/* a task's own form, loaded when one is opened: the job card carries this
   Overview onto every screen and none needs the form until then */
const TaskForm = dynamic(() => import("@/components/making/task-form").then((m) => m.TaskForm), { ssr: false });

/* A JOB'S OVERVIEW (v2, step 6, slice A; the board JC-1; laid out again as
   Isaac's refined Overview A, 25 October 2026, and again on 13 and 14
   November 2026: "Give scope its own tab ... That way the activity section
   can get as much width as it needs"; mocks C and D approved on
   https://claude.ai/artifact/MkfHutEG1PanPDCW7fyV5a). Two columns, fitted
   to the screen, each card scrolling inside itself and never under 420 high
   (use-fit-height; below that the page scrolls and the job's head stays put):

     on the left, 320 wide, the facts card (job-facts.tsx): Next visit, the
       map, the site with Directions, the contacts in full;
     on the right, the Activity feed (job-conversation.tsx) like a chat, its
       box at the foot, To do one of its tabs (mock D).

   The stages line stands beside the job's name (job-page-head.tsx), the
   Scope or Summary on its own tab (job-scope-tab.tsx), Money and the Job
   tracker on Billing, and a tracked job's board is a line in Actions.

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

const OPENING: Opening = { origin: null, still: true, at: 0, room: "diary" };

/* The tick's actions, reached when a tick is pressed: the job card carries
   this Overview into every screen it opens on, and none of them needs the
   task actions until someone ticks one here. */
const taskActions = () => import("@/app/actions/dashboard");

export function JobOverview({
  cardId,
  firstRead,
  label,
  story,
  loading,
  moneyVisible,
  detail,
  askTodo = 0,
  diary,
  onToast,
  doors,
}: {
  cardId: string | null;
  /** The read below as the page already made it, on the server: drawn at
      once, and read again only when something changes it. */
  firstRead?: JobConversationRead | null;
  /** What the job is called where Tiff says where words are going. */
  label?: string;
  story: StoryEntry[];
  loading: boolean;
  moneyVisible: boolean;
  detail: MirrorJobDetail | null;
  /** The job's colour: the pin on its map. */
  hue?: Hue;
  /** Bumped by Actions' Add › To do: the feed opens on To do, its box ready. */
  askTodo?: number;
  diary: ConversationDiary;
  onToast: (message: string, undo?: () => void | Promise<void>) => void;
  /** The sections' doors and the Money cell's insides, the page's own. */
  doors: {
    onVisits: () => void;
    onBook?: () => void;
    /** Contact's Edit, where saving customers is on. */
    onEditContact?: () => void;
    /** Where the job is up to, in the facts card under Next visit. */
    stages?: ReactNode;
    /** What's open on the job (the attention rows), at the head of To do,
        leaving out the tasks To do lists as its own rows. */
    open?: (taskIds: ReadonlySet<string>) => { rows: ReactNode; count: number };
  };
}) {
  const router = useRouter();
  const scope = useNoteScope();
  const [fitRef, fitH] = useFitHeight<HTMLDivElement>();
  const tiff = useTiff();
  const convo = useConversation({
    opening: OPENING,
    voiceEnabled: false,
    target: cardId ? { kind: "job", id: cardId } : { kind: "none" },
    targetLabel: label,
    onLeave: (href) => router.push(href),
  });

  /* THE READ, and every reason to read it again */
  const [read, setRead] = useState<JobConversationRead | null>(() => firstRead ?? null);
  /* the page's own read stands for the first one (Strict Mode's second
     mount reads, which is only development) */
  const skipFirst = useRef(firstRead !== undefined);
  const [kick, setKick] = useState(0);
  const again = () => setKick((k) => k + 1);
  const readAgain = useCallback(() => setKick((k) => k + 1), []);
  /* each answer Tiff gives in the box: a filing, an Undo's line, a question */
  const filedHere = convo.turns.filter((t) => t.who === "tiff").length;
  const ours = story.filter((e) => e.kind === "note" && e.origin === "heytiff").length;
  const landed = tiff.landed?.noteIds.join(",") ?? "";
  useEffect(() => {
    if (!cardId) return;
    if (skipFirst.current) {
      skipFirst.current = false;
      return;
    }
    let live = true;
    void readJobConversation(cardId)
      .then((r) => {
        if (live) setRead(r);
      })
      .catch(() => {
        /* the diary's own entries still stand; what Tiff made waits for the next read */
      });
    return () => {
      live = false;
    };
  }, [cardId, kick, filedHere, ours, landed]);

  /* a task made, changed or ticked anywhere on the page (New › Task, a row's
     own form) is read again here: it never reached this To do until a
     reload (25 October 2026) */
  useTasksChanged(readAgain);
  /* her window closed while she worked, and she has filed since: what she
     saved lands here too (call 10) */
  useEffect(() => {
    window.addEventListener(TIFF_FILED, readAgain);
    return () => window.removeEventListener(TIFF_FILED, readAgain);
  }, [readAgain]);

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
      .catch(() => ({ ok: false as const, error: "Couldn't tick that to do." }))
      .then((res) => {
        if (!res.ok) {
          untick(t.id);
          onToast(res.error);
          return;
        }
        again();
        onToast("To do ticked", async () => {
          const back = await taskActions()
            .then((a) => a.reopenTask(t.id, { takeBackDone: true }))
            .catch(() => ({ ok: false as const, error: "Couldn't open that to do again." }));
          untick(t.id);
          if (!back.ok) onToast(back.error);
          again();
        });
      });
  };

  /* SAVE ON THE TO DO TAB (call 8): the words as written, a To do for you on
     the job with no date; the toast's Undo takes it back */
  const addTodo = async (words: string): Promise<boolean> => {
    if (!cardId) return false;
    const a = await taskActions().catch(() => null);
    const res = a ? await a.makeTasks({ text: words, jobUuid: cardId }).catch(() => null) : null;
    if (!res?.ok) {
      onToast(res && !res.ok ? res.error : "That to do didn't save. Try it again.");
      return false;
    }
    again();
    onToast(res.taskIds.length === 1 ? "To do added" : `${res.taskIds.length} to dos added`, async () => {
      await Promise.all(res.taskIds.map((id) => a!.deleteTask(id).catch(() => null)));
      again();
    });
    return true;
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
  /* a task To do lists is its row, never an attention row too (N1) */
  const asks = doors.open?.(new Set((read?.tasks ?? []).map((t) => t.id)));

  return (
    <div className="jov jov--fit" ref={fitRef} style={fitH == null ? undefined : ({ "--fit-h": `${fitH}px` } as CSSProperties)}>
      <div className="jov-left">
        <JobFacts
          detail={detail}
          next={detail ? nextVisitOf({ booked: detail.booked ?? null, nextBooking: detail.nextBooking }, today) : null}
          nextRead={!!detail}
          onVisits={doors.onVisits}
          onBook={doors.onBook}
          onEditContact={doors.onEditContact}
          stages={doors.stages}
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
          jobUuid={cardId ?? null}
          onSaved={() => {
            router.refresh();
            again();
          }}
          customer={read?.customer}
          comms={read?.comms}
          askTodo={askTodo}
          quoteChat={read?.quoteChat ?? null}
          todos={{
            tasks,
            done: read?.done ?? [],
            read: !!read,
            onTick: tick,
            onOpen: setOpenTask,
            open: asks?.rows,
            openCount: asks?.count ?? 0,
            onAdd: cardId ? addTodo : undefined,
          }}
        />
      </div>
    </div>
  );
}
