"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";
import { Chevron } from "@/components/logo";
import { DictClock, LevelOrb, appendSpoken, useDictation } from "./dictation";
import { useNoteFlow, type NoteFlow } from "./note-flow";
import { useNoteScope } from "./note-context";
import { Cascade, JobPicker, ReviewRows, nothingTicked } from "./review-card";
import { describeJob } from "@/lib/workboard/note-match";
import { sniff } from "@/lib/notes/sniff";
import { TiffMark } from "./tiff-mark";

/* ONE TOKEN, EVERYWHERE.

   Five controls used to do some subset of "hear a person and do something
   with the words": a pill that routed, a box that appended, a one-liner that
   appended, a bridge button that carried text from the second to the first,
   and — on most of the app — nothing at all. This is all of them.

   THE ONLY THING THAT VARIES IS POSTURE, and posture is about where the
   token is standing, not about what it can do:

     strip    a row that lives with the notes it joins. Same flow, but the
              review grows in place instead of covering the job.
     field    a textarea with the token on it. Fills the box and shuts up;
              only offers to route when the words smell actionable.
     line     the same, one line, commits an item at a time.

   WHAT IT DOES WITH THE WORDS comes from context (./note-context): on a job
   card the note lands on that job, anywhere else it's a universal note taker
   that falls through to your own notes. No caller passes a target.

   THE CORNER TOKEN IS NOT IN HERE ANY MORE. It was the `capsule` posture — a
   keyboard|mic pill mounted by two workboard screens — and it has become the
   Tiff button in ./tiff-button, which stands in the app FRAME and is on every
   screen rather than two. The postures left are the ones that belong to a
   place on a page; the corner belongs to the frame.

   THE MIC IS ALWAYS AN ENHANCEMENT. No key, no permission, no MediaRecorder —
   every posture is still a control you can type into. */

export type Posture = "strip" | "field" | "line" | "debrief";

/* ── the surface: ribbon + whatever the stage calls for ── */

