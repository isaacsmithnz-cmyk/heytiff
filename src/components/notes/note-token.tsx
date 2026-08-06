"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";
import { LevelBars, appendSpoken, clockOf, useDictation } from "./dictation";
import { useNoteFlow, type NoteFlow } from "./note-flow";
import { useNoteScope } from "./note-context";
import { Cascade, JobPicker, ReviewRows, nothingTicked } from "./review-card";
import { describeJob } from "@/lib/workboard/note-match";
import { sniff } from "@/lib/notes/sniff";

/* ONE TOKEN, EVERYWHERE.

   Five controls used to do some subset of "hear a person and do something
   with the words": a pill that routed, a box that appended, a one-liner that
   appended, a bridge button that carried text from the second to the first,
   and — on most of the app — nothing at all. This is all of them.

   THE ONLY THING THAT VARIES IS POSTURE, and posture is about where the
   token is standing, not about what it can do:

     capsule  the corner token. Keyboard | mic in one object, mic the wider
              half. Opens a sheet carrying record → sorting → review.
     strip    a row that lives with the notes it joins. Same flow, but the
              review grows in place instead of covering the job.
     field    a textarea with the token on it. Fills the box and shuts up;
              only offers to route when the words smell actionable.
     line     the same, one line, commits an item at a time.

   WHAT IT DOES WITH THE WORDS comes from context (./note-context): on a job
   card the note lands on that job, anywhere else it's a universal note taker
   that falls through to your own notes. No caller passes a target.

   THE MIC IS ALWAYS AN ENHANCEMENT. No key, no permission, no MediaRecorder —
   every posture is still a control you can type into. That rule is why the
   capsule is a capsule and not the bare mic it started as: a lone microphone
   advertises one way in, and typing is first-class here. */

export type Posture = "capsule" | "strip" | "field" | "line" | "debrief";

/* ── the token's two halves, shared by capsule and strip ── */

function TokenHalves({
  onType,
  onTalk,
  voiceEnabled,
  live,
  className = "",
  label,
}: {
  onType: () => void;
  onTalk: () => void;
  voiceEnabled: boolean;
  live?: boolean;
  className?: string;
  label: string;
}) {
  return (
    <span className={`wb2-tok${live ? " live" : ""} ${className}`.trim()}>
      <button type="button" className="wb2-tokhalf" onClick={onType} aria-label={`Type ${label}`}>
        <Icon name="keyboard" size={17} />
      </button>
      {voiceEnabled && (
        <>
          <span className="wb2-tokdiv" aria-hidden="true" />
          {/* The wider half, deliberately. Both stay full targets so typing
              is never a sliver, but the note you speak is the one this
              exists for and the shape should say so. */}
          <button
            type="button"
            className="wb2-tokhalf mic"
            onClick={onTalk}
            aria-label={`Say ${label}`}
          >
            <Icon name="mic" size={20} />
          </button>
        </>
      )}
    </span>
  );
}

/* ── the surface: ribbon + whatever the stage calls for ── */

