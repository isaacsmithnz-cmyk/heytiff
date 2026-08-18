"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { appendSpoken, useDictation } from "./dictation";
import { askBrain } from "@/lib/brain/ask-client";
import { looksLikeQuestion } from "@/lib/brain/intent";
import { clearRun, markProposal, markRouting } from "@/lib/voice/timing";
import { matchJob } from "@/lib/workboard/note-match";
import type { NoteProposal, NoteStaff } from "@/lib/workboard/note-brain";
import type { NoteTarget } from "@/app/actions/workboard-notes";
import {
  answerClarify,
  applyNote,
  dismissNote,
  keepNoteForMe,
  keepNoteOnJob,
  routeNote,
} from "@/app/actions/workboard-notes";
import { useCaptureMode } from "./capture-default";
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

export function useNoteFlow(opts: { debrief?: boolean; governsDefault?: boolean } = {}) {
  const debrief = opts.debrief === true;
  /* WHOSE DEFAULT IS IT? Only the Tiff button opens according to the stored
     mode, so only its sheet may show a control labelled "Default" or write
     one. The debrief has its own two doors on its own button and the field
     postures are opened by a nudge — a preference offered there would be
     claiming authority over a surface that never consults it. */
  const governsDefault = opts.governsDefault === true;
  const router = useRouter();
  const scope = useNoteScope();
  const [busy, start] = useTransition();
  /* How the sheet opens — your last choice, remembered. Lives on the flow so
     the button that honours it and the buttons that change it read one
     value; see ./capture-default for why it is stored at all. */
  const { mode, choose: chooseMode } = useCaptureMode();

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
  /** The last recording stopped at the CEILING rather than because anyone
      decided it had. See the note above `useDictation` below. */
  const [ranOut, setRanOut] = useState(false);
  /* ANY OF THIS ARRIVED BY VOICE. `submit` is now always reached by pressing
     `Go`, so the caller can no longer tell the router how the
     words got here — and a spoken note recorded as typed is a quiet lie in
     the data. Sticky for the whole capture: talk, then tidy it by keyboard,
     and it is still a note you spoke. */
  const [spoke, setSpoke] = useState(false);

  /* THE TAG IS A SUGGESTION, NOT A RULE.

     The screen you opened this from rides along as a tag — "Meridian Data ·
     CRACs" — and the note lands there. But standing on a job card is not the
     same as talking about that job: you notice something about the NEXT
     visit, or remember to chase a supplier, or ask a question that has
     nothing to do with the site you happen to be standing on.

     So the tag comes off. Dropping it is per-capture and nothing more — the
     screen keeps reporting what it is about, and the next thing you open is
     tagged again. A drop that stuck would be a setting nobody knew they had
     changed. `reset()` clears it, so closing the sheet is enough. */
  const [aimDropped, setAimDropped] = useState(false);

  /* ── the ask path ──
     Separate state from the note flow on purpose: an answer is not a
     proposal, and mixing them would let a stray question mutate a review in
     progress. `askText` grows as the stream does; `askTools` is the honest
     progress — each entry is a read that actually happened. */
  const [asking, setAsking] = useState(false);
  const [askText, setAskText] = useState("");
  const [askTools, setAskTools] = useState<string[]>([]);
  const askAbort = useRef<AbortController | null>(null);

  /* ONE effective target, derived once. Every consumer below reads this and
     never `scope.target`, or dropping the tag would come off the ribbon while
     the note still quietly filed itself against the job. */
  const aimed = scope.target.kind !== "none" && !!scope.target.id && !aimDropped;
  /* Memoised because `read` and `ask` are `useCallback`s that depend on it —
     a fresh object each render would rebuild both every time and make the
     memoisation decorative. `scope.target` is itself stable between pushes. */
  const target: NoteTarget = useMemo(
    () => (aimed ? scope.target : { kind: "none" }),
    [aimed, scope.target]
  );
  const targetLabel = aimed ? scope.targetLabel : undefined;

  const reset = useCallback(() => {
    setNote(null);
    setRanOut(false);
    setSpoke(false);
    setAimDropped(false);
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
          target,
          targetLabel,
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
    [target, targetLabel]
  );

  /** Hand words to the router. The note row is written before the model runs
      and kept whatever it says — the words someone spoke are the valuable
      thing, routing is an enhancement on top. */
  const read = useCallback(
    (source: "text" | "voice", transcript: string) => {
      setError(null);
      setDone(null);
      markRouting();
      start(async () => {
        const res = await routeNote({ transcript, target, source, debrief });
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
    [target, router, debrief]
  );

  /* WHERE A SUBMIT DECIDES WHAT IT IS. One branch, used by both the typed
     submit and the voice transcript, so the two ways in can never disagree
     about what a question looks like. A debrief never asks — it is capture
     by definition, and "what's left at Meridian" inside a braindump is a
     note line, not a conversation. The bias in `looksLikeQuestion` runs
     hard toward note, because a note eaten by the answer path saves
     nothing, while a question on the review card is one Discard away. */
  const submit = useCallback(
    (words: string) => {
      setText(words);
      /* The source is DERIVED, not passed. Every submit is now the same
         button press, so a caller saying "text" would be reporting how the
         commit happened rather than how the words arrived — and the only
         thing that knows the latter is this hook. */
      if (!debrief && looksLikeQuestion(words)) ask(words);
      else read(spoke ? "voice" : "text", words);
    },
    [debrief, ask, read, spoke]
  );

  /* THE CEILING IS NOT A DECISION.

     Every other stop on this flow means "I have finished saying it", so the
     transcript goes straight to routing. The two-minute cap looks identical
     to the engine and means the opposite: the person was mid-sentence and
     the clock ran out. Routing there would file half a note and drop them on
     a review card for a thought they had not finished — worst of all on the
     debrief, which is a whole day's braindump and the single most likely
     recording to run long.

     So a capped transcript is KEPT AND HELD: appended to the box, nothing
     routed, mic ready. Press it again and carry on; the words accumulate
     until you stop because you actually meant to. */
  const engine = useDictation({
    onTranscript: (transcript, { capped }) => {
      /* WORDS GO IN THE BOX. NOTHING ROUTES OFF A TRANSCRIPT.

         This used to route the moment you pressed Stop, which made speaking
         the one way into the app you could not check first: the box
         unmounted, the router ran, and the review card showed you what had
         been MADE of your words with the words themselves no longer
         editable. Mishear "grilles" as "grills" and you could fix the task
         it produced but never the note it saved.

         Isaac, comparing it to dictating into a chat box (2026-08-10):
         there, speech fills a composer you then send. So it does here. Stop
         puts the words in front of you, you fix or add to them, and `Sort
         this out` is the single commit for spoken and typed alike.

         It also makes this hook agree with every other mic in the app — the
         ask bar and the field mics have always just appended to a box. The
         capture flow was the odd one out, and the `handedOver` flag existed
         only to carve out an exception that is now the rule.

         THE WHOLE THING, NOT THE LAST LEG: a note spoken across three
         recordings is one note. `text` is current — the callbacks are
         re-stashed every render, so each leg sees what the one before it
         appended.

         AND NOT AFTER YOU HAVE GONE. `cancel()` marks a run discarded when
         the card closes mid-read-back, so this should never fire for a
         capture nobody is looking at — but the cost of being wrong is the
         worst bug this card has had: words from the LAST note appearing in
         the box of the NEXT one, or arriving mid-sentence while you record.
         The engine is a shared component with four callers; the sheet's own
         answer to "is anybody here" is one line, and it is this one. */
      if (!open) return;
      setText(appendSpoken(text, transcript));
      setSpoke(true);
      setRanOut(capped);
    },
    onError: setError,
  });

  /* A NEW RECORDING RETIRES THE LAST ONE'S COMPLAINT. Live-walked on prod
     2026-08-10: "Nothing was said in that one. Try again, or type it." was
     still sitting on the card six seconds INTO the recording it had just
     asked for — a message that invites a retry and then calls the retry a
     failure before you have finished the first sentence. Worse, it is the
     one error whose subject is ambiguous: "that one" now reads as the
     recording you can see running.

     An error belongs to the attempt that produced it, so pressing the mic
     retires it. Wrapped here rather than inside `useDictation` because the
     engine reports errors and does not own them — this hook does. Every
     posture goes through `flow.dict`, so there is one place to do it. */
  const dict = {
    ...engine,
    start: () => {
      setError(null);
      engine.start();
    },
  };

  /* The routing call takes about seven seconds — measured, not guessed — and
     `sorting` is that gap given a state of its own. Deliberately NOT the same
     flag as `busy`: `busy` is also true while a confirmed note is SAVING, and
     the save has its own place on the review card. */
  const sorting = busy && !note;

  /* THE MIC OPENING IS PART OF THE RECORDING, as far as this card is
     concerned. `arming` covers the gap between the press and the microphone
     — `getUserMedia`, the tap, the chime — and branching on `recording`
     alone made the sheet render its IDLE self across it: press the Tiff
     button and a small card flashed up, box, Default switch and all, before
     the recording card replaced it. The button opens the sheet and asks for
     the mic in the same click, so the flash was exactly that gap.

     Nothing is being recorded yet and the card does not pretend otherwise —
     the clock reads 0:00 and the trace is flat, which is what an open card
     with no audio in it looks like anyway for the first tick. */
  const stage: Stage = dict.recording || dict.arming
    ? "recording"
    /* `handing` is the read-back somebody asked to TYPE through, and it stays
       on the idle stage — the box, with the words joining it when they land.
       Pressing "Type instead" and being shown a full-card animation is the
       card answering a request for the keyboard with a performance (Isaac,
       2026-08-17). The wait is identical; only who asked for it differs, and
       that decides what they should be looking at. */
    : dict.transcribing && !dict.handing
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
  const scoped = aimed;
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
    mode,
    chooseMode,
    governsDefault,
    stage,
    busy,
    debrief,
    open,
    setOpen,
    text,
    setText,
    /** The last recording stopped at the ceiling — say so, and invite more. */
    ranOut,
    setRanOut,
    /** The tag is showing and the note will land on it. */
    aimed,
    /** What the ribbon should name — absent once the tag is dropped. */
    targetLabel,
    /** Take the tag off for this capture only. */
    dropAim: () => setAimDropped(true),
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
