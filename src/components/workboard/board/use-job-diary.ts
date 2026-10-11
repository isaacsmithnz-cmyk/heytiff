"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { JobRecordRead } from "@/app/actions/workboard";
import { addJobNote, removeJobNote } from "@/app/actions/job-notes";
import {
  confirmMySm8Link,
  markJobNoteDone,
  readJobNoteStates,
  replyToJobNote,
  sendJobNoteToServiceM8,
  takeBackJobNote,
  undoJobNoteDone,
} from "@/app/actions/job-note-sm8";
import type { JobAttention } from "@/lib/workboard/job-attention";
import type { OurJobNote } from "@/lib/workboard/job-notes-query";
import type { FlagState, NoteState } from "@/lib/integrations/sm8-note-plan";
import type { NoteSender } from "@/lib/integrations/links";
import { NOTE_WORDS } from "@/lib/integrations/sm8-note-words";
import { mintPressId } from "@/lib/workboard/press-id";
import { thrownWords } from "@/lib/stale-deploy";
import { somethingWaiting, useNoteStatePoll } from "./use-note-poll";

/* THE JOB CARD'S DIARY, ITS STATE AND ITS DOORS.

   Lifted out of the card (job-sheet), which had grown to three thousand
   lines with every face's state in one function. This is the diary's: our
   own notes, who the viewer sends to ServiceM8 as, the line on each flag,
   and every press on them — the pen, a take-back, a reply, a copy sent to
   ServiceM8, Mark done and its Undo, "Is <name> you?". The card seeds it
   from the record read and draws what it holds; nothing here knows about
   the card's other faces.

   Two things stay the card's and are handed in: the attention strip, which
   an answered mention or a marked flag leaves, and the whole record read,
   which a flag somebody changed in ServiceM8 sends the card back to. */

export type JobDiaryInput = {
  /** The job's ServiceM8 uuid, once the card knows which job it is. */
  cardId: string | null;
  record: JobRecordRead | null | undefined;
  onToast: (message: string) => void;
  /** The strip's own list, which an answered mention leaves. */
  setAttention: Dispatch<SetStateAction<JobAttention | null>>;
  /** Take one row off the strip. */
  dropAttention: (key: string) => void;
  /** Read the whole record again. */
  reloadRecord: () => void;
};