function Ribbon({ flow }: { flow: NoteFlow }) {
  const { stage, scope, chosenJob } = flow;
  return (
    <div className="wb2-capribbon">
      {stage === "recording" ? (
        <span className="wb2-recdot" aria-hidden="true" />
      ) : stage === "sorting" || stage === "transcribing" ? (
        <span className="wb2-spin" aria-hidden="true" />
      ) : (
        <Icon name="note" size={16} />
      )}
      <b>
        {stage === "recording"
          ? "Recording"
          : stage === "transcribing"
            ? "Reading it back"
            : stage === "review"
              ? "Check it before it saves"
              : stage === "sorting"
                ? "Sorting it out"
                : flow.debrief
                  ? "Debrief"
                  : "Add a note"}
      </b>
      {flow.debrief ? (
        <span className="wb2-chip">Tasks, knowledge &amp; your notes</span>
      ) : scope.targetLabel ? (
        <span className="wb2-chip blue">Against: {scope.targetLabel}</span>
      ) : (
        <span className="wb2-chip">{chosenJob ? chosenJob.clientName : "General note"}</span>
      )}
      {stage === "recording" && <span className="wb2-capclock">{clockOf(flow.dict.seconds)}</span>}
      <button className="wb2-ico" onClick={flow.close} title="Discard" aria-label="Discard">
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

function Body({ flow }: { flow: NoteFlow }) {
  const stage = flow.stage;
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  /* `sorting` is in here because the textarea UNMOUNTS while the router
     thinks. Without it, a note that fails to route comes back to a box the
     cursor isn't in — the one moment you're most likely to want to retry. */
  useEffect(() => {
    if (flow.open && stage === "idle") textRef.current?.focus();
  }, [flow.open, stage]);

  if (stage === "sorting") {
    /* Something has to MOVE, or seven seconds is indistinguishable from a
       hang — and the note is worth re-reading while you wait, because the
       next screen asks you to confirm what was made of it. The skeleton rows
       hold the space the review is about to occupy. They do NOT count up,
       name steps, or claim to know what was found: there is a standing rule
       here against interfaces that pretend to be further along than they are. */
    return (
      <div className="wb2-sorting" role="status" aria-live="polite">
        <p className="wb2-sortnote">{flow.text}</p>
        <div className="wb2-sortrows" aria-hidden="true">
          <span className="wb2-skel wb2-skel-a" />
          <span className="wb2-skel wb2-skel-b" />
          <span className="wb2-skel wb2-skel-c" />
        </div>
        <p className="wb2-hint">Working out what this becomes — tasks, flags, or just a note.</p>
      </div>
    );
  }

  if (stage === "recording") {
    return (
      <div className="wb2-caprec">
        <LevelBars innerRef={flow.dict.barsRef} />
        {/* The card must never claim to be hearing you when it isn't. On the
            batch transport there is nothing to show until you stop, and the
            hint says exactly that. The live transport earns the other line by
            actually having words. */}
        {flow.dict.interim ? (
          <p className="wb2-livetext" aria-live="polite">
            {flow.dict.interim}
          </p>
        ) : (
          <p className="wb2-hint">
            If the bars don&apos;t move when you talk, nothing is being heard. Words are read back
            when you stop.
          </p>
        )}
        <div className="wb2-capact">
          <button className="pbtn ghost" onClick={flow.close}>
            Discard
          </button>
          <button className="pbtn" onClick={flow.dict.stop}>
            <Icon name="square" size={15} />
            Stop &amp; read
          </button>
        </div>
      </div>
    );
  }

  if (stage === "transcribing") return <p className="wb2-hint">Reading it back…</p>;

  if (stage === "idle") {
    return (
      <>
        <textarea
          ref={textRef}
          className="wb2-notes"
          rows={flow.debrief ? 6 : 3}
          value={flow.text}
          onChange={(e) => flow.setText(e.target.value)}
          placeholder={
            flow.debrief
              ? "Everything on your mind, in any order — jobs, people, things to chase, things you learned. It gets sorted; nothing is lost."
              : "Tell Luke he needs to order the grilles, and the middle rooftop unit tripped again…"
          }
          disabled={flow.busy}
        />
        <div className="wb2-capact">
          <button className="pbtn ghost" onClick={flow.close} disabled={flow.busy}>
            Discard
          </button>
          {flow.scope.voiceEnabled && (
            <button className="pbtn ghost" onClick={flow.dict.start} disabled={flow.busy}>
              <Icon name="mic" size={15} />
              Say it instead
            </button>
          )}
          <button
            className="pbtn"
            aria-label="Sort this out"
            onClick={() => flow.read("text", flow.text)}
            disabled={flow.busy || !flow.text.trim()}
          >
            {flow.busy ? "Reading…" : "Sort this out"}
          </button>
        </div>
      </>
    );
  }

  return <Review flow={flow} />;
}

function Review({ flow }: { flow: NoteFlow }) {
  const { note, draft } = flow;
  if (!note || !draft) return null;

  return (
    <div className="wb-review" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }}>
      <p className="wb-notetext">{note.proposal.plainNote || flow.text}</p>

      {note.proposal.clarify && (
        <div className="wb-ask">
          <b>{note.proposal.clarify.question}</b>
          <div className="int-act">
            {note.proposal.clarify.options.map((o) => (
              <button
                key={o}
                className="wb-chip"
                disabled={flow.busy}
                onClick={() => flow.sendAnswer(o)}
              >
                {o}
              </button>
            ))}
          </div>
          <div className="wb-row">
            <input
              className="wb-inline"
              value={flow.answer}
              onChange={(e) => flow.setAnswer(e.target.value)}
              placeholder="…or answer in your own words"
            />
            <button
              className="pbtn ghost"
              onClick={() => flow.sendAnswer()}
              disabled={flow.busy || !flow.answer.trim()}
            >
              Answer
            </button>
          </div>
        </div>
      )}

      <ReviewRows draft={draft} staff={note.staff} patch={flow.patch} />

      <Cascade
        jobLabel={
          flow.debrief
            ? null
            : flow.scope.targetLabel ?? (flow.chosenJob ? describeJob(flow.chosenJob) : null)
        }
        taskCount={draft.tasks.filter((t) => t.on && t.title.trim() && t.assigneeId).length}
        kbCount={draft.kbEntries.filter((k) => k.on && k.title.trim() && k.body.trim()).length}
        noteLineCount={draft.noteLines.filter((l) => l.on && l.text.trim()).length}
        fallsThrough={flow.fallsThrough}
      />

      {/* Nothing on this card is thrown away quietly. If a ticked row can't be
          saved, Save says so and stays off until you fix it or untick it. */}
      {flow.stops.map((s) => (
        <p className="wb2-capstop" key={s}>
          {s}
        </p>
      ))}

      <div className="wb2-capact">
        {/* A debrief's Save already files its leftovers as the grouped note,
            so a second "keep it" door would file the transcript TWICE. Untick
            everything else and Save IS "just keep my notes". */}
        {flow.debrief ? null : flow.hasTarget ? (
          <button
            className="pbtn ghost"
            onClick={flow.keepOnJob}
            disabled={flow.busy}
            title="Put the words on the job's notes and apply none of this"
          >
            Put it on the job&apos;s notes
          </button>
        ) : (
          <button
            className="pbtn ghost"
            onClick={flow.keepForMe}
            disabled={flow.busy}
            title="Keep the words in your own notes and apply none of this"
          >
            Keep it in my notes
          </button>
        )}
        {/* THE ACCESSIBLE NAME DOES NOT MOVE. The visible label still flips to
            "Saving…", but a button whose NAME changes mid-action is a button a
            screen reader loses track of exactly when it matters — and it made
            this one un-findable in tests the instant a transition was still
            pending, which is the same bug wearing different clothes. */}
        <button
          className="pbtn"
          aria-label="Save these"
          onClick={flow.confirm}
          disabled={flow.busy || nothingTicked(draft) || flow.stops.length > 0}
        >
          {flow.busy ? "Saving…" : "Save these"}
        </button>
      </div>
    </div>
  );
}

