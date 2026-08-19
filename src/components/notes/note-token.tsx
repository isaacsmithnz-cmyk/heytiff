"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";
import { Chevron } from "@/components/logo";
import { LiveWords, appendSpoken, useDictation } from "./dictation";
import { RecordingCard, RecordingMeter } from "./recording-card";
import { READING_BACK_NOTE } from "./waits";
import { Waiting } from "@/components/ui/orb";
import { DotField, useDotFieldExit } from "@/components/ui/dot-field";
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
  /* NO SECOND INDICATOR WHILE THE CLOUD IS UP. The crescent was the sort's
     spinner, from when the wait below it was three static-looking bars; now
     that the mark is in flight for the whole of it, a spinner beside the
     word is the same fact told twice — the thing this ribbon has already
     dropped a title and a caption for. The words stay: they are what names
     the wait, and what a screen reader gets. */
  const thinking = stageField(flow) === "cloud";
  return (
    <div className="wb2-capribbon">
      {stage === "recording" ? (
        <span className="wb2-recdot" aria-hidden="true" />
      ) : thinking ? null : stage === "answer" ? (
        /* the mark, not a sparkle — the ribbon says "Answer" and the thing
           that answered is HeyTiff */
        <Chevron size={19} gradient decorative />
      ) : (
        <Icon name="note" size={16} />
      )}
      {/* NOTHING NAMES THE WAIT. "Reading it back" was the last thing on this
          card describing itself while the field below was already saying it —
          the same doubling the sheet has been cut back for twice. The stage is
          the animation; what is left up here is the tag and the way out.
          `CaptureSheet` keeps announcing it to a screen reader, which gets
          nothing at all from a field of dots. */}
      <b hidden={stage === "transcribing"}>
        {stage === "recording"
          ? "Recording"
          : stage === "transcribing"
            ? ""
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
      {/* The read-back has no visible name — see the title above — so it says
          itself here instead. Kept inside the ribbon rather than beside the
          field so there is still exactly one of it on the card. */}
      {stage === "transcribing" && (
        <span className="wb2-sr" role="status">
          {READING_BACK_NOTE}
        </span>
      )}
    </div>
  );
}

/** The row's way back to the microphone. It used to be TWO controls — a
    labelled DEFAULT switch on the surface that owned the stored preference,
    a plain button everywhere else — and the switch went with the preference
    when the card learned to ask (see `choice` in ./note-flow). What is left
    is the button that was always the useful half. */
function ModeControl({ flow }: { flow: NoteFlow }) {
  if (!flow.scope.voiceEnabled) return null;
  /* THE MID-RECORDING BRANCH IS NOT HERE ANY MORE. While the mic was open
     this rendered the one live-useful thing on that row — "Type instead" —
     and it has moved into the shared recording card (./recording-card),
     which is the only stage that ever reached it. Leaving a copy behind
     would be the same button in two files, differing eventually.

     What is left is what this control is actually for: the choice offered
     around an idle box. */
  /* IT STEPS BACK ONCE THERE ARE WORDS. Isaac, 2026-08-10: "when
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
  /* AND IT ONLY SAYS "KEEP" IF YOU HAVE (Isaac, 2026-08-18, walking the new
     door): "if I hit Type instead, when I'm on the typing screen it says Keep
     talking, which isn't correct — that should change to Switch to talk."

     The label was reading the BOX, which was the whole truth back when every
     capture started at the microphone: words in it meant words you had said.
     A door on the front breaks that — a full box is now just as likely to be
     a box you typed — and what is left is a control inviting you to carry on
     doing something you never started. That is the stop-and-read bug the
     ceiling hint below is so careful about, in reverse: a button naming a
     thing that did not happen.

     `flow.spoke` is the honest question. It is already the flag the router
     files the note's SOURCE from, and it is sticky for the whole capture, so
     talk-then-tidy-by-keyboard still reads "Keep talking" — the same rule in
     both places, which is why this reuses it rather than growing a second
     one. Typed from the door reads "Switch to talk": what the press does,
     rather than what you were supposedly already doing.

     THE PLACE STILL FOLLOWS THE BOX, not the voice. Standing right is about
     being an action beside Go instead of a setting on the left edge, and that
     is equally true of either word — see `.wb2-keeptalk`. */
  const label = flow.spoke ? "Keep talking" : words ? "Switch to talk" : "Talk";
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
      disabled={flow.busy || flow.dict.transcribing}
    >
      <Icon name="mic" size={15} />
      {label}
    </button>
  );
}