function Ribbon({ flow }: { flow: NoteFlow }) {
  const { stage, chosenJob } = flow;
  return (
    <div className="wb2-capribbon">
      {stage === "recording" ? (
        <span className="wb2-recdot" aria-hidden="true" />
      ) : stage === "sorting" || stage === "transcribing" || (stage === "answer" && flow.asking) ? (
        <span className="wb2-spin" aria-hidden="true" />
      ) : stage === "answer" ? (
        /* the mark, not a sparkle — the ribbon says "Answer" and the thing
           that answered is HeyTiff */
        <Chevron size={19} gradient decorative />
      ) : (
        <Icon name="note" size={16} />
      )}
      <b>
        {stage === "recording"
          ? "Recording"
          : stage === "transcribing"
            ? "Reading it back"
            : stage === "answer"
              ? flow.asking
                ? "Looking it up"
                : "Answer"
              : stage === "review"
                ? "Check it before it saves"
                : stage === "sorting"
                  ? "Sorting it out"
                  : flow.debrief
                    ? "Debrief"
                    : /* The button's own words, not "Add a note" — every
                         posture routes questions as readily as notes, and
                         the title was the last thing still claiming
                         otherwise. */
                      "Ask or tell Tiff"}
      </b>
      {flow.debrief ? (
        <span className="wb2-chip">Tasks, knowledge &amp; your notes</span>
      ) : flow.targetLabel ? (
        /* THE TAG. What the screen underneath handed up, and the note lands
           on it — but standing on a job card is not the same as talking about
           that job, so it comes off. Dropping it is a per-capture thing; the
           next time you open this, the tag is back. */
        <span className="wb2-chip blue wb2-aim">
          {flow.targetLabel}
          <button
            type="button"
            className="wb2-aimx"
            onClick={flow.dropAim}
            title="This isn't about that — take the tag off"
            aria-label={`Not about ${flow.targetLabel} — take the tag off`}
          >
            <Icon name="x" size={11} />
          </button>
        </span>
      ) : (
        <span className="wb2-chip">{chosenJob ? chosenJob.clientName : "General note"}</span>
      )}
      {/* The clock is NOT here during a recording any more. It used to sit
          in this corner at 12.5px, 23px wide, behind a static 79px chip —
          the one number on the card that changes, and the hardest thing on
          it to read. It now leads the trace at 26px, where you are already
          looking. Every other stage keeps its corner clock. */}
      <button className="wb2-ico" onClick={flow.close} title="Discard" aria-label="Discard">
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

/* ── THE DEFAULT SWITCH ──

   Isaac wanted the preference SAID OUT LOUD rather than inferred from which
   button you last pressed: a switch that reads "Default", with Talk and Type
   on it, so what the Tiff button will do next time is never a thing you have
   to remember. That label is also what makes storing the preference safe at
   all — see ./capture-default.

   IT IS ONE CONTROL DOING ONE THING, not two. Flipping it sets the default
   AND puts you in that mode now, because the alternative is a row carrying
   both a "Talk" button and a Talk segment that don't do the same thing.
   Switching to Talk starts listening; switching to Type hands the words over
   to the box (never discarding them — see `handOver` in ./dictation).

   IT ONLY APPEARS WHERE THE DEFAULT APPLIES. Spotted live 2026-08-10: the
   switch was in the shared body, so the DEBRIEF sheet wore it too — a sheet
   that opens from its own two-door capsule and never consults the stored
   mode. It sat there reading "DEFAULT · Talk" above a text box, promising
   something that surface does not do, and pressing it would have silently
   rewritten the Tiff button's default from a screen with no authority over
   it. Everywhere but the Tiff button's sheet, the same choice is offered as
   what it actually is there: a one-off, in `ModeControl` below.

   Absent where the deployment cannot hear: a choice with one option is not a
   choice, it is furniture. */
function DefaultSwitch({ flow }: { flow: NoteFlow }) {
  const talk = flow.mode === "talk";
  return (
    <span className="wb2-modesw">
      <span className="wb2-modelbl" id="wb2-modelbl">
        Default
      </span>
      <span className={"wb2-modeseg" + (talk ? "" : " type")} role="group" aria-labelledby="wb2-modelbl">
        {/* The thumb is decoration over the two real buttons — it slides,
            they stay hit-targets. */}
        <span className="wb2-modethumb" aria-hidden="true" />
        <button
          type="button"
          className="wb2-modeopt"
          aria-pressed={talk}
          onClick={() => {
            flow.chooseMode("talk");
            if (!flow.dict.recording) flow.dict.start();
          }}
        >
          <Icon name="mic" size={13} />
          Talk
        </button>
        <button
          type="button"
          className="wb2-modeopt"
          aria-pressed={!talk}
          onClick={() => {
            flow.chooseMode("type");
            if (flow.dict.recording) flow.dict.handOver();
          }}
        >
          <Icon name="keyboard" size={13} />
          Type
        </button>
      </span>
    </span>
  );
}

/** The row's mode control. The labelled switch where the stored default is
    actually in play; a plain one-off button everywhere else — the debrief
    and the field postures already chose their way in, and offering them a
    "default" would be a setting that governs a different screen. */
function ModeControl({ flow }: { flow: NoteFlow }) {
  if (!flow.scope.voiceEnabled) return null;
  /* WHILE THE MIC IS OPEN THE SWITCH STEPS BACK, and this check has to come
     before the `governsDefault` one or the sheet that owns the default keeps
     wearing it mid-recording. Audited 2026-08-10: the strongest position on
     the action row went to a control about what the Tiff button does NEXT
     time, with its Talk half already pressed — half of it inert, all of it
     about later. The only live-useful thing there is the way out to the
     keyboard, so during a recording that is all it is. The default returns
     the moment the mic closes, which is the only place you can act on it. */
  if (flow.dict.recording)
    return (
      <button className="pbtn ghost wb2-modeone" onClick={flow.dict.handOver}>
        <Icon name="keyboard" size={15} />
        Type instead
      </button>
    );
  /* AND IT STEPS BACK AGAIN ONCE THERE ARE WORDS. Isaac, 2026-08-10: "when
     you record a message in Claude, you can hit enter, then tap the mic again
     to keep adding."

     The card already did exactly that — every leg appends, and a note spoken
     across three recordings is one note. What it did not have was anything
     that LOOKED like it. With words in the box, the way back to the mic was
     the left half of a switch labelled DEFAULT: a preference control, in the
     strongest position on the row, that happens to start recording. Nothing
     about it says "add more".

     So the switch owns the empty box, where "what should this button do next
     time" is a fair question to be asked, and gets out of the way the moment
     there is something to add to. Every capture opens empty, so the
     preference is still one press from reachable at the start of each one. */
  const words = Boolean(flow.text.trim());
  if (flow.governsDefault && !words) return <DefaultSwitch flow={flow} />;
  /* KEEP TALKING, AND ON THE RIGHT (Isaac, 2026-08-10): "the screen to add
     more text just says TALK on the left, which is not very helpful."

     Two faults, one control. `Talk` is the right word for an empty box —
     there is nothing yet to keep doing — and the wrong one over a box with a
     sentence in it, where the only question is whether you are adding to it.
     And the left edge is where this row keeps its SETTINGS: it held the
     Default switch, so a button parked there reads as chrome rather than as
     the thing to press next.

     So once there are words it says what it does and stands where the actions
     are, beside Go. `.wb2-capact` is `justify-content:flex-end`, so right is
     simply what happens when the left-anchoring margin comes off — see
     `.wb2-keeptalk`. */
  return (
    <button
      className={"pbtn ghost wb2-talk" + (words ? " wb2-keeptalk" : "")}
      onClick={flow.dict.start}
      disabled={flow.busy}
    >
      <Icon name="mic" size={15} />
      {words ? "Keep talking" : "Talk"}
    </button>
  );
}

/** What the bars are doing, in words.

    The meter has always carried this and nobody could read it — five bars at
    6px are the same picture whether the room is quiet or the microphone is
    dead. `hearing` is false when the meter could not start at all, so this
    never claims deafness it cannot prove: the silent line says only that
    nothing is arriving, which is true either way. */
function HeardLine({ hearing }: { hearing: boolean }) {
  return (
    <span className={"wb2-heard" + (hearing ? " on" : "")} aria-live="polite">
      {hearing ? "Hearing you" : "Not hearing anything"}
    </span>
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
    /* WHAT YOU HAVE ALREADY SAID STAYS ON SCREEN (Isaac, 2026-08-10, walking
       a second leg): "if I click talk, it looks like you're starting again
       because it doesn't show you what text it's already got on there."

       It was never starting again — every leg appends, and the words were
       safe in `flow.text` the whole time. But this stage REPLACED the box
       with the trace, so a second leg looked exactly like a first one. The
       card was hiding the only evidence that it had kept anything.

       The field posture has always got this right (`shown` in `FieldMic`
       below): the box keeps showing what is there, with the live words joined
       on by `appendSpoken` — the same join the committed transcript uses, so
       nothing jumps when the recording ends. This is that, on the card.

       It appears only once there is something to show, so a first leg on the
       batch transport is still the trace alone rather than an empty box. */
    /* GUARDED, the same way `FieldMic` guards it. `appendSpoken` joins with a
       space and does not care that the second half is empty, so calling it
       with no interim leaves a trailing space on every batch recording — the
       reason the field posture has always written this as a conditional
       rather than a call. */
    const sofar = flow.dict.interim ? appendSpoken(flow.text, flow.dict.interim) : flow.text;
    const words = Boolean(sofar.trim());
    return (
      <div className="wb2-caprec">
        {words && (
          <textarea
            className="wb2-notes wb2-recsofar"
            value={sofar}
            readOnly
            rows={3}
            aria-label="What you have said so far"
          />
        )}
        {/* THE INSTRUMENT, NOT AN ORNAMENT (audited 2026-08-10). This stage
            used to be a 680px card that was 86% empty with a 36px meter
            marooned in the middle of it, and the middle was empty because it
            is reserved for words that only the live transport ever delivers.

            Now the reserved space IS the meter until there are words to put
            in it: the orb takes the middle at a size worth looking at, the
            clock sits beside it at a size worth reading, and a line under
            that says in words what the sphere is doing — which is the
            question Isaac actually had ("is this thing hearing me?") and the
            one thing five 6px dots could never answer.

            IT IS THE SAME COMPONENT THE ASK BAR USES, and that is the point
            of it being here rather than a second meter built for this card.
            The 48-bar trace that used to hold this slot existed because a
            bar's only channel is its height, so the resting state had to be
            made large to survive being read as dead. The sphere turns as well
            as grows, so the card asks for a bigger one and gets it from the
            stylesheet — no second component, and nothing to drift. */}
        <div className={"wb2-recwave" + (words ? " with-words" : "")}>
          <div className="wb2-recmeta">
            <DictClock seconds={flow.dict.seconds} big />
            <HeardLine hearing={flow.dict.hearing} />
          </div>
          <LevelOrb innerRef={flow.dict.barsRef} />
        </div>
        <div className="wb2-capact">
          {/* Flipping this to Type is the way out of the mic, and it keeps
              every word — `handOver` puts what you have said in the box
              rather than routing it, so changing your mind mid-sentence
              costs nothing. */}
          <ModeControl flow={flow} />
          {/* START THAT ONE AGAIN (Isaac, 2026-08-10). The way to redo a
              fluffed recording was to close the card — losing the tag it
              came with — and open it again. It BINS what you have said, on
              purpose and without asking: a confirm step would make the fast
              path slower than starting over by hand, and the two chimes
              (thrown away, then listening) are the receipt.

              Ghost, not primary. It is the recovery, and the card must not
              offer two bright buttons to a person mid-sentence. */}
          <button
            className="pbtn ghost"
            onClick={flow.dict.restart}
            title="Bin this one and start the recording again"
          >
            <Icon name="rotate" size={14} sw={1.9} />
            Start again
          </button>
          {/* DONE, NOT GO (Isaac, 2026-08-10, after walking it on prod:
              "annoyingly you have to push go twice").

              It was Go for half a day, on the argument that both presses are
              simply the way onward. Walking it says otherwise: you press a
              button called Go, and nothing goes — it stops the mic and hands
              you a box to check. Two presses is the design and it is the
              right one (nothing routes off a transcript; see note-flow), but
              only ONE of them commits anything, and that is the one allowed
              to be called Go.

              So this stage ends with `Done` and the next one commits with
              `Go`. A chat composer works the same way: the mic button stops,
              the send button sends, and nobody confuses them.

              AND THE SQUARE IS GONE. It survived two rounds of argument —
              "that black square next to go is weird", answered by making it
              smaller, thinner and paler — and Isaac's verdict on the third
              look was that it is still stupid. He is right, and the reason is
              that the original defence stopped being true: the glyph was
              there because the word "Go" did not say the microphone was
              closing. "Done" does. A stop mark beside it is the same thing
              said twice, in the fussiest possible way. */}
          <button className="pbtn wb2-prim" onClick={flow.dict.stop}>
            Done
          </button>
        </div>
      </div>
    );
  }

  if (stage === "transcribing") return <p className="wb2-hint">Reading it back…</p>;

  if (stage === "answer") {
    return (
      <div className="wb2-ans">
        {/* The question, echoed — by the time an answer streams, the box it
            was typed into is gone, and an answer with no visible question
            reads like the widget talking to itself. */}
        <p className="wb2-ansq">{flow.text}</p>
        {flow.askTools.length > 0 && (
          <div className="wb2-anstools">
            {flow.askTools.map((label) => (
              <span className="wb2-anstool" key={label}>
                <Icon name="search" size={11} />
                {label}
              </span>
            ))}
          </div>
        )}
        <p className="wb2-anstext" aria-live="polite">
          {flow.askText}
          {flow.asking && <span className="wb2-anscursor" aria-hidden="true" />}
        </p>
        <div className="wb2-capact">
          <button className="pbtn ghost" onClick={flow.askAgain} disabled={flow.asking}>
            Ask another
          </button>
          <button className="pbtn" onClick={flow.close}>
            Done
          </button>
        </div>
      </div>
    );
  }

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
              : "Tell Luke he needs to order the grilles… or ask: what's outstanding here?"
          }
          disabled={flow.busy}
        />
        {/* The ceiling, explained where it happened. Nothing was lost and
            nothing was filed — this is a pause, so it says what to do next
            rather than apologising. */}
        {/* After the ceiling there are ALWAYS words in the box, so the button
            this points at reads "Keep talking" — the hint has to say the name
            that is actually on the row, or it is the stop-and-read bug again:
            an instruction naming a control that is not there. */}
        {flow.ranOut && (
          <p className="wb2-hint" role="status">
            Two minutes — that&apos;s the limit for one recording. It&apos;s all in the box; press
            Keep talking to carry on where you left off.
          </p>
        )}
        {/* DISCARD IS GONE FROM BOTH STAGES. It called `flow.close`, which is
            exactly what the ribbon's × does — two controls, one behaviour,
            and the × is present in every stage while Discard never was. */}
        <div className="wb2-capact">
          <ModeControl flow={flow} />
          {/* IT ARRIVES WITH THE WORDS (Isaac, 2026-08-10). It used to sit
              there greyed out on an empty sheet — a dead control is a
              question you have to answer every time you look at it. Now the
              row is quiet until there is something to sort, and the button
              appearing IS the signal that there is.

              AND IT IS CALLED "GO" (Isaac, 2026-08-10). "Sort this out" was
              the button describing its own machinery; by the time it appears
              there is one thing to do with the words in the box and no
              choice left to explain. The accessible name moves with the
              visible one — a label a screen reader reads as something other
              than what is printed on it is its own bug. */}
          {flow.text.trim() && (
            <button
              className="pbtn wb2-prim"
              aria-label="Go"
              onClick={() => flow.submit(flow.text)}
              disabled={flow.busy}
            >
              {flow.busy ? "Reading…" : "Go"}
            </button>
          )}
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
        /* A debrief used to pass null unconditionally, because it could not
           name a job at all. It can now, so when one is picked the cascade
           says so — that line is the only confirmation the pin took. With
           none picked a debrief still says nothing here, which is its normal
           case rather than a gap. */
        jobLabel={flow.targetLabel ?? (flow.chosenJob ? describeJob(flow.chosenJob) : null)}
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
  if (!flow.note || flow.targetLabel || flow.scope.jobs.length === 0) return null;
  return (
    <>
      {/* THE DEBRIEF GETS THIS TOO NOW (Isaac, 2026-08-13: "in this particular
          voice note, I mentioned a job, but I couldn't find one"). It used to
          return null here, on the argument that a debrief spans jobs and
          pinning the whole thing to one would un-say that. True of a debrief
          that never named a job — and no help at all to one that named a job
          the matcher could not resolve, which said "No job named" and offered
          nothing to do about it.

          WHAT CHANGES IS THE TONE, not the control. Naming no job is the
          NORMAL case for a debrief, not a problem, so it takes the note glyph
          and a plain statement; on every other posture a note that landed
          against nothing is a thing to fix, and keeps its alert. */}
      <div className={"wb2-capjob" + (flow.chosenJob ? " on" : "")}>
        <Icon
          name={flow.chosenJob ? "check" : flow.debrief ? "note" : "alert"}
          size={14}
        />
        <span>
          {flow.chosenJob ? (
            <>
              Sounds like <b>{describeJob(flow.chosenJob)}</b>
            </>
          ) : flow.guess.ambiguous ? (
            "More than one job matches what you said."
          ) : flow.debrief ? (
            "Not about one job — say which, if it was."
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
   everything at once and let the sorting be the machine's problem. It opens
   the same sheet as every other posture; only the framing and the brain's
   instructions differ. Typing is as first-class here as everywhere else.

   IT IS THE GLOBAL BUTTON, IN A BAR (Isaac, 2026-08-12). Four shapes now:

     the cyan pill      the app's language from before the Tiff button existed
     the ink capsule    dark face, gradient rim, mic half beside the word
     just "Debrief"     a word on a glass capsule
     this               the row IS the button, and it wears `TiffMark`

   THE CAPSULE DIED OF ITS OWN MATERIAL. It was the topbar button's glass —
   `rgba(255,255,255,.08)` — which works on the topbar's near-black but
   composites to 1.29:1 against the glass card it ended up on. On the topbar
   the fill was never the thing doing the work: a breathing halo sits behind
   it and the chevron-and-sparkle sit inside it. #327 removed both, rightly,
   when the control was a word on Tiff's own ink — but on a lighter ground
   that left a bright gradient rim around a fill nobody could see, and the
   card already wears that same gradient. Two outlines, one hollow shape.

   So the mark comes back, and the WORD stays: the rule this posture was
   built on is "never an icon alone, because what does the sparkle do is a
   question a 6am brain shouldn't have to ask". The bar is the label and the
   hit area; the mark is what makes it recognisably Tiff's. #327's argument
   does not carry over, because that was about a mark on a control sitting on
   an ink console — here the mark IS the control's contrast.

   THE MARK LEADS AND THE COPY IS THREE WORDS (Isaac, 2026-08-12). It read
   "Say the day — anything you'll forget, and it gets sorted", which is a
   sales promise, not this app's voice: "tag line is cheesy". `Debrief` is
   already the app's own noun for these entries (the record counts "2
   debriefs" and the sheet is labelled "Morning debrief"), so the verb costs
   no new vocabulary.

   The mark's host is a SPAN taking `.tiffbtn-topbar` (which owns the 44px
   box, the face, the halo and the spark's placement) but NOT `.tiffbtn` —
   the same split #325 arrived at, for the same reason: a button inside a
   button is invalid, and `.tiffbtn`'s cursor and lift belong to the bar now.
   Its hovers are re-pointed at `.hm-say:hover` in shell.css. */

function DebriefButton({ flow }: { flow: NoteFlow }) {
  const barRef = useRef<HTMLButtonElement | null>(null);
  const wasOpen = useRef(false);

  /* The bar is where you were when you opened it, and it is where you should
     be when it shuts — the card that replaced it is gone by then, so focus
     would otherwise fall to the top of the document. */
  useEffect(() => {
    if (wasOpen.current && !flow.open) barRef.current?.focus();
    wasOpen.current = flow.open;
  }, [flow.open]);

  if (!flow.open) {
    return (
      <div className="wb2-tokdock hm-saydock">
        <button
          ref={barRef}
          type="button"
          className="hm-say"
          /* NOT `haspopup="dialog"` any more: what opens is this row becoming
             the card, in the page, with everything around it still live. */
          aria-expanded={false}
          onClick={() => flow.setOpen(true)}
        >
          {/* Decorative: the bar's own words are its accessible name, and a
              mark announced beside them would be the label said twice. */}
          <span className="hm-saymk tiffbtn-topbar" aria-hidden="true">
            <TiffMark chevron={20} spark={13} halo />
          </span>
          <span className="hm-saytx">Debrief the day</span>
        </button>
        {flow.done && <span className="wb2-chip ok">{flow.done}</span>}
      </div>
    );
  }

  /* THE DEBRIEF HAPPENS IN THE PAGE (Isaac, 2026-08-12) — capture AND review,
     in the bar's own slot, on the card the journal is already on.

     The floating sheet stays exactly as it is for the topbar door; this is the
     one posture that had a place on a page to grow into. What that costs is a
     scrim, which was doing three jobs: it dimmed the page, it caught the click
     that closed the sheet, and it was the reason the thing counted as modal.
     None of them survive the move, and none of them should — nothing here is
     modal, the tabs and the record stay live, and the ribbon's × was always
     the real close (`flow.close`, on every stage). Escape still closes, from
     `useNoteFlow`'s own key handler.

     IT WEARS `wb2-capcard`, AND THAT IS THE WHOLE POINT (Isaac, 2026-08-13:
     "match how the global one does it but in line"). Every fill, every button
     skin, the dusk capture surface and the light review are keyed on that
     class — sixteen-odd rules the sheet has always had. The first version of
     this card left it off and RESTATED them under `.fg .hm-cap`: forty rules
     copying a system they could only drift from, and they already had — the
     review stayed ink here while the sheet crossfaded to light, so the same
     content wore different clothes depending on which door you came through.

     IT STAYS DUSK ALL THE WAY DOWN, which is the one place it does NOT follow
     the sheet (Isaac, 2026-08-13: "All sections of the debrief part should
     have the same background. No white."). The sheet hands back to light for
     the review because it is a white card floating over a white page and the
     review's dozen components were tuned for that. This card is a panel
     inside Home's ink card — a white block halfway down it is a second
     surface appearing mid-flow, on a screen that is one piece of glass.

     So the review family wears dusk here, and those rules live with the SKIN
     (`.wb2-capcard.wb2-dusk`, in shell.css) rather than with this posture —
     they describe what a review looks like on ink, wherever that ink is. */
  return (
    <section className="wb2-capcard hm-cap wb2-dusk" aria-label="Debrief">
      <Ribbon flow={flow} />
      {flow.error && <p className="wb2-sherr">{flow.error}</p>}
      {/* Same slot the sheet puts it in — between the error and the body. */}
      <JobLine flow={flow} />
      <Body flow={flow} />
    </section>
  );
}

/* ── posture: capsule ── */

/* THE DUSK SKIN. Until the review arrives the card wears the frame's own
   material — ink glass, gradient edge, white type — and the moment the
   review lands it hands over to the light work surface it has always been.
   The split is deliberate, not unfinished: capture is Tiff's moment and
   reads at a glance; the review is dense reading with a dozen tuned light
   components (ticks, selects, state colours) that a dark pass would have to
   re-earn one by one. Deriving it from the stage keeps every posture and the
   debrief consistent for free. */
const duskClass = (flow: NoteFlow) => (flow.stage === "review" ? "" : " wb2-dusk");

/** The capture surface, portalled. One copy: the Tiff button and the field
    postures open the SAME sheet, which is the whole argument of the
    unification — what you get should not depend on which control you reached
    it through. `entrance` only changes how it ARRIVES: the Tiff button hands
    in "blossom" so the sheet grows out of the button, and `from` is where —
    the button's own offset from the viewport centre, measured on click. */
export function CaptureSheet({
  flow,
  entrance,
  from,
}: {
  flow: NoteFlow;
  entrance?: "blossom";
  from?: { dx: number; dy: number } | null;
}) {
  if (!flow.open) return null;
  return createPortal(
    <>
      <div className="wb2-capdim" onClick={flow.close} />
      {/* KEEPS `wb2-capcard` DELIBERATELY. Sixteen rules in shell.css name
          that class to give a PORTALLED surface its button fills, type sizes
          and disabled states — anything declared under `.fg` is absent out
          here, and the capture card shipped once with colourless primary
          buttons for exactly this reason. `wb2-caps` only moves it. */}
      <div
        className={
          "wb2-capcard wb2-caps" + duskClass(flow) + (entrance === "blossom" ? " wb2-blossom" : "")
        }
        /* The keyframe reads these; with no measurement it falls back to 0,0
           and simply grows from the middle rather than breaking. */
        style={
          from
            ? ({ "--cap-dx": `${from.dx}px`, "--cap-dy": `${from.dy}px` } as React.CSSProperties)
            : undefined
        }
        role="dialog"
        aria-modal="true"
        aria-label={flow.debrief ? "Day debrief" : "Add a note"}
      >
        <span className="wb2-grab" aria-hidden="true" />
        <Ribbon flow={flow} />
        {flow.error && <p className="wb2-sherr">{flow.error}</p>}
        <JobLine flow={flow} />
        <Body flow={flow} />
      </div>
    </>,
    document.body
  );
}

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
            <LevelOrb innerRef={dict.barsRef} />
            <DictClock seconds={dict.seconds} />
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
      {/* a task was spotted, so the glyph is a task list. The sparkle said
          "something clever happened here", which is not the offer — the offer
          is that there is work buried in what you just wrote. */}
      <Icon name="listCheck" size={15} />
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
  as,
  label = "a note",
  value,
  onChange,
  onCommit,
  placeholder,
  rows = 3,
  disabled = false,
  className,
}: {
  /** Where this one is standing. No default: the corner — the only posture
      that was ever the obvious one — is now the Tiff button in the frame. */
  as: Posture;
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
     opens — which is the entire point of the unification. `wb2-capcard` was
     missing here alone of the three portal sites, which left this copy
     outside the sixteen rules that give the portalled card its fills and
     positioning — the exact bug the CaptureSheet comment warns about. */
  const surface =
    flow.open &&
    createPortal(
      <>
        <div className="wb2-capdim" onClick={flow.close} />
        <div
          className={"wb2-capcard wb2-caps" + duskClass(flow)}
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
              <LevelOrb innerRef={dict.barsRef} />
              <DictClock seconds={dict.seconds} />
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
              <LevelOrb innerRef={dict.barsRef} />
              <DictClock seconds={dict.seconds} />
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