/** The job confirmation + picker, shown when a note arrived against nothing
    and there are jobs it could belong to. */
function JobLine({ flow }: { flow: NoteFlow }) {
  /* A debrief spans jobs by nature and its job-bound lanes are closed, so
     offering to pin the WHOLE thing to one job would un-say all of that. */
  if (flow.debrief) return null;
  if (!flow.note || flow.scope.targetLabel || flow.scope.jobs.length === 0) return null;
  return (
    <>
      <div className={"wb2-capjob" + (flow.chosenJob ? " on" : "")}>
        <Icon name={flow.chosenJob ? "check" : "alert"} size={14} />
        <span>
          {flow.chosenJob ? (
            <>
              Sounds like <b>{describeJob(flow.chosenJob)}</b>
            </>
          ) : flow.guess.ambiguous ? (
            "More than one job matches what you said."
          ) : (
            "No job named — it'll go to your own notes."
          )}
        </span>
        {/* The picker lives HERE, on the thing it changes. A select you have
            to scroll past the right answer in is a way to hit the wrong one. */}
        <button
          type="button"
          className="wb2-capchange"
          onClick={() => flow.setPicking(!flow.picking)}
          aria-expanded={flow.picking}
        >
          {flow.chosenJob ? "Change" : "Pick a job"}
        </button>
      </div>
      {flow.picking && (
        <JobPicker
          options={flow.guess.ranked}
          chosenId={flow.chosen?.id ?? null}
          onPick={flow.pickJob}
          onClose={() => flow.setPicking(false)}
        />
      )}
    </>
  );
}