export function useJobDiary({ cardId, record, onToast, setAttention, dropAttention, reloadRecord }: JobDiaryInput) {
  /* OUR OWN WRITING arrives on the record read and is then LOCAL: a note
     typed at the diary's head has to be on screen at once. */
  const [ourNotes, setOurNotes] = useState<OurJobNote[] | null>(null);
  /* NOTES TO SERVICEM8 (two-way phase 2), seeded from the record read and
     then local for the same reason: who the viewer sends as changes the
     moment they answer "Is <name> you?", and a flag's line the moment they
     mark it. All empty where the deployment sends no notes. */
  const [sender, setSender] = useState<NoteSender | null>(null);
  const [flags, setFlags] = useState<Record<string, FlagState>>({});
  /* each press kicks the poll, so its own note gets its own looks */
  const [pollKick, setPollKick] = useState(0);
  /* An answer that lands after the card has gone draws nothing. */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /* THE PEN. A note typed at the diary's head is a diary entry the moment it
     lands — no round trip to look at first, which is what makes it a diary
     rather than a form. The SAVED row replaces the optimistic one because
     the browser knows its own auth id and not the display name behind it;
     slice 3 shipped that defect on the checklist's stamps and this is the
     same fix, applied before it could happen twice. */
  /* THE PEN'S OWN ID (two-way phase 2) is the optimistic row's id and the
     saved row's, so the same words pressed twice before the save lands are
     ONE entry — and, ticked Also in ServiceM8, one note. The send goes with
     the SAVED id, never a temporary one. */
  const penIds = useRef(new Set<string>());
  const writeNote = (body: string, alsoSm8 = false, composeId?: string): Promise<void> | undefined => {
    if (!cardId) return;
    const text = body.trim();
    if (!text) return;
    if (composeId && penIds.current.has(composeId)) return;
    if (composeId) penIds.current.add(composeId);
    const temp: OurJobNote = {
      id: composeId ?? `tmp-${mintPressId()}`,
      text,
      at: new Date().toISOString(),
      author: null,
    };
    setOurNotes((cur) => [temp, ...(cur ?? [])]);
    return addJobNote(cardId, text, composeId ? { id: composeId } : undefined)
      .then((saved) => {
        setOurNotes((cur) => (cur ?? []).map((n) => (n.id === temp.id ? saved : n)));
        if (alsoSm8) sendCopy(saved.id);
      })
      .catch((e: unknown) => {
        if (composeId) penIds.current.delete(composeId);
        setOurNotes((cur) => (cur ?? []).filter((n) => n.id !== temp.id));
        onToast(thrownWords(e, "Could not save that note"));
      });
  };

  const unwriteNote = (id: string) => {
    const before = ourNotes;
    setOurNotes((cur) => (cur ?? []).filter((n) => n.id !== id));
    void removeJobNote(id)
      .then((res) => {
        if (!res || (res.ok && res.gone)) return;
        /* refused: it stays, and says why */
        if (!res.ok) {
          setOurNotes(before);
          onToast(res.error);
          return;
        }
        /* taken back but something of it may still be in ServiceM8: it
           stays, removed, while its line says so */
        setOurNotes((before ?? []).map((n) => (n.id === id ? { ...n, removed: true } : n)));
        void refreshNoteStates();
        kickPoll();
      })
      .catch((e: unknown) => {
        setOurNotes(before);
        onToast(thrownWords(e, "Could not remove that note"));
      });
  };

  /* ── NOTES TO SERVICEM8 (two-way phase 2): every door asks the server
     and draws what it answers — the state, in its own words ── */

  const notesSm8 = record?.notesSm8 ?? null;

  /** One of our notes' line, as the server now says it. */
  const setNoteState = (id: string, state: NoteState | null, patch: Partial<OurJobNote> = {}) =>
    setOurNotes((cur) =>
      (cur ?? []).map((n) => (n.id === id ? { ...n, ...patch, state: state && state.key ? state : null } : n))
    );

  /** Where everything on the card stands — the poll, and after a press
      whose answer left something on its way. */
  const refreshNoteStates = async () => {
    if (!cardId) return;
    const s = await readJobNoteStates({ jobUuid: cardId });
    if (!s || !alive.current) return;
    setOurNotes((cur) =>
      (cur ?? []).flatMap((n) => {
        const line = s.ours[n.id];
        /* a take-back that settled: nothing of it is left to draw */
        if (line === undefined) return n.removed ? [] : [n];
        return [{ ...n, state: line.key ? line : null }];
      })
    );
    setFlags(s.flags);
  };
  useNoteStatePoll({
    waiting: somethingWaiting(ourNotes, flags),
    kick: pollKick,
    read: refreshNoteStates,
  });
  const kickPoll = () => setPollKick((k) => k + 1);

  const replyNote = async (input: {
    sourceNoteUuid: string;
    words: string;
    spoken: boolean;
    composeId: string;
  }): Promise<string | null> => {
    if (!cardId) return NOTE_WORDS.press.noNote;
    try {
      const res = await replyToJobNote({ jobUuid: cardId, ...input });
      if (!res.ok) {
        if (res.sender) setSender(res.sender);
        return res.error;
      }
      setOurNotes((cur) => [res.note, ...(cur ?? []).filter((n) => n.id !== res.note.id)]);
      /* answered: its mention leaves the strip */
      setAttention((cur) =>
        cur
          ? (() => {
              const items = cur.items.filter((i) => !(i.kind === "mention" && i.noteUuid === input.sourceNoteUuid));
              return { items, total: Math.max(0, cur.total - (cur.items.length - items.length)) };
            })()
          : cur
      );
      kickPoll();
      return null;
    } catch (e) {
      return thrownWords(e, NOTE_WORDS.press.saveFailed);
    }
  };

  function sendCopy(noteId: string) {
    if (!cardId) return;
    void sendJobNoteToServiceM8({ jobUuid: cardId, noteId })
      .then((res) => {
        if (res.ok) setNoteState(noteId, res.state, { hasCreate: true });
        else {
          onToast(res.error);
          if (res.state !== undefined) setNoteState(noteId, res.state);
        }
        kickPoll();
      })
      .catch((e: unknown) => onToast(thrownWords(e, NOTE_WORDS.press.unqueued)));
  }

  const takeBack = (noteId: string) => {
    if (!cardId) return;
    void takeBackJobNote({ jobUuid: cardId, noteId })
      .then((res) => {
        if (res.ok && res.gone) {
          setOurNotes((cur) => (cur ?? []).filter((n) => n.id !== noteId));
          return;
        }
        if (res.ok) setNoteState(noteId, res.state, { removed: true });
        else {
          onToast(res.error);
          if (res.state !== undefined) {
            if (res.state && res.state.key) setNoteState(noteId, res.state, { removed: true });
            else setOurNotes((cur) => (cur ?? []).filter((n) => n.id !== noteId));
          }
        }
        kickPoll();
      })
      .catch((e: unknown) => onToast(thrownWords(e, NOTE_WORDS.press.unqueued)));
  };

  /* ONE PRESS PER MARK. A flag's Mark done (and its Undo) carries an id
     minted once and kept until the server ANSWERS, so a repeat of the same
     press — a retry after a lost answer — is the same subject and the queue
     keeps one; a fresh id only follows a settled answer. And while a press
     on a note is out, its doors are off here and on the strip: a second
     click never becomes a second mark. The ref is the guard (two clicks in
     one tick see it); the state only draws it. */
  const flagPressIds = useRef(new Map<string, string>());
  const flagOut = useRef(new Set<string>());
  const [flagsBusy, setFlagsBusy] = useState<ReadonlySet<string>>(() => new Set());
  const flagPress = (noteUuid: string, doing: "done" | "clear"): string | null => {
    if (flagOut.current.has(noteUuid)) return null;
    flagOut.current.add(noteUuid);
    setFlagsBusy(new Set(flagOut.current));
    const key = `${doing}:${noteUuid}`;
    const id = flagPressIds.current.get(key) ?? mintPressId();
    flagPressIds.current.set(key, id);
    return id;
  };
  const flagSettled = (noteUuid: string, doing: "done" | "clear", answered: boolean) => {
    if (answered) flagPressIds.current.delete(`${doing}:${noteUuid}`);
    flagOut.current.delete(noteUuid);
    if (alive.current) setFlagsBusy(new Set(flagOut.current));
  };

  const markDone = (noteUuid: string, seenEditDate?: string | null) => {
    if (!cardId) return;
    const seen =
      seenEditDate !== undefined
        ? seenEditDate
        : (record?.notes.find((n) => n.remoteId === noteUuid)?.editedAt ?? null);
    const pressId = flagPress(noteUuid, "done");
    if (!pressId) return;
    void markJobNoteDone({ jobUuid: cardId, noteUuid, seenEditDate: seen, pressId })
      .then((res) => {
        flagSettled(noteUuid, "done", true);
        if (res.state) setFlags((cur) => ({ ...cur, [noteUuid]: res.state! }));
        if (res.ok) {
          dropAttention(`sm8flag:${noteUuid}`);
          kickPoll();
          return;
        }
        onToast(res.error);
        /* changed in ServiceM8 since it was read: look again */
        if (res.error === NOTE_WORDS.press.changed) reloadRecord();
      })
      .catch((e: unknown) => {
        flagSettled(noteUuid, "done", false);
        onToast(thrownWords(e, NOTE_WORDS.press.unqueued));
      });
  };

  const undoDone = (noteUuid: string) => {
    if (!cardId) return;
    const pressId = flagPress(noteUuid, "clear");
    if (!pressId) return;
    void undoJobNoteDone({ jobUuid: cardId, noteUuid, pressId })
      .then((res) => {
        flagSettled(noteUuid, "clear", true);
        if (res.state) setFlags((cur) => ({ ...cur, [noteUuid]: res.state! }));
        if (!res.ok) onToast(res.error);
        kickPoll();
      })
      .catch((e: unknown) => {
        flagSettled(noteUuid, "clear", false);
        onToast(thrownWords(e, NOTE_WORDS.press.unqueued));
      });
  };

  /** "Is <name> you?" — Yes on a saved row's line then sends that row. */
  const confirmLink = async (answer: "yes" | "no", thenSend?: string): Promise<string | null> => {
    if (!sender || !("remoteId" in sender)) return NOTE_WORDS.press.unknown;
    try {
      const res = await confirmMySm8Link({ remoteId: sender.remoteId, answer });
      if (!res.ok) {
        onToast(res.error);
        return res.error;
      }
      setSender(res.sender);
      /* guards, not one `&&` — see the note in `uploadDocument` */
      if (answer === "yes") {
        if (thenSend) sendCopy(thenSend);
      }
      return null;
    } catch (e) {
      return thrownWords(e, NOTE_WORDS.press.unknown);
    }
  };

  return {
    ourNotes,
    setOurNotes,
    sender,
    setSender,
    flags,
    setFlags,
    flagsBusy,
    notesSm8,
    writeNote,
    unwriteNote,
    replyNote,
    sendCopy,
    takeBack,
    markDone,
    undoDone,
    confirmLink,
  };
}