/* THE INSTRUMENT SPANS THE STAGES, so it cannot live inside one.

   The field is the mark while you talk and the cloud while Tiff reads it back,
   and the whole point is that it is the SAME dots making that journey. Rendered
   inside each stage's own branch it would be a different element on either side
   — React would unmount one and mount the other, and the flight would become a
   cut. So it is mounted once, above the branch, and told which it is.

   `useDotFieldExit` is what lets it leave. The wait ending unmounts everything
   below, and an unmounted element cannot animate; the hook holds the field for
   the length of the drop and then lets go. */
function stageField(flow: NoteFlow): "mark" | "cloud" | null {
  /* THE MARK IS UP BEFORE YOU HAVE CHOSEN (Isaac, 2026-08-18, first walk of
     the door): "I've clicked the global button, it comes up as talk or type,
     but I've got no animation in there — we should have the chevron
     animation, like we do on the talking screen."

     The door shipped as two buttons over nothing, and the gap was more than
     a missing flourish: the instrument was BUILT by the press, so choosing
     Talk grew 268px of card under your thumb at the same moment the
     microphone opened. The one stage that is supposed to be calm ended in a
     jump.

     Standing the mark on the door fixes both halves. The chevron is already
     there and already swelling, Talk changes only what is underneath it, and
     it is the same element on either side of the press — which is the rule
     this whole field exists to keep (see the note above). A door with the
     mark on it is also the only place in the app where the logo is simply
     itself, waiting, which is what a stage with nothing running should look
     like. */
  if (flow.stage === "door" || flow.stage === "recording") return "mark";
  /* THE CLOUD IS THE WHOLE WAIT, not the read-back (Isaac, 2026-08-17): "it
     brings up our nice animation, but it's so short because it's only
     confirming the words. The animation should really be used when it's
     thinking about how to sort the tasks out."

     He is describing the shape of the two waits. Reading a recording back is
     a second or two, and it used to own the mark's whole flight — the dots
     barely reached the cloud before the field was pulled and the skeleton
     rows took over. Sorting is the LONG one: about seven seconds, measured,
     of Tiff working out what the words become. The animation was ending
     precisely where the thinking began.

     So the cloud now spans every wait where Tiff has the words and there is
     nothing yet to show: the read-back, the sort, and the gap before an
     answer starts streaming. One flight, mic to result — which is also the
     only version where the mark leaving the chevron reads as a journey
     rather than a flourish.

     The skeleton rows went with it. They were the sort's own indicator, and
     two things saying "working" at once is the doubling this card has been
     cut back for twice; the honest one is the one that started when the mic
     closed and is still going. */
  if (flow.stage === "transcribing" || flow.stage === "sorting") return "cloud";
  /* An answer that has begun arriving is its own progress — the words are
     the thing, and a cloud over them would be the card still claiming to be
     thinking while it talks. */
  if (flow.stage === "answer" && flow.asking && !flow.askText) return "cloud";
  return null;
}

function Body({ flow, from }: { flow: NoteFlow; from?: { dx: number; dy: number } | null }) {
  const field = useDotFieldExit(stageField(flow));
  return (
    <>
      {/* THE BOX CLOSES BEHIND THE DOTS. The field is 268px of the card, and
          it used to vanish in one frame when `useDotFieldExit` let go — which
          was survivable while the thing underneath was an empty stage and is
          not now that the review lands there, because a dense card would jump
          268px up the moment the last dot went. `go` closes the gap over the
          back half of the drop, so the review rises into the space rather
          than being thrown into it. */}
      {field && (
        <div className={"wb2-capfield" + (field === "fall" ? " go" : "")}>
          {/* `from` is what makes the mark ARRIVE rather than appear — it is
              the button's own offset, handed down from the sheet, and it is
              absent everywhere there is no button to have flown out of. */}
          <DotField stage={field} size={252} from={from} />
        </div>
      )}
      <StageBody flow={flow} />
    </>
  );
}

