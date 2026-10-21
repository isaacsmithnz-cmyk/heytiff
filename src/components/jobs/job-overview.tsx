"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { JobTiles } from "./job-tiles";

/* A JOB'S OVERVIEW (v2, step 6, slice A; the board JC-1; four tiles, Isaac,
   22 October 2026): on the left the stages line, handed in by the page (it
   lives on Overview only), and under it the four tiles (job-tiles.tsx),
   then the customer; on the right the job's conversation, its full height.

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
  label,
  story,
  loading,
  moneyVisible,
  detail,
  fallbackWhat,
  diary,
  onToast,
  head,
  tiles,
  aside,
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
  /** Over the tiles: the stages line. */
  head?: ReactNode;
  /** The tiles' doors and the Money tile's insides, the page's own. */
  tiles: {
    onVisits: () => void;
    onBook?: () => void;
    money?: ReactNode;
    onMoney?: () => void;
    onAddTask?: () => void;
  };
  /** Under the tiles: the customer. */
  aside?: ReactNode;
}) {
  const router = useRouter();
  const scope = useNoteScope();
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
  const [kick, setKick] = useState(0);
  const again = () => setKick((k) => k + 1);
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
      });
    return () => {
      live = false;
    };
  }, [cardId, kick, filedHere, ours, landed]);

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

  const today = read?.today ?? null;
  const tasks = (read?.tasks ?? []).filter((t) => !ticked.has(t.id));
  const what = (detail?.description ?? fallbackWhat ?? "").trim();

  return (
    <div className="jc">
      <div className="jc-side">
        {head}
        <JobTiles
          what={what}
          next={detail ? nextVisitOf({ booked: detail.booked ?? null, nextBooking: detail.nextBooking }, today) : null}
          onVisits={tiles.onVisits}
          onBook={tiles.onBook}
          money={tiles.money}
          onMoney={tiles.onMoney}
          tasks={tasks}
          tasksRead={!!read}
          onTick={tick}
          onAddTask={tiles.onAddTask}
        />
        {aside}
      </div>
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
  );
}