/* ── posture: debrief ──

   THE BUTTON YOU PRESS BEFORE YOU GET STUCK IN (Isaac, 2026-08-06): unload
   everything at once and let the sorting be the machine's problem. One
   labelled button — never an icon alone, because "what does the sparkle do"
   is a question a 6am brain shouldn't have to ask. It opens the same sheet
   as every other posture; only the framing and the brain's instructions
   differ. Typing is as first-class here as everywhere else.

   The word half and the mic half are the capsule again, worn wide: press
   Debrief to type, press the mic to just start talking. */

function DebriefButton({ flow }: { flow: NoteFlow }) {
  return (
    <>
      <div className="wb2-tokdock">
        <span className={"wb2-tok wb2-debrief" + (flow.stage === "recording" ? " live" : "")}>
          <button
            type="button"
            className="wb2-tokhalf wb2-debriefword"
            onClick={() => flow.setOpen(true)}
          >
            <Icon name="sparkles" size={15} />
            Debrief
          </button>
          {flow.scope.voiceEnabled && (
            <>
              <span className="wb2-tokdiv" aria-hidden="true" />
              <button
                type="button"
                className="wb2-tokhalf mic"
                aria-label="Start the debrief by talking"
                onClick={() => {
                  flow.setOpen(true);
                  flow.dict.start();
                }}
              >
                <Icon name="mic" size={19} />
              </button>
            </>
          )}
        </span>
        {flow.done && <span className="wb2-chip ok">{flow.done}</span>}
      </div>

      {flow.open &&
        createPortal(
          <>
            <div className="wb2-capdim" onClick={flow.close} />
            <div
              className="wb2-capcard wb2-caps"
              role="dialog"
              aria-modal="true"
              aria-label="Morning debrief"
            >
              <span className="wb2-grab" aria-hidden="true" />
              <Ribbon flow={flow} />
              {flow.error && <p className="wb2-sherr">{flow.error}</p>}
              <Body flow={flow} />
            </div>
          </>,
          document.body
        )}
    </>
  );
}

/* ── posture: capsule ── */

function Capsule({ flow, label }: { flow: NoteFlow; label: string }) {
  return (
    <>
      <div className="wb2-tokdock">
        <TokenHalves
          label={label}
          voiceEnabled={flow.scope.voiceEnabled}
          live={flow.stage === "recording"}
          onType={() => flow.setOpen(true)}
          onTalk={() => {
            flow.setOpen(true);
            flow.dict.start();
          }}
        />
        {flow.done && <span className="wb2-chip ok">{flow.done}</span>}
      </div>

      {flow.open &&
        createPortal(
          <>
            <div className="wb2-capdim" onClick={flow.close} />
            {/* KEEPS `wb2-capcard` DELIBERATELY. Sixteen rules in shell.css
                name that class to give a PORTALLED surface its button fills,
                type sizes and disabled states — anything declared under `.fg`
                is absent out here, and the capture card shipped once with
                colourless primary buttons for exactly this reason. `wb2-caps`
                only moves it. */}
            <div
              className="wb2-capcard wb2-caps"
              role="dialog"
              aria-modal="true"
              aria-label="Add a note"
            >
              <span className="wb2-grab" aria-hidden="true" />
              <Ribbon flow={flow} />
              {flow.error && <p className="wb2-sherr">{flow.error}</p>}
              <JobLine flow={flow} />
              <Body flow={flow} />
            </div>
          </>,
          document.body
        )}
    </>
  );
}