function StageBody({ flow }: { flow: NoteFlow }) {
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
       hang — and the moving thing is now the cloud above, which has been in
       flight since the mic closed. The skeleton rows that used to stand here
       were the other half of the doubling that comment warns about: three
       bars claiming the shape of a review, under a mark that was already
       saying "working" and had just been cut short to make room for them.

       WHAT IS LEFT IS THE NOTE, and it is the reason this stage has a body
       at all: the next screen asks you to confirm what was made of your
       words, and this is the only quiet moment you get to re-read them.
       `role="status"` is what a screen reader gets from the wait — a field
       of dots has nothing to say to one. */
    return (
      <div className="wb2-sorting" role="status" aria-live="polite">
        <p className="wb2-sortnote">{flow.text}</p>
      </div>
    );
  }

  if (stage === "door") {
    /* TWO BUTTONS AND NOTHING RUNNING. The card opens here now: no microphone
       listening, no caret blinking, no preference deciding on your behalf
       (Isaac, 2026-08-18). It is the whole of the stage's CONTROLS on purpose
       — a choice you have to hunt for on a card doing three other things is
       the switch this replaced. The mark above it is not a fourth thing to
       read: it is the same instrument the recording stage stands on, mounted
       one stage earlier so the press changes nothing but the row (see
       `stageField`).

       TALK LEADS because talking is the case the button was built for, and it
       opens the microphone in the same press: a "Talk" that only sets a mode
       and waits for a second press is the tax the remembered default existed
       to avoid. Type is the ghost beside it, same size, same row — a second
       choice, not a fallback. */
    return (
      <div className="wb2-capdoor">
        <button type="button" className="pbtn wb2-prim" onClick={flow.talk}>
          <Icon name="mic" size={17} />
          Talk
        </button>
        <button type="button" className="pbtn ghost" onClick={flow.type}>
          <Icon name="keyboard" size={17} />
          Type
        </button>
      </div>
    );
  }

  if (stage === "recording") {
    /* THE SAME CARD EVERY DOOR SHOWS. It used to be written out here, which
       made this the only place it existed and the reason Tiff's ask bar grew
       a different one: a second mic in a different file had nothing to reuse.
       It lives in ./recording-card now — content, not container — so the
       sheet, the debrief and Tiff's composer render one component and cannot
       drift apart. Isaac's rule: the input section is identical throughout;
       only where it stands changes. */
    return <RecordingCard dict={flow.dict} text={flow.text} />;
  }

  /* THE INSTRUMENT, AND THE RIBBON KEEPS THE WORDS — the same division the
     recording stage above already uses, where the ribbon says "Recording"
     and the body shows the clock and the meter without repeating it.

     This was a line of flat grey (`.wb2-hint`, the colour of a caption) for
     the longest silence in a capture: the gap between the mic closing and
     the words arriving. Giving it the postures' full chip was the obvious
     move and it was wrong — rendered, the card read "Reading it back" in the
     ribbon and "Reading it back…" again two lines below it, with a spinner
     beside one and a sphere beside the other. The postures have no ribbon,
     which is exactly why they carry the sentence and this does not. */
  /* Nothing here any more: the field above IS this stage. It was an orb in a
     `.wb2-waiting` box, which was a second instrument mounted at the exact
     moment the first one unmounted — the two never met, so the mark could not
     become the cloud. */
  if (stage === "transcribing") return null;

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
              /* "It gets sorted; nothing is lost" used to close this. The
                 first half is the machinery and the second is a promise
                 nobody had asked for a reason to doubt — the same sales
                 voice Isaac cut from the button above ("tag line is
                 cheesy"). What is left is the invitation. */
              ? "Everything on your mind, in any order — jobs, people, things to chase, things you learned."
              : "Tell Luke he needs to order the grilles… or ask: what's outstanding here?"
          }
          disabled={flow.busy}
        />
        {/* The ceiling, explained where it happened. Nothing was lost and
            nothing was filed — this is a pause, so it says what to do next
            rather than apologising. */}
        {/* A ceiling only ever follows a recording that produced words, so
            `spoke` and the box are both true here and the button this points
            at reads "Keep talking" — never "Switch to talk". The hint has to
            say the name that is actually on the row, or it is the
            stop-and-read bug again: an instruction naming a control that is
            not there. */}
        {flow.ranOut && (
          <p className="wb2-hint" role="status">
            Two minutes — that&apos;s the limit for one recording. It&apos;s all in the box; press
            Keep talking to carry on where you left off.
          </p>
        )}
        {/* THE WORDS ARE STILL COMING, and you are already typing. This is the
            read-back after "Type instead": the box is yours now, and what you
            said joins it when the transcriber answers (`appendSpoken`, same as
            a second leg). The card owes you one thing here — the fact that
            something is still on its way — and it is the same chip the field
            postures have always used for this exact wait, which is also the
            live region a screen reader hears. The ribbon's hidden copy belongs
            to the OTHER read-back, the one with the cloud and no box. */}
        {flow.dict.transcribing && (
          <Waiting note={READING_BACK_NOTE} className="wb2-dicthint" />
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
              /* NOT WHILE WORDS ARE IN THE AIR. The box is live during a
                 handed-over read-back, so Go is reachable a second before the
                 spoken half of the note arrives — and filing then would send
                 what you typed and silently drop what you said. */
              disabled={flow.busy || flow.dict.transcribing}
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

/* THE DUSK SKIN, ALL THE WAY DOWN.

   It used to come off at the review: capture was Tiff's moment, checking was
   dense reading, and the review's dozen tuned light components would each
   have to re-earn themselves on ink. They since did — the debrief card in
   Home's journal is the same review on the same dusk skin, and every rule it
   needs already lives with the skin as `.wb2-capcard.wb2-dusk …` in
   shell.css rather than with that posture.

   So the split was costing what it was always going to cost: you press one
   button, watch a dark card listen and think, and it hands you a white one
   (Isaac, 2026-08-17: "it's also still got a white card instead of the dark
   glass"). Isaac already ruled on this shape once for the debrief — "All
   sections should have the same background. No white." — and the sheet is
   the same flow through the same stages.

   It stays a named thing rather than being inlined at the three mount
   points, because the argument above is the kind that gets re-litigated and
   it should be re-litigated in one place. */
const DUSK = " wb2-dusk";

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
          "wb2-capcard wb2-caps" + DUSK + (entrance === "blossom" ? " wb2-blossom" : "")
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
        <Body flow={flow} from={entrance === "blossom" ? from : null} />
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
  const busy = disabled || dict.recording || dict.transcribing;
  /* WHEN THE FIELD HANDS ITS BOX TO THE RIVER. Any time there are live words,
     and from the start of a recording that already has something to show —
     but NOT on an empty field with nothing heard yet, because "Listening…" is
     the only thing saying so until the first word lands, and a placeholder
     needs the field it belongs to.

     `dict.interim` on its own, not `recording &&`: the words are still on
     screen through the read-back, and swapping back to the field for that
     second and then forward again is two moves where the design has none. */
  const river = Boolean(dict.interim) || (dict.recording && value.trim() !== "");

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
        {/* THE WORDS ARRIVE IN THE FIELD'S OWN BOX, not in the field. An
            <input> can only take the sentence as one string, so every partial
            swapped the lot — and worse here than on the card: a disabled input
            never scrolls, so on one line the words being spoken sat off the
            right-hand edge where nobody could read them. The river carries
            `.wb2-stripin` so it is the same 30px box, and it rides SIDEWAYS.

            Only once there is something to show: the field keeps the frame
            while the box is empty, because "Listening…" is the only thing
            saying so before the first word lands. */}
        {river ? (
          <LiveWords line className="wb2-stripin" label={label} said={value} text={dict.interim} />
        ) : (
          <input
            className="wb2-stripin"
            value={value}
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
        )}
        {mic.voiceEnabled && dict.recording ? (
          <>
            {/* THE CARD'S INSTRUMENT, COMPACT. This row showed an orb and a
                clock and nothing else — the two readings a bar has room for
                — while the capture card three doors away showed a third:
                whether anything is actually reaching the microphone. That
                third one is the whole reason the meter was rebuilt, and it
                was missing from every posture that lives on a page. Same
                component, laid along the line instead of stacked. */}
            <RecordingMeter dict={dict} compact />
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
      {dict.transcribing && <Waiting note={READING_BACK_NOTE} className="wb2-dicthint" />}
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
  const busy = disabled || dict.recording || dict.transcribing;
  /* WHEN THE FIELD HANDS ITS BOX TO THE RIVER. Any time there are live words,
     and from the start of a recording that already has something to show —
     but NOT on an empty field with nothing heard yet, because "Listening…" is
     the only thing saying so until the first word lands, and a placeholder
     needs the field it belongs to.

     `dict.interim` on its own, not `recording &&`: the words are still on
     screen through the read-back, and swapping back to the field for that
     second and then forward again is two moves where the design has none. */
  const river = Boolean(dict.interim) || (dict.recording && value.trim() !== "");

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
          className={"wb2-capcard wb2-caps" + DUSK}
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
          {/* Same swap as the strip, in the other one-line posture — see the
              note there. `.wb2-fi` is a 34px box either way. */}
          {river ? (
            <LiveWords line className="wb2-fi" label={label} said={value} text={dict.interim} />
          ) : (
            <input
              className="wb2-fi"
              placeholder={dict.recording ? "Listening…" : placeholder}
              value={value}
              disabled={busy}
              aria-label={label}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                onCommit?.();
              }}
            />
          )}
          {mic.voiceEnabled && dict.recording ? (
            <>
              {/* THE CARD'S INSTRUMENT, COMPACT. This row showed an orb and a
                clock and nothing else — the two readings a bar has room for
                — while the capture card three doors away showed a third:
                whether anything is actually reaching the microphone. That
                third one is the whole reason the meter was rebuilt, and it
                was missing from every posture that lives on a page. Same
                component, laid along the line instead of stacked. */}
              <RecordingMeter dict={dict} compact />
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
        {dict.transcribing && <Waiting note={READING_BACK_NOTE} className="wb2-dicthint" />}
        {mic.err && <p className="wb2-dicterr">{mic.err}</p>}
        {offer}
        {surface}
      </div>
    );
  }

  return (
    <div className={"wb2-dict" + (className ? ` ${className}` : "")}>
      {/* And the same again in the posture closest to the capture card. A
          paragraph has no `rows`, so it is handed the number and the sheet
          works out the height the textarea would have had — measured, 74px
          either way at rows=3. */}
      {river ? (
        <LiveWords
          className="wb2-notes"
          rows={rows}
          label={label}
          said={value}
          text={dict.interim}
        />
      ) : (
        <textarea
          className="wb2-notes"
          rows={rows}
          placeholder={dict.recording ? "Listening…" : placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={busy}
        />
      )}
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
              {/* THE CARD'S INSTRUMENT, COMPACT. This row showed an orb and a
                clock and nothing else — the two readings a bar has room for
                — while the capture card three doors away showed a third:
                whether anything is actually reaching the microphone. That
                third one is the whole reason the meter was rebuilt, and it
                was missing from every posture that lives on a page. Same
                component, laid along the line instead of stacked. */}
              <RecordingMeter dict={dict} compact />
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
            <Waiting note={READING_BACK_NOTE} className="wb2-dicthint" />
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
