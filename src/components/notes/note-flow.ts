"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useDictation } from "./dictation";
import { askBrain } from "@/lib/brain/ask-client";
import { looksLikeQuestion } from "@/lib/brain/intent";
import { clearRun, markProposal } from "@/lib/voice/timing";
import { matchJob } from "@/lib/workboard/note-match";
import type { NoteProposal, NoteStaff } from "@/lib/workboard/note-brain";
import {
  answerClarify,
  applyNote,
  dismissNote,
  keepNoteForMe,
  keepNoteOnJob,
  routeNote,
} from "@/app/actions/workboard-notes";
import { useNoteScope } from "./note-context";
import { blockers, toConfirmed, toDraft, targetOf, type Draft } from "./review-card";

/* THE STATE MACHINE, once.

   Four postures wear this — the corner capsule, the in-place strip, a field
   and a one-liner. Before the unification each of them owned some fraction
   of it and the fractions had drifted: the pill could route but not fill a
   field, the field could fill but not route, and a bridge button existed to
   carry text from the second to the first. There is nothing posture-specific
   in this file, which is the test of whether the split was real. */

export type Stage = "idle" | "recording" | "transcribing" | "sorting" | "review" | "answer";

export function useNoteFlow(opts: { debrief?: boolean } = {}) {
  const debrief = opts.debrief === true;
  const router = useRouter();
  const scope = useNoteScope();
  const [busy, start] = useTransition();

  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<{
    id: string;
    proposal: NoteProposal;
    staff: NoteStaff[];
  } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [answer, setAnswer] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [attachTo, setAttachTo] = useState("");
  const [touched, setTouched] = useState(false);
  const [picking, setPicking] = useState(false);

  /* ── the ask path ──
     Separate state from the note flow on purpose: an answer is not a
     proposal, and mixing them would let a stray question mutate a review in
     progress. `askText` grows as the stream does; `askTools` is the honest
     progress — each entry is a read that actually happened. */
  const [asking, setAsking] = useState(false);
  const [askText, setAskText] = useState("");
  const [askTools, setAskTools] = useState<string[]>([]);
  const askAbort = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setNote(null);
    setDraft(null);
    setAnswer("");
    setText("");
    setAttachTo("");
    setTouched(false);
    setPicking(false);
    askAbort.current?.abort();
    askAbort.current = null;
    setAsking(false);
    setAskText("");
    setAskTools([]);
  }, []);

  /** Hand a question to the brain and stream the answer into the surface. */
  const ask = useCallback(
    (question: string) => {
      setError(null);
      setDone(null);
      setAsking(true);
      setAskText("");
      setAskTools([]);
      const abort = new AbortController();
      askAbort.current = abort;
      void askBrain(
        {
          question,
          target: scope.target,
          targetLabel: scope.targetLabel,
          signal: abort.signal,
        },
        {
          onDelta: (t) => setAskText((s) => s + t),
          onTool: (label) => setAskTools((ts) => (ts.includes(label) ? ts : [...ts, label])),
          onError: (message) => {
            setError(message);
            setAsking(false);
          },
          onDone: () => setAsking(false),
        }
      );
    },
    [scope.target, scope.targetLabel]
  );

  /** Hand words to the router. The note row is written before the model runs
      and kept whatever it says — the words someone spoke are the valuable
      thing, routing is an enhancement on top. */
  const read = useCallback(
    (source: "text" | "voice", transcript: string) => {
      setError(null);
      setDone(null);
      start(async () => {
        const res = await routeNote({ transcript, target: scope.target, source, debrief });
        if (!res.ok) {
          setError(res.error);
          clearRun();
          router.refresh(); // the note itself was still saved
          return;
        }
        /* The end of the wait — the card now has something to check. The
           transport only owns the first half of this number. */
        markProposal();
        setNote({ id: res.noteId, proposal: res.proposal, staff: res.staff });
        setDraft(toDraft(res.proposal));
      });
    },
    [scope.target, router, debrief]
  );

  /* WHERE A SUBMIT DECIDES WHAT IT IS. One branch, used by both the typed
     submit and the voice transcript, so the two ways in can never disagree
     about what a question looks like. A debrief never asks — it is capture
     by definition, and "what's left at Meridian" inside a braindump is a
     note line, not a conversation. The bias in `looksLikeQuestion` runs
     hard toward note, because a note eaten by the answer path saves
     nothing, while a question on the review card is one Discard away. */
  const submit = useCallback(
    (source: "text" | "voice", words: string) => {
      setText(words);
      if (!debrief && looksLikeQuestion(words)) ask(words);
      else read(source, words);
    },
    [debrief, ask, read]
  );

  const dict = useDictation({
    onTranscript: (transcript) => submit("voice", transcript),
    onError: setError,
  });

  /* The routing call takes about seven seconds — measured, not guessed — and
     `sorting` is that gap given a state of its own. Deliberately NOT the same
     flag as `busy`: `busy` is also true while a confirmed note is SAVING, and
     the save has its own place on the review card. */
  const sorting = busy && !note;

  const stage: Stage = dict.recording
    ? "recording"
    : dict.transcribing
      ? "transcribing"
      : asking || askText
        ? "answer"
        : note
          ? "review"
          : sorting
            ? "sorting"
            : "idle";

  const close = useCallback(() => {
    dict.cancel();
    /* Walking away from a parsed note means keep the words, apply none of it.
       Without this the row sits at status "pending" forever — nothing reads
       pending notes, so it is a proposal waiting on a review that can never
       happen. Fire and forget: the surface closes now, the status catches up. */
    if (note) void dismissNote(note.id);
    reset();
    setError(null);
    setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note, reset, dict.cancel]);

  // the token's little "saved" confirmation fades on its own
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(null), 4000);
    return () => clearTimeout(t);
  }, [done]);

  /* WHICH JOB DID THE NOTE MEAN? The words name a client out loud, so the
     card comes back with the job card it thinks that is — number and all —
     for a person to confirm, rather than making them hunt a dropdown. The
     matching is plain code (lib/workboard/note-match), never the model. */
  const guess = useMemo(
    () => matchJob(text || note?.proposal.plainNote || "", scope.jobs),
    [text, note, scope.jobs]
  );

  /* The guess is a SUGGESTION, so it seeds the picker and stays overridable —
     `attachTo` wins the moment it's touched, including when it's set back to
     nothing in particular. */
  const picked = touched
    ? attachTo
    : guess.bestId
      ? `${scope.jobs.find((o) => o.id === guess.bestId)?.kind}:${guess.bestId}`
      : "";

  const chosen = targetOf(picked);
  const chosenJob = chosen ? scope.jobs.find((o) => o.id === chosen.id) ?? null : null;
  const scoped = scope.target.kind !== "none" && !!scope.target.id;
  const hasTarget = scoped || !!chosen;
  const stops = draft ? blockers(draft, hasTarget) : [];

  /** Every ticked row could be saved, and none of them wants a job. That is
      the shape of a note whose only home is you. */
  const fallsThrough = !!draft && !hasTarget && toConfirmed(draft).tasks.length === 0;

  const finish = (summary: string) => {
    setDone(summary);
    reset();
    setOpen(false);
    router.refresh();
  };

  const confirm = () => {
    if (!note || !draft) return;
    setError(null);
    start(async () => {
      const res = await applyNote(note.id, toConfirmed(draft), chosen ?? undefined);
      if (!res.ok) return setError(res.error);
      finish(res.summary);
    });
  };

  const keepOnJob = () => {
    if (!note || !hasTarget) return;
    setError(null);
    start(async () => {
      const res = await keepNoteOnJob(note.id, chosen ?? undefined);
      if (!res.ok) return setError(res.error);
      finish(res.summary);
    });
  };

  /** The floor. Offered when the two rungs above can't take it. */
  const keepForMe = () => {
    if (!note) return;
    setError(null);
    start(async () => {
      const res = await keepNoteForMe(note.id);
      if (!res.ok) return setError(res.error);
      finish(res.summary);
    });
  };

  const sendAnswer = (reply: string = answer) => {
    if (!note) return;
    setError(null);
    start(async () => {
      const res = await answerClarify(note.id, reply);
      if (!res.ok) return setError(res.error);
      setNote({ id: res.noteId, proposal: res.proposal, staff: res.staff });
      setDraft(toDraft(res.proposal));
      setAnswer("");
    });
  };

  const patch = (fn: (d: Draft) => Draft) => setDraft((d) => (d ? fn({ ...d }) : d));

  /* Escape closes the picker first. Discarding a whole reviewed note because
     you meant to shut a dropdown would be its own bug. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (picking) return setPicking(false);
      close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, picking, close]);

  return {
    scope,
    dict,
    stage,
    busy,
    debrief,
    open,
    setOpen,
    text,
    setText,
    error,
    setError,
    note,
    draft,
    patch,
    answer,
    setAnswer,
    sendAnswer,
    done,
    sorting,
    guess,
    chosen,
    chosenJob,
    scoped,
    hasTarget,
    stops,
    fallsThrough,
    picking,
    setPicking,
    pickJob: (value: string) => {
      setTouched(true);
      setAttachTo(value);
      setPicking(false);
    },
    read,
    submit,
    ask,
    asking,
    askText,
    askTools,
    /** Wipe the answer and go again — "Ask another" without closing. */
    askAgain: () => {
      askAbort.current?.abort();
      setAsking(false);
      setAskText("");
      setAskTools([]);
      setText("");
    },
    confirm,
    keepOnJob,
    keepForMe,
    close,
  };
}

export type NoteFlow = ReturnType<typeof useNoteFlow>;