/* ── posture: strip ──

   ON A JOB CARD, ADDING A NOTE IS THE JOB. That is the whole brief for this
   posture ("if it's on a job card, its main objective is to add notes to
   that job"), and it decides the one thing that could have gone badly wrong
   here: the + does NOT route.

   The first draft of this made every commit go through the router, which
   would have turned "gate code 4417" into a seven-second wait and a review
   card asking which of nothing you'd like to save. Adding a note has to stay
   instant. So the strip obeys the same rule Isaac chose for the plain form
   fields — commit the words, then sniff them locally, and only offer the
   review when they actually look like a job for somebody.

   The review, when the offer is taken, GROWS IN PLACE — no portal, no dim,
   no scroll lock. The argument of this posture is that you keep seeing the
   job the note is about, so covering it would be self-defeating. */

function Strip({
  flow,
  label,
  placeholder,
  value,
  onChange,
  onCommit,
  disabled,
}: {
  flow: NoteFlow;
  label: string;
  placeholder?: string;
  value: string;
  onChange: (next: string) => void;
  onCommit?: () => void;
  disabled: boolean;
}) {
  const mic = useFieldMic(value, onChange);
  const { dict } = mic;
  const shown = dict.interim ? appendSpoken(value, dict.interim) : value;
  const busy = disabled || dict.recording || dict.transcribing;

  if (flow.open && flow.stage !== "idle") {
    return (
      <div className="wb2-stripopen">
        <Ribbon flow={flow} />
        {flow.error && <p className="wb2-sherr">{flow.error}</p>}
        <JobLine flow={flow} />
        <Body flow={flow} />
      </div>
    );
  }

  const commit = () => {
    if (!value.trim()) return;
    onCommit?.();
    /* Sniff what was just committed, not what's in the box — the box is
       about to be cleared by the caller. */
    mic.check(value);
  };

  return (
    <>
      <div className={"wb2-strip" + (dict.recording ? " live" : "")}>
        {dict.recording && <span className="wb2-recdot" aria-hidden="true" />}
        <input
          className="wb2-stripin"
          value={shown}
          placeholder={dict.recording ? "Listening…" : (placeholder ?? "Add a note, or say it…")}
          aria-label={label}
          disabled={busy}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            commit();
          }}
        />
        {mic.voiceEnabled && dict.recording ? (
          <>
            <LevelBars innerRef={dict.barsRef} />
            <span className="wb2-capclock">{clockOf(dict.seconds)}</span>
            <button
              type="button"
              className="wb2-striprnd stop"
              onClick={dict.stop}
              aria-label={`Stop dictating — ${label}`}
            >
              <Icon name="square" size={13} />
            </button>
            <button
              type="button"
              className="wb2-striprnd"
              onClick={dict.cancel}
              aria-label={`Discard the recording — ${label}`}
            >
              <Icon name="x" size={13} />
            </button>
          </>
        ) : (
          <>
            {mic.voiceEnabled && (
              <button
                type="button"
                className="wb2-striprnd"
                aria-label={`Say ${label}`}
                disabled={disabled || dict.transcribing}
                onClick={dict.start}
              >
                <Icon name="mic" size={15} />
              </button>
            )}
            <button
              type="button"
              className="wb2-striprnd go"
              aria-label={`Add ${label}`}
              disabled={busy || !value.trim()}
              onClick={commit}
            >
              <Icon name="plus" size={15} />
            </button>
          </>
        )}
      </div>
      {dict.transcribing && <p className="wb2-dicthint">Reading it back…</p>}
      {mic.err && <p className="wb2-dicterr">{mic.err}</p>}
      {mic.found && (
        <Nudge
          onDismiss={mic.dismiss}
          onOpen={() => {
            const words = mic.found!;
            mic.dismiss();
            flow.setOpen(true);
            flow.read("text", words);
          }}
        />
      )}
    </>
  );
}

/* ── postures: field and line ──

   These FILL A BOX. A mic on "site requirements" is not a note-taker: what
   you dictate belongs to that field and saves with the form around it, so
   routing every gate code would file a task nobody asked for.

   "Smart, but only when it finds something" (Isaac, 2026-08-05) is the
   middle path, and `sniff` is what makes it affordable — deciding the
   question properly costs an Opus call, so a free local sieve decides
   whether to ask. The offer that appears is dismissible and ignoring it
   costs nothing; the field has already saved either way. */

