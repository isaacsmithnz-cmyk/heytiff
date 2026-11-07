"use client";

import { useState } from "react";
import type { StoryEntry } from "@/lib/workboard/job-story";
import { NoteToken } from "@/components/notes/note-token";
import { mentionedHandles } from "@/lib/workboard/sm8-mentions";
import { mintPressId } from "@/lib/workboard/press-id";
import { fillWords, NOTE_WORDS, senderWords } from "@/lib/integrations/sm8-note-words";
import type { FlagState, NoteState } from "@/lib/integrations/sm8-note-plan";
import type { SendHold } from "@/lib/integrations/sm8-write-plan";
import type { NoteSender } from "@/lib/integrations/links";
import { StateLine } from "./state-line";

/* A NOTE'S DOORS — what is left of the job card's Diary face. The face
   itself, its pen and its day-marked feed, went once the job's Overview
   became its conversation (components/jobs/job-conversation), which draws
   every note as a message and takes from here what a note offers wherever
   it is drawn: its line and doors (NoteDoors), the Also in ServiceM8 tick
   and why it can't send yet (AlsoSm8), and @mentions worn as callouts
   (withMentions).

   OUR NOTES AND SERVICEM8'S ARE ONE STREAM. They are the same act — a
   person wrote on this job — and only the entry's `origin` says which
   system holds the row. Ours can be taken back off; theirs cannot, and the
   doors say so by simply not offering.

   WHERE NOTES ARE OFFERED (two-way phase 2), A NOTE TALKS BACK. A
   ServiceM8 note that mentions you offers Reply, and the reply is yours,
   with where it stands with ServiceM8 in that state's words
   (lib/integrations/sm8-note-plan's noteState — nothing here words a state
   itself). Your own note can go to ServiceM8 too, from the Also in
   ServiceM8 tick or its own Send to ServiceM8, and Undo (Remove, on an
   entry) takes it back whatever state it is in. A flagged note offers Mark
   done, as you. Every door on a note of ours is its sender's alone: the
   line's `acts` already say whose. Where notes aren't offered the doors to
   send are gone, and a note that already has a state still shows it. */

/** What notes to ServiceM8 hand the diary (two-way phase 2). */
export type DiaryNotesSm8 = { trial: boolean; hold: SendHold; owner: boolean };

export type NoteEntry = Extract<StoryEntry, { kind: "note" }>;

/** The handlers a note's doors call — each is the card's, which asks the
    server and answers with what now stands. */
export type Doors = {
  sender: NoteSender | null;
  notesSm8: DiaryNotesSm8 | null;
  flags: Record<string, FlagState>;
  /** Resolves with the refusal's words, or null once the reply is saved. */
  onReply?: (input: { sourceNoteUuid: string; words: string; spoken: boolean; composeId: string }) => Promise<string | null>;
  onSendCopy?: (noteId: string) => void;
  onTakeBack?: (noteId: string) => void;
  onMarkDone?: (noteUuid: string, seenEditDate: string | null) => void;
  onUndoDone?: (noteUuid: string) => void;
  /** The flags a Mark done or its Undo is out on: their doors are off. */
  flagsBusy: ReadonlySet<string>;
  /** The answer to "Is <name> you?"; `thenSend` is the row a line's Yes
      then sends. Resolves with the refusal's words, or null. */
  onConfirm?: (answer: "yes" | "no", thenSend?: string) => Promise<string | null>;
  onRemoveNote?: (id: string) => void;
};

/** Whether a note kept as typed goes to ServiceM8 too, said where notes
    are offered: the tick, and while the viewer can't send yet, why, with
    "Is <name> you?" and an owner's Link people. The job's conversation,
    whose Keep as typed was the diary pen's path, draws the why. */