function useFieldMic(value: string, onChange: (next: string) => void) {
  const scope = useNoteScope();
  const [err, setErr] = useState<string | null>(null);
  const [found, setFound] = useState<string | null>(null);

  const dict = useDictation({
    onTranscript: (spoken) => {
      setErr(null);
      const next = appendSpoken(value, spoken);
      onChange(next);
      /* The sieve runs on the WHOLE box, not just the new sentence: dictation
         appends, so "Luke needs to" and "order the grilles before Monday" can
         arrive as two presses and only read as a job together. */
      setFound(sniff(next, scope.staffFirstNames).actionable ? next : null);
    },
    onError: setErr,
  });

  return {
    dict,
    err,
    setErr,
    found,
    /** Run the sieve over words the caller already has — the strip commits
        and clears in one gesture, so by the time it asks, `value` is gone. */
    check: (words: string) => setFound(sniff(words, scope.staffFirstNames).actionable ? words : null),
    dismiss: () => setFound(null),
    voiceEnabled: scope.voiceEnabled,
  };
}

/** The offer. Deliberately quiet: a dashed hairline, no colour shift on the
    field, and a dismiss that leaves nothing behind. */
function Nudge({ onOpen, onDismiss }: { onOpen: () => void; onDismiss: () => void }) {
  return (
    <div className="wb2-nudge">
      <Icon name="sparkles" size={15} />
      <span className="wb2-nudgetext">There&apos;s something to do in this.</span>
      <button type="button" className="pbtn sm" onClick={onOpen}>
        Have a look
      </button>
      <button
        type="button"
        className="wb2-ico"
        onClick={onDismiss}
        aria-label="Ignore that — leave it as a note"
      >
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}

/* ── the component ── */

export function NoteToken({
  as = "capsule",
  label = "a note",
  value,
  onChange,
  onCommit,
  placeholder,
  rows = 3,
  disabled = false,
  className,
}: {
  as?: Posture;
  /** What the token's accessible names say it's for — "a note for this
      visit", "access notes". Never an icon alone. */
  label?: string;
  /** field/line only — the box's own value. */
  value?: string;
  onChange?: (next: string) => void;
  /** line only — Enter, or the +. */
  onCommit?: () => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  className?: string;
}) {
  const flow = useNoteFlow({ debrief: as === "debrief" });

  if (as === "debrief") return <DebriefButton flow={flow} />;
  if (as === "capsule") return <Capsule flow={flow} label={label} />;
  if (as === "strip")
    return (
      <Strip
        flow={flow}
        label={label}
        placeholder={placeholder}
        value={value ?? ""}
        onChange={onChange ?? (() => {})}
        onCommit={onCommit}
        disabled={disabled}
      />
    );

  return (
    <FieldPosture
      as={as}
      label={label}
      value={value ?? ""}
      onChange={onChange ?? (() => {})}
      onCommit={onCommit}
      placeholder={placeholder}
      rows={rows}
      disabled={disabled}
      className={className}
      flow={flow}
    />
  );
}

function FieldPosture({
  as,
  label,
  value,
  onChange,
  onCommit,
  placeholder,
  rows,
  disabled,
  className,
  flow,
}: {
  as: Posture;
  label: string;
  value: string;
  onChange: (next: string) => void;
  onCommit?: () => void;
  placeholder?: string;
  rows: number;
  disabled: boolean;
  className?: string;
  flow: NoteFlow;
}) {
  const mic = useFieldMic(value, onChange);
  const { dict } = mic;
  const shown = dict.interim ? appendSpoken(value, dict.interim) : value;
  const busy = disabled || dict.recording || dict.transcribing;

  const offer = mic.found && (
    <Nudge
      onDismiss={mic.dismiss}
      onOpen={() => {
        mic.dismiss();
        flow.setOpen(true);
        flow.read("text", mic.found!);
      }}
    />
  );

  /* The review, when the offer is taken, is the SAME surface the capsule
     opens — which is the entire point of the unification. */
  const surface =
    flow.open &&
    createPortal(
      <>
        <div className="wb2-capdim" onClick={flow.close} />
        <div className="wb2-caps" role="dialog" aria-modal="true" aria-label="Add a note">
          <span className="wb2-grab" aria-hidden="true" />
          <Ribbon flow={flow} />
          {flow.error && <p className="wb2-sherr">{flow.error}</p>}
          <JobLine flow={flow} />
          <Body flow={flow} />
        </div>
      </>,
      document.body
    );

  if (as === "line") {
    return (
      <div className="wb2-dictline">
        <div className="wb2-addrow">
          <input
            className="wb2-fi"
            placeholder={dict.recording ? "Listening…" : placeholder}
            value={shown}
            disabled={busy}
            aria-label={label}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              onCommit?.();
            }}
          />
          {mic.voiceEnabled && dict.recording ? (
            <>
              <LevelBars innerRef={dict.barsRef} />
              <span className="wb2-capclock">{clockOf(dict.seconds)}</span>
              <button
                type="button"
                className="wb2-micgo on"
                onClick={dict.stop}
                title="Stop and read it back"
                aria-label={`Stop dictating — ${label}`}
              >
                <Icon name="square" size={12} />
              </button>
              <button
                type="button"
                className="wb2-dictx"
                onClick={dict.cancel}
                title="Throw it away"
                aria-label={`Discard the recording — ${label}`}
              >
                <Icon name="x" size={12} />
              </button>
            </>
          ) : (
            <>
              {mic.voiceEnabled && (
                <button
                  type="button"
                  className="wb2-micgo"
                  onClick={dict.start}
                  disabled={disabled || dict.transcribing}
                  title="Say it instead"
                  aria-label={`Dictate — ${label}`}
                >
                  <Icon name="mic" size={14} />
                </button>
              )}
              <button
                type="button"
                className="wb2-addgo"
                disabled={disabled || dict.transcribing || value.trim() === ""}
                title="Add it"
                aria-label={`Add — ${label}`}
                onClick={onCommit}
              >
                <Icon name="plus" size={14} />
              </button>
            </>
          )}
        </div>
        {dict.transcribing && <p className="wb2-dicthint">Reading it back…</p>}
        {mic.err && <p className="wb2-dicterr">{mic.err}</p>}
        {offer}
        {surface}
      </div>
    );
  }

  return (
    <div className={"wb2-dict" + (className ? ` ${className}` : "")}>
      <textarea
        className="wb2-notes"
        rows={rows}
        placeholder={dict.recording ? "Listening…" : placeholder}
        value={shown}
        onChange={(e) => onChange(e.target.value)}
        disabled={busy}
      />
      {mic.voiceEnabled && (
        <div className="wb2-dictbar">
          {dict.recording ? (
            <>
              <button
                type="button"
                className="wb2-dictmic on"
                onClick={dict.stop}
                title="Stop and read it back"
                aria-label={`Stop dictating — ${label}`}
              >
                <Icon name="square" size={13} />
              </button>
              <LevelBars innerRef={dict.barsRef} />
              <span className="wb2-capclock">{clockOf(dict.seconds)}</span>
              <button
                type="button"
                className="wb2-dictx"
                onClick={dict.cancel}
                title="Throw it away"
                aria-label={`Discard the recording — ${label}`}
              >
                <Icon name="x" size={12} />
              </button>
            </>
          ) : dict.transcribing ? (
            <span className="wb2-dicthint">Reading it back…</span>
          ) : (
            <button
              type="button"
              className="wb2-dictmic"
              onClick={dict.start}
              disabled={disabled}
              title="Say it instead"
              aria-label={`Dictate — ${label}`}
            >
              <Icon name="mic" size={13} />
              Say it
            </button>
          )}
        </div>
      )}
      {mic.err && <p className="wb2-dicterr">{mic.err}</p>}
      {offer}
      {surface}
    </div>
  );
}