export function AlsoSm8({
  also,
  onTick,
  sender,
  notesSm8,
  onConfirm,
  part = "both",
}: {
  also: boolean;
  onTick: (on: boolean) => void;
  sender: NoteSender | null;
  notesSm8: DiaryNotesSm8;
  onConfirm?: Doors["onConfirm"];
  /** The tick alone (in a box's bottom row, a job's Overview), the line
      saying why it can't send alone (under that box), or both together. */
  part?: "both" | "tick" | "why";
}) {
  const ready = sender?.state === "ready";
  const why = sender && !ready ? senderWords(sender) : null;
  const box = (
    <label className="wb2-flcheck">
      <input type="checkbox" checked={ready && also} disabled={!ready} onChange={(e) => onTick(e.target.checked)} />
      {NOTE_WORDS.door.alsoInSm8}
    </label>
  );
  if (part === "tick") return box;
  if (part === "why" && !why) return null;
  return (
    <div className="wb2-evreply">
      {part === "both" && box}
      {why && (
        <div className="wb2-jcattsave">
          <span className="wb2-evmeta">{why}</span>
          {sender?.state === "confirm" && onConfirm && <ConfirmDoors onConfirm={onConfirm} />}
          {notesSm8.owner && (
            <a className="wb2-evdoor" href="/dashboard/admin/integrations/servicem8">
              {NOTE_WORDS.door.linkPeople}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/** Yes and Not me, for "Is <name> you?". Yes never sends by itself: the
    caller decides what follows (`thenSend`). */
function ConfirmDoors({ onConfirm, thenSend }: { onConfirm: NonNullable<Doors["onConfirm"]>; thenSend?: string }) {
  const [busy, setBusy] = useState(false);
  const answer = (a: "yes" | "no") => {
    setBusy(true);
    void onConfirm(a, a === "yes" ? thenSend : undefined).finally(() => setBusy(false));
  };
  return (
    <>
      <button className="wb2-evdoor" disabled={busy} onClick={() => answer("yes")}>
        {NOTE_WORDS.door.yes}
      </button>
      <button className="wb2-evdoor" disabled={busy} onClick={() => answer("no")}>
        {NOTE_WORDS.door.notMe}
      </button>
    </>
  );
}

/* ── a reply ── */

/** The box under a note: the words, said or typed (no Tiff offer — a reply
    is a reply), and Send reply. While the viewer hasn't said who they are
    in ServiceM8, the question stands where Send reply would. A refusal
    keeps the words in the box; a save closes it. */
function ReplyBox({
  sourceNoteUuid,
  doors,
  onClose,
}: {
  sourceNoteUuid: string;
  doors: Doors;
  onClose: () => void;
}) {
  const [words, setWords] = useState("");
  const [spoken, setSpoken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* the box's own id: one reply however many presses, a new one per reply */
  const [composeId, setComposeId] = useState(mintPressId);

  const send = () => {
    if (!doors.onReply || busy) return;
    setBusy(true);
    setError(null);
    void doors
      .onReply({ sourceNoteUuid, words, spoken, composeId })
      .then((refused) => {
        if (refused) {
          setError(refused);
          return;
        }
        setWords("");
        setSpoken(false);
        setComposeId(mintPressId());
        onClose();
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="wb2-evreply">
      <NoteToken
        as="field"
        label="a reply"
        offer={false}
        rows={2}
        value={words}
        onChange={setWords}
        onSpoken={() => setSpoken(true)}
        placeholder={NOTE_WORDS.door.replyPlaceholder}
        disabled={busy}
      />
      <div className="wb2-jcattsave">
        {doors.sender?.state === "confirm" && doors.onConfirm ? (
          <>
            <span className="wb2-evmeta">{fillWords(NOTE_WORDS.press.confirm, { sm8Name: doors.sender.sm8Name })}</span>
            <ConfirmDoors onConfirm={doors.onConfirm} />
          </>
        ) : (
          <button className="wb2-evdoor" disabled={busy || !words.trim()} onClick={send}>
            {NOTE_WORDS.door.sendReply}
          </button>
        )}
        <button className="wb2-evdoor" disabled={busy} onClick={onClose}>
          {NOTE_WORDS.door.cancel}
        </button>
      </div>
      {error && (
        <div className="wb2-evmeta">
          <StateLine as="span" line={{ word: error, tone: "bad" }} />
        </div>
      )}
    </div>
  );
}

/** A note's line and doors, under its words: where one of ours stands with
    ServiceM8 and its sender's doors, Remove, Send to ServiceM8, a flag's
    Mark done and its Undo, and Reply with its box. Shared with the job's
    conversation (components/jobs/job-conversation), which draws the same
    note as a message, so a note offers the same doors in both. */
export function NoteDoors({
  entry,
  doors,
  replyOpen,
  onReplyOpen,
}: {
  entry: NoteEntry;
  doors: Doors;
  replyOpen: boolean;
  onReplyOpen?: (on: boolean) => void;
}) {
  const ours = entry.origin === "heytiff";
  const state: NoteState | null = ours ? (entry.state ?? null) : null;
  const flag = !ours && entry.sm8Uuid ? (doors.flags[entry.sm8Uuid] ?? null) : null;
  /* a Mark done or its Undo is out on this flag: one press, one answer */
  const flagBusy = !!entry.sm8Uuid && doors.flagsBusy.has(entry.sm8Uuid);
  const { sender, notesSm8 } = doors;

  /* REPLY: only on a mention of you, never on your own note, and only when
     you can send (or be asked who you are). One of ours can be answered
     only once its copy is in ServiceM8, and never once its author took it
     back: a withdrawn row is drawn only to say it is on its way out. */
  const canAnswer = !!notesSm8 && !!sender && (sender.state === "ready" || sender.state === "confirm");
  const you = sender && "handle" in sender ? sender.handle : null;
  const mentionsYou = !!you && mentionedHandles(entry.text, [you]).length > 0;
  const replyable =
    canAnswer &&
    mentionsYou &&
    !!entry.sm8Uuid &&
    !entry.removed &&
    !!doors.onReply &&
    (ours ? !entry.mine : !(sender && "remoteId" in sender && entry.authorSm8Uuid && entry.authorSm8Uuid === sender.remoteId));

  const acts = state?.acts ?? [];
  const flagActs = flag?.acts ?? [];
  /* one of yours that never left HeyTiff, where notes are offered */
  const sendable = ours && !state && !!entry.mine && !entry.hasCreate && canAnswer && !!doors.onSendCopy;
  const remove = ours && entry.id && doors.onRemoveNote && (
    <button
      className="wb2-evdoor wb2-evdoor--remove"
      onClick={() => doors.onRemoveNote!(entry.id!)}
    >
      Remove
    </button>
  );

  return (
    <>
      {state?.text && (
        <div className="wb2-evmeta">
          <StateLine as="span" line={{ word: state.text, tone: state.tone }} />
        </div>
      )}

      {/* ── ours with a state: the sender's doors, from its line ── */}
      {ours && entry.id && state && acts.length > 0 && (
        <div className="wb2-jcattsave">
          {acts.includes("confirm") && sender?.state === "confirm" && doors.onConfirm && (
            <>
              <span className="wb2-evmeta">{fillWords(NOTE_WORDS.press.confirm, { sm8Name: sender.sm8Name })}</span>
              <ConfirmDoors onConfirm={doors.onConfirm} thenSend={entry.id} />
            </>
          )}
          {/* the question was answered since (here, or on another note):
              the row can simply go again */}
          {(acts.includes("send_again") || (acts.includes("confirm") && sender?.state === "ready")) && doors.onSendCopy && (
            <button className="wb2-evdoor" onClick={() => doors.onSendCopy!(entry.id!)}>
              {NOTE_WORDS.door.sendAgain}
            </button>
          )}
          {acts.includes("take_out_again") && doors.onTakeBack && (
            <button className="wb2-evdoor" onClick={() => doors.onTakeBack!(entry.id!)}>
              {NOTE_WORDS.door.tryAgain}
            </button>
          )}
          {acts.includes("undo") && doors.onTakeBack && (
            <button className={entry.replyTo ? "wb2-evdoor" : "wb2-evdoor wb2-evdoor--remove"} onClick={() => doors.onTakeBack!(entry.id!)}>
              {entry.replyTo ? NOTE_WORDS.door.undo : NOTE_WORDS.door.remove}
            </button>
          )}
        </div>
      )}

      {/* ── ours with no state: HeyTiff's only. Remove, as ever; and its
          author may send it where notes are offered, once ── */}
      {ours && entry.id && !state && sendable && (
        <div className="wb2-jcattsave">
          <button className="wb2-evdoor" onClick={() => doors.onSendCopy!(entry.id!)}>
            {NOTE_WORDS.door.sendToSm8}
          </button>
          {remove}
        </div>
      )}
      {ours && entry.id && !state && !sendable && remove}

      {/* ── ServiceM8's flag: Mark done as you, or your own mark's Undo ── */}
      {!ours && entry.sm8Uuid && flagActs.length > 0 && (
        <div className="wb2-jcattsave">
          {notesSm8 && doors.onMarkDone && (flagActs.includes("mark_done") || flagActs.includes("mark_done_again")) && (
            <button
              className="wb2-evdoor"
              disabled={flagBusy}
              onClick={() => doors.onMarkDone!(entry.sm8Uuid!, entry.editedAt ?? null)}
            >
              {flagActs.includes("mark_done_again") ? NOTE_WORDS.door.markDoneAgain : NOTE_WORDS.door.markDone}
            </button>
          )}
          {flagActs.includes("unmark") && doors.onUndoDone && (
            <button className="wb2-evdoor" disabled={flagBusy} onClick={() => doors.onUndoDone!(entry.sm8Uuid!)}>
              {NOTE_WORDS.door.undo}
            </button>
          )}
        </div>
      )}

      {replyable && !replyOpen && (
        <button className="wb2-evdoor" onClick={() => onReplyOpen?.(true)}>
          {NOTE_WORDS.door.reply}
        </button>
      )}
      {replyable && replyOpen && (
        <ReplyBox sourceNoteUuid={entry.sm8Uuid!} doors={doors} onClose={() => onReplyOpen?.(false)} />
      )}
    </>
  );
}

/** ServiceM8 @mentions, worn the way the diary mock wears them — the handle
    is lower(first+last), so the string itself is the join key slice 5 will
    resolve; here it only needs to read as a callout.

    AN "@" INSIDE A WORD IS AN ADDRESS, NOT A MENTION. The diary records the
    documents emailed from the job ("… to josh@lsdb.com.au"), and a split on
    every "@" drew "@lsdb" as a callout in the middle of it — the same
    tolerance lib/workboard/sm8-mentions already gives an email address. */
export function withMentions(text: string): React.ReactNode {
  const parts = text.split(/((?<![\w.+-])@[a-z0-9_]+)/gi);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    /^@[a-z0-9_]+$/i.test(part) ? (
      <span key={i} className="wb2-mention">
        {part}
      </span>
    ) : (
      part
    )
  );
}
